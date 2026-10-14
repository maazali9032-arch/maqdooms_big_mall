import { randomUUID } from "node:crypto";
export async function ecommercePaidCases({ q, one, denied, login, users, check }) {
  const rpc = "select submit_paid_ecommerce_order($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)";
  await login(users.owner);
  const workshop = await one("select id from locations where kind='workshop'");
  const floorA = await one("select manage_showroom_location(null,'AN-A','Analytics Floor A',true)");
  const floorB = await one("select manage_showroom_location(null,'AN-B','Analytics Floor B',true)");
  const batch = await one(
    "select create_barcode_batch_with_details($1,'Analytics Vendor','2026-10-14',null,$2::jsonb)",
    [
      randomUUID(),
      JSON.stringify([
        {
          name: "Analytics Cotton",
          quantity: 2,
          rows: [
            { length_mm: 20000, cp_paise_per_m: 40000 },
            { length_mm: 15000, cp_paise_per_m: 45000 },
          ],
        },
      ]),
    ],
  );
  const variants = (await one("select stock_registration_catalog($1)", [batch]))[0].fabric_types[0]
    .variants;
  const items = [];
  for (let i = 0; i < 2; i++) {
    const inv = await one("select id from inventory_items where thaan_id=$1", [
      variants[i].thaan_id,
    ]);
    items.push(inv);
    await one("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      workshop,
      i === 0 ? floorA : floorB,
      JSON.stringify([{ inventory_item_id: inv, quantity: 10000 }]),
      "Analytics Showroom placement",
    ]);
  }
  const piece = (
    await q(
      "select p.id,p.production_job_id from finished_products p join production_jobs j on j.id=p.production_job_id where j.custom_design='Hand embroidered' and p.status='available' limit 1",
    )
  )[0];
  await one("select set_workshop_product_sp($1,$2,$3::jsonb,$4)", [
    randomUUID(),
    piece.production_job_id,
    JSON.stringify([{ piece_id: piece.id, sp_paise: 400000 }]),
    "Online saved Workshop SP",
  ]);
  piece.price_id = await one(
    "select id from finished_product_prices where finished_product_id=$1 order by revision desc limit 1",
    [piece.id],
  );
  check(!!piece, "Real recorded custom-design piece prepared for online sale");
  await one("select transfer_finished_products($1,$2,$3,$4::jsonb,$5)", [
    randomUUID(),
    workshop,
    floorB,
    JSON.stringify([piece.id]),
    "Analytics online garment",
  ]);
  const cart = [
    {
      kind: "fabric",
      source_id: floorA,
      inventory_item_id: items[0],
      quantity_mm: 2000,
      sp_paise_per_m: 50000,
    },
    { kind: "product", source_id: floorB, piece_id: piece.id, sp_version_id: piece.price_id },
  ];
  const args = [
    randomUUID(),
    "website:test-order-A",
    "provider:test-payment-A",
    "2026-09-15T18:29:59Z",
    500000,
    users.ecommerce_manager,
    JSON.stringify(cart),
    null,
    null,
  ];
  for (const role of [
    "owner",
    "stock_entry",
    "counter",
    "ecommerce_manager",
    "salesperson",
    "tailor",
  ]) {
    await login(users[role]);
    await denied(rpc, args);
  }
  await login(null);
  await q("set role anon");
  await denied(rpc, args);
  await login(null);
  await q("set role service_role");
  const fingerprint = () =>
    one(
      "select jsonb_build_object('orders',(select count(*) from orders),'moves',(select count(*) from inventory_movements),'receipts',(select count(*) from ecommerce_paid_receipts))",
    );
  const before = await fingerprint();
  await denied(rpc, [...args.slice(0, 4), 499999, ...args.slice(5)]);
  check(
    JSON.stringify(before) === JSON.stringify(await fingerprint()),
    "Payment mismatch rolls back every sale line and receipt",
  );
  await denied(rpc, [...args.slice(0, 5), users.stock_entry, ...args.slice(6)]);
  await denied(rpc, [...args.slice(0, 8), users.counter]);
  await denied(rpc, [
    ...args.slice(0, 6),
    JSON.stringify([{ ...cart[0], source_id: workshop }, cart[1]]),
    null,
    null,
  ]);
  await denied(rpc, [
    ...args.slice(0, 6),
    JSON.stringify([cart[0], { ...cart[1], sp_version_id: randomUUID() }]),
    null,
    null,
  ]);
  const order = await one(rpc, args);
  check((await one(rpc, args)) === order, "Exact paid-order retry never double deducts");
  check(
    (await one(rpc, [randomUUID(), ...args.slice(1)])) === order,
    "Duplicate verified payment with a fresh request ID stays one bill",
  );
  await denied(rpc, [...args.slice(0, 4), 600000, ...args.slice(5)]);
  await q("reset role");
  check(
    Number(await one("select inventory_balance($1,$2)", [items[0], floorA])) === 8000,
    "Online fabric deducted from actual floor",
  );
  check(
    Number(await one("select inventory_balance($1,$2)", [items[1], floorB])) === 10000,
    "Unselected fabric unchanged",
  );
  check(
    (await one("select status from finished_products where id=$1", [piece.id])) === "sold",
    "Online physical piece marked sold",
  );
  check(
    Number(await one("select inventory_balance($1,$2)", [items[0], workshop])) === 10000,
    "Online checkout cannot consume Workshop reserves",
  );
  await denied("update ecommerce_paid_receipts set paid_total_paise=1 where order_id=$1", [order]);
  await denied("delete from orders where id=$1", [order]);
  const failcart = [
    {
      kind: "fabric",
      source_id: floorB,
      inventory_item_id: items[1],
      quantity_mm: 1000,
      sp_paise_per_m: 50000,
    },
    {
      kind: "fabric",
      source_id: floorA,
      inventory_item_id: items[0],
      quantity_mm: 9000,
      sp_paise_per_m: 50000,
    },
  ];
  await q("set role service_role");
  const beforeFailure = await fingerprint();
  await denied(rpc, [
    randomUUID(),
    "web:oversell",
    "payment:oversell",
    args[3],
    500000,
    users.ecommerce_manager,
    JSON.stringify(failcart),
    null,
    null,
  ]);
  check(
    JSON.stringify(await fingerprint()) === JSON.stringify(beforeFailure),
    "Late cart shortage rolls back entire checkout",
  );
  const args2 = [
    randomUUID(),
    "website:test-order-B",
    "provider:test-payment-B",
    "2026-09-15T18:30:00Z",
    50000,
    users.ecommerce_manager,
    JSON.stringify([
      {
        kind: "fabric",
        source_id: floorB,
        inventory_item_id: items[1],
        quantity_mm: 1000,
        sp_paise_per_m: 50000,
      },
    ]),
    null,
    users.salesperson,
  ];
  const second = await one(rpc, args2);
  await login(users.owner);
  const firstDay = await one("select owner_daily_business('2026-09-15')");
  const nextDay = await one("select owner_daily_business('2026-09-16')");
  check(
    firstDay.ecommerce_paise === "500000" && nextDay.ecommerce_paise === "50000",
    "India midnight includes the correct settled payment day",
  );
  check(firstDay.bills === 1, "Mixed fabric/product online cart is exactly one bill");
  check(
    firstDay.fabric_revenue_paise === "100000" && firstDay.product_revenue_paise === "400000",
    "Mixed cart amounts split without counting whole bill twice",
  );
  const monthly = await one(
    "select owner_monthly_business('2026-09-01T00:00:00+05:30','2026-10-01T00:00:00+05:30','2026-08-01T00:00:00+05:30','2026-09-01T00:00:00+05:30',null)",
  );
  check(
    monthly.current.revenue_paise === "550000" && monthly.current.bills === 2,
    "Monthly E-commerce revenue deduplicated across retries and lines",
  );
  check(
    monthly.current.known_margin_paise === "217000",
    "Captured fabric and allocated production CP calculate exact margin",
  );
  check(
    monthly.rankings.some(
      (r) =>
        r.dimension === "salesperson" && r.name === "Unassigned / not recorded" && r.bills === 1,
    ),
    "Self-service sale remains unassigned",
  );
  const filtered = await one(
    "select owner_monthly_business('2026-09-01T00:00:00+05:30','2026-10-01T00:00:00+05:30','2026-08-01T00:00:00+05:30','2026-09-01T00:00:00+05:30',$1)",
    [floorB],
  );
  check(
    filtered.current.revenue_paise === "450000" && filtered.current.bills === 2,
    "Location analytics use each real floor; split bill contributes only local lines",
  );
  const report = await one(
    "select owner_erp_report('sales_lines','2026-09-01T00:00:00+05:30','2026-10-01T00:00:00+05:30',null,200)",
  );
  check(
    report.rows.length === 3 && report.rows.every((r) => r.data.channel === "ecommerce"),
    "Full sales line evidence includes online settled payments only",
  );
  const original = report.rows.find(
    (r) => r.data.order_id === order && r.data.kind === "direct_fabric_sale",
  );
  check(
    original.data.vendor === "Analytics Vendor" &&
      original.data.fabric === "Analytics Cotton" &&
      original.data.dimension_basis === "sale_time_snapshot",
    "New sales capture vendor/fabric dimensions",
  );
  await login(null);
  await q("update profiles set full_name='Renamed Salesperson' where id=$1", [users.salesperson]);
  await login(users.owner);
  const row=(await one('select workshop_fabric_inventory()')).find(r=>r.thaan_id===variants[0].thaan_id);
  await one('select edit_workshop_thaan($1,$2,$3,$4::jsonb,$5)',[randomUUID(),row.thaan_id,row.version,JSON.stringify({type_name:'Renamed fabric'}),'Historical name snapshot verification']);
  await login(users.owner);
  const after = await one(
    "select owner_erp_report('sales_lines','2026-09-01T00:00:00+05:30','2026-10-01T00:00:00+05:30',null,200)",
  );
  check(
    after.rows.find((r) => r.key === original.key).data.fabric === "Analytics Cotton",
    "Historical fabric ranking survives catalogue rename",
  );
  check(
    after.rows.find((r) => r.data.order_id === second).data.salesperson === "salesperson",
    "Credited Salesperson name is captured at sale",
  );
  const bills = await one("select owner_erp_report('orders',null,null,null,200)");
  check(
    bills.rows.find((r) => r.key === order).data.source_names.length === 2,
    "Bill evidence shows all actual Showroom floors",
  );
  await login(users.counter);
  await denied("select complete_counter_fabric_sale($1,$2,$3::jsonb,null,true,null,null)", [
    randomUUID(),
    floorA,
    JSON.stringify([{ inventory_item_id: items[0], quantity: 1000, sp_paise_per_m: 50000 }]),
  ]);
  await login(users.ecommerce_manager);
  check(
    !(await one("select showroom_stock(null)")).some((p) => p.id === piece.id),
    "Storefront stock immediately reflects online product sale",
  );
  await login(users.owner);
}
