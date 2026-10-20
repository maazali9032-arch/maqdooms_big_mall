import { ecommerceShowroomCases } from "./ecommerce-showroom-cases.mjs";
import { productionPricedReceiptCases } from "./production-priced-receipt-cases.mjs";
import { customerFinishedReceiverCases } from "./customer-finished-receiver-cases.mjs";
/** Disposable PostgreSQL only. No .env, network database or production settings. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gstConfigurationReloadCases } from "./gst-configuration-reload-cases.mjs";
import { gstPaidRetailCases } from "./gst-paid-retail-cases.mjs";
import { unifiedFinishedReceiptCases } from "./unified-finished-receipt-cases.mjs";
import { gstOptionConsistencyCases } from "./gst-option-consistency-cases.mjs";
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const source = await fs.readFile(
  "supabase/migrations/20261019000200_short_document_scan_codes.sql",
  "utf8",
);
assert.equal(
  source,
  await fs.readFile("drizzle/migrations/0066_short_document_scan_codes.sql", "utf8"),
);
assert.equal(
  await fs.readFile("supabase/migrations/20261019000300_gst_configuration_reload.sql", "utf8"),
  await fs.readFile("drizzle/migrations/0067_gst_configuration_reload.sql", "utf8"),
);
const db = new PGlite();
assert.equal(
  await fs.readFile("supabase/migrations/20261020000100_gst_paid_retail_bill.sql", "utf8"),
  await fs.readFile("drizzle/migrations/0068_gst_paid_retail_bill.sql", "utf8"),
);
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`);
  for (const file of (await fs.readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql") && !f.includes("_live_"))
    .sort()) {
    try {
      if (file === "20261019000200_short_document_scan_codes.sql") {
        await db.exec(
          `insert into public.orders(code,kind,source_location_id) values('BILL-preexisting','counter_bill',(select id from locations where kind='workshop' limit 1))`,
        );
      }
      await db.exec(await fs.readFile(`supabase/migrations/${file}`, "utf8"));
    } catch (e) {
      throw new Error(`${file}: ${e.message}`);
    }
  }
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const [bill] = await q(
    `insert into public.orders(code,kind,source_location_id) values('BILL-original-reference','counter_bill',(select id from locations where kind='workshop' limit 1)) returning id,code,scan_code`,
  );
  assert.equal(bill.code, "BILL-original-reference");
  assert.match(bill.scan_code, /^BL-[23456789ABCDEFGH]{12}$/);
  const [resolved] = await q(`select public.resolve_document_scan_code($1) value`, [
    bill.scan_code,
  ]);
  assert.equal(resolved.value, bill.code);
  const [legacy] = await q(
    `select public.resolve_document_scan_code('unchanged-legacy-code') value`,
  );
  assert.equal(legacy.value, "unchanged-legacy-code");
  const [historical] = await q(`select code,scan_code from orders where code='BILL-preexisting'`);
  assert.deepEqual(historical, { code: "BILL-preexisting", scan_code: null });
  await assert.rejects(q(`select public.counter_bill($1)`, [bill.scan_code]), /access required/);
  await assert.rejects(
    q(`update orders set scan_code='BL-222222222222' where id=$1`, [bill.id]),
    /permanent/,
  );
  // Exercise actual trigger generation on disposable tables using exactly the same trigger.
  for (const [table, prefix] of [
    ["orders", "BL"],
    ["production_jobs", "PJ"],
    ["customer_tailoring_jobs", "TJ"],
  ]) {
    const old = await q(`select id,code,scan_code from public.${table}`);
    assert(
      old.filter((r) => r.id !== bill.id).every((r) => r.scan_code === null),
      "Historical documents must remain untouched",
    );
    await db.exec(`create schema if not exists scan_test;create table scan_test.${table}(id uuid primary key default gen_random_uuid(),code text unique,scan_code text unique);
      create trigger generate before insert on scan_test.${table} for each row execute function public.assign_document_scan_code();`);
    const codes = await q(
      `insert into scan_test.${table}(code) select 'test-'||g from generate_series(1,100) g returning code,scan_code`,
    );
    assert.equal(new Set(codes.map((r) => r.scan_code)).size, 100);
    assert(codes.every((r) => new RegExp(`^${prefix}-[23456789ABCDEFGH]{12}$`).test(r.scan_code)));
  }
  const defs = await q(
    `select proname,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('counter_bill','customer_tailoring_work','production_job_document','tailor_work_order','receive_production_barcode','issue_additional_production_fabric')`,
  );
  assert.equal(defs.length, 6);
  assert(defs.every((r) => r.definition.includes("resolve_document_scan_code")));
  const permission = await q(
    `select has_function_privilege('authenticated','public.resolve_document_scan_code(text)','execute') allowed`,
  );
  assert.equal(permission[0].allowed, false);
  console.log(
    "PASS: full migration replay, historical preservation, 300 compact identities, lookup integration and private resolver permissions.",
  );
  await gstConfigurationReloadCases(db);
  const receiptFixtures = await gstPaidRetailCases(db);
  await unifiedFinishedReceiptCases(db, receiptFixtures);
  await gstOptionConsistencyCases(db, receiptFixtures);
  await customerFinishedReceiverCases(db, receiptFixtures);
  await productionPricedReceiptCases(db, receiptFixtures);
  await ecommerceShowroomCases(db, receiptFixtures);
} finally {
  await db.close();
}
