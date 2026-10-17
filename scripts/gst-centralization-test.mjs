import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import postgres from "postgres";

const source = await fs.readFile(
  "supabase/migrations/20261017000400_gst_centralization.sql",
  "utf8",
);
const mirror = await fs.readFile("drizzle/migrations/0064_gst_centralization.sql", "utf8");
assert.equal(source, mirror, "Supabase and Drizzle GST migrations must remain byte-identical");
for (const required of [
  "gst_configuration_versions",
  "gst_invoice_snapshots",
  "gst_purchase_documents",
  "complete_counter_bill_gst",
  "create_barcode_batch_with_gst",
  "owner_gst_report",
])
  assert.match(source, new RegExp(required), `${required} is missing`);
assert.doesNotMatch(
  source.split("CREATE FUNCTION public.owner_save_gst_configuration")[0],
  /INSERT INTO public\.gst_configuration_versions/i,
  "Migration must not seed an unverified GST rate",
);

const connection = process.env.LOVABLE_DB_MIGRATION_URL;
if (!connection) throw new Error("LOVABLE_DB_MIGRATION_URL is required");
const sql = postgres(connection, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 15 });
const rollback = Symbol("rollback");
const version = "20261017000400";
const hash = createHash("sha256").update(source).digest("hex");
try {
  const existing =
    await sql`select sha256 from supabase_migrations.erp_execution_history where version=${version}`;
  if (existing.length) {
    assert.equal(existing[0].sha256, hash, "Recorded migration hash differs");
    const [applied] = await sql`select
      to_regprocedure('public.complete_counter_bill_gst(uuid,jsonb,jsonb,boolean,bigint,uuid,text,text,jsonb)') is not null as sale_rpc,
      (select count(*) from public.gst_configuration_versions) as configuration_count`;
    assert.deepEqual(applied, { sale_rpc: true, configuration_count: "0" });
    console.log("GST migration is applied, verified and inactive until Owner configuration.");
  } else {
    await sql.begin(async (tx) => {
      const body = source.replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, "");
      await tx.unsafe(body);
      const [objects] = await tx`select
      to_regclass('public.gst_configuration_versions') is not null as config_table,
      to_regclass('public.gst_invoice_snapshots') is not null as invoice_table,
      to_regprocedure('public.complete_counter_bill_gst(uuid,jsonb,jsonb,boolean,bigint,uuid,text,text,jsonb)') is not null as sale_rpc`;
      assert.deepEqual(objects, { config_table: true, invoice_table: true, sale_rpc: true });
      const [seed] = await tx`select count(*)::int as count from public.gst_configuration_versions`;
      assert.equal(seed.count, 0, "Migration must remain inactive until Owner configuration");
      throw rollback;
    });
    console.log(
      "GST migration dry-run passed and rolled back; no production rows or settings changed.",
    );
  }
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await sql.end();
}
