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
      "Full 22-file business chain",
    );
    for (const f of files) {
      if (!demo && f.includes("demo_seed")) continue;
      if (f.includes("phase12_")) {
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
    const counts = () =>
      one(
        "select jsonb_build_array((select count(*) from production_cost_versions),(select count(*) from production_cost_lines),(select count(*) from production_cost_inputs),(select count(*) from finished_product_cost_allocations),(select count(*) from production_cost_requests),(select count(*) from finished_product_prices),(select count(*) from finished_product_price_reviews),(select count(*) from erp_audit_records))",
      );
    const beforeInvalid = await counts();
    await denied(finalize, [...costs.slice(0, 4), 999, ...costs.slice(5)], "Changed cost retry");
    await denied(
      finalize,
      [randomUUID(), job, null, ...costs.slice(3)],
      "Stale cost expected version",
    );
    for (const rows of [
      materials.slice(0, 1),
      [materials[0], materials[0]],
      [{ ...materials[0], fabric_cost_id: randomUUID() }, materials[1]],
      [materials[0], { ...materials[1], receipt_id: randomUUID() }],
      [{ ...materials[0], quantity: 30000.5 }, materials[1]],
      [materials[0], { ...materials[1], quantity: 1 }],
      [{ ...materials[0], quantity: 31000 }, materials[1]],
      [materials[0], { issue_line_id: threadLine, quantity: 2, category: "thread" }],
    ])
      await denied(
        finalize,
        [
          randomUUID(),
          job,
          version,
          JSON.stringify(rows),
          100000,
          "job_total",
          "[]",
          "Invalid cost",
        ],
        "Invalid/incomplete/foreign/under/over/fractional cost source denied",
      );
    await denied(finalize, [
      randomUUID(),
      job,
      version,
      JSON.stringify(materials),
      -1,
      "job_total",
      "[]",
      "Negative",
    ]);
    await denied(
      finalize,
      [
        randomUUID(),
        job,
        version,
        JSON.stringify(materials),
        0,
        "not_applicable",
        "[]",
        "Omit retained Design",
      ],
      "Design omission rejected",
    );
    await denied(
      finalize,
      [randomUUID(), job2, null, JSON.stringify(materials), 0, "job_total", "[]", "Wrong job"],
      "Uncompleted/unreceived job denied",
    );
    check(
      JSON.stringify(beforeInvalid) === JSON.stringify(await counts()),
      "Every failed revision atomic",
    );
    const pricing = "select set_finished_product_sp($1,$2,$3,$4::jsonb,$5)";
    const updates = first.allocations.map((p) => ({ piece_id: p.piece_id, sp_paise: 123456 }));
    const prices = [
      randomUUID(),
      job,
      version,
      JSON.stringify(updates),
      "Owner reviewed full cost and explicitly chose SP",
    ];
    check((await one(pricing, prices)) === job, "Owner sets explicit SP after cost review");
    check((await one(pricing, prices)) === job, "Price retry once");
    check(await one("select count(*)=10 from finished_product_prices"), "Ten prices once");
    check(
      await one("select count(*)=10 from finished_product_price_reviews where cost_version_id=$1", [
        version,
      ]),
      "Ten retained price/cost review links",
    );
    await denied(
      pricing,
      [prices[0], job, version, JSON.stringify(updates), "Changed reason"],
      "Changed price retry denied",
    );
    await denied(
      pricing,
      [randomUUID(), job, randomUUID(), JSON.stringify(updates), "Foreign version"],
      "Foreign cost version denied",
    );
    await denied(
      pricing,
      [randomUUID(), job, version, JSON.stringify([updates[0], updates[0]]), "Duplicate"],
      "Duplicate price piece denied",
    );
    await denied(
      pricing,
      [
        randomUUID(),
        job,
        version,
        JSON.stringify([{ piece_id: updates[0].piece_id, sp_paise: -1 }]),
        "Negative",
      ],
      "Negative SP denied",
    );
    const cost2 = [
      randomUUID(),
      job,
      version,
      JSON.stringify(materials),
      100000,
      "per_piece",
      JSON.stringify([{ description: "Explicit finishing cost", amount_paise: 17 }]),
      "Design applies to each identical piece",
    ];
    const second = await one(finalize, cost2);
    check(second !== version, "New immutable cost revision");
    const current = (await one("select owner_production_costs($1)", [job])).versions[0];
    check(
      Number(current.total_paise) === 523667 &&
        current.lines.find((l) => l.category === "design_embroidery").amount_paise === 123450,
      "Explicit per-piece Design charge included ten times",
    );
    check(
      (await one(finalize, costs)) === version,
      "Historical retry never creates/replaces newer revision",
    );
    await denied(
      pricing,
      [randomUUID(), job, version, JSON.stringify(updates), "Stale review"],
      "New price needs latest cost review",
    );
    check(
      (await one(pricing, prices)) === job,
      "Old successful price retry immutable after later costing",
    );
    check(
      (await one("select finished_product_catalog(null,$1)", [job])).every(
        (p) => Number(p.sp_paise) === 123456,
      ),
      "Cost revision does not automatically change SP",
    );
    const scan = (await one("select finished_product_catalog(null,$1)", [job]))[0];
    check(
      Number(scan.production_cost_paise) > 0 && scan.cost_version_id === second,
      "Owner scan retrieves current per-piece internal cost",
    );
    await login(null);
    await db.exec(
      "create function phase12_failure() returns trigger language plpgsql as $$begin raise exception 'Forced final failure';end$$;create trigger z_phase12_failure before insert on production_cost_requests for each row execute function phase12_failure();",
    );
    await login(users.owner);
    const beforeLate = await counts();
    const third = [
      randomUUID(),
      job,
      second,
      JSON.stringify([
        materials[0],
        { issue_line_id: threadLine, quantity: 2, category: "thread", amount_paise: 201 },
      ]),
      0,
      "job_total",
      "[]",
      "Explicit actual manual material cost",
    ];
    await denied(finalize, third, "Late cost failure");
    await denied(
      pricing,
      [randomUUID(), job, second, JSON.stringify(updates), "Late price failure"],
      "Late price failure",
    );
    check(
      JSON.stringify(beforeLate) === JSON.stringify(await counts()),
      "Cost/allocations/prices/reviews/audit/request late failures fully rollback",
    );
    await login(null);
    await db.exec(
      "drop trigger z_phase12_failure on production_cost_requests;drop function phase12_failure()",
    );
    await login(users.owner);
    check(await one(finalize, third), "Same rolled-back cost request succeeds");
    const roundedMaterials = [materials[0], { ...materials[1], quantity: 2.125 }];
    const thirdId = (await one("select owner_production_costs($1)", [job])).versions[0].id;
    const fourth = await one(finalize, [
      randomUUID(),
      job,
      thirdId,
      JSON.stringify(roundedMaterials),
      0,
      "job_total",
      "[]",
      "Explicit billable receipt quantity with half-paise rounding",
    ]);
    const rounded = (await one("select owner_production_costs($1)", [job])).versions[0];
    check(
      rounded.lines.find((l) => l.category === "thread").amount_paise === 213,
      "Native fractional quantity rounded once to whole paise",
    );
    check(Number(rounded.total_paise) === 312558, "Rounded component total exact");
    check(
      rounded.allocations.reduce((a, p) => a + Number(p.amount_paise), 0) === 312558,
      "Uneven total still conserved",
    );
    await one(progress, [randomUUID(), job2, "open", "in_progress", "Start other Design"]);
    await one(progress, [randomUUID(), job2, "in_progress", "completed", "Complete other Design"]);
    await one(receive, [
      randomUUID(),
      job2,
      JSON.stringify([
        { piece_number: 1, materials: [{ issue_line_id: foreignLine, quantity: 1000 }] },
      ]),
      "Actual other job Workshop receipt",
    ]);
    const noDesign = [
      randomUUID(),
      job2,
      null,
      JSON.stringify([{ issue_line_id: foreignLine, quantity: 1000, fabric_cost_id: cp }]),
      0,
      "not_applicable",
      "[]",
      "Owner explicitly confirms no applicable Design charge",
    ];
    check(
      await one(finalize, noDesign),
      "Explicit not-applicable Design supported for job without charge snapshot",
    );
    check(
      (await one("select owner_production_costs($1)", [job2])).versions[0].lines.find(
        (l) => l.category === "design_embroidery",
      ).amount_paise === 0,
      "Explicit zero NA recorded, no guessed Design charge",
    );
    for (const role of ["counter", "tailor", "other_tailor", "stock_entry", "ecommerce_manager"]) {
      await login(users[role]);
      await denied("select owner_production_costs($1)", [job]);
      await denied(finalize, costs);
      await denied(pricing, prices);
      for (const table of [
        "production_cost_versions",
        "production_cost_lines",
        "finished_product_cost_allocations",
        "production_cost_inputs",
        "production_cost_requests",
        "finished_product_price_reviews",
      ]) {
        check(await one("select count(*)=0 from " + table), "Financial rows hidden from " + role);
        await denied("delete from " + table);
        await denied("truncate " + table);
      }
      if (["counter", "tailor"].includes(role)) {
        const rows = await one("select finished_product_catalog(null,$1)", [job]);
        check(
          rows.length === 10 &&
            !JSON.stringify(rows).includes("production_cost_paise") &&
            !JSON.stringify(rows).includes("cost_version_id"),
          "Operational scan cannot retrieve internal cost",
        );
        check(
          role === "counter"
            ? rows.every((p) => Number(p.sp_paise) === 123456)
            : rows.every((p) => p.sp_paise === null),
          "Only permitted SP visible",
        );
      }
    }
    await login(null);
    await denied(
      "update production_cost_lines set amount_paise=0 where cost_version_id=$1",
      [version],
      "Cost lines append-only",
    );
    await denied(
      "delete from production_cost_versions where id=$1",
      [version],
      "Cost versions retained",
    );
    await denied("update finished_product_prices set sp_paise=0", "Price history retained");
    await login(users.owner);
    const zeroUpdates = JSON.stringify([{ piece_id: first.allocations[0].piece_id, sp_paise: 0 }]);
    check(
      await one(pricing, [
        randomUUID(),
        job,
        fourth,
        zeroUpdates,
        "Owner explicitly chooses zero SP for this piece",
      ]),
      "Explicit zero SP supported without minimum-margin invention",
    );
    await login(null);
    await q("insert into user_roles(user_id,role_key) values($1,'owner')", [
      users.ecommerce_manager,
    ]);
    await q("update profiles set active=false where id=$1", [users.owner]);
    await login(users.owner);
    await denied("select owner_production_costs($1)", [job]);
    await denied(finalize, costs);
    await denied(pricing, prices);
    await login(null);
    await db.exec("set role anon");
    await denied("select owner_production_costs($1)", [job]);
    await denied(finalize, costs);
    await denied(pricing, prices);
    await db.exec("reset role");
    console.log(
      directory +
        (demo ? " demo" : " clean") +
        ": Phase 12 costs/Design/rounding/SP/security passed",
    );
  } finally {
    await db.close();
  }
}
console.log("Phase 12: " + checks + " checks passed");
