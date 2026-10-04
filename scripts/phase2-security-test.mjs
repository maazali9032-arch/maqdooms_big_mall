/** Disposable PostgreSQL role tests; never connects to production or reads .env. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
let checks = 0;
for (const directory of ["supabase/migrations", "drizzle/migrations"]) {
  const db = new PGlite();
  const q = async (sql, args = []) => {
    try {
      return (await db.query(sql, args)).rows;
    } catch (e) {
      throw new Error(`${sql}: ${e.message}`);
    }
  };
  const one = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const check = (value, label) => {
    assert.ok(value, label);
    checks++;
  };
  const denied = async (sql, args = [], label = sql) => {
    let error;
    try {
      await q(sql, args);
    } catch (e) {
      error = e;
    }
    check(error, label);
  };
  const login = async (id) => {
    await db.exec("reset role");
    await q("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
    await db.exec("set role authenticated");
  };
  const admin = async () => {
    await db.exec("reset role");
    await q("select set_config('request.jwt.claim.sub','',false)");
  };
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`);
    const includePhase7 =
      process.argv.includes("--include-phase9") ||
      process.argv.includes("--include-phase8") ||
      process.argv.includes("--include-phase7");
    const includePhase6 = includePhase7 || process.argv.includes("--include-phase6");
    const includePhase5 = includePhase6 || process.argv.includes("--include-phase5");
    const includePhase4 = includePhase5 || process.argv.includes("--include-phase4");
    const includePhase3 = includePhase4 || process.argv.includes("--include-phase3");
    const files = (await readdir(directory))
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
            !f.includes("phase9_")) &&
          (process.argv.includes("--include-phase9") ||
            process.argv.includes("--include-phase8") ||
            !f.includes("phase8_")) &&
          (includePhase3 || !f.includes("phase3_")) &&
          (includePhase4 || !f.includes("phase4_")) &&
          (includePhase5 || !f.includes("phase5_")) &&
          (includePhase6 || !f.includes("phase6_")) &&
          (includePhase7 || !f.includes("phase7_")),
      )
      .sort();
    assert.equal(
      files.length,
      includePhase7
        ? process.argv.includes("--include-phase9") || process.argv.includes("--include-phase8")
          ? process.argv.includes("--include-phase15")
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
                        : 19
          : 17
        : includePhase6
          ? 16
          : includePhase5
            ? 15
            : includePhase4
              ? 14
              : includePhase3
                ? 13
                : 12,
    );
    let beforeSecurity;
    const snapshot = async () =>
      JSON.stringify(
        await q(
          "select tablename,jsonb_agg(rowdata order by rowdata::text) as rows from (select 'thaans' tablename,to_jsonb(t) rowdata from thaans t union all select 'thaan_costs',to_jsonb(t) from thaan_costs t union all select 'stock_movements',to_jsonb(t) from stock_movements t union all select 'fabric_stock_costs',to_jsonb(t) from fabric_stock_costs t union all select 'user_roles',to_jsonb(t) from user_roles t union all select 'user_permission_overrides',to_jsonb(t) from user_permission_overrides t) s group by tablename order by tablename",
        ),
      );
    for (const f of files) {
      if (f.includes("phase2_")) beforeSecurity = await snapshot();
      try {
        await db.exec(await readFile(resolve(directory, f), "utf8"));
      } catch (e) {
        throw new Error(`${f}: ${e.message}`);
      }
    }
    check(
      beforeSecurity === (await snapshot()),
      "Phase 2 migration preserves existing business and access rows",
    );
    const ids = {};
    for (const role of ["owner", "stock_entry", "counter", "tailor", "other_tailor"]) {
      const id = (ids[role] = randomUUID());
      await q("insert into auth.users(id,email) values($1,$2)", [id, `${role}@test.invalid`]);
      await q("insert into profiles(id,full_name) values($1,$2)", [id, role]);
      await q("insert into user_roles(user_id,role_key) values($1,$2)", [
        id,
        role === "other_tailor" ? "tailor" : role,
      ]);
    }
    const batch = randomUUID(),
      thaan = randomUUID(),
      closed = randomUUID();
    await q("insert into receiving_batches(id,code,created_by) values($1,'TEST-BATCH',$2)", [
      batch,
      ids.stock_entry,
    ]);
    await q(
      "insert into thaans(id,barcode,batch_id,created_by,status) values($1,'TEST-OPEN',$2,$3,'draft'),($4,'TEST-CLOSED',$2,$3,'active')",
      [thaan, batch, ids.stock_entry, closed],
    );
    await q("update thaans set original_mm=10000,price_paise=15000 where id=$1", [closed]);
    await q("insert into thaan_costs(thaan_id,cost_paise) values($1,1000),($2,2000)", [
      thaan,
      closed,
    ]);
    const stock = (await q("select id from fabric_stock limit 1"))[0].id;
    await q("update fabric_stock set created_by=$1,entry_state='draft' where id=$2", [
      ids.stock_entry,
      stock,
    ]);
    for (const role of ["counter", "tailor", "stock_entry"]) {
      await login(ids[role]);
      check(await one("select count(*)=0 from thaan_costs"), `${role} no raw CP`);
      check(await one("select count(*)=0 from fabric_stock_costs"), `${role} no CP history`);
      check(
        await one("select count(*)=0 from production_cost_versions"),
        `${role} no production cost versions`,
      );
      check(
        await one("select count(*)=0 from production_cost_lines"),
        `${role} no production cost lines`,
      );
      check(await one("select count(*)=0 from material_costs()"), `${role} no consumable CP RPC`);
      await denied("select cost_paise from materials", [], `${role} no raw consumable CP`);
      await denied(
        "select cost_snapshot_paise from stock_movements",
        [],
        `${role} no raw movement CP`,
      );
      await denied(
        "select cost_snapshot_paise from tailoring_job_lines",
        [],
        `${role} no raw job CP`,
      );
      check(await one("select count(*)=0 from tailoring_line_costs()"), `${role} no job CP RPC`);
      await denied(
        "insert into thaan_costs(thaan_id,cost_paise) values($1,999) on conflict(thaan_id) do update set cost_paise=999",
        [closed],
        `${role} no historical CP write`,
      );
      if (role !== "stock_entry")
        await denied(
          "select domain_stock_entry_cp($1,100)",
          [stock],
          `${role} domain CP endpoint denial`,
        );
    }
    await login(ids.stock_entry);
    const bootstrap = await one("select bootstrap_current_user(null)");
    check(
      !bootstrap.permissions.includes("inventory.view_cost"),
      "Stock Entry bootstrap has no ongoing CP permission",
    );
    check((await one("select stock_entry_cp($1)", [thaan])) === 1000, "Stock Entry scoped CP read");
    await q("select stock_entry_set_cp($1,3000)", [thaan]);
    check((await one("select stock_entry_cp($1)", [thaan])) === 3000, "Stock Entry scoped CP edit");
    await denied("select stock_entry_cp($1)", [closed], "Completed workflow no CP read");
    await denied("select stock_entry_set_cp($1,4000)", [closed], "Completed workflow no CP edit");
    await denied("select stock_entry_set_cp($1,-1)", [thaan], "Negative CP rejected");
    await denied(
      "update thaans set price_paise=100 where id=$1",
      [thaan],
      "Stock Entry SP update denied",
    );
    await denied(
      "select correct_incomplete_thaan($1,null,null,null,100,null)",
      [thaan],
      "Stock Entry SP RPC denied",
    );
    check(
      (await one("select domain_stock_entry_cp($1,4000)", [stock])) === 4000,
      "Domain CP write",
    );
    check(
      (await one("select domain_stock_entry_cp($1,5000)", [stock])) === 5000,
      "Domain CP edit appends revision",
    );
    check(
      await one("select count(*)=0 from fabric_stock_costs"),
      "Domain cost history still hidden",
    );
    await admin();
    await q("update fabric_stock set entry_state='complete' where id=$1", [stock]);
    await login(ids.stock_entry);
    await denied(
      "update fabric_stock set entry_state='correcting' where id=$1",
      [stock],
      "Stock Entry cannot reopen completed domain workflow",
    );
    await denied(
      "select domain_stock_entry_cp($1)",
      [stock],
      "Complete domain workflow no CP read",
    );
    await denied(
      "select domain_stock_entry_cp($1,6000)",
      [stock],
      "Complete domain workflow no CP edit",
    );
    await admin();
    await q(
      "insert into user_permission_overrides(user_id,permission_key,granted) values($1,'inventory.view_cost',true),($1,'access.manage',true)",
      [ids.counter],
    );
    await login(ids.counter);
    check(
      !(await one("select has_perm(auth.uid(),'inventory.view_cost')")),
      "Financial override blocked",
    );
    check(
      !(await one("select has_perm(auth.uid(),'access.manage')")),
      "Administration override blocked",
    );
    await login(ids.owner);
    check(await one("select count(*)>0 from thaan_costs"), "Owner legacy CP visible");
    check(await one("select count(*)>0 from fabric_stock_costs"), "Owner domain CP visible");
    await q("update thaans set price_paise=17000 where id=$1", [closed]);
    check(
      (await one("select price_paise from thaans where id=$1", [closed])) === 17000,
      "Owner SP control",
    );
    await denied(
      "delete from user_roles where user_id=auth.uid() and role_key='owner'",
      [],
      "Last active Owner protected",
    );
    await admin();
    // Owner production fixture: exact schema requirements, no application workflow.
    const factory = await one(
      "insert into tailoring_factories(code,name) values('TEST-F','Factory') returning id",
    );
    const section = await one(
      "insert into tailoring_sections(factory_id,code,name) values($1,'TEST-S','Section') returning id",
      [factory],
    );
    const tailor = await one(
      "insert into tailors(code,real_name,profile_id) values('TEST-T','Tailor',$1) returning id",
      [ids.tailor],
    );
    const assignment = await one(
      "insert into tailor_assignments(tailor_id,factory_id,section_id) values($1,$2,$3) returning id",
      [tailor, factory, section],
    );
    const product = await one(
      "insert into products(code,name) values('TEST-P','Product') returning id",
    );
    const design = await one(
      "insert into designs(code,name) values('TEST-D','Design') returning id",
    );
    const job = await one(
      "insert into production_jobs(code,product_id,design_id,quantity,tailor_assignment_id) values('TEST-PJ',$1,$2,2,$3) returning id",
      [product, design, assignment],
    );
    const version = await one(
      "insert into production_cost_versions(production_job_id,revision,quantity_snapshot) values($1,1,2) returning id",
      [job],
    );
    await q(
      "insert into production_cost_lines(cost_version_id,category,amount_paise) select $1,category,1000 from unnest(array['fabric','tailoring_production','design_embroidery','buttons','thread','padding','other_consumables','other_production']) category",
      [version],
    );
    for (const role of ["owner", "counter", "stock_entry", "tailor", "other_tailor"]) {
      await login(ids[role]);
      check(
        (await one("select count(*) from production_cost_lines")) === (role === "owner" ? 8 : 0),
        `${role} production cost isolation with real data`,
      );
      check(
        (await one("select count(*) from production_jobs where id=$1", [job])) ===
          (["owner", "tailor"].includes(role) ? 1 : 0),
        `${role} assigned production scope`,
      );
    }
    await login(ids.owner);
    check(
      Number(await one("select sum(amount_paise) from production_cost_lines")) === 8000,
      "Owner complete eight-component production cost",
    );
    await admin();
    const customer = await one(
      "insert into customers(name) values('Security Customer') returning id",
    );
    const cj = await one(
      "insert into customer_tailoring_jobs(code,customer_id,garment,tailor_assignment_id) values('TEST-CJ',$1,'Dress',$2) returning id",
      [customer, assignment],
    );
    const charge = await one(
      "insert into tailoring_charges(code,name) values('TEST-CH','Charge') returning id",
    );
    const cv = await one(
      "insert into tailoring_charge_versions(charge_id,revision,amount_paise) values($1,1,3000) returning id",
      [charge],
    );
    await q(
      "insert into customer_tailoring_prices(job_id,revision,fabric_cp_total_paise,tailoring_charge_paise,charge_version_id) values($1,1,10000,3000,$2)",
      [cj, cv],
    );
    await login(ids.counter);
    check(
      Number(await one("select customer_tailoring_final_price($1)", [cj])) === 13000,
      "Counter sees only final CP plus charge result",
    );
    check(
      await one("select count(*)=0 from customer_tailoring_prices"),
      "Counter no internal customer pricing rows",
    );
    check(
      await one("select count(*)=0 from tailoring_charge_versions"),
      "Counter no charge breakdown",
    );
    await denied(
      "select price_snapshot_paise from tailoring_job_lines",
      [],
      "Counter no legacy tailoring SP breakdown",
    );
    check(
      await one("select count(*)=0 from owner_tailoring_line_prices()"),
      "Counter no Owner price reader",
    );
    await login(ids.tailor);
    check(
      (await one("select count(*) from customer_tailoring_jobs where id=$1", [cj])) === 1,
      "Assigned Tailor Customer Tailoring read",
    );
    await denied("select customer_tailoring_final_price($1)", [cj], "Tailor no pricing RPC");
    await login(ids.other_tailor);
    check(
      await one("select count(*)=0 from customer_tailoring_jobs"),
      "Other Tailor no Customer Tailoring jobs",
    );
    await login(ids.counter);
    await denied(
      "select domain_stock_entry_cp($1,9000)",
      [stock],
      "Counter cannot write completed domain CP",
    );
    await admin();
    await q("insert into stock_movements(thaan_id,kind,delta_mm) values($1,'INWARD',10000)", [
      closed,
    ]);
    await login(ids.counter);
    const receipt = await one("select complete_fabric_sale($1::jsonb,null,null)", [
      JSON.stringify([{ barcode: "TEST-CLOSED", length_mm: 10000 }]),
    ]);
    check(receipt.total_paise === 170000, "Counter direct sale still uses Owner SP");
    check(
      (await one("select status from thaans where id=$1", [closed])) === "depleted",
      "Legacy sale can deplete stock after security guards",
    );
    check(!JSON.stringify(receipt).includes("cost"), "Counter sale result contains no cost");
    await login(ids.tailor);
    await denied(
      "select issue_tailoring_fabrics($1,$2::jsonb,null)",
      [cj, JSON.stringify([{ barcode: "TEST-CLOSED", length_mm: 1000 }])],
      "Tailor receives material; Counter issues it",
    );
    await admin();
    await q("update profiles set active=false where id=$1", [ids.tailor]);
    await login(ids.tailor);
    check(await one("select count(*)=0 from production_jobs"), "Inactive Tailor no jobs");
    await denied("select stock_entry_cp($1)", [thaan], "Tailor cannot use scoped CP reader");
    await denied(
      "select thaan_available_mm($1)",
      [closed],
      "Inactive Tailor cannot bypass stock RLS through availability RPC",
    );
    await login(ids.other_tailor);
    await denied(
      "select thaan_available_mm($1)",
      [closed],
      "Unassigned Tailor cannot read arbitrary stock via RPC",
    );
    await admin();
    check(
      await one(
        "select count(*)=0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'execute')",
      ),
      "No anonymous definer RPC execution",
    );
    console.log(`${directory}: role matrix verified`);
  } finally {
    await db.close();
  }
}
console.log(`${checks} Phase 2 security checks passed`);
