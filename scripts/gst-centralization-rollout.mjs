/**
 * Applies the GST migration only after its complete transactional dry run passes.
 * Usage: node scripts/gst-centralization-rollout.mjs --apply
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import postgres from "postgres";

process.loadEnvFile(".env");
assert(process.argv.includes("--apply"), "Pass --apply to change the database");
assert(process.env.LOVABLE_DB_MIGRATION_URL, "LOVABLE_DB_MIGRATION_URL is required");
const file = "20261017000400_gst_centralization.sql";
const version = file.split("_")[0];
const migration = await fs.readFile(`supabase/migrations/${file}`, "utf8");
const hash = createHash("sha256").update(migration).digest("hex");
const statements = migration.replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, "");
const sql = postgres(process.env.LOVABLE_DB_MIGRATION_URL, {
  ssl: "require",
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
});

async function verify(tx) {
  const [check] = await tx.unsafe(`select
    to_regclass('public.gst_configuration_versions') is not null as config_table,
    to_regclass('public.gst_invoice_snapshots') is not null as invoice_table,
    to_regclass('public.gst_purchase_documents') is not null as purchase_table,
    to_regprocedure('public.complete_counter_bill_gst(uuid,jsonb,jsonb,boolean,bigint,uuid,text,text,jsonb)') is not null as sale_rpc,
    to_regprocedure('public.create_barcode_batch_with_gst(uuid,text,date,text,jsonb,jsonb)') is not null as purchase_rpc,
    to_regprocedure('public.owner_gst_report(date,date,text,uuid)') is not null as report_rpc,
    (select count(*) from public.gst_configuration_versions) as config_count`);
  assert.deepEqual(
    check,
    {
      config_table: true,
      invoice_table: true,
      purchase_table: true,
      sale_rpc: true,
      purchase_rpc: true,
      report_rpc: true,
      config_count: "0",
    },
    "GST objects must exist and no unverified configuration may be seeded",
  );
}

try {
  const existing = await sql.unsafe(
    "select sha256 from supabase_migrations.erp_execution_history where version=$1",
    [version],
  );
  if (existing.length) {
    assert.equal(existing[0].sha256, hash, "Recorded GST migration hash differs");
    await verify(sql);
    console.log("Already applied and verified:", file);
  } else {
    await sql.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout='15s'");
      await tx.unsafe(statements);
      await verify(tx);
      await tx.unsafe(
        "insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)",
        [version, file.slice(15, -4), [migration]],
      );
      await tx.unsafe(
        "insert into supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) values($1,$2,$3,'applied',$4::jsonb)",
        [
          version,
          file,
          hash,
          JSON.stringify({
            schema: "GST tables, RLS and server-authoritative tax RPCs",
            business_rows: "preserved; no active configuration or rate seeded",
            verified_at: new Date().toISOString(),
          }),
        ],
      );
    });
    console.log("Applied and verified:", file);
  }
} finally {
  await sql.end();
}
