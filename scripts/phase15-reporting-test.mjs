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
      "Full Phase 15 business chain",
    );
    for (const f of files) {
      if (!demo && f.includes("demo_seed")) continue;
      if (f.includes("phase15_")) {
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
    const datasets = [
      "stock",
      "fabric_stock",
      "batches",
      "thans",
      "consumables",
      "consumable_receipts",
      "customer_tailoring",
      "configuration",
      "material_issues",
      "tailor_usage",
      "production_jobs",
      "production_costs",
      "finished_products",
      "transfers",
      "movements",
      "orders",
      "production_history",
      "reconciliation",
      "controls",
      "access",
      "audit",
      "legacy_sales",
      "legacy_tailoring",
      "legacy_movements",
    ];
    await one(`select log_audit('phase15_fixture','report','legacy-test','{}'::jsonb)`);
    const report = (dataset, after = null, limit = 100, search = null, from = null, to = null) =>
      one("select owner_erp_report($1,$2,$3,$4,$5,$6)", [dataset, from, to, after, limit, search]);
    for (const dataset of datasets) {
      const r = await report(dataset);
      check(
        r.dataset === dataset && Array.isArray(r.rows) && /^\d+$/.test(r.total_rows),
        "Owner dataset works: " + dataset,
      );
    }
    const initial = await one("select owner_erp_overview()");
    check(
      initial.controls.negative_location_balances === 0 &&
        initial.controls.finished_stock_mismatches === 0,
      "Canonical consistency checks clean",
    );
    check(
      initial.stock.every((s) => s.unit && typeof s.quantity === "string"),
      "Stock remains exact native-unit strings",
    );
    await one("select owner_set_fabric_sp($1,10000,$2)", [stock, "Actual Owner SP"]);
    const stockReport = await report("fabric_stock", null, 100, "P10B");
    check(
      stockReport.rows.length === 1 &&
        stockReport.rows[0].data.cp_paise_per_m === "10000" &&
        stockReport.rows[0].data.sp_paise_per_m === "10000",
      "Owner fabric CP/SP report exact",
    );
    const costsReport = await report("production_costs");
    check(
      costsReport.rows.some(
        (r) =>
          r.data.id === version &&
          r.data.finalized &&
          r.data.components.length === first.lines.length,
      ),
      "Complete cost/component/input/allocation report",
    );
    const usage = (await report("tailor_usage")).rows.filter(
      (r) => r.data.job === originalPieces[0].production_job,
    );
    check(
      usage.length === 2 &&
        usage.find((r) => r.data.unit === "mm").data.quantity_issued === "30000.000" &&
        usage.find((r) => r.data.unit === "mm").data.actual_piece_usage === "30000.000",
      "Actual production usage matches recorded allocations, not assumed wastage",
    );
    const scan = await one("select finished_product_sale_scan($1)", [originalPieces[0].barcode]);
    const since = new Date().toISOString();
    const sale = await one("select complete_finished_product_sale($1,$2,$3::jsonb,null,true,$4)", [
      randomUUID(),
      workshop,
      JSON.stringify([{ piece_id: scan.id, sp_version_id: scan.sp_version_id }]),
      "Phase 15 exact reporting sale",
    ]);
    const paid = (await one("select owner_erp_overview($1,null)", [since])).paid_sales.find(
      (r) => r.kind === "finished_product_sale",
    );
    check(
      paid.orders === "1" && paid.total_paise === "345678",
      "Paid sales summary uses all matching canonical orders",
    );
    const ord = (await report("orders", null, 100, sale)).rows[0].data;
    check(
      ord.items.length === 1 &&
        ord.items[0].financial_snapshot.production_cost_snapshot_paise != null &&
        ord.items[0].finished_sale_snapshot.cost_version_id === version,
      "Owner CP/SP/final price/order evidence preserved",
    );
    check(
      (await report("finished_products", null, 100, scan.barcode)).rows[0].data.status === "sold",
      "Reports reflect completed sale",
    );
    const stockNow = (await one("select owner_erp_overview()")).stock;
    check(
      stockNow.filter((r) => r.unit === "pc").reduce((n, r) => n + Number(r.quantity), 0) === 9,
      "Stock summary decrements exactly one piece",
    );
    const farFuture = "2099-01-01T00:00:00Z";
    check(
      (await one("select owner_erp_overview($1,null)", [farFuture])).paid_sales.length === 0,
      "Future sales range empty",
    );
    check(
      (await report("orders", null, 100, null, farFuture, null)).total_rows === "0",
      "Transaction report date boundaries exclude earlier orders",
    );
    check(
      (await report("stock", null, 100, null, farFuture, null)).rows.length > 0,
      "Stock is explicitly current, not a invented historic snapshot",
    );
    const stockKeys = [];
    let cursor = null;
    do {
      const page = await report("stock", cursor, 2);
      stockKeys.push(...page.rows.map((r) => r.key));
      cursor = page.next_cursor;
    } while (cursor);
    check(
      new Set(stockKeys).size === stockKeys.length &&
        stockKeys.length === Number((await report("stock")).total_rows),
      "Keyset reaches every stock record without duplicates",
    );
    const priceEvents = (await report("audit", null, 200, "finished_product_prices")).rows.filter(
      (r) => r.data.action === "row_insert",
    );
    check(
      priceEvents.length === 10 &&
        priceEvents.every(
          (r) => r.data.new_value.sp_paise === 345678 && r.data.previous_value === null,
        ),
      "Prospective initial price audit actual values",
    );
    const auditKeys = [];
    cursor = null;
    do {
      const page = await report("audit", cursor, 50);
      auditKeys.push(...page.rows.map((r) => r.key));
      cursor = page.next_cursor;
    } while (cursor);
    check(
      new Set(auditKeys).size === auditKeys.length &&
        auditKeys.length === Number((await report("audit")).total_rows) &&
        auditKeys.every((key, index) => index === 0 || auditKeys[index - 1] > key),
      "Audit pagination reaches all canonical/legacy events newest first without duplicates",
    );
    check(
      (await report("orders", null, 100, null, null, "2000-01-01T00:00:00Z")).total_rows === "0",
      "Transaction reports enforce exclusive upper date boundary",
    );
    check(
      (await report("fabric_stock", null, 100, null, farFuture, null)).total_rows ===
        (await report("fabric_stock")).total_rows,
      "Current Fabric/CP/SP snapshot is independent of transaction dates",
    );
    await one("select set_finished_product_sp($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      job,
      version,
      JSON.stringify([{ piece_id: originalPieces[1].id, sp_paise: 456789 }]),
      "Actual new SP",
    ]);
    const changed = (await report("audit", null, 200, "finished_product_prices")).rows.find(
      (r) => r.data.new_value?.sp_paise === 456789 && r.data.action === "row_insert",
    );
    check(
      changed.data.previous_value.sp_paise === 345678 &&
        changed.data.actor_id === users.owner &&
        changed.data.reference &&
        changed.data.occurred_at,
      "Price revision audit includes previous actual value, actor, time and reference",
    );
    const floor = await one("select manage_showroom_location(null,'P15FLOOR','Display',true)");
    await one("select manage_showroom_location($1,'P15FLOOR','Updated Display',true)", [floor]);
    const locationEvent = (await report("audit", null, 200, "Updated Display")).rows.find(
      (r) => r.data.action === "row_update" && r.data.entity_table === "locations",
    );
    check(
      locationEvent.data.previous_value.name === "Display" &&
        locationEvent.data.new_value.name === "Updated Display",
      "Location audit old/new values",
    );
    const roleId = await one(
      "insert into user_roles(user_id,role_key) values($1,'counter') returning id",
      [users.other_tailor],
    );
    await q("delete from user_roles where id=$1", [roleId]);
    const roleEvents = (await report("audit", null, 200, roleId)).rows;
    check(
      roleEvents.some((r) => r.data.action === "row_insert") &&
        roleEvents.some(
          (r) =>
            r.data.action === "row_delete" && r.data.previous_value.user_id === users.other_tailor,
        ),
      "User role add/remove captured atomically",
    );
    await q(
      "insert into user_permission_overrides(user_id,permission_key,granted) values($1,'pos.sell',false)",
      [users.counter],
    );
    check(
      (await report("audit", null, 200, "user_permission_overrides")).rows.some(
        (r) => r.data.new_value?.granted === false,
      ),
      "Permission override changes captured",
    );
    await q("update role_permissions set permission_key=permission_key where role_key='counter'");
    const cpAudit = (await report("audit", null, 200, "fabric_stock_costs")).rows;
    check(
      cpAudit.some(
        (r) => r.data.action === "row_insert" && r.data.new_value.cp_paise_per_m === 10000,
      ),
      "CP creation audited",
    );
    const actionTables = [
      "barcodes",
      "inventory_movements",
      "production_jobs",
      "production_cost_versions",
      "finished_product_receipts",
      "orders",
    ];
    for (const table of actionTables)
      check(
        (await report("audit", null, 200, table)).rows.some(
          (r) => r.data.entity_table === table && r.data.new_value,
        ),
        "Critical transaction row audit: " + table,
      );
    // Read-only reports must not themselves produce audit or business writes.
    const auditsBefore = await one("select count(*) from erp_audit_records");
    for (const d of datasets) await report(d);
    await one("select owner_erp_overview()");
    check(
      (await one("select count(*) from erp_audit_records")) === auditsBefore,
      "Reporting has no writes or synthetic audit history",
    );
    for (const params of [
      ["bad", null, null, null, 100, null],
      ["orders", farFuture, since, null, 100, null],
      ["orders", null, null, null, 201, null],
      ["audit", null, null, "x".repeat(257), 100, null],
      ["audit", null, null, null, 100, "x".repeat(201)],
    ])
      await denied("select owner_erp_report($1,$2,$3,$4,$5,$6)", params);
    await denied("select owner_erp_overview($1,$2)", [farFuture, since]);
    for (const role of ["counter", "tailor", "other_tailor", "stock_entry", "ecommerce_manager"]) {
      await login(users[role]);
      for (const d of datasets)
        await denied(
          "select owner_erp_report($1)",
          [d],
          "Owner report inaccessible: " + role + "/" + d,
        );
      await denied("select owner_erp_overview()");
      check(
        await one("select count(*)=0 from erp_audit_records"),
        "Financial audit rows inaccessible to " + role,
      );
      await denied("delete from audit_log");
      await denied("truncate audit_log");
      await denied("update erp_audit_records set reference=null");
    }
    await login(users.owner);
    await denied("delete from audit_log");
    await denied("truncate audit_log");
    await login(null);
    await denied("update audit_log set detail=detail");
    await denied("delete from erp_audit_records");
    await q("insert into user_roles(user_id,role_key) values($1,'owner')", [
      users.ecommerce_manager,
    ]);
    await q("update profiles set active=false where id=$1", [users.owner]);
    await login(users.owner);
    await denied("select owner_erp_report('orders')");
    await denied("select owner_erp_overview()");
    await login(null);
    await db.exec("set role anon");
    await denied("select owner_erp_report('audit')");
    await denied("select owner_erp_overview()");
    await db.exec("reset role");
    console.log(
      directory + (demo ? " demo" : " clean") + ": Phase 15 reports/audit/controls/security passed",
    );
  } finally {
    await db.close();
  }
}
console.log("Phase 15: " + checks + " checks passed");
