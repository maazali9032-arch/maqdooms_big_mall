/** Read-only live schema/ledger/role verification. No business fixtures or writes. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import postgres from "postgres";
process.loadEnvFile(".env");
const sql = postgres(process.env.LOVABLE_DB_MIGRATION_URL, {
  ssl: "require",
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
});
let checks = 0;
const check = (value, label) => {
  assert(value, label);
  checks++;
};
try {
  const file = "20261011000300_owner_production_workflow.sql";
  const canonical = await fs.readFile("supabase/migrations/" + file);
  check(
    canonical.equals(await fs.readFile("drizzle/migrations/0033_owner_production_workflow.sql")),
    "Byte-identical migration mirror",
  );
  const hash = createHash("sha256").update(canonical).digest("hex");
  const ledger = (
    await sql`select version,filename,sha256,mode,verification from supabase_migrations.erp_execution_history where filename=${file}`
  )[0];
  check(
    ledger?.sha256 === hash && ledger.mode === "applied",
    "Recorded canonical hash and applied mode",
  );
  check(
    (
      await sql`select count(*)::int n from supabase_migrations.schema_migrations where version='20261011000300'`
    )[0].n === 1,
    "One canonical migration ledger entry",
  );
  check(
    (
      await sql`select relrowsecurity from pg_class where oid='public.production_job_tailors'::regclass`
    )[0].relrowsecurity,
    "Shared assignment RLS enabled",
  );
  for (const role of ["anon", "authenticated"]) {
    check(
      !(
        await sql`select has_table_privilege(${role},'public.production_job_tailors','INSERT,UPDATE,DELETE,TRUNCATE') allowed`
      )[0].allowed,
      role + " cannot mutate shared assignments",
    );
    for (const name of [
      "production_tailor_names",
      "production_piece_summary",
      "guard_production_shared_assignment",
    ]) {
      check(
        !(
          await sql`select has_function_privilege(${role},p.oid,'EXECUTE') allowed from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=${name}`
        )[0].allowed,
        role + " cannot execute private helper " + name,
      );
    }
  }
  const people =
    await sql`select p.id,array_agg(r.role_key) roles from profiles p join user_roles r on r.user_id=p.id where p.active group by p.id`;
  const rolesVerified = [];
  for (const role of ["owner", "stock_entry", "counter", "tailor"]) {
    const person = people.find(
      (p) => p.roles.includes(role) && (role === "owner" || !p.roles.includes("owner")),
    );
    assert(person, "Existing active " + role + " account needed");
    await sql.begin("read only", async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${person.id},true)`;
      await tx.unsafe("set local role authenticated");
      const permission = (
        await tx`select has_perm(auth.uid(),'stock.transfer_finished') allowed`
      )[0].allowed;
      const allowed = role === "owner" || (role === "stock_entry" && permission);
      for (const query of [
        "select finished_product_transfer_scan('NO-SUCH-PRODUCT') data",
        "select finished_product_inventory() data",
        "select finished_product_movement_history() data",
      ]) {
        if (allowed) {
          const rows = (await tx.unsafe(query))[0].data;
          check(Array.isArray(rows), role + " allowed operational read");
          check(
            !/cp_paise|sp_paise|production_cost|amount_paise/.test(JSON.stringify(rows)),
            "Staff operational projection contains no finance",
          );
        } else {
          let rejected = false;
          try {
            await tx.savepoint((sp) => sp.unsafe(query));
          } catch (e) {
            rejected = e.code === "P0001" || e.code === "42501";
          }
          check(rejected, role + " denied finished-product transfers");
        }
      }
      if (role !== "owner")
        check(
          (await tx`select count(*)::int n from production_job_tailors`)[0].n === 0,
          role + " has no unrelated shared-assignment rows",
        );
      rolesVerified.push({ role, transfer_permission: permission, verified: true });
    });
  }
  const report = {
    verified_at: new Date().toISOString(),
    checks,
    passed: true,
    ledger,
    versions: (await sql`select count(*)::int n from supabase_migrations.schema_migrations`)[0].n,
    live_shared_assignments: (await sql`select count(*)::int n from production_job_tailors`)[0].n,
    roles_verified: rolesVerified,
    limitations: [
      "No live business fixture or stock transaction created",
      "Shared-Tailor populated behavior verified in disposable PostgreSQL",
      "Physical printer/scanner and real concurrent transactions not exercised",
    ],
  };
  await fs.writeFile(
    "docs/OWNER_PRODUCTION_WORKFLOW_LIVE_VERIFICATION.json",
    JSON.stringify(report, null, 2),
  );
  const rollout = JSON.parse(
    await fs.readFile(path.join(os.tmpdir(), "maqdooms-live-rollout-results.json"), "utf8"),
  );
  await fs.copyFile(
    path.join(os.tmpdir(), "maqdooms-live-rollout-results.json"),
    rollout.applied.includes(file)
      ? "docs/OWNER_PRODUCTION_WORKFLOW_APPLICATION_VERIFICATION.json"
      : "docs/OWNER_PRODUCTION_WORKFLOW_SCHEMA_VERIFICATION.json",
  );
  await fs.copyFile(
    path.join(os.tmpdir(), "maqdooms-live-security-results.json"),
    "docs/OWNER_PRODUCTION_WORKFLOW_SECURITY_VERIFICATION.json",
  );
  console.log(
    `PASS: ${checks} live Owner Production checks; ${report.versions} migration versions`,
  );
} finally {
  await sql.end();
}
