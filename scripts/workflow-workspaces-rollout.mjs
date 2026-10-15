/** Controlled cumulative rollout through optional Thaan colour/reason. No business fixtures are executed live.
 * Usage: node scripts/role-workspaces-rollout.mjs <absolute PGlite module path> [--apply]
 * Reads ignored .env. Never logs credentials or business rows.
 * Stops on schema/data mismatch; every application and ledger entry is atomic.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import postgres from "postgres";

process.loadEnvFile(".env");
const apply = process.argv.includes("--apply");
const runtime = process.argv[2];
assert(runtime && !runtime.startsWith("--"), "Supply disposable PGlite runtime");
const { PGlite } = await import(pathToFileURL(path.resolve(runtime)).href);
const reference = new PGlite();
const sql = postgres(process.env.LOVABLE_DB_MIGRATION_URL, {
  ssl: "require",
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
});
const report = { started_at: new Date().toISOString(), applied: [], verified: [] };
const pricingMetadataTables = new Set([
  "roles",
  "permissions",
  "role_permissions",
  "erp_audit_records",
]);
const preserve = (before, after, pricing = false) => {
  for (const [table, value] of Object.entries(before)) {
    if (pricing && pricingMetadataTables.has(table)) continue;
    assert.deepEqual(after[table], value, "Existing rows changed: " + table);
  }
};
const reportPath = path.join(os.tmpdir(), "maqdooms-workflow-workspaces-rollout-results.json");
const queries = {
  columns: `select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position`,
  constraints: `select c.relname as table_name,p.conname,p.contype,p.convalidated,pg_get_constraintdef(p.oid) as definition from pg_constraint p join pg_class c on c.oid=p.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and p.contype<>'n' order by 1,2`,
  indexes: `select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by 1,2`,
  functions: `select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,pg_get_functiondef(p.oid) as definition,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' order by 1,2,3`,
  triggers: `select c.relname as table_name,t.tgname,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by 1,2`,
  policies: `select * from pg_policies where schemaname='public' order by tablename,policyname`,
  rls: `select c.relname,c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') as anon_select,has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select,has_table_privilege('authenticated',c.oid,'INSERT') as authenticated_insert,has_table_privilege('authenticated',c.oid,'UPDATE') as authenticated_update,has_table_privilege('authenticated',c.oid,'DELETE') as authenticated_delete from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1`,
};
const key = {
  columns: (r) => r.table_name + "." + r.column_name,
  constraints: (r) => r.table_name + "." + r.conname,
  indexes: (r) => r.tablename + "." + r.indexname,
  functions: (r) => r.nspname + "." + r.proname + "(" + r.args + ")",
  triggers: (r) => r.table_name + "." + r.tgname,
  policies: (r) => r.tablename + "." + r.policyname,
  rls: (r) => r.relname,
};
const normalize = (x) =>
  typeof x === "string"
    ? x.replace(/\s+/g, " ").trim()
    : Array.isArray(x)
      ? x.map(normalize)
      : x && typeof x === "object"
        ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, normalize(v)]))
        : x;
const catalog = async (q) => {
  const out = {};
  for (const [k, query] of Object.entries(queries)) out[k] = await q(query);
  return out;
};
const compare = (expected, actual, allowMissingSale = false) => {
  const differences = [];
  for (const [category, identify] of Object.entries(key)) {
    const found = new Map(actual[category].map((r) => [identify(r), r]));
    for (const row of expected[category]) {
      const name = identify(row);
      if (
        allowMissingSale &&
        category === "functions" &&
        row.proname === "complete_fabric_sale" &&
        !found.has(name)
      )
        continue;
      // Initial gate permits only known Supabase default anonymous table grants;
      // the versioned reconciliation removes these before any phase is adopted.
      if (allowMissingSale && category === "rls" && found.has(name)) {
        const initial = { ...found.get(name), anon_select: row.anon_select };
        try {
          assert.deepEqual(normalize(initial), normalize(row));
        } catch {
          differences.push(category + ":" + name);
        }
        continue;
      }
      try {
        assert.deepEqual(normalize(found.get(name)), normalize(row));
      } catch {
        differences.push(category + ":" + name);
      }
    }
  }
  assert.equal(differences.length, 0, "Schema/permission mismatch: " + differences.join(", "));
};
let oldTables;
const fingerprint = async (connection = sql) => {
  const out = {};
  for (const t of oldTables) {
    const name = 'public."' + t.table_name.replaceAll('"', '""') + '"';
    const rows = await connection.unsafe(
      `select count(*)::integer as count,md5(coalesce(string_agg(row::text,E'\n' order by row::text),'')) as digest from (select (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(r)) where key=any($1::text[])) row from ${name} r) z`,
      [t.columns],
    );
    out[t.table_name] = rows[0];
  }
  return out;
};
const record = async (tx, file, text, verification) => {
  const version = file.split("_")[0];
  await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values (${version},${file.slice(15, -4)},${[text]})`;
  await tx`insert into supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) values (${version},${file},${createHash("sha256").update(text).digest("hex")},'applied',${tx.json(verification)})`;
};
const execute = async (file, expected) => {
  const text = await fs.readFile(path.join("supabase/migrations", file), "utf8");
  const version = file.split("_")[0];
  if ((await sql`select to_regclass('supabase_migrations.schema_migrations') as rel`)[0].rel) {
    const existing =
      await sql`select h.sha256,h.mode from supabase_migrations.erp_execution_history h where version=${version}`;
    if (existing.length) {
      assert.equal(
        existing[0].sha256,
        createHash("sha256").update(text).digest("hex"),
        "Recorded migration hash differs",
      );
      // Later phases intentionally replace earlier function bodies/policies.
      // Current cumulative schema is checked once before any resume operation.
      console.log("Already recorded:", file, existing[0].mode);
      return;
    }
  }
  // SQL files retain original BEGIN/COMMIT. Strip only top-level wrapper lines
  // so verification and migration metadata share the runner's transaction.
  const statements = text.replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, "");
  let baseline;
  let verifiedAfter;
  const pricing =
    file.includes("_stock_transfer_counter_pricing") ||
    file.includes("_salesperson_tailoring_pricing") ||
    file.includes("_owner_production_workflow") ||
    file.includes("_labels_first_stock_entry") ||
    file.includes("_optional_thaan_details") ||
    file.includes("_workshop_inventory_hierarchy") ||
    file.includes("_delegated_thaan_permissions") ||
    file.includes("_module_role_scope") ||
    file.includes("_role_workspaces");
  await sql.begin(async (tx) => {
    await tx.unsafe("set local lock_timeout='15s'");
    await tx.unsafe(
      "lock table " +
        oldTables
          .map((t) => 'public."' + t.table_name.replaceAll('"', '""') + '"')
          .sort()
          .join(",") +
        " in share row exclusive mode",
    );
    baseline = await fingerprint(tx);
    const metadata = {};
    if (pricing)
      for (const table of pricingMetadataTables)
        metadata[table] = await tx.unsafe(`select to_jsonb(t) value from public.${table} t`);
    await tx.unsafe(statements);
    if (expected) compare(expected, await catalog((q) => tx.unsafe(q)));
    verifiedAfter = await fingerprint(tx);
    preserve(baseline, verifiedAfter, pricing);
    if (pricing)
      for (const [table, rows] of Object.entries(metadata)) {
        const current = new Set(
          (await tx.unsafe(`select to_jsonb(t)::text value from public.${table} t`)).map((r) =>
            JSON.stringify(JSON.parse(r.value)),
          ),
        );
        for (const row of rows)
          assert(
            current.has(JSON.stringify(row.value)),
            "Existing metadata/history rewritten: " + table,
          );
      }
    await record(tx, file, text, {
      schema: expected
        ? "matches canonical reference including RLS/grants"
        : "metadata-only reconciliation",
      verified_at: new Date().toISOString(),
    });
  });
  report.applied.push(file);
  report.before = baseline;
  report.after = verifiedAfter;
  report.preservation_basis =
    "Full original-column fingerprints and metadata row sets checked inside locked migration transaction; normal post-commit app writes are permitted";
  report.verified.push(file);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log("APPLIED AND VERIFIED:", file, "(existing public rows unchanged)");
};
try {
  report.connection = (
    await sql`select current_database() as database,current_user as db_user,version() as version`
  )[0];
  console.log("Connected:", report.connection.database, report.connection.db_user);
  await reference.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`,
  );
  const files = (await fs.readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql") && !f.includes("_live_"))
    .sort();
  const expected = {};
  for (const f of files) {
    if (
      f.includes("_stock_registration") ||
      f.includes("_stock_transfer_counter_pricing") ||
      f.includes("_salesperson_tailoring_pricing") ||
      f.includes("_owner_production_workflow") ||
      f.includes("_labels_first_stock_entry") ||
      f.includes("_optional_thaan_details") ||
      f.includes("_workshop_inventory_hierarchy") ||
      f.includes("_delegated_thaan_permissions") ||
      f.includes("_module_role_scope") ||
      f.includes("_thaan_optional_colour_reason") ||
      f.includes("_role_workspaces") ||
      f.includes("_barcode_inspector_legacy_evidence") ||
      f.includes("_finished_sale_compatibility") || f.includes("_workspace_cleanup") || f.includes("_counter_workspace") || f.includes("_mixed_production") || f.includes("_owner_definitions") || f.includes("_workflow_integrations") ||
      f.includes("_owner_barcode_inspector") ||
      f.includes("_owner_business_analytics")
    )
      continue;
    if (/phase(?:8|9|10|11|12|13|14|15)_/.test(f)) continue; // Apply after the already-approved provenance overlay.
    await reference.exec(await fs.readFile(path.join("supabase/migrations", f), "utf8"));
    const phase = f.match(/phase(\d+)_/);
    if (phase)
      expected[Number(phase[1])] = await catalog(async (q) => (await reference.query(q)).rows);
    if (phase?.[1] === "1") {
      // Validate reconciliation SQL in disposable PostgreSQL before live DDL.
      await reference.exec(
        await fs.readFile("supabase/migrations/20261003000700_live_migration_tracking.sql", "utf8"),
      );
      await reference.exec(
        await fs.readFile(
          "supabase/migrations/20261003000800_live_function_grants_reconciliation.sql",
          "utf8",
        ),
      );
    }
  }
  oldTables =
    await sql`select table_name,array_agg(column_name order by ordinal_position) as columns from information_schema.columns where table_schema='public' and table_name in(select tablename from pg_tables where schemaname='public') group by table_name order by table_name`;
  report.before = await fingerprint();
  let currentPhase = 1;
  if ((await sql`select to_regclass('supabase_migrations.erp_execution_history') as rel`)[0].rel) {
    const tracked =
      await sql`select filename from supabase_migrations.erp_execution_history where mode='applied'`;
    for (const r of tracked) {
      const phase = r.filename.match(/phase(\d+)_/);
      if (phase) currentPhase = Math.max(currentPhase, Number(phase[1]));
    }
  }
  if (
    (await sql`select to_regclass('supabase_migrations.erp_test_stock_fixtures') as rel`)[0].rel
  ) {
    // Approved test commissioning adds narrow automated provenance and a guard
    // exception which is closed by its recorded migration version. Replay only
    // its schema prefix for the cumulative reference, never its live-ID seed.
    const overlay = await fs.readFile(
      "supabase/migrations/20261003001000_live_test_stock_scenarios.sql",
      "utf8",
    );
    await reference.exec(
      overlay.split("CREATE TEMP TABLE test_stock_plan")[0].replace(/^BEGIN;\s*$/m, ""),
    );
    expected[7] = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const phase8File = files.find((f) => f.includes("phase8_"));
  let phase8Base;
  if (phase8File) {
    await reference.exec(await fs.readFile(path.join("supabase/migrations", phase8File), "utf8"));
    phase8Base = await catalog(async (q) => (await reference.query(q)).rows);
    for (const file of files.filter((f) => f.includes("phase8_") && f !== phase8File))
      await reference.exec(await fs.readFile(path.join("supabase/migrations", file), "utf8"));
    expected[8] = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const guardRecorded =
    currentPhase === 8 &&
    (
      await sql`select count(*)::int as n from supabase_migrations.erp_execution_history where version='20261003001200'`
    )[0].n > 0;
  const phase9File = files.find((f) => f.includes("phase9_"));
  if (phase9File) {
    await reference.exec(await fs.readFile(path.join("supabase/migrations", phase9File), "utf8"));
    expected[9] = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const phase10File = files.find((f) => f.includes("phase10_"));
  if (phase10File) {
    await reference.exec(await fs.readFile(path.join("supabase/migrations", phase10File), "utf8"));
    expected[10] = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const phase11File = files.find((f) => f.includes("phase11_"));
  if (phase11File) {
    await reference.exec(await fs.readFile(path.join("supabase/migrations", phase11File), "utf8"));
    expected[11] = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const phase12File = files.find((f) => f.includes("phase12_"));
  if (phase12File) {
    await reference.exec(await fs.readFile(path.join("supabase/migrations", phase12File), "utf8"));
    expected[12] = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const phase13File = files.find((f) => f.includes("phase13_"));
  if (phase13File) {
    await reference.exec(await fs.readFile(path.join("supabase/migrations", phase13File), "utf8"));
    expected[13] = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const phase14File = files.find((f) => f.includes("phase14_"));
  if (phase14File) {
    await reference.exec(await fs.readFile(path.join("supabase/migrations", phase14File), "utf8"));
    expected[14] = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const phase15File = files.find((f) => f.includes("phase15_"));
  if (phase15File) {
    await reference.exec(await fs.readFile(path.join("supabase/migrations", phase15File), "utf8"));
    expected[15] = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const registrationFile = files.find((f) => f.includes("_stock_registration"));
  let registrationExpected;
  if (registrationFile) {
    await reference.exec(
      await fs.readFile(path.join("supabase/migrations", registrationFile), "utf8"),
    );
    registrationExpected = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const registrationRecorded =
    registrationFile &&
    (await sql`select to_regclass('supabase_migrations.erp_execution_history') rel`)[0].rel &&
    (
      await sql`select count(*)::int n from supabase_migrations.erp_execution_history where filename=${registrationFile}`
    )[0].n > 0;
  const pricingFile = files.find((f) => f.includes("_stock_transfer_counter_pricing"));
  let pricingExpected;
  if (pricingFile) {
    await reference.exec(await fs.readFile(path.join("supabase/migrations", pricingFile), "utf8"));
    pricingExpected = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const pricingRecorded =
    pricingFile &&
    (
      await sql`select count(*)::int n from supabase_migrations.erp_execution_history where filename=${pricingFile}`
    )[0].n > 0;
  const salespersonFile = files.find((f) => f.includes("_salesperson_tailoring_pricing"));
  let salespersonExpected;
  if (salespersonFile) {
    await reference.exec(
      await fs.readFile(path.join("supabase/migrations", salespersonFile), "utf8"),
    );
    salespersonExpected = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const salespersonRecorded =
    salespersonFile &&
    (
      await sql`select count(*)::int n from supabase_migrations.erp_execution_history where filename=${salespersonFile}`
    )[0].n > 0;
  const productionFile = files.find((f) => f.includes("_owner_production_workflow"));
  let productionExpected;
  if (productionFile) {
    await reference.exec(
      await fs.readFile(path.join("supabase/migrations", productionFile), "utf8"),
    );
    productionExpected = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const productionRecorded =
    productionFile &&
    Number(
      (
        await sql`select count(*)::int n from supabase_migrations.erp_execution_history where filename=${productionFile}`
      )[0]?.n,
    );
  const labelsFile = files.find((f) => f.includes("_labels_first_stock_entry"));
  let labelsExpected;
  if (labelsFile) {
    await reference.exec(await fs.readFile(path.join("supabase/migrations", labelsFile), "utf8"));
    labelsExpected = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const labelsRecorded =
    labelsFile &&
    Number(
      (
        await sql`select count(*)::int n from supabase_migrations.erp_execution_history where filename=${labelsFile}`
      )[0]?.n,
    );
  const optionalFile = files.find((f) => f.includes("_optional_thaan_details"));
  let optionalExpected;
  if (optionalFile) {
    await reference.exec(await fs.readFile(path.join("supabase/migrations", optionalFile), "utf8"));
    optionalExpected = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const optionalRecorded =
    optionalFile &&
    Number(
      (
        await sql`select count(*)::int n from supabase_migrations.erp_execution_history where filename=${optionalFile}`
      )[0]?.n,
    );
  const hierarchyFile = files.find((f) => f.includes("_workshop_inventory_hierarchy"));
  let hierarchyExpected;
  if (hierarchyFile) {
    await reference.exec(
      await fs.readFile(path.join("supabase/migrations", hierarchyFile), "utf8"),
    );
    hierarchyExpected = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const hierarchyRecorded =
    hierarchyFile &&
    Number(
      (
        await sql`select count(*)::int n from supabase_migrations.erp_execution_history where filename=${hierarchyFile}`
      )[0]?.n,
    );
  const delegatedFile = files.find((f) => f.includes("_delegated_thaan_permissions"));
  let delegatedExpected;
  if (delegatedFile) {
    await reference.exec(
      await fs.readFile(path.join("supabase/migrations", delegatedFile), "utf8"),
    );
    delegatedExpected = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const delegatedRecorded =
    delegatedFile &&
    Number(
      (
        await sql`select count(*)::int n from supabase_migrations.erp_execution_history where filename=${delegatedFile}`
      )[0]?.n,
    );
  const scopeFile = files.find((f) => f.includes("_module_role_scope"));
  let scopeExpected;
  if (scopeFile) {
    await reference.exec(await fs.readFile(path.join("supabase/migrations", scopeFile), "utf8"));
    scopeExpected = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const scopeRecorded =
    scopeFile &&
    Number(
      (
        await sql`select count(*)::int n from supabase_migrations.erp_execution_history where filename=${scopeFile}`
      )[0]?.n,
    );
  const thaanOptionalFile = files.find((f) => f.includes("_thaan_optional_colour_reason"));
  let thaanOptionalExpected;
  if (thaanOptionalFile) {
    await reference.exec(
      await fs.readFile(path.join("supabase/migrations", thaanOptionalFile), "utf8"),
    );
    thaanOptionalExpected = await catalog(async (q) => (await reference.query(q)).rows);
  }
  const thaanOptionalRecorded =
    thaanOptionalFile &&
    Number(
      (
        await sql`select count(*)::int n from supabase_migrations.erp_execution_history where filename=${thaanOptionalFile}`
      )[0]?.n,
    );
  const roleFile = files.find((f) => f.includes("_role_workspaces"));
  await reference.exec(await fs.readFile(path.join("supabase/migrations", roleFile), "utf8"));
  const roleExpected = await catalog(async (q) => (await reference.query(q)).rows);
  const roleRecorded = Number(
    (
      await sql`select count(*)::int n from supabase_migrations.erp_execution_history where filename=${roleFile}`
    )[0]?.n,
  );
  const analyticsFile = files.find((f) => f.includes("_owner_business_analytics"));
  await reference.exec(await fs.readFile(path.join("supabase/migrations", analyticsFile), "utf8"));
  const analyticsExpected = await catalog(async (q) => (await reference.query(q)).rows);
  const analyticsRecorded = Number(
    (
      await sql`select count(*)::int n from supabase_migrations.erp_execution_history where filename=${analyticsFile}`
    )[0]?.n,
  );
  const inspectorFile = files.find((f) => f.includes("_owner_barcode_inspector"));
  await reference.exec(await fs.readFile(path.join("supabase/migrations", inspectorFile), "utf8"));
  const inspectorExpected = await catalog(async (q) => (await reference.query(q)).rows);
  const inspectorRecorded = Number(
    (
      await sql`select count(*)::int n from supabase_migrations.erp_execution_history where filename=${inspectorFile}`
    )[0]?.n,
  );
  const evidenceFile = files.find((f) => f.includes("_barcode_inspector_legacy_evidence"));
  await reference.exec(await fs.readFile(path.join("supabase/migrations", evidenceFile), "utf8"));
  const evidenceExpected = await catalog(async (q) => (await reference.query(q)).rows);
  const evidenceRecorded = Number(
    (
      await sql`select count(*)::int n from supabase_migrations.erp_execution_history where filename=${evidenceFile}`
    )[0]?.n,
  );
  const workflowStages=[];
  let latestWorkflowExpected;
  for(const suffix of ['_workspace_cleanup.sql','_counter_workspace.sql','_mixed_production.sql','_owner_definitions.sql','_workflow_integrations.sql','_finished_sale_compatibility.sql']){
    const file=files.find(f=>f.endsWith(suffix));
    await reference.exec(await fs.readFile(path.join('supabase/migrations',file),'utf8'));
    const expected=await catalog(async q=>(await reference.query(q)).rows);
    workflowStages.push({file,expected});
    const recorded=Number((await sql.unsafe('select count(*)::int n from supabase_migrations.erp_execution_history where filename=$1',[file]))[0].n);
    if(recorded)latestWorkflowExpected=expected;
  }
  compare(
    latestWorkflowExpected ?? (evidenceRecorded
      ? evidenceExpected
      : inspectorRecorded
        ? inspectorExpected
        : analyticsRecorded
          ? analyticsExpected
          : roleRecorded
            ? roleExpected
            : thaanOptionalRecorded
              ? thaanOptionalExpected
              : scopeRecorded
                ? scopeExpected
                : delegatedRecorded
                  ? delegatedExpected
                  : hierarchyRecorded
                    ? hierarchyExpected
                    : optionalRecorded
                      ? optionalExpected
                      : labelsRecorded
                        ? labelsExpected
                        : productionRecorded
                          ? productionExpected
                          : salespersonRecorded
                            ? salespersonExpected
                            : pricingRecorded
                              ? pricingExpected
                              : registrationRecorded
                                ? registrationExpected
                                : currentPhase === 8 && !guardRecorded
                                  ? phase8Base
                                  : expected[currentPhase]),
    await catalog((q) => sql.unsafe(q)),
    currentPhase === 1,
  );
  report.owner_business_analytics_verified = Boolean(analyticsRecorded);
  report.role_workspaces_verified = Boolean(roleRecorded);
  report.current_phase_verified = currentPhase;
  report.stock_registration_verified = Boolean(registrationRecorded);
  report.stock_transfer_counter_pricing_verified = Boolean(pricingRecorded);
  report.salesperson_tailoring_verified = Boolean(salespersonRecorded);
  report.owner_production_workflow_verified = Boolean(productionRecorded);
  report.labels_first_stock_entry_verified = Boolean(labelsRecorded);
  report.optional_thaan_details_verified = Boolean(optionalRecorded);
  report.workshop_inventory_hierarchy_verified = Boolean(hierarchyRecorded);
  report.delegated_thaan_permissions_verified = Boolean(delegatedRecorded);
  report.module_role_scope_verified = Boolean(scopeRecorded);
  report.thaan_optional_colour_reason_verified = Boolean(thaanOptionalRecorded);
  console.log("Verified current cumulative live schema:", "Phase " + currentPhase);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  if (apply) {
    await execute("20261003000700_live_migration_tracking.sql");
    await execute("20260927000100_customer_multi_fabric_sale.sql", expected[1]);
    await execute("20261003000800_live_function_grants_reconciliation.sql", expected[1]);
    for (let phase = 2; phase <= (phase8File ? 8 : 7); phase++) {
      const file = files.find((f) => f.includes("phase" + phase + "_"));
      await execute(file, phase === 8 ? phase8Base : expected[phase]);
    }
    for (const file of files.filter((f) => f.includes("phase8_") && f !== phase8File))
      await execute(file, expected[8]);
    if (phase9File) await execute(phase9File, expected[9]);
    if (phase10File) await execute(phase10File, expected[10]);
    if (phase11File) await execute(phase11File, expected[11]);
    if (phase12File) await execute(phase12File, expected[12]);
    if (phase13File) await execute(phase13File, expected[13]);
    if (phase14File) await execute(phase14File, expected[14]);
    if (phase15File) await execute(phase15File, expected[15]);
    if (registrationFile) await execute(registrationFile, registrationExpected);
    if (pricingFile) await execute(pricingFile, pricingExpected);
    if (salespersonFile) await execute(salespersonFile, salespersonExpected);
    if (productionFile) await execute(productionFile, productionExpected);
    if (labelsFile) await execute(labelsFile, labelsExpected);
    if (optionalFile) await execute(optionalFile, optionalExpected);
    if (hierarchyFile) await execute(hierarchyFile, hierarchyExpected);
    if (delegatedFile) await execute(delegatedFile, delegatedExpected);
    if (scopeFile) await execute(scopeFile, scopeExpected);
    if (thaanOptionalFile) await execute(thaanOptionalFile, thaanOptionalExpected);
    await execute(roleFile, roleExpected);
    await execute(analyticsFile, analyticsExpected);
    await execute(inspectorFile, inspectorExpected);
    await execute(evidenceFile, evidenceExpected);
    for(const stage of workflowStages) await execute(stage.file,stage.expected);
    if (report.applied.length) preserve(report.before, report.after, Boolean(pricingFile));
    else report.after = await fingerprint();
    console.log(
      "All implemented phase schemas and permissions verified; all pre-existing public rows preserved.",
    );
  }
} catch (error) {
  report.error = {
    code: error.code,
    message: error.message.replace(/postgres(?:ql)?:\/\/\S+/g, "[REDACTED]"),
  };
  console.error(JSON.stringify(report.error));
  process.exitCode = 1;
} finally {
  report.finished_at = new Date().toISOString();
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  await fs.writeFile(
    reportPath.replace(".json", "-" + report.started_at.replace(/[:.]/g, "-") + ".json"),
    JSON.stringify(report, null, 2),
  );
  await reference.close();
  await sql.end();
}
