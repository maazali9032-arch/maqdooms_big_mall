/** Forward release with hash checks. Default: exercise actual schema and roll back. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import postgres from "postgres";

process.loadEnvFile(".env");
const apply = process.argv.includes("--apply");
const files = [
  ["20261019000100_gst_operational_input_audit.sql", "0065_gst_operational_input_audit.sql"],
  ["20261019000200_short_document_scan_codes.sql", "0066_short_document_scan_codes.sql"],
  ["20261019000300_gst_configuration_reload.sql", "0067_gst_configuration_reload.sql"],
  ["20261020000100_gst_paid_retail_bill.sql", "0068_gst_paid_retail_bill.sql"],
  [
    "20261020000200_unified_finished_receipt_lookup.sql",
    "0069_unified_finished_receipt_lookup.sql",
  ],
  ["20261020000300_gst_option_consistency.sql", "0070_gst_option_consistency.sql"],
  [
    "20261020000400_customer_finished_receiver_access.sql",
    "0071_customer_finished_receiver_access.sql",
  ],
  ["20261020000500_production_sp_before_barcode.sql", "0072_production_sp_before_barcode.sql"],
  ["20261021000100_tailor_work_order_status.sql", "0073_tailor_work_order_status.sql"],
];
const migrations = [];
for (const [file, mirror] of files) {
  const source = await fs.readFile(`supabase/migrations/${file}`, "utf8");
  assert.equal(
    source,
    await fs.readFile(`drizzle/migrations/${mirror}`, "utf8"),
    `Mirror differs: ${file}`,
  );
  migrations.push({
    file,
    version: file.split("_")[0],
    source,
    hash: createHash("sha256").update(source).digest("hex"),
  });
}
assert(process.env.LOVABLE_DB_MIGRATION_URL, "Database connection is required");
const sql = postgres(process.env.LOVABLE_DB_MIGRATION_URL, {
  ssl: "require",
  max: 1,
  prepare: false,
  connect_timeout: 15,
  onnotice: () => {},
});
const rollback = Symbol("dry-run");
async function fingerprints(tx) {
  const result = {};
  for (const table of [
    "orders",
    "production_jobs",
    "customer_tailoring_jobs",
    "gst_configuration_versions",
    "gst_tax_rules",
    "gst_invoice_snapshots",
    "gst_invoice_lines",
    "gst_purchase_documents",
    "gst_purchase_lines",
    "inventory_movements",
    "customer_tailoring_finished_items",
    "finished_products",
    "finished_product_prices",
    "finished_product_receipts",
    "finished_product_price_reviews",
    "barcodes",
  ]) {
    // Only new scan aliases/default cut ordinals are excluded; every historical value is compared.
    const [row] = await tx.unsafe(
      `select count(*)::text rows,md5(coalesce(string_agg(payload::text,'' order by payload::text),'')) checksum from (select to_jsonb(t)-'scan_code'-'source_cut_ordinal' payload from public.${table} t) data`,
    );
    result[table] = row;
  }
  return result;
}
async function verify(tx) {
  const [checks] = await tx.unsafe(`select
 to_regprocedure('public.resolve_finished_receipt(text)') is not null as unified_receipt,
 position('''status'',job.status' in pg_get_functiondef('public.tailor_work_order(text)'::regprocedure))>0 as workshop_copy_real_status,
 to_regprocedure('public.receive_production_barcode_priced(uuid,text,jsonb)') is not null as priced_production_receipt,
 position('Positive SP is required' in pg_get_functiondef('public.complete_production_batch(uuid,uuid,text,text)'::regprocedure))>0 as old_unpriced_receipt_blocked,
 position('validate_production_piece_prices' in pg_get_functiondef('public.receive_finished_products(uuid,uuid,jsonb,text)'::regprocedure))>0 as owner_allocation_requires_sp,
 not has_function_privilege('authenticated','public.complete_production_batch_priced(uuid,uuid,text,text,jsonb)','execute') as private_priced_staging,
 position('production.receive' in pg_get_functiondef('public.customer_tailoring_finished_item(text)'::regprocedure))>0 as receiver_result_access,
 to_regprocedure('public.owner_gst_configuration()') is not null as owner_reader,
 position('gst_stage_counter_bill_multi(' in pg_get_functiondef('public.complete_counter_bill_gst(uuid,jsonb,jsonb,boolean,bigint,uuid,text,text,jsonb)'::regprocedure))>0 as private_staging,
 position('configuration_id' in pg_get_functiondef('public.gst_snapshot_counter_bill(uuid,jsonb)'::regprocedure))>0 as preview_version_guard,
 position('row_ordinal' in pg_get_functiondef('public.create_barcode_batch_with_gst(uuid,text,date,text,jsonb,jsonb)'::regprocedure))>0 as purchase_row_lookup,
 (select pronargdefaults=1 from pg_proc where oid='public.create_barcode_batch_with_gst(uuid,text,date,text,jsonb,jsonb)'::regprocedure) as optional_purchase,
 not has_function_privilege('authenticated','public.gst_stage_counter_bill_multi(uuid,jsonb,jsonb,boolean,uuid,uuid,text,text)','execute') as private_staging_denied,
 not has_function_privilege('anon','public.resolve_finished_receipt(text)','execute') as anonymous_receipt_denied,
 exists(select 1 from information_schema.columns where table_schema='public' and table_name='gst_invoice_lines' and column_name='source_cut_ordinal') as multiple_fabric_cuts`);
  assert(
    Object.values(checks).every(Boolean),
    "Post-migration function/permission verification failed",
  );
  const [owner] =
    await tx`select user_id from public.user_roles where role_key='owner' order by user_id limit 1`;
  assert(owner, "Owner required for read-only GST report verification");
  await tx`select set_config('request.jwt.claim.sub',${owner.user_id},true)`;
  const [result] =
    await tx`select public.gst_transaction_configuration() is not null as transaction_reader,public.owner_gst_configuration() is not null as owner_reader,public.owner_gst_report(current_date-30,current_date,null,null) is not null as report_reader`;
  assert(
    Object.values(result).every(Boolean),
    "Read-only configuration/report verification failed",
  );
  const [stock] =
    await tx`select r.user_id from public.user_roles r where r.role_key='stock_entry' and public.has_perm(r.user_id,'production.receive') and not exists(select 1 from public.user_roles other where other.user_id=r.user_id and other.role_key in ('owner','counter','tailor','production')) order by r.user_id limit 1`;
  assert(stock, "A stock-only receiver is required for permission verification");
  await tx`select set_config('request.jwt.claim.sub',${stock.user_id},true)`;
  await tx`select public.customer_tailoring_finished_item('__permission_probe_not_a_real_barcode__')`;
  return { ...checks, ...result, stock_receiver_lookup: true };
}
try {
  await sql.begin(async (tx) => {
    await tx.unsafe("set local lock_timeout='10s'; set local statement_timeout='60s'");
    await tx`select pg_advisory_xact_lock(hashtext('maqdooms-pending-gst-release'))`;
    const baseline = await fingerprints(tx);
    for (const m of migrations) {
      const tracked =
        await tx`select sha256 from supabase_migrations.erp_execution_history where version=${m.version}`;
      const native =
        await tx`select version from supabase_migrations.schema_migrations where version=${m.version}`;
      if (tracked.length) {
        assert.equal(tracked[0].sha256, m.hash, `Recorded hash mismatch: ${m.file}`);
        assert.equal(native.length, 1, `Missing migration record: ${m.file}`);
        console.log("Already recorded:", m.file);
        continue;
      }
      assert.equal(native.length, 0, `Unreconciled migration record: ${m.file}`);
      await tx.unsafe(m.source.replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, ""));
      await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values(${m.version},${m.file.slice(15, -4)},${[m.source]})`;
      await tx`insert into supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) values(${m.version},${m.file},${m.hash},'applied',${tx.json({ release: "GST and receipt fixes 0065-0073", business_values: "unchanged; checksums verified", verified_at: new Date().toISOString() })})`;
      console.log(apply ? "Staged for atomic commit:" : "Dry-run staged:", m.file);
    }
    const checks = await verify(tx);
    assert.deepEqual(
      await fingerprints(tx),
      baseline,
      "Business values changed during release; rolling back",
    );
    console.log(JSON.stringify({ verified: checks, historical_business_values_preserved: true }));
    if (!apply) throw rollback;
  });
  console.log(
    "COMMITTED: pending migrations and tracking records; no business transactions posted.",
  );
  await sql.begin("read only", async (tx) => {
    console.log(JSON.stringify({ post_commit: await verify(tx) }));
  });
} catch (error) {
  if (error === rollback) console.log("DRY RUN PASSED: all changes rolled back.");
  else {
    console.error(
      JSON.stringify({
        failed: true,
        error_code: error.code ?? "ASSERTION",
        reason:
          error instanceof assert.AssertionError
            ? error.message
            : "Database check failed; no connection details printed.",
      }),
    );
    process.exitCode = 1;
  }
} finally {
  await sql.end({ timeout: 5 });
}
