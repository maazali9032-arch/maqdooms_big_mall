/** Full disposable PostgreSQL replay and populated feature/security integration. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
let checks = 0;
const check = (value, label) => {
  assert(value, label);
  checks++;
};
for (const [directory, demo] of [
  ["supabase/migrations", true],
  ["drizzle/migrations", true],
  ["supabase/migrations", false],
]) {
  const db = new PGlite();
  const q = async (sql, args = []) => {
    try {
      return (await db.query(sql, args)).rows;
    } catch (error) {
      throw new Error(sql + ": " + error.message);
    }
  };
  const one = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const denied = async (sql, args = []) => {
    let failure = false;
    try {
      await q(sql, args);
    } catch {
      failure = true;
    }
    check(failure, "Denied: " + sql);
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
    let oldTables, before;
    const snapshot = async () => {
      const result = {};
      for (const row of oldTables)
        result[row.name] = await q(
          `select to_jsonb(t) data from public."${row.name}" t order by to_jsonb(t)::text`,
        );
      return JSON.stringify(result);
    };
    for (const file of (await fs.readdir(directory))
      .filter((file) => file.endsWith(".sql") && !file.includes("_labels_first_stock_entry") && !file.includes("_optional_thaan_details") && !file.includes("_workshop_inventory_hierarchy") && !file.includes("_live_"))
      .sort()) {
      if (!demo && file.includes("demo_seed")) continue;
      if (file.includes("_owner_production_workflow")) {
        oldTables = await q(
          "select tablename name from pg_tables where schemaname='public' and tablename not in ('roles','permissions','role_permissions','erp_audit_records') order by tablename",
        );
        before = await snapshot();
      }
      await db.exec(await fs.readFile(resolve(directory, file), "utf8"));
    }

    check(before === (await snapshot()), "All pre-existing business rows preserved");

    const users = {};
    for (const role of [
      "owner",
      "stock_entry",
      "counter",
      "tailor",
      "tailor2",
      "stranger",
      "salesperson",
      "ecommerce_manager",
    ]) {
      const id = (users[role] = randomUUID());
      await q("insert into auth.users values($1,$2)", [id, role + "@production.test"]);
      await q("insert into profiles(id,full_name)values($1,$2)", [id, role]);
      await q("insert into user_roles(user_id,role_key)values($1,$2)", [
        id,
        ["tailor2", "stranger"].includes(role) ? "tailor" : role,
      ]);
    }
    await login(users.owner);
    const assignment = await one(
      "select setup_customer_tailoring_assignment('PROD-F','Production Factory','PROD-S','Production Section','PROD-T','First Tailor',$1)",
      [users.tailor],
    );
    const second = await one(
      "select setup_customer_tailoring_assignment('PROD-F','Production Factory','PROD-S','Production Section','PROD-T2','Second Tailor',$1)",
      [users.tailor2],
    );
    const foreign = await one(
      "select setup_customer_tailoring_assignment('OTHER-F','Other Factory',null,null,'OTHER-T','Unrelated Tailor',$1)",
      [users.stranger],
    );
    const workshop = await one("select id from locations where kind='workshop'");
    const showroom = await one("select id from locations where kind='showroom'");
    const floor = await one(
      "select manage_showroom_location(null,'PROD-FLOOR','Production Floor',true)",
    );
    const floor2 = await one(
      "select manage_showroom_location(null,'PROD-FLOOR2','Other Floor',true)",
    );
    const product = await one(
      "select manage_production_catalog($1,'product',null,'PROD-P','Production Product',true,null,'Actual catalogue')",
      [randomUUID()],
    );
    const design = await one(
      "select manage_production_catalog($1,'design',null,'PROD-D','Production Design',true,0,'Explicit zero')",
      [randomUUID()],
    );
    await login(users.stock_entry);
    const batch = await one("select register_delivery_batch($1,'Raymonds')", [randomUUID()]);
    await one("select register_fabric_type($1,$2,'Production Fabric',$3::jsonb)", [
      randomUUID(),
      batch,
      JSON.stringify([{ length_mm: 50000, cp_paise_per_m: 12500 }]),
    ]);
    const variant = (await one("select stock_registration_catalog($1)", [batch]))[0].fabric_types[0]
      .variants[0];
    await login(users.owner);
    const scanned = (await one("select direct_fabric_sale_catalog($1)", [variant.code]))[0];
    check(scanned.barcode === variant.code, "Original Thaan barcode identifies production fabric");
    const item = scanned.cuts[0].inventory_item_id;
    check(
      scanned.cuts[0].locations.find((l) => l.id === workshop).quantity_mm === 50000,
      "Scan shows actual fifty metres",
    );
    const creation =
      "select create_owner_production_shared($1,$2,$3,3,$4::jsonb,$5,$6::jsonb,null,$7)";
    const req = randomUUID(),
      materials = JSON.stringify([{ inventory_item_id: item, quantity: 25000 }]);
    const args = [
      req,
      product,
      design,
      JSON.stringify([assignment, second]),
      workshop,
      materials,
      "Required total 25 metres",
    ];
    const job = await one(creation, args);
    check(
      Number(
        await one(
          "select quantity from inventory_location_balances() where inventory_item_id=$1 and location_id=$2",
          [item, workshop],
        ),
      ) === 25000,
      "Allocation deducts only 25m; unallocated 25m remains",
    );
    check(
      (await one("select count(*)::int from production_job_tailors where production_job_id=$1", [
        job,
      ])) === 2,
      "Both Tailors linked to same job",
    );
    check(
      (await one(creation, [
        ...args.slice(0, 3),
        JSON.stringify([second, assignment]),
        ...args.slice(4),
      ])) === job,
      "Canonical reordered exact retry returns same job",
    );
    check(
      Number(
        await one(
          "select quantity from inventory_location_balances() where inventory_item_id=$1 and location_id=$2",
          [item, workshop],
        ),
      ) === 25000,
      "Retry does not issue twice",
    );
    await denied(creation, [
      req,
      product,
      design,
      JSON.stringify([assignment]),
      workshop,
      materials,
      "Required total 25 metres",
    ]);
    for (const bad of [[], [assignment, assignment], [assignment, foreign]])
      await denied(creation, [
        randomUUID(),
        product,
        design,
        JSON.stringify(bad),
        workshop,
        materials,
        "Invalid assignment",
      ]);
    const beforeRejectedJob = await q(
      "select (select count(*)::int from production_jobs) jobs,(select count(*)::int from production_job_tailors) assignments,(select count(*)::int from production_requests) requests,(select count(*)::int from inventory_movements) movements",
    );
    await denied(creation, [
      randomUUID(),
      product,
      design,
      JSON.stringify([assignment]),
      workshop,
      JSON.stringify([{ inventory_item_id: item, quantity: 26000 }]),
      "Insufficient",
    ]);
    check(
      JSON.stringify(beforeRejectedJob) ===
        JSON.stringify(
          await q(
            "select (select count(*)::int from production_jobs) jobs,(select count(*)::int from production_job_tailors) assignments,(select count(*)::int from production_requests) requests,(select count(*)::int from inventory_movements) movements",
          ),
        ),
      "Late insufficient-stock failure rolls back job, shared assignments, requests and movements",
    );
    const additional = await one(
      "select post_material_issue($1,'production',$2,$3,'additional',$4::jsonb,'Extra three metres')",
      [randomUUID(), job, workshop, JSON.stringify([{ inventory_item_id: item, quantity: 3000 }])],
    );
    check(
      Number(
        await one(
          "select quantity from inventory_location_balances() where inventory_item_id=$1 and location_id=$2",
          [item, workshop],
        ),
      ) === 22000,
      "Additional issue uses same job and exact quantity",
    );
    const lines = await q(
      "select l.id,i.issue_type from material_issue_lines l join material_issues i on i.id=l.material_issue_id where i.production_job_id=$1",
      [job],
    );
    const required = lines.find((l) => l.issue_type === "required").id,
      extra = lines.find((l) => l.issue_type === "additional").id;
    check(!!additional && lines.length === 2, "All material lines linked to same Production ID");
    // Existing one-Tailor API/records remain accessible, without backfilling old rows.
    const legacy = await one(
      "select create_owner_production($1,$2,$3,1,$4,$5,$6::jsonb,null,'Compatibility job')",
      [
        randomUUID(),
        product,
        design,
        assignment,
        workshop,
        JSON.stringify([{ inventory_item_id: item, quantity: 1000 }]),
      ],
    );
    for (const user of [users.tailor, users.tailor2]) {
      await login(user);
      const history = await one("select owner_production_history($1)", [job]);
      check(
        history.length === 1 && history[0].tailors.length === 2,
        "Each assigned Tailor sees shared job and both names",
      );
      check(
        (await one("select material_issue_jobs()")).some((j) => j.id === job),
        "Shared Tailor sees material job",
      );
      check(
        (await one("select material_issue_history($1)", [job])).length === 2,
        "Shared Tailor sees required and additional issue history",
      );
      check(
        await one("select owns_production_job($1)", [job]),
        "Job-specific participation helper",
      );
      await denied("select owner_production_costs($1)", [job]);
      await denied(creation, [
        randomUUID(),
        product,
        design,
        JSON.stringify([assignment]),
        workshop,
        materials,
        "Tailor cannot create",
      ]);
    }
    await login(users.tailor2);
    check(
      (await one("select owner_production_history($1)", [legacy])).length === 0,
      "Sharing does not expose another job of primary Tailor",
    );
    check(
      (await one("select count(*)::int from production_jobs where id=$1", [legacy])) === 0,
      "Raw RLS excludes unrelated production job",
    );
    check(
      (await one("select count(*)::int from production_jobs where id=$1", [job])) === 1,
      "Raw RLS includes shared job",
    );
    await denied("update production_job_tailors set recorded_at=now() where production_job_id=$1", [
      job,
    ]);
    await login(users.stranger);
    check(
      (await one("select owner_production_history($1)", [job])).length === 0,
      "Unrelated Tailor sees no shared job",
    );
    await denied("select progress_owner_production($1,$2,'open','in_progress','Unauthorized')", [
      randomUUID(),
      job,
    ]);
    await login(users.tailor2);
    await one(
      "select progress_owner_production($1,$2,'open','in_progress','Second Tailor starts shared job')",
      [randomUUID(), job],
    );
    await one(
      "select progress_owner_production($1,$2,'in_progress','completed','All pieces complete')",
      [randomUUID(), job],
    );
    await login(users.owner);
    await denied(
      "select post_material_issue($1,'production',$2,$3,'additional',$4::jsonb,'Too late')",
      [randomUUID(), job, workshop, JSON.stringify([{ inventory_item_id: item, quantity: 1000 }])],
    );
    const pieces = [1, 2, 3].map((n) => ({
      piece_number: n,
      materials: [
        { issue_line_id: required, quantity: 8000 },
        { issue_line_id: extra, quantity: 1000 },
      ],
    }));
    await denied("select receive_finished_products($1,$2,$3::jsonb,'Partial forbidden')", [
      randomUUID(),
      job,
      JSON.stringify(pieces.slice(0, 2)),
    ]);
    const receipt = randomUUID();
    await one("select receive_finished_products($1,$2,$3::jsonb,'All arrive at Workshop')", [
      receipt,
      job,
      JSON.stringify(pieces),
    ]);
    await one("select receive_finished_products($1,$2,$3::jsonb,'All arrive at Workshop')", [
      receipt,
      job,
      JSON.stringify(pieces),
    ]);
    check(
      Number(
        await one(
          "select quantity from inventory_location_balances() where inventory_item_id=$1 and location_id=$2",
          [item, workshop],
        ),
      ) === 21000,
      "Receipt does not issue fabric again",
    );
    const products = await one("select finished_product_catalog(null,$1,100)", [job]);
    check(
      products.length === 3 && new Set(products.map((p) => p.barcode)).size === 3,
      "All physical pieces have unique finished barcodes",
    );
    check(
      products.every(
        (p) =>
          p.barcode !== variant.code && p.production_job_id === job && p.quantity_at_location === 1,
      ),
      "Separate product identity and Workshop ledger receipt",
    );
    check(
      products[0].production_summary.produced === 3 &&
        products[0].production_summary.sold === 0 &&
        products[0].production_summary.remaining === 3,
      "Owner produced/sold/remaining summary",
    );
    await login(users.tailor2);
    const tailorPieces = await one("select finished_product_catalog(null,$1,100)", [job]);
    check(
      tailorPieces.length === 3 &&
        !("production_summary" in tailorPieces[0]) &&
        !("production_cost_paise" in tailorPieces[0]),
      "Shared Tailor sees genealogy without Owner finance",
    );
    await login(users.owner);
    const costid = await one(
      "select id from fabric_stock_costs where fabric_stock_id=$1 order by revision desc limit 1",
      [variant.stock_id],
    );
    const cost = await one(
      "select finalize_production_cost($1,$2,null,$3::jsonb,10001,'job_total','[]'::jsonb,'Actual materials and charges')",
      [
        randomUUID(),
        job,
        JSON.stringify([
          { issue_line_id: required, quantity: 24000, fabric_cost_id: costid },
          { issue_line_id: extra, quantity: 3000, fabric_cost_id: costid },
        ]),
      ],
    );
    const costs = await one("select owner_production_costs($1)", [job]),
      latest = costs.versions[0];
    check(
      latest.total_paise === 347501 && latest.quantity === 3,
      "Exact actual cost includes fabric plus charge",
    );
    check(
      latest.allocations.reduce((n, p) => n + Number(p.amount_paise), 0) === 347501,
      "Equal per-piece allocations conserve every paise",
    );
    check(
      Math.max(...latest.allocations.map((p) => p.amount_paise)) -
        Math.min(...latest.allocations.map((p) => p.amount_paise)) ===
        1,
      "Only one-paise rounding difference",
    );
    await one("select set_finished_product_sp($1,$2,$3,$4::jsonb,'Owner manually sets SP')", [
      randomUUID(),
      job,
      cost,
      JSON.stringify(products.map((p) => ({ piece_id: p.id, sp_paise: 100000 }))),
    ]);
    await login(users.stock_entry);
    const lookup = (
      await one("select finished_product_transfer_scan($1)", [products[0].barcode])
    )[0];
    check(
      lookup.id === products[0].id &&
        !("production_cost_paise" in lookup) &&
        !("sp_paise" in lookup),
      "Staff scan exact physical product without pricing/CP",
    );
    check(
      (await one("select finished_product_inventory()")).some((p) => p.id === lookup.id),
      "Staff sees transfer inventory",
    );
    const transferreq = randomUUID(),
      ids = JSON.stringify(products.map((p) => p.id));
    const transfer = await one("select transfer_finished_products($1,$2,$3,$4::jsonb,$5)", [
      transferreq,
      workshop,
      floor,
      ids,
      "Direct floor transfer",
    ]);
    check(
      (await one("select transfer_finished_products($1,$2,$3,$4::jsonb,$5)", [
        transferreq,
        workshop,
        floor,
        ids,
        "Direct floor transfer",
      ])) === transfer,
      "Transfer retry posts once without receiving",
    );
    const moved = await one("select finished_product_inventory()");
    check(
      products.every(
        (p) =>
          moved.find((x) => x.id === p.id).location_id === floor &&
          moved.find((x) => x.id === p.id).quantity === 1,
      ),
      "All pieces immediately at selected floor",
    );
    check(
      (await one("select finished_product_movement_history($1)", [lookup.id])).filter(
        (m) => m.kind === "TRANSFER",
      ).length === 1,
      "One direct transfer movement; no showroom intermediary",
    );
    await denied("select transfer_finished_products($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      floor,
      floor2,
      ids,
      "Staff sibling movement forbidden",
    ]);
    await denied("select transfer_finished_products($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      workshop,
      floor,
      ids,
      "Stale source",
    ]);
    await denied("select owner_production_costs($1)", [job]);
    await login(users.owner);
    await one("select owner_set_user_permission($1,'stock.transfer_finished',false)", [
      users.stock_entry,
    ]);
    await login(users.stock_entry);
    await denied("select finished_product_transfer_scan($1)", [lookup.barcode]);
    await denied("select finished_product_inventory()");
    await denied("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      workshop,
      floor,
      JSON.stringify([{ inventory_item_id: lookup.inventory_item_id, quantity: 1 }]),
      "Generic API cannot bypass permission",
    ]);
    await login(users.owner);
    await one("select owner_set_user_permission($1,'stock.transfer_finished',null)", [
      users.stock_entry,
    ]);
    await login(users.counter);
    const saleScan = await one("select finished_product_sale_scan($1)", [lookup.barcode]);
    check(
      saleScan.id === lookup.id &&
        saleScan.sp_paise === 100000 &&
        saleScan.identical_available === 3,
      "Counter sees exact piece, Owner SP and actual availability",
    );
    check(
      !("production_summary" in saleScan) && !("production_cost" in saleScan),
      "Counter has no Owner cost or summary",
    );
    const saleItems = JSON.stringify([
      { piece_id: lookup.id, sp_version_id: saleScan.sp_version_id },
    ]);
    const saleReq = randomUUID();
    const sale = await one(
      "select complete_finished_product_sale($1,$2,$3::jsonb,null,true,'Actual sale',$4)",
      [saleReq, floor, saleItems, users.salesperson],
    );
    check(
      (await one(
        "select complete_finished_product_sale($1,$2,$3::jsonb,null,true,'Actual sale',$4)",
        [saleReq, floor, saleItems, users.salesperson],
      )) === sale,
      "Finished-product sale retains safe retry/Salesperson",
    );
    await login(users.owner);
    const ownerScan = await one("select finished_product_sale_scan($1)", [lookup.barcode]);
    check(
      ownerScan.production_summary.produced === 3 &&
        ownerScan.production_summary.sold === 1 &&
        ownerScan.production_summary.remaining === 2,
      "Owner summary distinguishes produced/sold/remaining",
    );
    check(
      ownerScan.production_summary.planned === 3 &&
        ownerScan.production_cost.versions[0].total_paise === 347501,
      "Owner scan linked to whole Production ID and costing",
    );
    check(
      ownerScan.status === "sold" && ownerScan.available === false,
      "Scanned sold identity and status retained",
    );
    await denied("delete from production_job_tailors where production_job_id=$1", [job]);
    await denied(
      "update production_job_tailors set tailor_assignment_id=$1 where production_job_id=$2",
      [foreign, job],
    );
    for (const user of [
      users.counter,
      users.salesperson,
      users.ecommerce_manager,
      users.stranger,
    ]) {
      await login(user);
      await denied("select finished_product_transfer_scan($1)", [lookup.barcode]);
      await denied("select transfer_finished_products($1,$2,$3,$4::jsonb,$5)", [
        randomUUID(),
        workshop,
        floor,
        ids,
        "Unauthorized",
      ]);
    }
    await login(null);
    await db.exec("set role anon");
    await denied("select owns_production_job($1)", [job]);
    await denied("select finished_product_transfer_scan($1)", [lookup.barcode]);
    await denied("select production_piece_summary($1)", [job]);
    await db.exec("reset role");
    check(
      !(await one("select has_table_privilege('authenticated','production_job_tailors','INSERT')")),
      "No raw shared-assignment write grants",
    );
    console.log(
      directory + " " + (demo ? "demo" : "clean") + ": Owner Production workflow verified",
    );
  } finally {
    await db.close();
  }
}
await fs.writeFile(
  "docs/OWNER_PRODUCTION_WORKFLOW_DATABASE_VERIFICATION.json",
  JSON.stringify({ verified_at: new Date().toISOString(), checks, passed: true }, null, 2),
);
console.log(`PASS: ${checks} Owner Production workflow checks`);
