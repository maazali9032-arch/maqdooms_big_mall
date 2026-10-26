import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import postgres from "postgres";

process.loadEnvFile(".env");

const apply = process.argv.includes("--apply");
const file = "20261026000500_owner_delete_supplier_profiles.sql";
const source = await fs.readFile(`supabase/migrations/${file}`, "utf8");
const version = file.split("_")[0];
const hash = createHash("sha256").update(source).digest("hex");

assert(process.env.LOVABLE_DB_MIGRATION_URL, "Database connection is required");
const sql = postgres(process.env.LOVABLE_DB_MIGRATION_URL, {
  ssl: "require",
  max: 1,
  prepare: false,
  connect_timeout: 15,
  onnotice: () => {},
});
const rollback = Symbol("dry-run");

try {
  await sql.begin(async (tx) => {
    await tx.unsafe("set local lock_timeout='10s'; set local statement_timeout='60s'");
    await tx`select pg_advisory_xact_lock(hashtext('maqdooms-owner-supplier-delete-release'))`;

    const tracked = await tx`
      select sha256 from supabase_migrations.erp_execution_history where version = ${version}
    `;
    const native = await tx`
      select version from supabase_migrations.schema_migrations where version = ${version}
    `;

    if (tracked.length) {
      assert.equal(tracked[0].sha256, hash, "Recorded migration hash differs");
      assert.equal(native.length, 1, "Native migration record is missing");
      console.log("Already applied:", file);
      return;
    }

    assert.equal(native.length, 0, "Unreconciled native migration record exists");
    await tx.unsafe(source.replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, ""));
    assert(
      (
        await tx`select to_regprocedure('public.owner_delete_supplier_profile(uuid)') is not null as ready`
      )[0].ready,
      "Delete supplier RPC was not created",
    );
    assert(
      (
        await tx`select has_function_privilege('authenticated','public.owner_delete_supplier_profile(uuid)','execute') as allowed`
      )[0].allowed,
      "Authenticated execute grant is missing",
    );

    await tx`
      insert into supabase_migrations.schema_migrations(version, name, statements)
      values(${version}, ${file.slice(15, -4)}, ${[source]})
    `;
    await tx`
      insert into supabase_migrations.erp_execution_history(version, filename, sha256, mode, verification)
      values(
        ${version}, ${file}, ${hash}, 'applied',
        ${tx.json({ release: "Owner supplier profile deletion", verified_at: new Date().toISOString() })}
      )
    `;
    console.log(apply ? "Staged for commit:" : "Dry-run staged:", file);
    if (!apply) throw rollback;
  });
  console.log(apply ? "Committed" : "Dry-run passed");
} catch (error) {
  if (error === rollback) console.log("Dry-run passed and rolled back");
  else throw error;
} finally {
  await sql.end({ timeout: 5 });
}
