/** Disposable PostgreSQL business/security tests, no live credentials. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
let checks = 0;
const check = (v, label) => {
  assert.ok(v, label);
  checks++;
};
for (const [directory, demo] of [
  ["supabase/migrations", true],
  ["drizzle/migrations", true],
  ["supabase/migrations", false],
]) {
  const db = new PGlite();
  const q = async (s, a = []) => {
    try {
      return (await db.query(s, a)).rows;
    } catch (e) {
      throw new Error(s + ": " + e.message);
    }
  };
  const one = async (s, a = []) => Object.values((await q(s, a))[0])[0];
  const denied = async (s, a = [], label = s) => {
    let error;
    try {
      await q(s, a);
    } catch (e) {
      error = e;
    }
    check(error, label);
  };
  const login = async (id) => {
    await db.exec("reset role");
    await q("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
    if (id) await db.exec("set role authenticated");
  };
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`,
    );
    let tables, before;
    const snapshot = async () => {
      const out = {};
      for (const t of tables)
        out[t.name] = await q(
          `select row from(select(select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(r)) where key=any($1::text[])) row from public."${t.name}" r) x order by row::text`,
          [t.columns],
        );
      return JSON.stringify(out);
    };
    const files = (await fs.readdir(directory))
      .filter(
        (f) =>
          (process.argv.includes("--include-phase10") || !f.includes("phase12_")) &&
          f.endsWith(".sql") &&
          (process.argv.includes("--include-phase15") || !f.includes("phase15_")) &&
          (process.argv.includes("--include-phase14") || !f.includes("phase14_")) &&
          (process.argv.includes("--include-phase13") || !f.includes("phase13_")) &&
          (process.argv.includes("--include-phase12") || !f.includes("phase12_")) &&
          (process.argv.includes("--include-phase11") || !f.includes("phase12_")) &&
          (process.argv.includes("--include-phase10") || !f.includes("phase12_")) &&
          !f.includes("_live_"),
      )
      .sort();
    check(
      files.length ===
        (process.argv.includes("--include-phase15")
          ? 26
          : process.argv.includes("--include-phase14")
            ? 25
            : process.argv.includes("--include-phase13")
              ? 24
              : 23),
      "Full Phase 14 business chain",
    );
    for (const f of files) {
      if (!demo && f.includes("demo_seed")) continue;
      if (f.includes("phase14_")) {
        tables = await q(
          "select table_name name,array_agg(column_name order by ordinal_position) columns from information_schema.columns where table_schema='public' and table_name in(select tablename from pg_tables where schemaname='public') group by table_name order by table_name",
        );
        before = await snapshot();
      }
      await db.exec(await fs.readFile(resolve(directory, f), "utf8"));
    }
    check(before === (await snapshot()), "Every old table/column/value preserved");
    const users = {};
    for (const role of [
      "owner",
      "counter",
      "stock_entry",
      "tailor",
      "other_tailor",
      "ecommerce_manager",
    ]) {
      const id = (users[role] = randomUUID());
      await q("insert into auth.users values($1,$2)", [id, role + "@p10.test"]);
      await q("insert into profiles(id,full_name) values($1,$2)", [id, role]);
      await q("insert into user_roles(user_id,role_key) values($1,$2)", [
        id,
        role === "other_tailor" ? "tailor" : role,
      ]);
    }
    await login(users.owner);
    const m = "select manage_production_catalog($1,$2,$3,$4,$5,$6,$7,$8)";
    const config = async (kind, code, charge = null) =>
      one(m, [randomUUID(), kind, null, code, code, true, charge, "Explicit configuration"]);
    const productArgs = [
      randomUUID(),
      "product",
      null,
      "P10P",
      "Product",
      true,
      null,
      "Create Product",
    ];
    const product = await one(m, productArgs);
    check((await one(m, productArgs)) === product, "Configuration retry");
    await denied(
      m,
      [...productArgs.slice(0, 4), "Changed", ...productArgs.slice(5)],
      "Changed catalogue retry",
    );
    const design = await config("design", "P10D", 12345);
    const design2 = await config("design", "P10D2");
    const hierarchy = "select manage_tailoring_entity($1,$2,$3,$4,$5,true,$6,$7,$8)";
    const factory = await one(hierarchy, [
      randomUUID(),
      "factory",
      null,
      "P10F",
      "Factory",
      null,
      null,
      "Create",
    ]);
    const section = await one(hierarchy, [
      randomUUID(),
      "section",
      null,
      "P10S",
      "Section",
      factory,
      null,
      "Create",
    ]);
    const tailor = await one(hierarchy, [
      randomUUID(),
      "tailor",
      null,
      "P10T",
      "Tailor",
      null,
      users.tailor,
      "Create",
    ]);
    const assignment = await one("select assign_tailor($1,$2,$3,$4,null,$5)", [
      randomUUID(),
      tailor,
      factory,
      section,
      "Assign",
    ]);
    const workshop = await one("select id from locations where kind='workshop'");
    const showroom = await one("select id from locations where kind='showroom'");
    const fabric = await one(
      "insert into fabrics(code,name,category) values('P10F','Fabric','Fabric') returning id",
    );
    const batch = await one("insert into receiving_batches(code) values('P10B') returning id");
    const stock = await one("select create_fabric_entry($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      fabric,
      batch,
      "[100000]",
      10000,
    ]);
    await q("select complete_fabric_entry($1)", [stock]);
    const item = await one(
      "select id from inventory_items where thaan_id in(select id from thaans where fabric_stock_id=$1)",
      [stock],
    );
    const receipt = await one(
      "select receive_consumable($1,null,'Thread','m','thread',$2,100,100,'Receipt')",
      [randomUUID(), workshop],
    );
    const material = await one("select inventory_item_id from consumable_receipts where id=$1", [
      receipt,
    ]);
    const create = "select create_owner_production($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)";
    const args = [
      randomUUID(),
      product,
      design,
      10,
      assignment,
      workshop,
      JSON.stringify([
        { inventory_item_id: item, quantity: 30000 },
        { inventory_item_id: material, quantity: 2.125 },
      ]),
      "10 identical pieces",
      "Actual total quantities",
    ];

    const job = await one(create, args);
    const job2 = await one(create, [
      randomUUID(),
      product,
      design2,
      1,
      assignment,
      workshop,
      JSON.stringify([{ inventory_item_id: item, quantity: 1000 }]),
      null,
      "Other job",
    ]);
    const progress = "select progress_owner_production($1,$2,$3,$4,$5)";
    const receive = "select receive_finished_products($1,$2,$3::jsonb,$4)";
    const fabricLine = await one(
      "select l.id from material_issue_lines l join material_issues i on i.id=l.material_issue_id where i.production_job_id=$1 and l.thaan_id is not null",
      [job],
    );
    const threadLine = await one(
      "select l.id from material_issue_lines l join material_issues i on i.id=l.material_issue_id where i.production_job_id=$1 and l.material_id is not null",
      [job],
    );
    const foreignLine = await one(
      "select l.id from material_issue_lines l join material_issues i on i.id=l.material_issue_id where i.production_job_id=$1",
      [job2],
    );
    const pieces = Array.from({ length: 10 }, (_, i) => ({
      piece_number: i + 1,
      materials: [
        { issue_line_id: fabricLine, quantity: 3000 },
        { issue_line_id: threadLine, quantity: 0.2 },
      ],
    }));
    const request = [
      randomUUID(),
      job,
      JSON.stringify(pieces),
      "Ten physical pieces returned to Workshop",
    ];
    await denied(receive, request, "Open job cannot create pieces");
    await one(progress, [randomUUID(), job, "open", "in_progress", "Started"]);
    await denied(receive, request, "In-progress job cannot create pieces");
    await one(progress, [
      randomUUID(),
      job,
      "in_progress",
      "completed",
      "All ten physically completed",
    ]);
    const snapshotProduction = () =>
      one(
        "select jsonb_build_array((select count(*) from finished_products),(select count(*) from barcodes),(select count(*) from finished_product_materials),(select count(*) from finished_product_receipts),(select count(*) from finished_product_receipt_pieces),(select count(*) from inventory_items),(select count(*) from inventory_movements),(select count(*) from erp_audit_records))",
      );
    check((await one(receive, request)) === job, "Actual pieces received before costing");
    const cp = await one(
      "select id from fabric_stock_costs where fabric_stock_id=$1 order by revision desc limit 1",
      [stock],
    );
    const materials = [
      { issue_line_id: fabricLine, quantity: 30000, fabric_cost_id: cp },
      { issue_line_id: threadLine, quantity: 2, category: "thread", receipt_id: receipt },
    ];
    const finalize = "select finalize_production_cost($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8)";
    const costs = [
      randomUUID(),
      job,
      null,
      JSON.stringify(materials),
      100000,
      "job_total",
      JSON.stringify([{ description: "Explicit finishing cost", amount_paise: 17 }]),
      "Actual billed quantities, CP sources and whole-job Design charge reviewed",
    ];
    const version = await one(finalize, costs);
    check((await one(finalize, costs)) === version, "Cost retry once");
    const context = await one("select owner_production_costs($1)", [job]);
    const first = context.versions[0];
    check(
      Number(first.total_paise) === 412562,
      "Fabric + thread + tailoring + Design + other complete total",
    );
    check(Number(first.mean_piece_paise) === 41256.2, "Exact average total divided by ten");
    check(
      first.allocations.reduce((s, p) => s + Number(p.amount_paise), 0) === 412562,
      "Allocations preserve exact total",
    );
    check(
      first.allocations.slice(0, 2).every((p) => Number(p.amount_paise) === 41257) &&
        first.allocations.slice(2).every((p) => Number(p.amount_paise) === 41256),
      "Deterministic one-paise remainder",
    );
    check(
      first.lines.find((l) => l.category === "design_embroidery").amount_paise === 12345,
      "Retained Design charge included once per explicit job basis",
    );
    check(
      first.lines.find((l) => l.category === "fabric").amount_paise === 300000,
      "Fabric CP x explicit metres",
    );
    check(
      first.lines.find((l) => l.category === "thread").amount_paise === 200,
      "Native receipt CP x actual billed thread",
    );
    const originalPieces = await one("select finished_product_catalog(null,$1)", [job]);
    await one("select set_finished_product_sp($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      job,
      version,
      JSON.stringify(originalPieces.map((p) => ({ piece_id: p.id, sp_paise: 345678 }))),
      "Explicit Owner SP",
    ]);
    const ids = originalPieces.map((p) => p.id);
    const floor = await one("select manage_showroom_location(null,'P14FLOOR','Display',true)");
    const inactive = await one("select manage_showroom_location(null,'P14CLOSED','Closed',false)");
    const move = "select transfer_finished_products($1,$2,$3,$4::jsonb,$5)";
    await one(move, [
      randomUUID(),
      workshop,
      showroom,
      JSON.stringify(ids.slice(0, 3)),
      "Three Showroom",
    ]);
    await one(move, [
      randomUUID(),
      showroom,
      floor,
      JSON.stringify(ids.slice(0, 2)),
      "Two display",
    ]);
    const scan = "select finished_product_sale_scan($1)";
    const sale = "select complete_finished_product_sale($1,$2,$3::jsonb,$4,$5,$6)";
    const scanned = await one(scan, [originalPieces[0].barcode]);
    check(
      scanned.identical_available === 10 && scanned.sp_paise === 345678 && scanned.available,
      "Scanned price and ten available identical job pieces",
    );
    for (const [location, count] of [
      [workshop, 7],
      [showroom, 1],
      [floor, 2],
    ])
      check(
        Number(scanned.locations.find((l) => l.location_id === location).quantity) === count,
        "Exact global location counts",
      );
    check(
      scanned.production_cost && scanned.production_cost_paise != null,
      "Owner complete production cost visible",
    );
    check(
      Number(scanned.locations.find((l) => l.location_id === showroom).subtree_quantity) === 3,
      "Showroom total includes its sublocation pieces without double-counting total",
    );
    check((await one(scan, ["unknown"])) === null, "Unknown Product Barcode returns null");
    await denied(scan, [" "]);
    await one(progress, [randomUUID(), job2, "open", "in_progress", "Other job started"]);
    await one(progress, [randomUUID(), job2, "in_progress", "completed", "Other job complete"]);
    await one(receive, [
      randomUUID(),
      job2,
      JSON.stringify([
        { piece_number: 1, materials: [{ issue_line_id: foreignLine, quantity: 1000 }] },
      ]),
      "One unpriced actual Workshop piece",
    ]);
    const unpriced = await one("select finished_product_catalog(null,$1)", [job2]);
    check(
      (await one(scan, [originalPieces[0].barcode])).identical_available === 10,
      "Other job never inflates identical count",
    );
    check(
      (await one(scan, [unpriced[0].barcode])).sp_paise === null,
      "Missing Owner SP explicitly shown",
    );
    const customer = await one(
      "select find_or_create_customer('Historical customer','9000012345',null,null)",
    );
    const saleArgs = [
      randomUUID(),
      floor,
      JSON.stringify(ids.slice(0, 2).map((id) => ({ piece_id: id, sp_version_id: null }))),
      customer,
      true,
      "Customer receipt reference",
    ];
    const scanned2 = await one(scan, [originalPieces[1].barcode]);
    saleArgs[2] = JSON.stringify([
      { piece_id: ids[0], sp_version_id: scanned.sp_version_id },
      { piece_id: ids[1], sp_version_id: scanned2.sp_version_id },
    ]);
    const saleSnapshot = () =>
      one(
        "select jsonb_build_array((select jsonb_agg(to_jsonb(p) order by id) from finished_products p),(select count(*) from orders),(select count(*) from order_items),(select count(*) from order_item_financials),(select count(*) from finished_product_sale_snapshots),(select count(*) from inventory_movements),(select count(*) from erp_audit_records))",
      );
    const saleBefore = JSON.stringify(await saleSnapshot());
    await denied(sale, [
      randomUUID(),
      workshop,
      JSON.stringify([{ piece_id: unpriced[0].id, sp_version_id: randomUUID() }]),
      null,
      true,
      "Missing reviewed SP/cost",
    ]);
    await denied(sale, [
      randomUUID(),
      floor,
      JSON.stringify([{ piece_id: ids[0], sp_version_id: scanned.sp_version_id, quantity: 0.5 }]),
      null,
      true,
      "Unexpected quantity denied",
    ]);
    await denied(sale, [
      randomUUID(),
      floor,
      JSON.stringify(
        Array.from({ length: 51 }, () => ({ piece_id: randomUUID(), sp_version_id: randomUUID() })),
      ),
      null,
      true,
      "Oversized cart",
    ]);
    for (const a of [
      [randomUUID(), floor, saleArgs[2], customer, false, "Unpaid"],
      [randomUUID(), workshop, saleArgs[2], customer, true, "Wrong source"],
      [randomUUID(), inactive, saleArgs[2], customer, true, "Inactive"],
      [randomUUID(), floor, saleArgs[2], randomUUID(), true, "Unknown customer"],
      [
        randomUUID(),
        floor,
        JSON.stringify([{ piece_id: ids[0], sp_version_id: randomUUID() }]),
        null,
        true,
        "Changed price",
      ],
      [
        randomUUID(),
        floor,
        JSON.stringify([
          { piece_id: ids[0], sp_version_id: scanned.sp_version_id },
          { piece_id: ids[0], sp_version_id: scanned.sp_version_id },
        ]),
        null,
        true,
        "Duplicate piece",
      ],
      [
        randomUUID(),
        floor,
        JSON.stringify([{ piece_id: randomUUID(), sp_version_id: scanned.sp_version_id }]),
        null,
        true,
        "Missing piece",
      ],
      [randomUUID(), floor, "[]", null, true, "No pieces"],
      [
        randomUUID(),
        floor,
        JSON.stringify([{ piece_id: ids[0] }]),
        null,
        true,
        "Missing SP version",
      ],
    ])
      await denied(sale, a, "Invalid sale rejected");
    check(
      saleBefore === JSON.stringify(await saleSnapshot()),
      "All rejections preserve products, ledger, orders, financials and audit",
    );
    await login(null);
    await db.exec(
      "create function phase14_fail() returns trigger language plpgsql as $$begin if NEW.action='complete_finished_product_sale' then raise exception 'Forced final audit failure';end if;return NEW;end$$;create trigger z_phase14_fail before insert on erp_audit_records for each row execute function phase14_fail();",
    );
    await login(users.counter);
    await denied(sale, saleArgs, "Late batch rollback");
    await login(users.owner);
    check(
      saleBefore === JSON.stringify(await saleSnapshot()),
      "Late failure rolls back all sale effects",
    );
    await login(null);
    await db.exec("drop trigger z_phase14_fail on erp_audit_records;drop function phase14_fail()");
    await login(users.counter);
    const counterScan = await one(scan, [originalPieces[0].barcode]);
    check(
      counterScan.identical_available === 10 &&
        !/production_cost|cost_version|amount_paise|cp_paise/.test(JSON.stringify(counterScan)),
      "Counter scan/counts cannot access costs",
    );
    const order = await one(sale, saleArgs);
    check((await one(sale, saleArgs)) === order, "Paid Counter sale retry exactly once");
    await denied(sale, [...saleArgs.slice(0, 5), "Changed reference"]);
    await denied(sale, [randomUUID(), ...saleArgs.slice(1)], "Physical piece cannot sell twice");
    const history = (await one("select finished_product_order_history($1)", [order]))[0];
    check(
      history.items.length === 2 && Number(history.final_customer_price_paise) === 691356,
      "Exact SP-derived total and two whole physical order lines",
    );
    check(
      history.items.every(
        (i) =>
          Number(i.quantity) === 1 &&
          i.unit === "pc" &&
          Number(i.sp_paise) === 345678 &&
          Number(i.final_customer_price_paise) === 345678 &&
          i.movement_id,
      ),
      "Exact line prices and ledger linkage",
    );
    check(
      history.customer_snapshot.name === "Historical customer" &&
        history.source === "Display" &&
        history.created_by === users.counter &&
        history.reference === saleArgs[5] &&
        history.payment_confirmed_at &&
        history.completed_at,
      "Customer, source, actor, reference, payment and time retained",
    );
    check(
      !/production_cost|cost_evidence|cost_version|price_version|amount_paise|cp_snapshot/.test(
        JSON.stringify(history),
      ),
      "Counter sale history has no internal finances",
    );
    const afterScan = await one(scan, [originalPieces[0].barcode]);
    check(
      !afterScan.available && afterScan.status === "sold" && afterScan.identical_available === 8,
      "Sold scan remains traceable and count decrements by two",
    );
    check(
      Number(afterScan.locations.find((l) => l.location_id === floor).quantity) === 0,
      "Sold display stock is zero",
    );
    await login(users.owner);
    const ownerHistory = (await one("select finished_product_order_history($1)", [order]))[0];
    check(
      ownerHistory.items.every(
        (i) =>
          i.production_cost_paise != null &&
          i.cost_version_id === version &&
          i.price_version_id &&
          i.cost_evidence.lines.length === first.lines.length,
      ),
      "Owner sale-time complete cost and per-piece allocation evidence",
    );
    check(
      Number(
        await one(
          "select sum(quantity) from v_inventory_location_balances where finished_product_id=any($1::uuid[])",
          [ids],
        ),
      ) === 8,
      "Exactly two pieces deducted globally",
    );
    await denied(move, [
      randomUUID(),
      floor,
      showroom,
      JSON.stringify([ids[0]]),
      "Sold piece transfer",
    ]);
    await denied("update orders set reference='rewrite' where id=$1", [order]);
    await login(null);
    await denied(
      "update orders set reference='rewrite' where id=$1",
      [order],
      "Completed order permanent even privileged",
    );
    await denied("delete from order_items where order_id=$1", [order]);
    await denied(
      "update finished_product_sale_snapshots set cost_evidence='{}'",
      [],
      "Snapshot immutable even privileged",
    );
    await denied("delete from finished_product_sale_snapshots");
    await q("update customers set name='Renamed customer' where id=$1", [customer]);
    await login(users.owner);
    await one(
      "select manage_production_catalog($1,'product',$2,'P10P','Renamed Product',true,null,'Rename')",
      [randomUUID(), product],
    );
    await one("select manage_showroom_location($1,'P14FLOOR','Renamed Display',true)", [floor]);
    const newCost = await one(finalize, [
      randomUUID(),
      job,
      version,
      JSON.stringify(materials),
      200000,
      "job_total",
      "[]",
      "Later actual cost revision",
    ]);
    check(newCost !== version, "Later cost revision posted without rewriting sale");
    const unchanged = (await one("select finished_product_order_history($1)", [order]))[0];
    check(
      JSON.stringify(unchanged.items) === JSON.stringify(ownerHistory.items) &&
        unchanged.customer_snapshot.name === "Historical customer" &&
        unchanged.source === "Display",
      "Sale snapshots survive customer/Product/location/cost changes",
    );
    // A new price revision forces stale carts to refresh. Free Owner SP remains explicit.
    const remaining = await one(scan, [originalPieces[2].barcode]);
    await one("select set_finished_product_sp($1,$2,$3,$4::jsonb,'New Owner review')", [
      randomUUID(),
      job,
      newCost,
      JSON.stringify([{ piece_id: ids[2], sp_paise: 0 }]),
    ]);
    await login(users.counter);
    await denied(sale, [
      randomUUID(),
      showroom,
      JSON.stringify([{ piece_id: ids[2], sp_version_id: remaining.sp_version_id }]),
      null,
      true,
      "Stale cart",
    ]);
    const free = await one(scan, [originalPieces[2].barcode]);
    const freeOrder = await one(sale, [
      randomUUID(),
      showroom,
      JSON.stringify([{ piece_id: ids[2], sp_version_id: free.sp_version_id }]),
      null,
      true,
      "Explicit zero Owner SP",
    ]);
    check(
      Number(
        (await one("select finished_product_order_history($1)", [freeOrder]))[0]
          .final_customer_price_paise,
      ) === 0,
      "Explicit zero SP and walk-in sale allowed",
    );
    await login(users.owner);
    const unchangedPricePiece = await one(scan, [originalPieces[3].barcode]);
    check(
      unchangedPricePiece.sp_paise === 345678,
      "New cost does not automatically change reviewed SP",
    );
    const ownerOrder = await one(sale, [
      randomUUID(),
      workshop,
      JSON.stringify([{ piece_id: ids[3], sp_version_id: unchangedPricePiece.sp_version_id }]),
      null,
      true,
      "Owner paid sale with existing SP",
    ]);
    const ownerLine = (await one("select finished_product_order_history($1)", [ownerOrder]))[0]
      .items[0];
    check(
      ownerLine.cost_version_id === newCost && ownerLine.reviewed_cost_version_id === version,
      "Sale records latest actual cost separately from SP review provenance",
    );
    await one("select set_finished_product_sp($1,$2,$3,$4::jsonb,'Explicit maximum SP')", [
      randomUUID(),
      job,
      newCost,
      JSON.stringify(ids.slice(4, 6).map((id) => ({ piece_id: id, sp_paise: 9007199254740991 }))),
    ]);
    const expensive = await Promise.all(
      ids.slice(4, 6).map(async (id) => {
        const barcode = originalPieces.find((p) => p.id === id).barcode;
        const p = await one(scan, [barcode]);
        return { piece_id: id, sp_version_id: p.sp_version_id };
      }),
    );
    const beforeOverflow = JSON.stringify(await saleSnapshot());
    await denied(sale, [
      randomUUID(),
      workshop,
      JSON.stringify(expensive),
      null,
      true,
      "Overflow rejected",
    ]);
    check(
      beforeOverflow === JSON.stringify(await saleSnapshot()),
      "Unsafe total rolls back every sale effect",
    );
    for (const role of [
      "owner",
      "counter",
      "tailor",
      "other_tailor",
      "stock_entry",
      "ecommerce_manager",
    ]) {
      await login(users[role]);
      if (!["owner", "counter"].includes(role)) {
        await denied(scan, [originalPieces[0].barcode]);
        await denied(sale, saleArgs);
        await denied("select finished_product_order_history()");
      }
      if (role !== "owner")
        for (const t of ["order_item_financials", "finished_product_sale_snapshots"])
          check(await one("select count(*)=0 from " + t), "Financial snapshot RLS " + role);
      for (const t of [
        "orders",
        "order_items",
        "order_item_financials",
        "finished_product_sale_snapshots",
      ]) {
        await denied("delete from " + t);
        await denied("truncate " + t);
      }
    }
    await login(users.owner);
    await denied(sale, saleArgs, "Another actor cannot reuse Counter sale request");
    await denied("select finished_product_order_history(null,201)");
    await login(null);
    await q("update profiles set active=false where id=$1", [users.counter]);
    await login(users.counter);
    await denied(scan, [originalPieces[0].barcode]);
    await denied(sale, saleArgs);
    await denied("select finished_product_order_history()");
    await login(null);
    await db.exec("set role anon");
    await denied(scan, [originalPieces[0].barcode]);
    await denied(sale, saleArgs);
    await denied("select finished_product_order_history()");
    await denied("select * from finished_product_sale_snapshots");
    await db.exec("reset role");
    console.log(
      directory +
        (demo ? " demo" : " clean") +
        ": Phase 14 scan/counts/sale/history/security passed",
    );
  } finally {
    await db.close();
  }
}
console.log("Phase 14: " + checks + " checks passed");
