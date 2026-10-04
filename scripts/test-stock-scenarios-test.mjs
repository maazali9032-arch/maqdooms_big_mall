/** Disposable-only tests for authorized test-stock commissioning. No .env/live DB. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const plan = JSON.parse(await fs.readFile('docs/TEST_STOCK_SCENARIOS.json', 'utf8'));
const analysis = JSON.parse(await fs.readFile('docs/LEGACY_RECONCILIATION_ANALYSIS.json', 'utf8'));
const filename = '20261003001000_live_test_stock_scenarios.sql';
const text = await fs.readFile('supabase/migrations/' + filename, 'utf8');
assert.equal(text, await fs.readFile('drizzle/migrations/0020_live_test_stock_scenarios.sql', 'utf8'));
let checks = 1;
const db = new PGlite();
const q = async (s, p = []) => (await db.query(s, p)).rows;
const check = (x, label) => { assert(x, label); checks++; };
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`);
  for (const f of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql') && !f.includes('_live_') && !f.includes('demo_seed')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + f, 'utf8'));
  const fabric = randomUUID();
  await q('insert into public.fabrics(id,code,name) values($1,$2,$3)', [fabric, 'FIXTURE-FABRIC', 'Synthetic disposable test fabric']);
  const stocks = new Map();
  for (const p of plan.fixtures.filter(p => p.legacy_table === 'thaans')) {
    const source = analysis.issues.find(r => r.legacy_id === p.legacy_id).evidence;
    let stock = stocks.get(source.fabric_stock_id);
    if (!stock) {
      stock = { id: source.fabric_stock_id, batch: randomUUID(), barcode: randomUUID() };
      await q('insert into public.receiving_batches(id,code,status) values($1,$2,$3)', [stock.batch, 'FIXTURE-' + stock.id, p.status === 'draft' ? 'draft' : 'committed']);
      await q('insert into public.barcodes(id,code,kind) values($1,$2,$3)', [stock.barcode, 'FAB-' + stock.id, 'fabric']);
      await q('insert into public.fabric_stock(id,fabric_id,batch_id,barcode_id,entry_state) values($1,$2,$3,$4,$5)', [stock.id, fabric, stock.batch, stock.barcode, 'legacy_pending']);
      if (stock.id !== 'a1919ba4-31d9-4091-b249-c6545a82ffaf') {
        await q('insert into public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m) values($1,1,100)', [stock.id]);
        await q('insert into public.fabric_stock_prices(fabric_stock_id,revision,sp_paise_per_m) values($1,1,200)', [stock.id]);
      }
      stocks.set(stock.id, stock);
    }
    await q('insert into public.thaans(id,barcode,fabric_id,batch_id,fabric_stock_id,original_mm,status) values($1,$2,$3,$4,$5,$6,$7)', [p.legacy_id, p.label, fabric, stock.batch, stock.id, source.original_mm, p.status]);
    if (p.status === 'draft') continue;
    await q("insert into public.stock_movements(thaan_id,kind,delta_mm) values($1,'INWARD',$2)", [p.legacy_id, source.original_mm]);
    if (p.label === 'TH-0003') {
      const sale = randomUUID();
      await q('insert into public.sales(id,bill_no) values($1,$2)', [sale, 'FIXTURE-DEPLETED-BILL']);
      await q('insert into public.sale_items(sale_id,thaan_id,length_mm,price_paise_per_m,amount_paise) values($1,$2,26000,0,0)', [sale, p.legacy_id]);
      await q("insert into public.stock_movements(thaan_id,kind,delta_mm,sale_id) values($1,'SALE',-26000,$2)", [p.legacy_id, sale]);
    } else if (source.original_mm !== p.quantity) await q("insert into public.stock_movements(thaan_id,kind,delta_mm) values($1,'ADJUSTMENT',$2)", [p.legacy_id, p.quantity - source.original_mm]);
  }
  for (const p of plan.fixtures.filter(p => p.legacy_table === 'materials')) await q('insert into public.materials(id,name,unit,qty_on_hand) values($1,$2,$3,$4)', [p.legacy_id, p.label, p.unit, p.quantity]);
  for (const r of analysis.issues) await q('insert into public.domain_reconciliation(id,legacy_table,legacy_id,issue,details) values($1,$2,$3,$4,$5)', [r.reconciliation_id, r.legacy_table, r.legacy_id, r.issue, { synthetic_local_fixture: true }]);
  await db.exec(await fs.readFile('supabase/migrations/20261003000700_live_migration_tracking.sql', 'utf8'));
  await db.exec(await fs.readFile('supabase/migrations/20261003000900_live_legacy_reconciliation.sql', 'utf8'));
  const body = text.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
  const blocked = async change => {
    await db.exec('BEGIN');
    await db.exec(change);
    let rejected = false;
    try { await db.exec(body); } catch { rejected = true; }
    await db.exec('ROLLBACK');
    check(rejected, 'Changed source baseline rejected');
    check((await q('select count(*)::int n from public.inventory_items'))[0].n === 0, 'No partial stock commissioning');
    check((await q("select count(*)::int n from public.locations where code like 'TEST-%'"))[0].n === 0, 'No partial test location');
    check((await q("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='inventory_items' and column_name='fixture_migration_version'"))[0].n === 0, 'DDL rolls back');
  };
  await blocked("insert into public.stock_movements(thaan_id,kind,delta_mm) values('442fe81d-12c2-4bb5-b983-f53e2ad7411d','RETURN',1000)");
  await blocked("insert into public.holds(thaan_id,length_mm,expires_at) values('442fe81d-12c2-4bb5-b983-f53e2ad7411d',1000,now()+interval '1 day')");
  await blocked("insert into public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m) values('a1919ba4-31d9-4091-b249-c6545a82ffaf',1,100)");
  const before = {};
  for (const t of ['thaans', 'materials', 'stock_movements', 'fabric_stock', 'barcodes', 'fabric_stock_costs', 'fabric_stock_prices', 'tailoring_jobs', 'tailoring_job_lines']) before[t] = await q('select * from public.' + t + ' order by 1');
  await db.exec('BEGIN');
  await db.exec(body);
  await db.exec("insert into supabase_migrations.schema_migrations(version,name) values('20261003001000','live_test_stock_scenarios')");
  await db.exec('COMMIT');
  for (const [t, rows] of Object.entries(before)) { assert.deepEqual(await q('select * from public.' + t + ' order by 1'), rows); checks++; }
  check((await q('select count(*)::int n from public.inventory_items'))[0].n === 18, '18 canonical items');
  check((await q('select count(*)::int n from public.inventory_movements'))[0].n === 27, '27 openings');
  check((await q('select count(*)::int n from supabase_migrations.erp_test_stock_fixtures'))[0].n === 21, '21 unique stock fixtures');
  check((await q('select count(*)::int n from public.domain_reconciliation where resolved_at is null'))[0].n === 4, 'Only four job issues remain');
  for (const p of plan.fixtures) {
    const fixture = (await q('select * from supabase_migrations.erp_test_stock_fixtures where legacy_id=$1', [p.legacy_id]))[0];
    if (p.status === 'draft') { check(fixture.inventory_item_id === null, 'Unreceived draft not imported'); continue; }
    check(Number((await q('select public.inventory_balance($1,null) n', [fixture.inventory_item_id]))[0].n) === p.quantity, 'Total conserved: ' + p.label);
    for (const a of p.allocations) check(Number((await q('select public.inventory_balance($1,(select id from public.locations where code=$2)) n', [fixture.inventory_item_id, a.code]))[0].n) === a.quantity, 'Allocation matches: ' + p.label);
    const item = (await q('select * from public.inventory_items where id=$1', [fixture.inventory_item_id]))[0];
    check(item.reconciled_by === null && item.fixture_migration_version === '20261003001000', 'Truthful automated provenance');
  }
  const owner = randomUUID();
  await q('insert into auth.users(id) values($1)', [owner]);
  await q('insert into public.profiles(id) values($1)', [owner]);
  await q("insert into public.user_roles(user_id,role_key) values($1,'owner')", [owner]);
  const extra = randomUUID();
  await q("insert into public.materials(id,name,unit,qty_on_hand) values($1,'Additional local RPC test','m',5)", [extra]);
  await q("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec('set role authenticated');
  const opening = (await q("select public.reconcile_inventory_item('consumable',$1,$2,'Local normal Owner path test') id", [extra, [{ location_id: (await q("select id from public.locations where code='WORKSHOP'"))[0].id, quantity: 5 }]]))[0].id;
  const regular = (await q('select reconciled_by,fixture_migration_version from public.inventory_items where id=$1', [opening]))[0];
  check(regular.reconciled_by === owner && regular.fixture_migration_version === null, 'Normal Owner RPC remains unchanged');
  await db.exec('reset role');
  await q("select set_config('request.jwt.claim.sub','',false)");
  const unallocatedMaterial = randomUUID();
  await q("insert into public.materials(id,name,unit,qty_on_hand) values($1,'Actorless provenance negative fixture','m',0)", [unallocatedMaterial]);
  await db.exec('BEGIN');
  let rejected = false;
  try { await q("insert into public.inventory_items(material_id,unit,legacy_quantity_snapshot,reconciled_by,reason) values($1,'m',0,null,'Local actorless constraint test')", [unallocatedMaterial]); } catch (error) { rejected = error.code === '23514'; }
  await db.exec('ROLLBACK');
  check(rejected, 'Actorless ordinary items rejected');
  await db.exec('BEGIN');
  let lateOpeningRejected = false;
  try {
    // First create spare capacity, so rejection proves the ledger gate closed
    // rather than merely exceeding the original opening quantity.
    await q(`insert into public.inventory_movements(inventory_item_id,kind,thaan_id,fabric_stock_id,quantity,unit,source_location_id,actor_id,reference,reason)
     select i.id,'ADJUSTMENT',i.thaan_id,t.fabric_stock_id,1000,'mm',l.id,$1,'LOCAL-ROLLBACK-TEST','Local temporary outgoing adjustment'
     from public.inventory_items i join public.thaans t on t.id=i.thaan_id cross join public.locations l
     where t.barcode='TH-0001' and l.code='WORKSHOP'`, [owner]);
    await db.exec(`insert into public.inventory_movements(inventory_item_id,kind,thaan_id,fabric_stock_id,quantity,unit,destination_location_id,reference,reason)
     select i.id,'ADJUSTMENT',i.thaan_id,t.fabric_stock_id,1,'mm',l.id,'OPENING:'||i.id::text,'Unauthorized post-migration actorless opening'
     from public.inventory_items i join public.thaans t on t.id=i.thaan_id cross join public.locations l
     where t.barcode='TH-0001' and l.code='WORKSHOP'`);
  } catch { lateOpeningRejected = true; }
  await db.exec('ROLLBACK');
  check(lateOpeningRejected, 'Actorless movement exception closed after migration ledger record');
  await db.exec('BEGIN');
  let immutable = false;
  try { await db.exec('update supabase_migrations.erp_test_stock_fixtures set scenario=\'changed\''); } catch { immutable = true; }
  await db.exec('ROLLBACK');
  check(immutable, 'Test fixture manifest immutable');
  console.log('PASS:', checks, 'test-stock allocation/provenance/preservation/rollback checks');
} catch (error) {
  console.error(JSON.stringify({ code: error.code, message: error.message, detail: error.detail, where: error.where }));
  process.exitCode = 1;
} finally { await db.close(); }
