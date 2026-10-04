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
          (process.argv.includes("--include-phase10") || !f.includes("phase10_")) &&
          f.endsWith(".sql") &&
          (process.argv.includes("--include-phase15") || !f.includes("phase15_")) &&
          (process.argv.includes("--include-phase14") || !f.includes("phase14_")) &&
          (process.argv.includes("--include-phase13") || !f.includes("phase13_")) &&
          (process.argv.includes("--include-phase12") || !f.includes("phase12_")) &&
          (process.argv.includes("--include-phase11") || !f.includes("phase11_")) &&
          (process.argv.includes("--include-phase10") || !f.includes("phase10_")) &&
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
                : process.argv.includes("--include-phase11")
                  ? 22
                  : 21),
      "Full 21-file business chain",
    );
    for (const f of files) {
      if (!demo && f.includes("demo_seed")) continue;
      if (f.includes("phase10_")) {
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
    const financial = await one(
      "select jsonb_build_array((select count(*) from orders),(select count(*) from customers),(select count(*) from finished_products),(select count(*) from production_cost_versions),(select count(*) from finished_product_prices),(select count(*) from barcodes))",
    );
    const job = await one(create, args);
    check((await one(create, args)) === job, "Job retry exactly once");
    check(
      await one(
        "select quantity=10 and product_id=$2 and design_id=$3 and status='open' from production_jobs where id=$1",
        [job, product, design],
      ),
      "Ten pieces one Product/Design job",
    );
    check(
      Number(
        await one(
          "select sum(quantity) from inventory_movements where production_job_id=$1 and inventory_item_id=$2",
          [job, item],
        ),
      ) === 30000,
      "Total fabric exactly 30m, not multiplied",
    );
    check(
      Number(
        await one(
          "select sum(quantity) from inventory_movements where production_job_id=$1 and inventory_item_id=$2",
          [job, material],
        ),
      ) === 2.125,
      "Exact native material quantity",
    );
    await login(null);
    check(
      Number(await one("select inventory_balance($1,$2)", [item, workshop])) === 70000,
      "Source debited exactly once",
    );
    await login(users.owner);
    check(
      await one("select count(*)=2 from job_material_requirements where production_job_id=$1", [
        job,
      ]),
      "Requirements linked to issued lines",
    );
    await denied(create, [...args.slice(0, 3), 11, ...args.slice(4)], "Changed job retry");
    const invalids = [
      [
        ...args.slice(0, 0),
        randomUUID(),
        product,
        design,
        0,
        assignment,
        workshop,
        args[6],
        null,
        "Invalid quantity",
      ],
      [randomUUID(), product, design, 1, assignment, showroom, args[6], null, "Wrong source"],
      [randomUUID(), product, design, 1, assignment, workshop, "[]", null, "No fabric"],
      [
        randomUUID(),
        product,
        design,
        1,
        assignment,
        workshop,
        JSON.stringify([{ inventory_item_id: material, quantity: 1 }]),
        null,
        "No fabric",
      ],
      [
        randomUUID(),
        product,
        design,
        1,
        assignment,
        workshop,
        JSON.stringify([{ inventory_item_id: item, quantity: 0.5 }]),
        null,
        "Fractional mm",
      ],
      [
        randomUUID(),
        product,
        design,
        1,
        assignment,
        workshop,
        JSON.stringify([{ inventory_item_id: item, quantity: 999999 }]),
        null,
        "Insufficient stock",
      ],
      [randomUUID(), product, design, 1, randomUUID(), workshop, args[6], null, "No assignment"],
      [
        randomUUID(),
        product,
        design,
        1,
        assignment,
        workshop,
        JSON.stringify([
          { inventory_item_id: item, quantity: 1 },
          { inventory_item_id: item, quantity: 1 },
        ]),
        null,
        "Duplicate item",
      ],
    ];
    const snapshotJob = () =>
      one(
        "select jsonb_build_array((select count(*) from production_jobs),(select count(*) from production_requests),(select count(*) from material_issues),(select count(*) from material_issue_lines),(select count(*) from inventory_movements),(select count(*) from job_material_requirements),(select count(*) from erp_audit_records))",
      );
    const beforeBad = await snapshotJob();
    for (const invalid of invalids) await denied(create, invalid, "Invalid job denied");
    check(
      JSON.stringify(beforeBad) === JSON.stringify(await snapshotJob()),
      "Every invalid creation fully rolls back",
    );
    await one(m, [
      randomUUID(),
      "design",
      design,
      "P10D",
      "Design revised",
      true,
      33333,
      "New charge",
    ]);
    check(
      Number(
        await one(
          "select v.amount_paise from production_jobs j join design_charge_versions v on v.id=j.design_charge_version_id where j.id=$1",
          [job],
        ),
      ) === 12345,
      "Job retains original Design charge version",
    );
    check(
      (await one("select owner_production_catalog()")).designs.find((d) => d.id === design)
        .charge_paise === 33333,
      "Owner sees latest charge",
    );
    const job2 = await one(create, [
      randomUUID(),
      product,
      design2,
      1,
      assignment,
      workshop,
      JSON.stringify([{ inventory_item_id: item, quantity: 1000 }]),
      null,
      "Different Design, new job",
    ]);
    check(job2 !== job, "Different Design separate job");
    check(
      await one("select design_charge_version_id is null from production_jobs where id=$1", [job2]),
      "No guessed zero Design charge",
    );
    await login(null);
    for (const sql of [
      "update production_jobs set quantity=11 where id=$1",
      "update production_jobs set design_id=gen_random_uuid() where id=$1",
      "update production_jobs set tailor_assignment_id=gen_random_uuid() where id=$1",
      "delete from production_jobs where id=$1",
    ])
      await denied(sql, [job], "Production identity/history retained");
    await db.exec(
      "create function phase10_test_failure() returns trigger language plpgsql as $$begin if NEW.payload ? 'product' then raise exception 'Forced late failure';end if;return NEW;end$$;create trigger z_phase10_failure before insert on production_requests for each row execute function phase10_test_failure();",
    );
    await login(users.owner);
    const beforeLate = await snapshotJob();
    const late = [
      randomUUID(),
      product,
      design,
      1,
      assignment,
      workshop,
      JSON.stringify([{ inventory_item_id: item, quantity: 1000 }]),
      null,
      "Late failure",
    ];
    await denied(create, late, "Forced late failure");
    check(
      JSON.stringify(beforeLate) === JSON.stringify(await snapshotJob()),
      "Job/issue/requirements/movements/audit atomic",
    );
    await login(null);
    await db.exec(
      "drop trigger z_phase10_failure on production_requests;drop function phase10_test_failure()",
    );
    await login(users.owner);
    check(await one(create, late), "Same retry works after rollback");
    // Active catalogue and current hierarchy are checked at commit, without rewriting old jobs.
    await one(m, [randomUUID(), "product", product, "P10P", "Product", false, null, "Disable"]);
    await denied(create, [randomUUID(), ...late.slice(1)], "Inactive Product rejected");
    await one(m, [randomUUID(), "product", product, "P10P", "Product", true, null, "Enable"]);
    await denied(
      m,
      [randomUUID(), "product", product, "CHANGED", "Product", true, null, "Rewrite code"],
      "Code is permanent",
    );
    await denied(
      m,
      [randomUUID(), "design", design, "P10D", "Design", true, -1, "Negative charge"],
      "No guessed/negative charge",
    );
    await denied(
      m,
      [randomUUID(), "product", product, "P10P", "Product", true, 1, "Wrong charge"],
      "Product has no Design charge",
    );
    const moved = await one("select assign_tailor($1,$2,$3,null,$4,$5)", [
      randomUUID(),
      tailor,
      factory,
      assignment,
      "Move to no Section",
    ]);
    await denied(
      create,
      [randomUUID(), ...late.slice(1)],
      "Closed assignment rejected for new job",
    );
    check(
      (await one("select owner_production_history($1)", [job]))[0].assignment_id === assignment,
      "Old job retains original Section/assignment",
    );
    check(moved !== assignment, "Real reassignment made");
    const progress = "select progress_owner_production($1,$2,$3,$4,$5)";
    await login(null);
    await db.exec(
      "create function phase10_status_failure() returns trigger language plpgsql as $$begin raise exception 'Forced status failure';end$$;create trigger z_phase10_status_failure before insert on production_status_events for each row execute function phase10_status_failure();",
    );
    await login(users.owner);
    const beforeStatus = await snapshotJob();
    await denied(
      progress,
      [randomUUID(), job, "open", "in_progress", "Atomic start"],
      "Late status failure",
    );
    check(
      JSON.stringify(beforeStatus) === JSON.stringify(await snapshotJob()),
      "Status request/audit rollback",
    );
    check(
      await one("select status='open' from production_jobs where id=$1", [job]),
      "Failed status remains open",
    );
    await login(null);
    await db.exec(
      "drop trigger z_phase10_status_failure on production_status_events;drop function phase10_status_failure()",
    );
    await login(users.owner);
    await denied(
      progress,
      [randomUUID(), job, "open", "completed", "Skip start"],
      "No skip to completed",
    );
    await login(users.other_tailor);
    check(
      (await one("select owner_production_history()")).length === 0,
      "Unassigned Tailor no history",
    );
    await denied(
      progress,
      [randomUUID(), job, "open", "in_progress", "Not mine"],
      "Unassigned Tailor denied",
    );
    await login(users.tailor);
    const operational = (await one("select owner_production_history($1)", [job]))[0];
    check(
      operational.quantity === 10 && operational.requirements.length === 2,
      "Assigned Tailor operational history",
    );
    check(
      !JSON.stringify(operational).includes("paise") &&
        !JSON.stringify(operational).includes("charge"),
      "No financial fields in operational history",
    );
    check(await one("select count(*)=0 from design_charge_versions"), "Tailor Design charge RLS");
    await denied("select owner_production_catalog()");
    await denied(create, args);
    await denied(m, productArgs);
    const start = [randomUUID(), job, "open", "in_progress", "Started actual production"];
    check((await one(progress, start)) === job, "Assigned Tailor starts");
    check((await one(progress, start)) === job, "Status retry once");
    await denied(
      progress,
      [randomUUID(), job, "open", "in_progress", "Stale"],
      "Compare expected state",
    );
    const finish = [
      randomUUID(),
      job,
      "in_progress",
      "completed",
      "All 10 identical pieces complete",
    ];
    check((await one(progress, finish)) === job, "Assigned Tailor completes");
    check((await one(progress, finish)) === job, "Completion retry once");
    check((await one(progress, start)) === job, "Old start retry cannot reopen completed job");
    await denied(
      progress,
      [randomUUID(), job, "completed", "in_progress", "Reopen"],
      "Completed state terminal",
    );
    await login(users.owner);
    check(
      await one("select count(*)=2 from production_status_events where job_id=$1", [job]),
      "Exactly two immutable status events",
    );
    check(
      JSON.stringify(financial) ===
        JSON.stringify(
          await one(
            "select jsonb_build_array((select count(*) from orders),(select count(*) from customers),(select count(*) from finished_products),(select count(*) from production_cost_versions),(select count(*) from finished_product_prices),(select count(*) from barcodes))",
          ),
        ),
      "No customers/orders/finished pieces/barcodes/costing/SP created",
    );
    await denied(
      "select post_material_issue($1,'production',$2,$3,'additional',$4::jsonb,'After completion')",
      [randomUUID(), job, workshop, JSON.stringify([{ inventory_item_id: material, quantity: 1 }])],
      "No issue after completion",
    );
    await login(users.counter);
    check(
      (await one("select material_issue_jobs()")).some((j) => j.id === job2),
      "Counter can target open production for issues",
    );
    check(
      await one(
        "select post_material_issue($1,'production',$2,$3,'additional',$4::jsonb,'Explicit extra thread')",
        [
          randomUUID(),
          job2,
          workshop,
          JSON.stringify([{ inventory_item_id: material, quantity: 1 }]),
        ],
      ),
      "Counter explicit Additional Material Issue",
    );
    await denied(
      "select post_material_issue($1,'production',$2,$3,'required',$4::jsonb,'Repeat fabric')",
      [randomUUID(), job2, workshop, JSON.stringify([{ inventory_item_id: item, quantity: 1 }])],
      "Repeated required fabric denied",
    );
    for (const role of ["counter", "stock_entry", "ecommerce_manager", "other_tailor"]) {
      await login(users[role]);
      await denied(create, args);
      await denied(m, productArgs);
      await denied("select owner_production_catalog()");
      await denied(progress, [randomUUID(), job2, "open", "in_progress", "Not allowed"]);
      check(await one("select count(*)=0 from production_requests"), "Private payload hidden");
      for (const table of [
        "products",
        "designs",
        "production_jobs",
        "production_requests",
        "production_status_events",
      ]) {
        await denied("delete from " + table);
        await denied("truncate " + table);
      }
      if (role !== "other_tailor") await denied("select owner_production_history()");
    }
    await login(null);
    await q("insert into user_roles(user_id,role_key) values($1,'owner')", [
      users.ecommerce_manager,
    ]);
    await q("update profiles set active=false where id=$1", [users.owner]);
    await login(users.owner);
    await denied(create, args);
    await denied("select owner_production_catalog()");
    await denied("select owner_production_history()");
    await login(null);
    await db.exec("set role anon");
    for (const call of ["select owner_production_catalog()", "select owner_production_history()"])
      await denied(call);
    for (const t of ["production_requests", "production_status_events"])
      await denied("select * from " + t);
    await db.exec("reset role");
    console.log(
      directory + (demo ? " demo" : " clean") + ": Phase 10 business/security/atomicity passed",
    );
  } finally {
    await db.close();
  }
}
console.log("Phase 10: " + checks + " checks passed");
