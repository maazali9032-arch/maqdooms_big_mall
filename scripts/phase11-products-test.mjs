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
          (process.argv.includes("--include-phase10") || !f.includes("phase11_")) &&
          f.endsWith(".sql") &&
          (process.argv.includes("--include-phase15") || !f.includes("phase15_")) &&
          (process.argv.includes("--include-phase14") || !f.includes("phase14_")) &&
          (process.argv.includes("--include-phase13") || !f.includes("phase13_")) &&
          (process.argv.includes("--include-phase12") || !f.includes("phase12_")) &&
          (process.argv.includes("--include-phase11") || !f.includes("phase11_")) &&
          (process.argv.includes("--include-phase10") || !f.includes("phase11_")) &&
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
              : process.argv.includes("--include-phase12")
                ? 23
                : 22),
      "Full 22-file business chain",
    );
    for (const f of files) {
      if (!demo && f.includes("demo_seed")) continue;
      if (f.includes("phase11_")) {
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
    const old = await snapshotProduction();
    const variants = [
      pieces.slice(0, 9),
      [...pieces.slice(0, 9), pieces[0]],
      pieces.map((p, i) => (i ? p : { ...p, piece_number: 11 })),
      pieces.map((p, i) => (i ? p : { ...p, materials: [] })),
      pieces.map((p, i) =>
        i ? p : { ...p, materials: [{ issue_line_id: threadLine, quantity: 0.2 }] },
      ),
      pieces.map((p, i) =>
        i ? p : { ...p, materials: [{ issue_line_id: foreignLine, quantity: 1 }] },
      ),
      pieces.map((p, i) =>
        i ? p : { ...p, materials: [{ issue_line_id: fabricLine, quantity: 3000.5 }] },
      ),
      pieces.map((p, i) =>
        i
          ? p
          : {
              ...p,
              materials: [
                { issue_line_id: fabricLine, quantity: 3000 },
                { issue_line_id: fabricLine, quantity: 1 },
              ],
            },
      ),
      pieces.map((p, i) =>
        i ? p : { ...p, materials: [{ issue_line_id: fabricLine, quantity: 4000 }] },
      ),
      pieces.map((p, i) =>
        i ? p : { ...p, materials: [{ issue_line_id: fabricLine, quantity: -1 }] },
      ),
      pieces.map((p, i) =>
        i
          ? p
          : {
              ...p,
              materials: [
                { issue_line_id: fabricLine, quantity: 3000 },
                { issue_line_id: threadLine, quantity: 0.1234 },
              ],
            },
      ),
    ];
    for (const v of variants)
      await denied(
        receive,
        [randomUUID(), job, JSON.stringify(v), "Invalid usage"],
        "Invalid pieces/usage denied",
      );
    check(
      JSON.stringify(old) === JSON.stringify(await snapshotProduction()),
      "Every failed batch preserves all products/barcodes/allocations/stock/audit",
    );
    await login(null);
    await db.exec(
      "create function phase11_test_failure() returns trigger language plpgsql as $$begin if NEW.kind='PRODUCTION' and (select piece_number from finished_products where id=NEW.finished_product_id)=10 then raise exception 'Late tenth-piece failure';end if;return NEW;end$$;create trigger z_phase11_failure before insert on inventory_movements for each row execute function phase11_test_failure();",
    );
    await login(users.owner);
    await denied(receive, request, "Late tenth-piece failure");
    check(
      JSON.stringify(old) === JSON.stringify(await snapshotProduction()),
      "All ten pieces and stock roll back on late failure",
    );
    await login(null);
    await db.exec(
      "drop trigger z_phase11_failure on inventory_movements;drop function phase11_test_failure()",
    );
    await login(users.owner);
    const beforeMoney = await one(
      "select jsonb_build_array((select count(*) from production_cost_versions),(select count(*) from production_cost_lines),(select count(*) from finished_product_cost_allocations),(select count(*) from finished_product_prices),(select count(*) from orders))",
    );
    check((await one(receive, request)) === job, "Owner receipt succeeds");
    check((await one(receive, request)) === job, "Receipt retry exactly once");
    await denied(
      receive,
      [request[0], job, request[2], "Changed reason"],
      "Changed request rejected",
    );
    await denied(
      receive,
      [randomUUID(), job, request[2], request[3]],
      "New request cannot duplicate job",
    );
    const catalog = await one("select finished_product_catalog(null,$1,100)", [job]);
    check(catalog.length === 10, "Ten physical pieces");
    check(new Set(catalog.map((p) => p.barcode)).size === 10, "Ten unique Product Barcodes");
    check(
      catalog.every(
        (p) =>
          p.barcode.startsWith("PRD-") &&
          p.production_job_id === job &&
          p.design_id === design &&
          p.product_id === product,
      ),
      "Correct product barcode/genealogy",
    );
    check(
      catalog.every(
        (p) =>
          p.location === "Workshop" &&
          p.status === "available" &&
          p.available &&
          Number(p.quantity_at_location) === 1,
      ),
      "All pieces enter Workshop with exact one stock each",
    );
    check(
      new Set(catalog.map((p) => p.piece_number)).size === 10 &&
        catalog[0].piece_number === 1 &&
        catalog[9].piece_number === 10,
      "Complete piece numbering",
    );
    check(
      catalog.every(
        (p) =>
          p.materials.length === 2 &&
          p.materials.find((m) => m.unit === "mm").quantity === 3000 &&
          Number(p.materials.find((m) => m.unit === "m").quantity) === 0.2,
      ),
      "Explicit exact per-piece materials",
    );
    check(
      catalog[0].materials.find((m) => m.unit === "mm").fabric_barcode &&
        catalog[0].materials.find((m) => m.unit === "mm").thaan_id,
      "Fabric + Batch barcode and internal Than provenance",
    );
    check(
      catalog.every(
        (p) =>
          p.factory === "Factory" &&
          p.section === "Section" &&
          p.tailor === "Tailor" &&
          p.production_history.length === 2 &&
          p.receipt.reason === request[3],
      ),
      "Complete hierarchy and production/receipt history",
    );
    check(
      catalog.every(
        (p) => p.sp_paise === null && !("cp_paise" in p) && p.production_cost_paise == null,
      ),
      "No invented cost/SP",
    );
    check(
      Number(
        await one(
          "select sum(quantity) from finished_product_materials where production_job_id=$1 and material_issue_line_id=$2",
          [job, threadLine],
        ),
      ) === 2,
      "Unused issued thread not guessed into products",
    );
    check(
      await one(
        "select count(*)=10 from inventory_movements where kind='PRODUCTION' and production_job_id=$1",
        [job],
      ),
      "Ten production events",
    );
    check(
      JSON.stringify(beforeMoney) ===
        JSON.stringify(
          await one(
            "select jsonb_build_array((select count(*) from production_cost_versions),(select count(*) from production_cost_lines),(select count(*) from finished_product_cost_allocations),(select count(*) from finished_product_prices),(select count(*) from orders))",
          ),
        ),
      "No costing/SP/sales",
    );
    check(
      (await one("select finished_product_catalog($1)", [catalog[0].barcode])).length === 1,
      "Scan identifies exactly one physical piece",
    );
    check(
      (
        await one("select finished_product_catalog($1)", [
          catalog[1].materials.find((m) => m.unit === "mm").fabric_barcode,
        ])
      ).length === 0,
      "Fabric barcode never matches product scan",
    );
    check(
      (await one("select finished_product_catalog('UNKNOWN')")).length === 0,
      "Unknown barcode empty",
    );
    await denied("select finished_product_catalog(null,null,101)");
    // Existing Phase 3 ledger operations remain authoritative; no new transfer UI/workflow.

    await one("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      workshop,
      showroom,
      JSON.stringify([{ inventory_item_id: catalog[0].inventory_item_id, quantity: 1 }]),
      "Existing ledger transfer regression",
    ]);
    const moved = (await one("select finished_product_catalog($1)", [catalog[0].barcode]))[0];
    check(
      moved.location === "Showroom" && moved.barcode === catalog[0].barcode && moved.available,
      "Scan reflects current ledger location, immutable barcode",
    );
    await login(users.counter);
    check(
      (await one("select finished_product_catalog($1)", [catalog[0].barcode]))[0].piece_number ===
        1,
      "Counter scans operational piece",
    );
    check(await one("select count(*)=0 from design_charge_versions"), "Counter no internal charge");
    await denied(receive, request);
    check(
      !JSON.stringify(await one("select finished_product_catalog()")).includes("amount_paise"),
      "Counter no internal cost",
    );
    await login(users.tailor);
    check(
      (await one("select finished_product_catalog()")).length === 10,
      "Assigned Tailor sees own pieces",
    );
    await denied(receive, request);
    await login(users.other_tailor);
    check(
      (await one("select finished_product_catalog($1)", [catalog[0].barcode])).length === 0,
      "Unassigned Tailor cannot scan foreign piece",
    );
    await denied(receive, request);
    for (const role of ["stock_entry", "ecommerce_manager"]) {
      await login(users[role]);
      await denied("select finished_product_catalog()");
      await denied(receive, request);
    }
    for (const role of [
      "owner",
      "counter",
      "tailor",
      "other_tailor",
      "stock_entry",
      "ecommerce_manager",
    ]) {
      await login(users[role]);
      for (const t of [
        "finished_products",
        "finished_product_materials",
        "finished_product_receipts",
        "finished_product_receipt_pieces",
      ]) {
        await denied("delete from " + t);
        await denied("truncate " + t);
      }
      if (role !== "owner")
        check(
          await one("select count(*)=0 from finished_product_receipts"),
          "Private receipt payload RLS",
        );
    }
    await login(null);
    for (const sql of [
      "update finished_products set created_at=now()+interval '1 day' where id=$1",
      "update finished_products set piece_number=20 where id=$1",
      "delete from finished_products where id=$1",
    ])
      await denied(sql, [catalog[0].id], "Piece identity/history immutable");
    await denied(
      "update barcodes set code='REWRITTEN' where code=$1",
      [catalog[0].barcode],
      "Barcode immutable",
    );
    await denied(
      "update finished_product_materials set quantity=1 where finished_product_id=$1",
      [catalog[0].id],
      "Material usage history immutable",
    );
    await denied(
      "insert into inventory_movements(kind,inventory_item_id,finished_product_id,quantity,unit,destination_location_id,production_job_id,actor_id,reason,reference) values('PRODUCTION',$1,$2,1,'pc',$3,$4,$5,'Duplicate','Wrong')",
      [catalog[0].inventory_item_id, catalog[0].id, workshop, job, users.owner],
      "Duplicate/forged production event rejected",
    );
    await q("insert into user_roles(user_id,role_key) values($1,'owner')", [
      users.ecommerce_manager,
    ]);
    await q("update profiles set active=false where id=$1", [users.owner]);
    await login(users.owner);
    await denied(receive, request);
    await denied("select finished_product_catalog()");
    await login(null);
    await db.exec("set role anon");
    await denied("select finished_product_catalog()");
    await denied(receive, request);
    await denied("select * from finished_product_receipts");
    await db.exec("reset role");
    console.log(
      directory + (demo ? " demo" : " clean") + ": Phase 11 bulk/genealogy/receipt/security passed",
    );
  } finally {
    await db.close();
  }
}
console.log("Phase 11: " + checks + " checks passed");
