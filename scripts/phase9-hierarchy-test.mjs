/** Phase 9: disposable PostgreSQL only; no live credentials or fixtures. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
  hierarchySections,
  hierarchyTailors,
} from "../src/features/tailoring/hierarchy-options.ts";
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
let checks = 0;
const check = (v, label) => {
  assert.ok(v, label);
  checks++;
};
const ui = [
  {
    id: "A",
    factory_id: "F1",
    factory_name: "F1",
    section_id: "S1",
    section_name: "S1",
    tailor_name: "T1",
    tailor_code: "T1",
  },
  {
    id: "B",
    factory_id: "F2",
    factory_name: "F2",
    section_id: "S2",
    section_name: "S2",
    tailor_name: "T2",
    tailor_code: "T2",
  },
  {
    id: "C",
    factory_id: "F1",
    factory_name: "F1",
    section_id: null,
    section_name: null,
    tailor_name: "T3",
    tailor_code: "T3",
  },
];
check(hierarchySections(ui, "F1").length === 2, "Only selected Factory Sections");
check(hierarchyTailors(ui, "F1", "S2").length === 0, "Cross-Factory Section cannot leak Tailors");
check(hierarchyTailors(ui, "F1", "none")[0].id === "C", "Optional Section filtering");
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
                  : process.argv.includes("--include-phase10")
                    ? 21
                    : 20),
      "Full 20-file business chain",
    );
    for (const f of files) {
      if (!demo && f.includes("demo_seed")) continue;
      if (f.includes("phase9_")) {
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
      await q("insert into auth.users values($1,$2)", [id, role + "@p9.test"]);
      await q("insert into profiles(id,full_name) values($1,$2)", [id, role]);
      await q("insert into user_roles(user_id,role_key) values($1,$2)", [
        id,
        role === "other_tailor" ? "tailor" : role,
      ]);
    }
    const manageSql = "select manage_tailoring_entity($1,$2,$3,$4,$5,$6,$7,$8,$9)";
    const assignSql = "select assign_tailor($1,$2,$3,$4,$5,$6)";
    const manage = async (kind, code, name, factory = null, profile = null) =>
      one(manageSql, [
        randomUUID(),
        kind,
        null,
        code,
        name,
        true,
        factory,
        profile,
        "Owner explicit creation",
      ]);
    await login(users.owner);
    const factoryArgs = [
      randomUUID(),
      "factory",
      null,
      "P9F",
      "Factory",
      true,
      null,
      null,
      "Create Factory",
    ];
    const f1 = await one(manageSql, factoryArgs);
    check((await one(manageSql, factoryArgs)) === f1, "Factory retry exactly once");
    await denied(
      manageSql,
      [...factoryArgs.slice(0, 4), "Different", ...factoryArgs.slice(5)],
      "Changed request rejected",
    );
    const f2 = await manage("factory", "P9F2", "Factory2");
    const s1 = await manage("section", "P9S", "Section", f1);
    const s2 = await manage("section", "P9S", "Other Section", f2);
    check(s1 !== s2, "Section code scoped to Factory");
    const t1 = await manage("tailor", "P9T", "Real Tailor", null, users.tailor);
    const t2 = await manage("tailor", "P9T2", "No login Tailor");
    const t3 = await manage("tailor", "P9T3", "Other Tailor", null, users.other_tailor);
    const a1args = [randomUUID(), t1, f1, s1, null, "Initial assignment"];
    const a1 = await one(assignSql, a1args);
    check((await one(assignSql, a1args)) === a1, "Assignment retry exactly once");
    const a2 = await one(assignSql, [randomUUID(), t2, f1, null, null, "No Section"]);
    await one(assignSql, [randomUUID(), t3, f2, s2, null, "Other Tailor"]);
    check(
      (await one(assignSql, [randomUUID(), t1, f1, s1, a1, "No change"])) === a1,
      "Same current target creates no duplicate assignment",
    );
    await denied(
      assignSql,
      [randomUUID(), t1, f1, s2, a1, "Cross Factory"],
      "Cross-Factory Section denied",
    );
    await denied(assignSql, [randomUUID(), t1, f2, s2, null, "Stale"], "Stale assignment denied");
    await denied(
      manageSql,
      [randomUUID(), "factory", f1, "CHANGED", "Factory", true, null, null, "Rename ID"],
      "Historical business code immutable",
    );
    await denied(
      manageSql,
      [randomUUID(), "section", s1, "P9S", "Section", true, f2, null, "Reparent"],
      "Section Factory immutable",
    );
    await denied(
      manageSql,
      [randomUUID(), "tailor", null, "BAD", "Bad", true, null, users.counter, "Wrong role"],
      "Cannot assign Counter login as Tailor",
    );
    await denied(manageSql, [randomUUID(), "factory", null, "", "Empty", true, null, null, "Bad"]);
    await denied(manageSql, [
      randomUUID(),
      "section",
      null,
      "BAD",
      "Bad",
      true,
      randomUUID(),
      null,
      "Bad",
    ]);
    const workshop = await one("select id from locations where kind='workshop'");
    const fabric = await one(
      "insert into fabrics(code,name,category) values('P9FAB','Fabric','Fabric') returning id",
    );
    const batch = await one("insert into receiving_batches(code) values('P9B') returning id");
    const fsid = await one("select create_fabric_entry($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      fabric,
      batch,
      "[10000]",
      10000,
    ]);
    await q("select complete_fabric_entry($1)", [fsid]);
    const charge = await one("select set_customer_tailoring_charge('P9CH','Charge',25000)");
    const item = await one(
      "select id from inventory_items where thaan_id in(select id from thaans where fabric_stock_id=$1)",
      [fsid],
    );
    const receipt = await one("select receive_consumable($1,null,$2,$3,$4,$5,$6,$7,$8)", [
      randomUUID(),
      "Thread",
      "m",
      "thread",
      workshop,
      10,
      100,
      "Stock",
    ]);
    const materialItem = await one(
      "select inventory_item_id from consumable_receipts where id=$1",
      [receipt],
    );
    await login(users.counter);
    const options = await one("select tailoring_assignment_options($1,$2,false)", [f1, s1]);
    check(
      options.length === 1 && options[0].id === a1,
      "Server filters relevant Factory Section Tailor",
    );
    check(
      (await one("select tailoring_assignment_options($1,null,true)", [f1]))[0].id === a2,
      "Server no Section filtering",
    );
    check(
      (await one("select tailoring_assignment_options($1,$2,false)", [f1, s2])).length === 0,
      "Server cross-Factory option empty",
    );
    const customer = await one(
      "select find_or_create_customer('P9 Customer','998001','998002',null)",
    );
    const quote = await one("select quote_customer_tailoring($1,$2::jsonb,$3)", [
      workshop,
      JSON.stringify([{ inventory_item_id: item, quantity: 1000 }]),
      charge,
    ]);
    const job = await one("select create_customer_tailoring($1,$2,$3,$4,$5,$6)", [
      randomUUID(),
      quote.quote_id,
      customer,
      a1,
      "Suit",
      "Historic",
    ]);
    const oldHistory = (await one("select customer_tailoring_history($1,50)", [job]))[0];
    await login(users.owner);
    const moveArgs = [randomUUID(), t1, f2, s2, a1, "Owner moved Tailor"];
    const moved = await one(assignSql, moveArgs);
    check(moved !== a1, "Reassignment creates new ID");
    check((await one(assignSql, moveArgs)) === moved, "Move retry exactly once");
    const all = await one("select owner_tailoring_hierarchy()");
    check(
      all.assignments.find((a) => a.id === a1).valid_until ===
        all.assignments.find((a) => a.id === moved).valid_from,
      "Closed/open assignment boundary matches",
    );
    check(
      all.assignments.filter((a) => a.tailor_id === t1 && !a.valid_until).length === 1,
      "One current assignment",
    );
    const movedAgain = await one(assignSql, [
      randomUUID(),
      t1,
      f1,
      null,
      moved,
      "Another explicit move",
    ]);
    check(
      (await one(assignSql, moveArgs)) === moved,
      "Retry old move does not move Tailor back after a later change",
    );
    check(
      (await one("select owner_tailoring_hierarchy()")).assignments.find((a) => a.id === movedAgain)
        .valid_until === null,
      "Latest assignment remains current",
    );
    await denied(
      assignSql,
      [randomUUID(), t1, f2, s2, a1, "Stale"],
      "Stale move cannot override newer assignment",
    );
    await login(null);
    const beforeFail = await one(
      "select jsonb_build_array((select count(*) from tailor_assignments),(select count(*) from tailoring_management_requests),(select count(*) from erp_audit_records))",
    );
    await db.exec(
      "create function phase9_test_failure() returns trigger language plpgsql as $$begin if NEW.payload->>'kind'='assignment' then raise exception 'Forced late failure';end if;return NEW;end$$;create trigger z_phase9_test_failure before insert on tailoring_management_requests for each row execute function phase9_test_failure();",
    );
    await login(users.owner);
    const retryMove = [randomUUID(), t1, f2, s2, movedAgain, "Atomic move"];
    await denied(assignSql, retryMove, "Late failure must roll back reassignment");
    check(
      (await one("select owner_tailoring_hierarchy()")).assignments.find((a) => a.id === movedAgain)
        .valid_until === null,
      "Old assignment stays current on late failure",
    );
    await login(null);
    check(
      JSON.stringify(beforeFail) ===
        JSON.stringify(
          await one(
            "select jsonb_build_array((select count(*) from tailor_assignments),(select count(*) from tailoring_management_requests),(select count(*) from erp_audit_records))",
          ),
        ),
      "New assignment/request/audit all rolled back",
    );
    await db.exec(
      "drop trigger z_phase9_test_failure on tailoring_management_requests;drop function phase9_test_failure()",
    );
    await login(users.owner);
    check(await one(assignSql, retryMove), "Same move retry succeeds after rollback");
    await login(users.counter);
    const history = (await one("select customer_tailoring_history($1,50)", [job]))[0];
    check(
      history.assignment_id === a1 &&
        history.factory_name === oldHistory.factory_name &&
        history.section_name === oldHistory.section_name &&
        history.final_customer_price_paise === 35000,
      "Old job genealogy and price preserved",
    );
    check(
      !(await one("select tailoring_assignment_options()")).some((a) => a.id === a1),
      "Counter cannot select closed assignment",
    );
    check(
      await one("select post_material_issue($1,$2,$3,$4,$5,$6::jsonb,$7)", [
        randomUUID(),
        "customer_tailoring",
        job,
        workshop,
        "additional",
        JSON.stringify([{ inventory_item_id: materialItem, quantity: 1 }]),
        "Actual addition for original job",
      ]),
      "Old job can receive explicit additional material after Tailor moves",
    );
    const issue = (await one("select material_issue_history($1,100)", [job])).find(
      (i) => i.issue_type === "additional",
    );
    check(
      issue.tailor_assignment_id === a1 && issue.factory_name === "Factory",
      "New issue retains old job assignment",
    );
    const quote2 = await one("select quote_customer_tailoring($1,$2::jsonb,$3)", [
      workshop,
      JSON.stringify([{ inventory_item_id: item, quantity: 1000 }]),
      charge,
    ]);
    await denied(
      "select create_customer_tailoring($1,$2,$3,$4,$5,$6)",
      [randomUUID(), quote2.quote_id, customer, a1, "Bad", "Closed assignment"],
      "New jobs cannot use old assignment",
    );
    await login(users.owner);
    await one(manageSql, [
      randomUUID(),
      "tailor",
      t1,
      "P9T",
      "Renamed Tailor",
      false,
      null,
      users.tailor,
      "Disable",
    ]);
    await login(users.counter);
    check(
      !(await one("select tailoring_assignment_options()")).some((a) => a.tailor_id === t1),
      "Disabled Tailor excluded",
    );
    await login(users.owner);
    await one(manageSql, [
      randomUUID(),
      "tailor",
      t1,
      "P9T",
      "Renamed Tailor",
      true,
      null,
      users.tailor,
      "Enable",
    ]);
    await one(manageSql, [
      randomUUID(),
      "factory",
      f1,
      "P9F",
      "Factory renamed",
      false,
      null,
      null,
      "Disable Factory",
    ]);
    await login(users.counter);
    check(
      !(await one("select tailoring_assignment_options()")).some((a) => a.factory_id === f1),
      "Disabled parent excludes descendants",
    );
    await login(users.owner);
    await one(manageSql, [
      randomUUID(),
      "factory",
      f1,
      "P9F",
      "Factory",
      true,
      null,
      null,
      "Enable Factory",
    ]);
    await one(manageSql, [
      randomUUID(),
      "section",
      s2,
      "P9S",
      "Other Section",
      false,
      f2,
      null,
      "Disable Section",
    ]);
    await login(users.counter);
    check(
      !(await one("select tailoring_assignment_options()")).some((a) => a.section_id === s2),
      "Disabled Section excluded",
    );
    await login(users.owner);
    await one(manageSql, [
      randomUUID(),
      "section",
      s2,
      "P9S",
      "Other Section",
      true,
      f2,
      null,
      "Enable Section",
    ]);
    await denied(
      manageSql,
      [randomUUID(), "tailor", t1, "P9T", "Tailor", true, null, users.other_tailor, "Change login"],
      "Historical Tailor login cannot change",
    );
    await one(manageSql, [
      randomUUID(),
      "tailor",
      t2,
      "P9T2",
      "No login Tailor",
      true,
      null,
      null,
      "No-login edit",
    ]);
    await login(null);
    await denied("delete from tailor_assignments where id=$1", [a1], "No assignment delete");
    await denied(
      "update tailor_assignments set valid_until=null where id=$1",
      [a1],
      "Closed assignment cannot reopen",
    );
    for (const table of ["tailoring_factories", "tailoring_sections", "tailors"])
      await denied(`delete from ${table}`);
    await denied(
      "update tailoring_management_requests set result_id=$1",
      [randomUUID()],
      "Request history immutable",
    );
    for (const role of ["counter", "tailor", "other_tailor", "stock_entry", "ecommerce_manager"]) {
      await login(users[role]);
      await denied("select owner_tailoring_hierarchy()");
      await denied(manageSql, factoryArgs);
      await denied(assignSql, moveArgs);
      for (const table of [
        "tailoring_factories",
        "tailoring_sections",
        "tailors",
        "tailor_assignments",
        "tailoring_management_requests",
      ])
        check(
          !(await one("select has_table_privilege(current_user,$1,'INSERT')", ["public." + table])),
          role + " raw hierarchy writes sealed",
        );
      check(
        await one("select count(*)=0 from tailoring_management_requests"),
        role + " private management requests hidden",
      );
      if (role === "tailor" || role === "other_tailor") {
        const opts = await one("select tailoring_assignment_options()");
        check(
          opts.every((a) => (role === "tailor" ? a.tailor_id === t1 : a.tailor_id === t3)),
          "Tailor sees own options only",
        );
        check(await one("select count(*)=0 from fabric_stock_costs"), "Tailor CP still hidden");
      }
      if (role === "stock_entry" || role === "ecommerce_manager")
        await denied("select tailoring_assignment_options()");
    }
    await login(null);
    await q("insert into user_roles(user_id,role_key) values($1,'owner')", [
      users.ecommerce_manager,
    ]);
    await q("update profiles set active=false where id=$1", [users.owner]);
    await login(users.owner);
    await denied("select owner_tailoring_hierarchy()");
    await denied(manageSql, factoryArgs);
    await login(null);
    await db.exec("set role anon");
    for (const call of [
      "select owner_tailoring_hierarchy()",
      "select tailoring_assignment_options()",
    ])
      await denied(call);
    await db.exec("reset role");
    console.log(
      directory + (demo ? " demo" : " clean") + ": Phase 9 hierarchy/history/security passed",
    );
  } finally {
    await db.close();
  }
}
console.log("Phase 9: " + checks + " checks passed");
