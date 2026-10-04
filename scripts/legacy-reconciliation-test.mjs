/** Disposable-only guarded reconciliation tests. Never loads .env. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const analysis = JSON.parse(await fs.readFile('docs/LEGACY_RECONCILIATION_ANALYSIS.json', 'utf8'));
const migration = await fs.readFile('supabase/migrations/20261003000900_live_legacy_reconciliation.sql', 'utf8');
const mirror = await fs.readFile('drizzle/migrations/0019_live_legacy_reconciliation.sql', 'utf8');
assert.equal(migration, mirror);
let checks = 1;
const db = new PGlite();
const q = async (text, args = []) => (await db.query(text, args)).rows;
const check = (value, label) => { assert(value, label); checks++; };
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 create schema supabase_migrations;`);
  for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql') && !f.includes('_live_') && !f.includes('demo_seed')).sort()) {
    await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
  }
  // Synthetic fixture reproduces only the guarded depletion evidence. No live DB.
  await db.exec(`insert into public.thaans(id,barcode,original_mm,status,rack)
 values('d7bc14e3-a672-4277-8b88-be1d751b767b','TH-0003',26000,'depleted','A-02');
 insert into public.sales(id,bill_no,total_paise) values('99999999-9999-4999-8999-999999999999','FIXTURE-BILL',0);
 insert into public.sale_items(sale_id,thaan_id,length_mm,price_paise_per_m,amount_paise)
 values('99999999-9999-4999-8999-999999999999','d7bc14e3-a672-4277-8b88-be1d751b767b',26000,0,0);
 insert into public.stock_movements(thaan_id,kind,delta_mm) values('d7bc14e3-a672-4277-8b88-be1d751b767b','INWARD',26000);
 insert into public.stock_movements(thaan_id,kind,delta_mm,sale_id)
 values('d7bc14e3-a672-4277-8b88-be1d751b767b','SALE',-26000,'99999999-9999-4999-8999-999999999999');`);
  for (const r of analysis.issues) await q(`insert into public.domain_reconciliation(id,legacy_table,legacy_id,issue,details) values($1,$2,$3,$4,$5)`, [r.reconciliation_id, r.legacy_table, r.legacy_id, r.issue, { fixture: true }]);
  const body = migration.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
  const reject = async (change, reason) => {
    await db.exec('BEGIN');
    await db.exec(change);
    let failed = false;
    try { await db.exec(body); } catch { failed = true; }
    await db.exec('ROLLBACK');
    check(failed, reason);
    check((await q("select to_regclass('supabase_migrations.erp_legacy_reconciliation_assessments') as t"))[0].t === null, reason + ' metadata rolled back');
    check((await q('select count(*)::int n from public.domain_reconciliation where resolved_at is null'))[0].n === 26, reason + ' issue changes rolled back');
  };
  await reject("update public.thaans set status='active' where barcode='TH-0003'", 'Non-depleted row blocked');
  await reject("insert into public.stock_movements(thaan_id,kind,delta_mm) values('d7bc14e3-a672-4277-8b88-be1d751b767b','RETURN',1000)", 'Changed ledger blocked');
  await reject("insert into public.holds(thaan_id,length_mm,expires_at) values('d7bc14e3-a672-4277-8b88-be1d751b767b',1000,now()+interval '1 day')", 'Live unlocated hold blocked');
  await reject("update public.sale_items set length_mm=25000", 'Billed sale mismatch blocked');
  await reject("update public.domain_reconciliation set resolved_at=now() where legacy_table='materials'", 'Changed 26-record set blocked');
  const original = await q('select * from public.domain_reconciliation order by id');
  const stockBefore = await q('select * from public.stock_movements order by id');
  const thaanBefore = await q('select * from public.thaans order by id');
  await db.exec(migration);
  const after = await q('select * from public.domain_reconciliation order by id');
  check(after.filter(r => r.resolved_at).length === 1, 'Exactly one issue closed');
  check(after.filter(r => !r.resolved_at).length === 25, '25 Owner issues retained');
  for (const r of after) {
    const old = original.find(x => x.id === r.id);
    for (const field of ['id', 'legacy_table', 'legacy_id', 'issue', 'details', 'created_at']) { assert.deepEqual(r[field], old[field]); checks++; }
    if (r.legacy_id !== 'd7bc14e3-a672-4277-8b88-be1d751b767b') { assert.deepEqual(r, old); checks++; }
  }
  assert.deepEqual(await q('select * from public.stock_movements order by id'), stockBefore); checks++;
  assert.deepEqual(await q('select * from public.thaans order by id'), thaanBefore); checks++;
  check((await q('select count(*)::int n from public.inventory_items'))[0].n === 0, 'No inventory authority switch');
  check((await q('select count(*)::int n from public.inventory_movements'))[0].n === 0, 'No guessed opening movement');
  check((await q('select count(*)::int n from supabase_migrations.erp_legacy_reconciliation_assessments'))[0].n === 26, 'All assessments persisted');
  check((await q("select count(*)::int n from public.erp_audit_records where action='migration_legacy_reconciliation' and actor_id is null"))[0].n === 1, 'Truthful automated audit');
  await db.exec('BEGIN');
  let immutable = false;
  try { await db.exec('update supabase_migrations.erp_legacy_reconciliation_assessments set recorded_at=now()'); } catch { immutable = true; }
  await db.exec('ROLLBACK');
  check(immutable, 'Assessment history immutable');
  await db.exec('BEGIN; SET LOCAL ROLE authenticated');
  let inaccessible = false;
  try { await db.exec('select * from supabase_migrations.erp_legacy_reconciliation_assessments'); } catch { inaccessible = true; }
  await db.exec('ROLLBACK');
  check(inaccessible, 'Browser assessment access denied');
  console.log('PASS:', checks, 'guarded reconciliation/preservation/security checks');
} finally { await db.close(); }
