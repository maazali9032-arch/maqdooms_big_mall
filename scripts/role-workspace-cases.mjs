import { randomUUID } from "node:crypto";
export async function roleWorkspaceCases({ q, one, denied, login, users, check }) {
  await login(null);
  const production = randomUUID();
  await q("insert into auth.users values($1,$2)", [production, "production@role.test"]);
  await q("insert into profiles(id,full_name) values($1,$2)", [production, "Production Staff"]);
  await q("insert into user_roles(user_id,role_key) values($1,'production')", [production]);
  await login(users.owner);
  const workshop = await one("select id from locations where kind='workshop'");
  const floor = await one(
    "select manage_showroom_location(null,'ROLE-FLOOR','Role showroom floor',true)",
  );
  const assignment = await one(
    "select setup_customer_tailoring_assignment('ROLE-F','Role Factory',null,null,'ROLE-T','Role Tailor',$1)",
    [users.tailor],
  );
  const product = await one(
    "select manage_production_catalog($1,'product',null,'ROLE-P','Role Kurta',true,null,'Defined product')",
    [randomUUID()],
  );
  const design = await one(
    "select manage_production_catalog($1,'design',null,'ROLE-D','Role Design',true,12345,'Recorded design cost')",
    [randomUUID()],
  );
  await login(users.stock_entry);
  const batch = await one(
    "select create_barcode_batch_with_details($1,'Role Provider','2026-10-14',null,$2::jsonb)",
    [
      randomUUID(),
      JSON.stringify([
        {
          name: "Role Cotton",
          quantity: 2,
          rows: [
            { length_mm: 50000, cp_paise_per_m: 40000 },
            { length_mm: 10000, cp_paise_per_m: 40000 },
          ],
        },
      ]),
    ],
  );
  const variants = (await one("select stock_registration_catalog($1)", [batch]))[0].fabric_types[0]
    .variants;
  const before = await one("select workshop_fabric_inventory()");
  check(
    before.find((x) => x.thaan_id === variants[0].thaan_id).cp_paise_per_m === 40000,
    "Stock staff see CP",
  );
  await login(production);
  const stock = (await one("select production_fabric_catalog($1)", [variants[0].code]))[0];
  const item = stock.cuts[0].inventory_item_id;
  check(
    stock.cuts[0].locations.find((l) => l.id === workshop).quantity_mm === 50000,
    "Production scans actual Workshop stock",
  );
  check(!JSON.stringify(stock).includes("cp_paise"), "Production catalog has no CP");
  check(
    (await q("select * from inventory_locations()")).some((l) => l.id === workshop),
    "Production location selector includes Workshop",
  );
  await denied("select production_fabric_projection(null)");
  const catalog = await one("select owner_production_catalog()");
  check(
    !JSON.stringify(catalog).includes("charge_paise"),
    "Production design catalog has no costs",
  );
  const create =
    "select create_production_batch($1,$2,$3,null,'38',2,$4::jsonb,$5,$6::jsonb,null,$7)";
  const args = [
    randomUUID(),
    product,
    design,
    JSON.stringify([assignment]),
    workshop,
    JSON.stringify([{ inventory_item_id: item, quantity: 9000 }]),
    "Explicit 9 metres for two pieces",
  ];
  const job = await one(create, args);
  check((await one(create, args)) === job, "Production issue retry exactly idempotent");
  check(
    (
      await one("select production_fabric_catalog($1)", [variants[0].code])
    )[0].cuts[0].locations.find((l) => l.id === workshop).quantity_mm === 41000,
    "Issue deducts exactly immediately",
  );
  await denied("select workshop_fabric_inventory()");
  await denied("select manage_production_catalog($1,'product',null,'BAD','Bad',true,null,'No')", [
    randomUUID(),
  ]);
  await denied("select complete_production_batch($1,$2,$3,$4)", [
    randomUUID(),
    job,
    "open",
    "Not started",
  ]);
  await one("select progress_owner_production($1,$2,$3,$4,$5)", [
    randomUUID(),
    job,
    "open",
    "in_progress",
    "Started",
  ]);
  await one("select progress_owner_production($1,$2,$3,$4,$5)", [
    randomUUID(),
    job,
    "in_progress",
    "completed",
    "Finished all pieces",
  ]);
  await login(users.stock_entry);
  const receiptArgs = [randomUUID(), job, "completed", "All two garments arrived at Workshop"];
  await one("select complete_production_batch($1,$2,$3,$4)", receiptArgs);
  check(
    (await one("select complete_production_batch($1,$2,$3,$4)", receiptArgs)) === job,
    "Whole receipt retry idempotent",
  );
  await denied("select complete_production_batch($1,$2,$3,$4)", [
    randomUUID(),
    job,
    "completed",
    "Repeated whole batch",
  ]);
  await login(production);
  check(
    (await one("select owner_production_history($1)", [job]))[0].received === true,
    "Production history knows batch received",
  );
  await login(users.owner);
  const pieces = await q(
    "select p.id,i.id inventory_item_id from finished_products p join inventory_items i on i.finished_product_id=p.id where production_job_id=$1",
    [job],
  );
  check(pieces.length === 2, "Exactly planned whole piece count created");
  check(
    (await one(
      "select count(*)::integer from finished_product_materials where production_job_id=$1",
      [job],
    )) === 0,
    "No invented actual consumption allocations",
  );
  check(
    (await one(
      "select count(*)::integer from inventory_movements where production_job_id=$1 and kind='PRODUCTION'",
      [job],
    )) === 2,
    "One receipt movement per piece",
  );
  check(
    (await one(
      "select sum(amount_paise)::bigint from finished_product_cost_allocations where production_job_id=$1",
      [job],
    )) === "360000" ||
      Number(
        await one(
          "select sum(amount_paise) from finished_product_cost_allocations where production_job_id=$1",
          [job],
        ),
      ) === 360000,
    "Issued fabric CP split exactly",
  );
  await denied("select transfer_finished_products($1,$2,$3,$4::jsonb,$5)", [
    randomUUID(),
    workshop,
    floor,
    JSON.stringify(pieces.map((x) => x.id)),
    "Unpriced blocked",
  ]);
  await login(users.stock_entry);
  await one("select set_workshop_product_sp($1,$2,$3::jsonb,$4)", [
    randomUUID(),
    job,
    JSON.stringify(pieces.map((x) => ({ piece_id: x.id, sp_paise: 250000 }))),
    "Set SP in Workshop",
  ]);
  await login(users.owner);
  // Existing transfer API expects an explicit array of piece UUIDs.
  await one("select transfer_finished_products($1,$2,$3,$4::jsonb,$5)", [
    randomUUID(),
    workshop,
    floor,
    JSON.stringify(pieces.map((x) => x.id)),
    "Placed in Showroom",
  ]);
  await one("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
    randomUUID(),
    workshop,
    floor,
    JSON.stringify([{ inventory_item_id: item, quantity: 10000 }]),
    "Showroom fabric",
  ]);
  const listing = await one(
    "insert into listings(title,slug,published,stock_mode) values('Role fabric','role-fabric',true,'linked') returning id",
  );
  const garmentListing = await one(
    "insert into listings(title,slug,published,stock_mode) values('Role garment','role-garment',true,'linked') returning id",
  );
  await login(users.ecommerce_manager);
  const showroom = await one("select showroom_stock(null)");
  const shown = showroom.find((x) => x.id === variants[0].thaan_id);
  check(shown.available_mm === 10000, "Ecom shows only Showroom metres");
  check(!showroom.some((x) => x.id === variants[1].thaan_id), "Workshop-only fabric hidden");
  check(
    !JSON.stringify(showroom).includes("Workshop") &&
      !JSON.stringify(showroom).includes("cp_paise"),
    "Ecom projection contains no reserve or CP",
  );
  check(
    (await one("select count(*)::integer from inventory_movements")) === 0,
    "Ecom cannot read Workshop ledger directly",
  );
  check(
    (await one("select count(*)::integer from thaans")) === 0,
    "Ecom cannot bypass projection using raw Thaans",
  );
  await denied("select workshop_fabric_inventory()");
  await denied("select fabric_stock_catalog()");
  await denied("select consumable_catalog()");
  await one("select link_showroom_listing($1,$2,$3,true)", [
    listing,
    "fabric",
    variants[0].thaan_id,
  ]);
  await one("select link_showroom_listing($1,$2,$3,true)", [
    garmentListing,
    "product",
    pieces[0].id,
  ]);
  await denied("select link_showroom_listing($1,$2,$3,true)", [
    listing,
    "fabric",
    variants[1].thaan_id,
  ]);
  await login(null);
  await q("set role anon");
  const publicCatalog = await one("select storefront_catalog()");
  check(
    publicCatalog.find((x) => x.id === listing).stock[0].available_mm === 10000,
    "Anonymous storefront sees linked Showroom stock only",
  );
  await denied("select showroom_stock(null)");
  await denied("select showroom_stock_projection(null)");
  await denied("select complete_production_batch($1,$2,$3,$4)", receiptArgs);
  await login(users.counter);
  await denied("select complete_production_batch($1,$2,$3,$4)", receiptArgs);
  const reserves = await one("select pos_reserve_variants($1)", [variants[0].code]);
  check(reserves.length === 2, "Counter sees matching variants across stock");
  check(
    reserves
      .find((x) => x.barcode === variants[0].code)
      .cuts[0].locations.some((l) => l.id === workshop),
    "Counter sees reserve availability",
  );
  await denied("select complete_direct_fabric_sale($1,$2,$3::jsonb,null,true,null)", [
    randomUUID(),
    workshop,
    JSON.stringify([{ inventory_item_id: item, quantity_mm: 1000, sp_paise_per_m: 50000 }]),
  ]);
  for (const sale of [
    "select complete_counter_fabric_sale($1,$2,[]::jsonb,null,true,null)",
    "select complete_counter_fabric_sale($1,$2,[]::jsonb,null,true,null,null)",
  ])
    await denied(sale.replace("[]", "'[]'"), [randomUUID(), workshop]);
  await login(users.owner);
  const price = await one(
    "select id from finished_product_prices where finished_product_id=$1 order by revision desc limit 1",
    [pieces[0].id],
  );
  await login(users.counter);
  const soldArgs = [
    randomUUID(),
    floor,
    JSON.stringify([{ piece_id: pieces[0].id, sp_version_id: price }]),
    users.salesperson,
  ];
  const sold = await one(
    "select complete_finished_product_sale($1,$2,$3::jsonb,null,true,null,$4)",
    soldArgs,
  );
  check(
    (await one(
      "select complete_finished_product_sale($1,$2,$3::jsonb,null,true,null,$4)",
      soldArgs,
    )) === sold,
    "Product sale retry never deducts twice",
  );
  await denied("select complete_finished_product_sale($1,$2,$3::jsonb,null,true,null,$4)", [
    randomUUID(),
    floor,
    soldArgs[2],
    users.salesperson,
  ]);
  await login(users.ecommerce_manager);
  check(
    !(await one("select showroom_stock(null)")).some((x) => x.id === pieces[0].id),
    "Sold piece disappears from Ecom immediately",
  );
  check(
    (await one("select ecommerce_listing_stock()")).find((x) => x.listing_id === garmentListing)
      .stock.length === 0,
    "Listing manager reports no remaining Showroom pieces",
  );
  await login(null);
  await q("set role anon");
  check(
    (await one("select storefront_catalog()")).find((x) => x.id === garmentListing).stock.length ===
      0,
    "Public storefront reflects sold product",
  );
  check(
    (await one("select storefront_catalog()")).find((x) => x.id === garmentListing).availability ===
      "sold_out",
    "Public sold-out status follows actual stock",
  );
  await denied("select ecommerce_listing_stock()");
  await login(users.counter);
  const fabricSale = [
    randomUUID(),
    floor,
    JSON.stringify([{ inventory_item_id: item, quantity: 1000, sp_paise_per_m: 50000 }]),
    users.salesperson,
  ];
  const order = await one(
    "select complete_counter_fabric_sale($1,$2,$3::jsonb,null,true,null,$4)",
    fabricSale,
  );
  check(
    (await one(
      "select complete_counter_fabric_sale($1,$2,$3::jsonb,null,true,null,$4)",
      fabricSale,
    )) === order,
    "Fabric sale idempotent",
  );
  await login(users.ecommerce_manager);
  check(
    (await one("select showroom_stock(null)")).find((x) => x.id === variants[0].thaan_id)
      .available_mm === 9000,
    "Counter fabric sale changes only Showroom web availability",
  );

  await login(users.stock_entry);
  const products = await one("select finished_product_inventory()");
  check(
    products.some((x) => x.id === pieces[1].id || x.finished_product_id === pieces[1].id),
    "Stock staff see finished production pieces",
  );
  check(
    (await one("select complete_production_batch($1,$2,$3,$4)", receiptArgs)) === job,
    "Stock receipt exact retry works after transfer",
  );
  await login(users.salesperson);
  await denied("select production_fabric_catalog(null)");
  await denied("select showroom_stock(null)");
  await login(users.tailor);
  check(
    (await one("select owner_production_history($1)", [job])).length === 1,
    "Assigned Tailor sees production job",
  );
  await denied(create, args);
  await denied("select complete_production_batch($1,$2,$3,$4)", receiptArgs);
  await login(users.owner);
  await q(
    "insert into user_permission_overrides(user_id,permission_key,granted) values($1,'production.create',false)",
    [production],
  );
  await login(production);
  await denied(create, [randomUUID(), ...args.slice(1)]);
  check(
    (await one("select count(*)::integer from fabric_stock_costs")) === 0,
    "Production raw CP access denied",
  );
  await login(users.stock_entry);
  const drafts = await one(
    "select create_barcode_batch_with_details($1,'Pending Provider','2026-10-14',null,$2::jsonb)",
    [
      randomUUID(),
      JSON.stringify([
        {
          name: "Pending",
          quantity: 3,
          rows: [
            { length_mm: 9000 },
            { cp_paise_per_m: 40000 },
            { length_mm: 9000, cp_paise_per_m: 0 },
          ],
        },
      ]),
    ],
  );
  const pending = (await one("select stock_registration_catalog($1)", [drafts]))[0].fabric_types[0]
    .variants;
  for (const v of pending)
    check(
      v.original_mm === null && v.status === "draft",
      "Missing length or positive CP stays draft",
    );
  await denied("select complete_barcode_thaan($1,$2,null,9000,null)", [
    randomUUID(),
    pending[0].code,
  ]);
  await one("select save_registered_thaan_details($1,$2,null,null,40000)", [
    randomUUID(),
    pending[0].code,
  ]);
  await one("select save_registered_thaan_details($1,$2,null,9000,null)", [
    randomUUID(),
    pending[1].code,
  ]);
  await one("select save_registered_thaan_details($1,$2,null,null,40000)", [
    randomUUID(),
    pending[2].code,
  ]);
  for (const v of pending) {
    const r = (await one("select workshop_fabric_inventory()")).find(
      (r) => r.thaan_id === v.thaan_id,
    );
    check(
      r.status === "active" && !r.incomplete && r.workshop_mm === 9000,
      "Positive length and CP activate once without colour",
    );
  }
  await login(users.owner);
  await q(
    "delete from user_permission_overrides where user_id=$1 and permission_key='production.create'",
    [production],
  );
  await login(production);
  const customArgs = [
    randomUUID(),
    product,
    "Hand embroidered",
    "38",
    JSON.stringify([assignment]),
    workshop,
    JSON.stringify([{ inventory_item_id: item, quantity: 25000 }]),
  ];
  const customCreate =
    "select create_production_batch($1,$2,null,$3,$4,5,$5::jsonb,$6,$7::jsonb,null,'Initial fabric')";
  const custom = await one(customCreate, customArgs);
  check((await one(customCreate, customArgs)) === custom, "Custom design size retry stable");
  await denied(customCreate, [
    customArgs[0],
    product,
    "Changed custom",
    "38",
    ...customArgs.slice(4),
  ]);
  const document = await one("select production_job_document($1)", [custom]);
  check(
    document.size === "38" &&
      document.design === "Hand embroidered" &&
      !JSON.stringify(document).includes("cp_total"),
    "Custom Production ID has size/design and hides CP",
  );
  await login(users.counter);
  const extra = [
    randomUUID(),
    document.code,
    variants[0].code,
    workshop,
    1000,
    "Tailor requested extra metre",
  ];
  await one("select issue_additional_production_fabric($1,$2,$3,$4,$5,$6)", extra);
  check(
    (await one("select issue_additional_production_fabric($1,$2,$3,$4,$5,$6)", extra)) !== null,
    "Extra issue retry is stable",
  );
  await denied("select issue_additional_production_fabric($1,$2,$3,$4,$5,$6)", [
    extra[0],
    ...extra.slice(1, 4),
    2000,
    extra[5],
  ]);
  await login(production);
  await one("select progress_owner_production($1,$2,$3,$4,$5)", [
    randomUUID(),
    custom,
    "open",
    "in_progress",
    "Started",
  ]);
  await one("select progress_owner_production($1,$2,$3,$4,$5)", [
    randomUUID(),
    custom,
    "in_progress",
    "completed",
    "All finished",
  ]);
  await denied("select complete_production_batch($1,$2,$3,$4)", [
    randomUUID(),
    custom,
    "completed",
    "Production cannot receive by default",
  ]);
  await login(users.stock_entry);
  const doc = await one("select production_job_document($1)", [custom]);
  check(doc.cp_total_paise === 1040000, "25 plus 1 metres captured at issue-time CP");
  await one("select complete_production_batch($1,$2,$3,$4)", [
    randomUUID(),
    custom,
    "completed",
    "All five arrived",
  ]);
  const customPieces = await one("select workshop_production_pieces($1)", [custom]);
  check(
    customPieces.length === 5 &&
      customPieces.every(
        (p) => p.size === "38" && p.design === "Hand embroidered" && p.cp_paise === 208000,
      ),
    "Five finished custom pieces split exact 26 metre CP",
  );
  await login(users.counter);
  await denied("select workshop_production_pieces($1)", [custom]);
  await denied("select set_workshop_product_sp($1,$2,$3::jsonb,$4)", [
    randomUUID(),
    custom,
    JSON.stringify([{ piece_id: customPieces[0].id, sp_paise: 400000 }]),
    "Unauthorized",
  ]);

  await login(null);
  const waiting = randomUUID();
  await q("insert into auth.users values($1,$2)", [waiting, "waiting@roles.test"]);
  await login(waiting);
  const session = await one("select bootstrap_current_user($1)", ["Waiting Staff"]);
  check(
    session.roles.length === 0 && session.permissions.length === 0,
    "Self signup waits for Owner and never gets Counter",
  );
  await denied("select showroom_stock(null)");
  await denied("select production_fabric_catalog(null)");
  await denied("select owner_register_staff($1,$2,$3::text[])", [
    waiting,
    "Waiting Staff",
    ["owner"],
  ]);
  await login(users.owner);
  const register = [waiting, "Waiting Staff", ["production"]];
  await one("select owner_register_staff($1,$2,$3::text[])", register);
  await one("select owner_register_staff($1,$2,$3::text[])", register);
  await denied("select owner_register_staff($1,$2,$3::text[])", [
    waiting,
    "Waiting Staff",
    ["owner"],
  ]);
  await login(waiting);
  check(
    (await one("select bootstrap_current_user(null)")).roles.join() === "production",
    "Owner-assigned Production access appears",
  );
  await one("select update_account_name($1)", ["My new name"]);
  check(
    (await one("select full_name from profiles where id=$1", [waiting])) === "My new name",
    "Account edits own name",
  );
  await denied("select update_account_name($1)", ["   "]);
  await login(null);
  await q("set role anon");
  await denied("select update_account_name($1)", ["Anonymous"]);
}
