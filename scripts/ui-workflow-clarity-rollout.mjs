/**
 * Applies only the UI workflow clarity function migration.
 *
 * Usage:
 *   node scripts/ui-workflow-clarity-rollout.mjs          # transactional dry run
 *   node scripts/ui-workflow-clarity-rollout.mjs --apply  # apply and record
 *
 * Credentials are read from the ignored .env file and are never printed.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import postgres from "postgres";

process.loadEnvFile(".env");

const apply = process.argv.includes("--apply");
const file = "20261017000300_ui_workflow_clarity.sql";
const version = file.split("_")[0];
const migration = await fs.readFile(
  new URL(`../supabase/migrations/${file}`, import.meta.url),
  "utf8",
);
const sha256 = createHash("sha256").update(migration).digest("hex");
const statements = migration.replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, "");

assert(process.env.LOVABLE_DB_MIGRATION_URL, "LOVABLE_DB_MIGRATION_URL is required");
const sql = postgres(process.env.LOVABLE_DB_MIGRATION_URL, {
  ssl: "require",
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
});

const verify = async (tx) => {
  const functions = await tx.unsafe(`
    select p.proname, pg_get_functiondef(p.oid) definition,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') authenticated_execute
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        (p.proname = 'showroom_floor_distribution' and pg_get_function_identity_arguments(p.oid) = '')
        or (p.proname = 'salesperson_work' and pg_get_function_identity_arguments(p.oid) = 'p_salesperson uuid, p_after timestamp with time zone, p_after_id uuid, p_limit integer')
      )
    order by p.proname
  `);
  assert.equal(functions.length, 2, "Expected both workflow functions");
  const showroom = functions.find((row) => row.proname === "showroom_floor_distribution");
  const salesperson = functions.find((row) => row.proname === "salesperson_work");
  assert.match(showroom.definition, /'items'/, "Showroom function must return expandable items");
  assert.match(
    salesperson.definition,
    /operator_name/,
    "Salesperson function must return POS operator name",
  );
  for (const fn of functions) {
    assert.equal(fn.anon_execute, false, `${fn.proname} must reject anon execution`);
    assert.equal(
      fn.authenticated_execute,
      true,
      `${fn.proname} must allow authenticated execution`,
    );
  }
};

try {
  const existing = await sql.unsafe(
    "select sha256,mode from supabase_migrations.erp_execution_history where version=$1",
    [version],
  );
  if (existing.length) {
    assert.equal(existing[0].sha256, sha256, "Recorded migration hash differs");
    await verify(sql);
    console.log("Already applied and verified:", file);
  } else {
    const before = await sql.unsafe(
      "select sum(n_live_tup)::bigint::text rows from pg_stat_user_tables where schemaname='public'",
    );
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe("set local lock_timeout='15s'");
        await tx.unsafe(statements);
        await verify(tx);
        if (!apply) throw new Error("ROLLBACK_DRY_RUN");
        await tx.unsafe(
          "insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)",
          [version, file.slice(15, -4), [migration]],
        );
        await tx.unsafe(
          "insert into supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) values($1,$2,$3,'applied',$4::jsonb)",
          [
            version,
            file,
            sha256,
            JSON.stringify({
              schema: "two existing functions replaced; grants verified",
              business_rows: "unchanged by function-only DDL",
              verified_at: new Date().toISOString(),
            }),
          ],
        );
      });
    } catch (error) {
      if (error.message !== "ROLLBACK_DRY_RUN") throw error;
    }
    const after = await sql.unsafe(
      "select sum(n_live_tup)::bigint::text rows from pg_stat_user_tables where schemaname='public'",
    );
    assert.deepEqual(after, before, "Public row estimate changed during function-only rollout");
    console.log(apply ? "Applied and verified:" : "Dry run passed:", file);
  }
} finally {
  await sql.end();
}
