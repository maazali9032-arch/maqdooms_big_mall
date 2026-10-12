/** Read-only live schema/permission checks; never creates business fixtures. */
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
  const file = "20261012000100_optional_thaan_details.sql";
  const canonical = await fs.readFile("supabase/migrations/" + file);
  check(
    canonical.equals(await fs.readFile("drizzle/migrations/0035_optional_thaan_details.sql")),
    "Identical migration mirror",
  );
  const hash = createHash("sha256").update(canonical).digest("hex");
  const ledger = (
    await sql`select version,filename,sha256,mode,verification from supabase_migrations.erp_execution_history where filename=${file}`
  )[0];
  check(ledger?.sha256 === hash && ledger.mode === "applied", "Recorded applied migration hash");
  for (const [table, column] of [["stock_registration_variants", "draft_details"]]) {
    check(
      (
        await sql`select count(*)::int n from information_schema.columns where table_schema='public' and table_name=${table} and column_name=${column}`
      )[0].n === 1,
      "New metadata column exists",
    );
  }
  for (const role of ["anon", "authenticated"]) {
    check(
      !(
        await sql`select has_function_privilege(${role},'public.guard_label_variant_history()','EXECUTE') allowed`
      )[0].allowed,
      "Private history guard " + role,
    );
    check(
      !(
        await sql`select has_table_privilege(${role},'public.stock_registration_variants','INSERT,UPDATE,DELETE,TRUNCATE') allowed`
      )[0].allowed,
      "No raw registration writes " + role,
    );
  }
  for (const api of [
    "public.save_registered_thaan_details(uuid,text,text,integer,bigint)",
    "public.create_barcode_batch_with_details(uuid,text,date,text,jsonb)",
  ]) {
    check(
      !(await sql`select has_function_privilege('anon',${api},'EXECUTE') allowed`)[0].allowed,
      "Anonymous new API denied",
    );
    check(
      (await sql`select has_function_privilege('authenticated',${api},'EXECUTE') allowed`)[0]
        .allowed,
      "Authenticated checked new API exposed",
    );
  }
  const people =
    await sql`select p.id,array_agg(r.role_key) roles from profiles p join user_roles r on r.user_id=p.id where p.active group by p.id`;
  const rolesVerified = [];
  for (const role of ["owner", "stock_entry", "counter", "tailor"]) {
    const person = people.find(
      (p) => p.roles.includes(role) && (role === "owner" || !p.roles.includes("owner")),
    );
    assert(person, "Existing active role " + role);
    await sql.begin("read only", async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${person.id},true)`;
      await tx.unsafe("set local role authenticated");
      if (role === "owner" || role === "stock_entry") {
        check(
          (await tx`select registered_thaan_details('NO-SUCH-CODE') data`)[0].data === null,
          "Permitted safe barcode lookup " + role,
        );
        const permission = (
          await tx`select has_perm(auth.uid(),'stock.generate_labels') generate,has_perm(auth.uid(),'stock.measure_thaan') measure,has_perm(auth.uid(),'inventory.view_registered_cp') own_cp`
        )[0];
        check(
          Object.values(permission).every((v) => typeof v === "boolean"),
          "Owner-managed permission evaluation " + role,
        );
        if (role === "stock_entry")
          check(
            (await tx`select count(*)::int n from stock_registration_variants`)[0].n === 0,
            "Staff raw variant/draft CP hidden by Owner-only RLS",
          );
        rolesVerified.push({ role, permissions: permission, verified: true });
      } else {
        let rejected = false;
        try {
          await tx.savepoint((sp) => sp`select registered_thaan_details('NO-SUCH-CODE')`);
        } catch (e) {
          rejected = ["42501", "P0001"].includes(e.code);
        }
        check(rejected, "Role cannot use Stock Entry scan " + role);
        rolesVerified.push({ role, verified: true });
      }
    });
  }
  const report = {
    verified_at: new Date().toISOString(),
    checks,
    passed: true,
    ledger,
    public_tables: (await sql`select count(*)::int n from pg_tables where schemaname='public'`)[0]
      .n,
    versions: (await sql`select count(*)::int n from supabase_migrations.schema_migrations`)[0].n,
    roles_verified: rolesVerified,
    limitations: [
      "No live barcode batch, measurement, CP or stock transaction created",
      "Populated behavior tested in disposable PostgreSQL; no live concurrency/hardware test",
    ],
  };
  await fs.writeFile(
    "docs/OPTIONAL_THAAN_DETAILS_LIVE_VERIFICATION.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    `PASS: ${checks} labels-first live checks; ${report.public_tables} public tables / ${report.versions} migration versions`,
  );
} finally {
  await sql.end();
}
