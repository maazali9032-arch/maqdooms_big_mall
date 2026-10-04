/** Disposable PostgreSQL only. Never reads .env or executes fixtures live. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
  consumableQuantity,
  receiptCost,
  issueItems,
  definiteDatabaseRejection,
} from "../src/features/inventory/consumable-input.ts";
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
let checks = 0;
const check = (v, label) => {
  assert.ok(v, label);
  checks++;
};
check(consumableQuantity("1.001", "m") === 1.001, "Exact material decimal");
check(receiptCost("10.01") === 1001, "Exact paise");
check(
  issueItems([
    { inventory_item_id: "B", quantity: 1 },
    { inventory_item_id: "A", quantity: 2 },
  ])[0].inventory_item_id === "A",
  "Stable retry sort",
);
for (const fn of [
  () => consumableQuantity("0", "pc"),
  () => consumableQuantity("1.0001", "m"),
  () => consumableQuantity("10000000000000", "pc"),
  () => receiptCost("-1"),
  () => receiptCost("1.001"),
  () => receiptCost("999999999"),
  () => issueItems([]),
  () =>
    issueItems([
      { inventory_item_id: "A", quantity: 1 },
      { inventory_item_id: "A", quantity: 2 },
    ]),
]) {
  assert.throws(fn);
  checks++;
}
check(
  definiteDatabaseRejection({ code: "P0001" }) &&
    !definiteDatabaseRejection({ code: "FETCH_ERROR" }),
  "Network uncertainty retains retry",
);
for (const [directory, demo] of [
  ["supabase/migrations", true],
  ["drizzle/migrations", true],
  ["supabase/migrations", false],
]) {
  const db = new PGlite();
  const q = async (s, args = []) => {
    try {
      return (await db.query(s, args)).rows;
    } catch (e) {
      throw Object.assign(new Error(s + ": " + e.message), { code: e.code });
    }
  };
  const one = async (s, args = []) => Object.values((await q(s, args))[0])[0];
  const denied = async (s, args = [], label = s) => {
    let error;
    try {
      await q(s, args);
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
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`);
    let tables, before;
    const snapshot = async () => {
      const out = {};
      for (const t of tables)
        out[t.name] = await q(
          `select row from (select (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(r)) where key=any($1::text[])) row from public."${t.name}" r) z order by row::text`,
          [t.columns],
        );
      return JSON.stringify(out);
    };
    const files = (await fs.readdir(directory))
      .filter(
        (f) =>
          f.endsWith(".sql") &&
          (process.argv.includes("--include-phase15") || !f.includes("phase15_")) &&
          (process.argv.includes("--include-phase14") || !f.includes("phase14_")) &&
          (process.argv.includes("--include-phase13") || !f.includes("phase13_")) &&
          (process.argv.includes("--include-phase12") || !f.includes("phase12_")) &&
          (process.argv.includes("--include-phase11") || !f.includes("phase11_")) &&
          (process.argv.includes("--include-phase10") || !f.includes("phase10_")) &&
          !f.includes("_live_") &&
          (process.argv.includes("--include-phase10") ||
            process.argv.includes("--include-phase9") ||
            !f.includes("phase9_")),
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
                  : process.argv.includes("--include-phase10")
                    ? 21
                    : process.argv.includes("--include-phase15")
                      ? 26
                      : process.argv.includes("--include-phase14")
                        ? 25
                        : process.argv.includes("--include-phase13")
                          ? 24
                          : process.argv.includes("--include-phase12")
                            ? 23
                            : process.argv.includes("--include-phase11")
                              ? 22
                              : process.argv.includes("--include-phase10")
                                ? 21
                                : process.argv.includes("--include-phase9")
                                  ? 20
                                  : 19),
      "19 business migrations",
    );
    for (const f of files) {
      if (!demo && f.includes("demo_seed")) continue;
      if (f.includes("phase8_consumables")) {
        tables = await q(
          "select table_name name,array_agg(column_name order by ordinal_position) columns from information_schema.columns where table_schema='public' and table_name in(select tablename from pg_tables where schemaname='public') group by table_name order by table_name",
        );
        before = await snapshot();
      }
      await db.exec(await fs.readFile(resolve(directory, f), "utf8"));
    }
    check(before === (await snapshot()), "Every existing public row/column preserved");
    const users = {};
    for (const role of [
      "owner",
      "stock_entry",
      "counter",
      "tailor",
      "ecommerce_manager",
      "other_tailor",
    ]) {
      const id = (users[role] = randomUUID());
      await q("insert into auth.users values($1,$2)", [id, role + "@p8.test"]);
      await q("insert into profiles(id,full_name) values($1,$2)", [id, role]);
      await q("insert into user_roles(user_id,role_key) values($1,$2)", [
        id,
        role === "other_tailor" ? "tailor" : role,
      ]);
    }
    const workshop = await one("select id from locations where kind='workshop'");
    const showroom = await one("select id from locations where kind='showroom'");
    const receiptSql = "select receive_consumable($1,$2,$3,$4,$5,$6,$7,$8,$9)";
    await login(users.stock_entry);
    const receiptArgs = [
      randomUUID(),
      null,
      "Buttons",
      "set",
      "buttons",
      workshop,
      60,
      12000,
      "Supplier receipt",
    ];
    const receipt = await one(receiptSql, receiptArgs);
    check((await one(receiptSql, receiptArgs)) === receipt, "Receipt retry exactly once");
    await denied(
      receiptSql,
      [...receiptArgs.slice(0, 6), 61, 12000, "Supplier receipt"],
      "Changed retry rejected",
    );
    const material = await one("select material_id from consumable_receipts where id=$1", [
      receipt,
    ]);
    const item = await one("select inventory_item_id from consumable_receipts where id=$1", [
      receipt,
    ]);
    check(
      (await one("select consumable_catalog()")).find((m) => m.id === material).quantity === 60,
      "Receipt enters location ledger",
    );
    check(
      await one("select count(*)=0 from consumable_receipt_costs"),
      "Stock Entry cannot retrieve submitted CP",
    );
    await denied(
      "select request_payload from consumable_receipts",
      [],
      "Stock Entry retry CP payload inaccessible",
    );
    await denied(
      "select cost_paise from materials where id=$1",
      [material],
      "Stock Entry catalogue CP inaccessible",
    );
    for (const bad of [0, -1, 0.0001, 1e15])
      await denied(receiptSql, [
        randomUUID(),
        material,
        null,
        null,
        null,
        workshop,
        bad,
        100,
        "Invalid quantity",
      ]);
    await denied(receiptSql, [
      randomUUID(),
      null,
      "bad",
      "",
      "other",
      workshop,
      1,
      100,
      "Invalid unit",
    ]);
    await denied(receiptSql, [
      randomUUID(),
      null,
      "bad",
      "pc",
      "unknown",
      workshop,
      1,
      100,
      "Invalid category",
    ]);
    const beforeBad = await one(
      "select jsonb_build_array((select count(*) from materials),(select count(*) from inventory_items),(select count(*) from consumable_receipts))",
    );
    await denied(receiptSql, [
      randomUUID(),
      null,
      "bad",
      "pc",
      "thread",
      randomUUID(),
      5,
      100,
      "Invalid destination",
    ]);
    check(
      JSON.stringify(beforeBad) ===
        JSON.stringify(
          await one(
            "select jsonb_build_array((select count(*) from materials),(select count(*) from inventory_items),(select count(*) from consumable_receipts))",
          ),
        ),
      "Failed receipt creates no partial stock/receipt",
    );
    const stock = await one(
      "insert into fabrics(code,name,category) values('P8-F','Fabric','Fabric') returning id",
    );
    const batch = await one("insert into receiving_batches(code) values('P8-B') returning id");
    const fsid = await one("select create_fabric_entry($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      stock,
      batch,
      "[10000]",
      10000,
    ]);
    await q("select complete_fabric_entry($1)", [fsid]);
    await login(users.owner);
    check(await one("select count(*)=1 from consumable_receipt_costs"), "Owner sees receipt cost");
    check(
      (await one("select consumable_receipt_history(100)")).length === 1,
      "Owner receipt history",
    );
    const setup = "select setup_customer_tailoring_assignment($1,$2,$3,$4,$5,$6,$7)";
    const assignment = await one(setup, [
      "P8F",
      "Factory",
      "P8S",
      "Section",
      "P8T",
      "Tailor",
      users.tailor,
    ]);
    const otherAssignment = await one(setup, [
      "P8F2",
      "Factory2",
      null,
      null,
      "P8T2",
      "Other Tailor",
      users.other_tailor,
    ]);
    const charge = await one("select set_customer_tailoring_charge('P8CH','Charge',25000)");
    const fabricItem = await one(
      "select id from inventory_items where thaan_id in(select id from thaans where fabric_stock_id=$1)",
      [fsid],
    );
    const threadReceipt = await one(receiptSql, [
      randomUUID(),
      null,
      "Thread",
      "m",
      "thread",
      workshop,
      10.125,
      500,
      "Thread receipt",
    ]);
    const threadItem = await one("select inventory_item_id from consumable_receipts where id=$1", [
      threadReceipt,
    ]);
    const otherItem = await one(receiptSql, [
      randomUUID(),
      null,
      "Padding",
      "pair",
      "padding",
      showroom,
      5,
      200,
      "Padding receipt",
    ]);
    check(otherItem, "Padding supported");
    const otherReceipt = await one(receiptSql, [
      randomUUID(),
      null,
      "Other material",
      "pc",
      "other",
      workshop,
      10,
      0,
      "Explicit zero CP",
    ]);
    check(otherReceipt, "Other and zero CP supported");
    await login(users.counter);
    const customer = await one(
      "select find_or_create_customer('P8 Customer','123456','123457',null)",
    );
    const quote = await one("select quote_customer_tailoring($1,$2::jsonb,$3)", [
      workshop,
      JSON.stringify([{ inventory_item_id: fabricItem, quantity: 1000 }]),
      charge,
    ]);
    const job = await one("select create_customer_tailoring($1,$2,$3,$4,$5,$6)", [
      randomUUID(),
      quote.quote_id,
      customer,
      assignment,
      "Suit",
      "Phase8",
    ]);
    const job2quote = await one("select quote_customer_tailoring($1,$2::jsonb,$3)", [
      workshop,
      JSON.stringify([{ inventory_item_id: fabricItem, quantity: 1000 }]),
      charge,
    ]);
    const job2 = await one("select create_customer_tailoring($1,$2,$3,$4,$5,$6)", [
      randomUUID(),
      job2quote.quote_id,
      customer,
      otherAssignment,
      "Suit2",
      null,
    ]);
    const catalog = await one("select consumable_catalog()");
    check(
      !JSON.stringify(catalog).includes("cp") && !JSON.stringify(catalog).includes("cost_paise"),
      "Counter stock projection has no cost",
    );
    const jobs = await one("select material_issue_jobs()");
    check(
      jobs.find((j) => j.id === job).factory_name === "Factory" &&
        jobs.find((j) => j.id === job).section_name === "Section",
      "Job genealogy derived",
    );
    const issueSql = "select post_material_issue($1,$2,$3,$4,$5,$6::jsonb,$7)";
    const args = [
      randomUUID(),
      "customer_tailoring",
      job,
      workshop,
      "required",
      JSON.stringify([
        { inventory_item_id: item, quantity: 5 },
        { inventory_item_id: threadItem, quantity: 1.125 },
      ]),
      "Actual suit requirements",
    ];
    const issue = await one(issueSql, args);
    check((await one(issueSql, args)) === issue, "Issue retry exactly once");
    await denied(
      issueSql,
      [randomUUID(), ...args.slice(1)],
      "A new request cannot issue already-required material again",
    );
    check(
      (await one("select consumable_catalog()")).find((m) => m.id === material).quantity === 55,
      "Exact button deduction",
    );
    const h = (await one("select material_issue_history($1,100)", [job])).find(
      (i) => i.id === issue,
    );
    check(
      h.lines.length === 2 &&
        h.lines.every((l) => l.movement_id) &&
        h.issued_by === users.counter &&
        h.source_name === "Workshop" &&
        h.tailor_name === "Tailor",
      "History includes every line actor source genealogy",
    );
    check(
      !JSON.stringify(h).includes("cost_paise") && !JSON.stringify(h).includes("cp_"),
      "Issue history never exposes costs",
    );
    await denied(issueSql, [...args.slice(0, 6), "Changed reason"], "Changed request rejected");
    const extraArgs = [
      randomUUID(),
      "customer_tailoring",
      job,
      workshop,
      "additional",
      JSON.stringify([
        { inventory_item_id: item, quantity: 2 },
        { inventory_item_id: fabricItem, quantity: 100 },
      ]),
      "Additional actual material",
    ];
    const extra = await one(issueSql, extraArgs);
    check(extra, "Explicit additional fabric and material");
    check(
      (await one("select customer_tailoring_history($1,50)", [job]))[0]
        .final_customer_price_paise === 35000,
      "Additional issue does not reprice booked order",
    );
    await denied(issueSql, [
      randomUUID(),
      "customer_tailoring",
      job,
      workshop,
      "required",
      JSON.stringify([{ inventory_item_id: fabricItem, quantity: 1 }]),
      "Duplicate required fabric",
    ]);
    for (const [src, type, lines, reason] of [
      [showroom, "required", [{ inventory_item_id: item, quantity: 1 }], "Wrong location"],
      [workshop, "required", [{ inventory_item_id: item, quantity: 999 }], "Insufficient"],
      [workshop, "additional", [{ inventory_item_id: item, quantity: 1 }], ""],
      [
        workshop,
        "required",
        [
          { inventory_item_id: item, quantity: 1 },
          { inventory_item_id: item, quantity: 2 },
        ],
        "Duplicate",
      ],
      [workshop, "required", [{ inventory_item_id: randomUUID(), quantity: 1 }], "Missing"],
      [workshop, "required", [{ inventory_item_id: item, quantity: 0.0001 }], "Fraction"],
    ])
      await denied(issueSql, [
        randomUUID(),
        "customer_tailoring",
        job,
        src,
        type,
        JSON.stringify(lines),
        reason,
      ]);
    await login(null);
    const prior = await one(
      "select jsonb_build_array((select count(*) from material_issues),(select count(*) from material_issue_lines),(select count(*) from inventory_movements),(select count(*) from job_material_requirements),(select count(*) from erp_audit_records))",
    );
    await db.exec(
      `create function p8_test_fail() returns trigger language plpgsql as $$begin if NEW.material_id=(select material_id from inventory_items where id='${threadItem}') and NEW.kind='MATERIAL_ISSUE' then raise exception 'Forced late failure';end if;return NEW;end$$;create trigger z_p8_test_fail before insert on inventory_movements for each row execute function p8_test_fail();`,
    );
    await login(users.counter);
    const retryArgs = [
      randomUUID(),
      "customer_tailoring",
      job,
      workshop,
      "additional",
      JSON.stringify([
        { inventory_item_id: item, quantity: 1 },
        { inventory_item_id: threadItem, quantity: 1 },
      ]),
      "Atomic test",
    ];
    await denied(issueSql, retryArgs);
    await login(null);
    check(
      JSON.stringify(prior) ===
        JSON.stringify(
          await one(
            "select jsonb_build_array((select count(*) from material_issues),(select count(*) from material_issue_lines),(select count(*) from inventory_movements),(select count(*) from job_material_requirements),(select count(*) from erp_audit_records))",
          ),
        ),
      "Late failure rolls back header lines ledger requirements audit",
    );
    await db.exec(
      "drop trigger z_p8_test_fail on inventory_movements;drop function p8_test_fail()",
    );
    await login(users.counter);
    check(await one(issueSql, retryArgs), "Same request succeeds after rollback");
    await q("select set_customer_tailoring_status($1,'ready')", [job]);
    await denied(issueSql, [
      randomUUID(),
      "customer_tailoring",
      job,
      workshop,
      "additional",
      JSON.stringify([{ inventory_item_id: item, quantity: 1 }]),
      "Closed",
    ]);
    check(
      (await one(issueSql, args)) === issue,
      "Existing confirmed retry works even after job closes",
    );
    await q("select set_customer_tailoring_status($1,'open')", [job]);
    await login(users.owner);
    await q("select manage_consumable($1,'Buttons','buttons',false)", [material]);
    await login(users.counter);
    await denied(issueSql, [
      randomUUID(),
      "customer_tailoring",
      job,
      workshop,
      "additional",
      JSON.stringify([{ inventory_item_id: item, quantity: 1 }]),
      "Inactive",
    ]);
    await login(users.owner);
    await q("select manage_consumable($1,'Buttons','buttons',true)", [material]);
    await login(null);
    check(
      await one("select qty_on_hand=0 from materials where id=$1", [material]),
      "Legacy quantity never mutated",
    );
    const requirement = await one(
      "select id from job_material_requirements where material_issue_line_id in(select id from material_issue_lines where material_issue_id=$1) limit 1",
      [issue],
    );
    await denied(
      "update job_material_requirements set quantity=99 where id=$1",
      [requirement],
      "Posted requirement immutable even to privileged update",
    );
    await denied("delete from material_issues where id=$1", [issue]);
    await denied("update consumable_receipts set quantity=99 where id=$1", [receipt]);
    await denied(
      "insert into job_material_requirements(customer_tailoring_job_id,material_id,quantity,unit) values($1,$2,1,'set')",
      [job, material],
      "Unlinked booked consumable requirement denied",
    );
    await denied(
      "insert into job_material_requirements(customer_tailoring_job_id,material_id,quantity,unit,material_issue_line_id) select $1,$2,99,'set',id from material_issue_lines where material_issue_id=$3 limit 1",
      [job, material, extra],
      "Additional/wrong quantity cannot become requirement",
    );
    const product = await one(
      "insert into products(code,name) values('P8P','Product') returning id",
    );
    const design = await one("insert into designs(code,name) values('P8D','Design') returning id");
    const prod = await one(
      "insert into production_jobs(code,product_id,design_id,quantity,tailor_assignment_id,status) values('P8PROD',$1,$2,1,$3,'open') returning id",
      [product, design, assignment],
    );
    await login(users.counter);
    const prodIssue = await one(issueSql, [
      randomUUID(),
      "production",
      prod,
      workshop,
      "required",
      JSON.stringify([
        { inventory_item_id: item, quantity: 1 },
        { inventory_item_id: fabricItem, quantity: 100 },
      ]),
      "Production materials",
    ]);
    check(
      (await one("select material_issue_history($1,100)", [prod]))[0].id === prodIssue,
      "Existing Production Job issue supported without creating production workflow",
    );
    for (const role of [
      "owner",
      "counter",
      "tailor",
      "stock_entry",
      "ecommerce_manager",
      "other_tailor",
    ]) {
      await login(users[role]);
      for (const table of [
        "consumable_receipts",
        "consumable_receipt_costs",
        "material_issues",
        "material_issue_lines",
        "inventory_movements",
        "job_material_requirements",
      ])
        check(
          !(await one("select has_table_privilege(current_user,$1,'INSERT')", ["public." + table])),
          role + " direct writes sealed: " + table,
        );
      if (role !== "owner")
        check(await one("select count(*)=0 from consumable_receipt_costs"), role + " costs hidden");
      if (["tailor", "other_tailor"].includes(role)) {
        const visible = await one("select material_issue_jobs()");
        check(
          visible.every((j) => (role === "tailor" ? [job, prod].includes(j.id) : j.id === job2)),
          "Assigned jobs only",
        );
        const ih = await one("select material_issue_history(null,100)");
        check(
          ih.every((i) =>
            role === "tailor"
              ? [job, prod].includes(i.customer_tailoring_job_id ?? i.production_job_id)
              : i.customer_tailoring_job_id === job2,
          ),
          "Assigned issue history only",
        );
        await denied("select consumable_catalog()");
      }
      if (!["owner", "counter"].includes(role))
        await denied(issueSql, [
          randomUUID(),
          "customer_tailoring",
          job,
          workshop,
          "additional",
          JSON.stringify([{ inventory_item_id: item, quantity: 1 }]),
          "Unauthorized",
        ]);
      if (!["owner", "stock_entry"].includes(role))
        await denied(receiptSql, [
          randomUUID(),
          material,
          null,
          null,
          null,
          workshop,
          1,
          100,
          "Unauthorized",
        ]);
      if (role !== "owner")
        await denied("select manage_consumable($1,'Buttons','buttons',true)", [material]);
    }
    await login(null);
    await q(
      "insert into user_permission_overrides(user_id,permission_key,granted) values($1,'pos.issue_to_tailoring',false),($2,'inventory.receive',false)",
      [users.counter, users.stock_entry],
    );
    await login(users.counter);
    await denied(issueSql, [
      randomUUID(),
      "customer_tailoring",
      job,
      workshop,
      "additional",
      JSON.stringify([{ inventory_item_id: item, quantity: 1 }]),
      "Revoked permission",
    ]);
    await login(users.stock_entry);
    await denied(receiptSql, [
      randomUUID(),
      material,
      null,
      null,
      null,
      workshop,
      1,
      100,
      "Revoked permission",
    ]);
    await login(null);
    await denied(
      "insert into inventory_movements(kind,inventory_item_id,material_id,quantity,unit,destination_location_id,consumable_receipt_id,reason,actor_id) values('INWARD',$1,$2,1,'set',$3,$4,'Fake receipt',$5)",
      [item, material, workshop, receipt, users.stock_entry],
      "Mismatched receipt movement rejected",
    );
    await denied(
      "insert into inventory_movements(kind,inventory_item_id,material_id,quantity,unit,destination_location_id,consumable_receipt_id,reason,actor_id) values('INWARD',$1,$2,60,'set',$3,$4,'Duplicate receipt',$5)",
      [item, material, workshop, receipt, users.stock_entry],
      "Receipt cannot post twice",
    );
    await q("update profiles set active=false where id=$1", [users.counter]);
    await login(users.counter);
    await denied("select material_issue_jobs()");
    await denied(issueSql, [
      randomUUID(),
      "customer_tailoring",
      job,
      workshop,
      "additional",
      JSON.stringify([{ inventory_item_id: item, quantity: 1 }]),
      "Inactive caller",
    ]);
    await login(null);
    await db.exec("set role anon");
    for (const s of [
      "select consumable_catalog()",
      "select material_issue_jobs()",
      "select material_issue_history(null,100)",
      "select consumable_receipt_history(100)",
    ])
      await denied(s);
    await db.exec("reset role");
    console.log(
      directory +
        (demo ? " demo" : " clean") +
        ": Phase 8 business/security/preservation checks passed",
    );
  } finally {
    await db.close();
  }
}
console.log("Phase 8: " + checks + " checks passed");
