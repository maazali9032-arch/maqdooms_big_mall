/** Apply only the user-authorized test-stock fixture migration; preserve history. */
import postgres from 'postgres';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
process.loadEnvFile('.env');
const filename = '20261003001000_live_test_stock_scenarios.sql';
const version = '20261003001000';
const text = await fs.readFile('supabase/migrations/' + filename, 'utf8');
assert.equal(text, await fs.readFile('drizzle/migrations/0020_live_test_stock_scenarios.sql', 'utf8'));
const hash = createHash('sha256').update(text).digest('hex');
const plan = JSON.parse(await fs.readFile('docs/TEST_STOCK_SCENARIOS.json', 'utf8'));
const sql = postgres(process.env.LOVABLE_DB_MIGRATION_URL, { ssl: 'require', max: 1, connect_timeout: 15, onnotice: () => {} });
let tables;
const fingerprint = async tx => {
  const hasProvenance = (await tx`select exists(select 1 from information_schema.columns where table_schema='public' and table_name='inventory_items' and column_name='fixture_migration_version') as yes`)[0].yes;
  const out = {};
  for (const name of tables) {
    let where = '';
    let row = 'to_jsonb(r)';
    if (name === 'domain_reconciliation') row += "-'resolved_at'-'resolved_by'-'resolution'";
    if (name === 'erp_audit_records') where = " where reference is distinct from '" + filename + "'";
    if (name === 'locations') where = " where code not in ('TEST-DISPLAY-A','TEST-DISPLAY-B')";
    if (name === 'inventory_items' && hasProvenance) where = " where fixture_migration_version is distinct from '" + version + "'";
    if (name === 'inventory_movements' && hasProvenance) where = " where inventory_item_id not in(select id from public.inventory_items where fixture_migration_version='" + version + "')";
    out[name] = (await tx.unsafe(`select count(*)::int count,md5(coalesce(string_agg(row::text,E'\n' order by row::text),'')) digest from(select ${row} row from public."${name}" r${where}) z`))[0];
  }
  return out;
};
const verifyBalances = async tx => {
  const records = await tx`select * from supabase_migrations.erp_test_stock_fixtures order by label`;
  assert.equal(records.length, 21);
  for (const p of plan.fixtures) {
    const fixture = records.find(r => r.legacy_id === p.legacy_id);
    assert(fixture && Number(fixture.recorded_quantity) === p.quantity);
    if (p.status === 'draft') { assert.equal(fixture.inventory_item_id, null); continue; }
    assert.equal(Number((await tx`select public.inventory_balance(${fixture.inventory_item_id},null) n`)[0].n), p.quantity);
    for (const a of p.allocations) assert.equal(Number((await tx`select public.inventory_balance(${fixture.inventory_item_id},(select id from public.locations where code=${a.code})) n`)[0].n), a.quantity);
  }
  assert.equal(Number((await tx`select count(*) n from public.inventory_items`)[0].n), 18);
  assert.equal(Number((await tx`select count(*) n from public.inventory_movements`)[0].n), 27);
  assert.equal(Number((await tx`select count(*) n from public.domain_reconciliation where resolved_at is null`)[0].n), 4);
  return records.map(r => ({ label: r.label, scenario: r.scenario, quantity: Number(r.recorded_quantity), unit: r.unit, allocations: r.allocations, inventory_item_id: r.inventory_item_id }));
};
try {
  console.log('Connected:', (await sql`select current_database() db`)[0].db);
  const recorded = await sql`select sha256 from supabase_migrations.erp_execution_history where version=${version}`;
  if (recorded.length) {
    assert.equal(recorded[0].sha256, hash);
    await verifyBalances(sql);
    console.log('Already recorded and balances verified; no migration replay.');
  } else {
    tables = (await sql`select tablename from pg_tables where schemaname='public' order by tablename`).map(r => r.tablename);
    let verification;
    await sql.begin(async tx => {
      await tx.unsafe("set local lock_timeout='10s';set local statement_timeout='60s'");
      const before = await fingerprint(tx);
      const issues = await tx`select * from public.domain_reconciliation order by id`;
      const auditCount = Number((await tx`select count(*) n from public.erp_audit_records`)[0].n);
      await tx.unsafe(text.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, ''));
      assert.deepEqual(await fingerprint(tx), before, 'Unexpected existing data/history changes');
      const afterIssues = await tx`select * from public.domain_reconciliation order by id`;
      for (const old of issues) {
        const current = afterIssues.find(r => r.id === old.id);
        if (old.legacy_table === 'tailoring_jobs' || old.resolved_at) assert.deepEqual(current, old, 'Job/prior resolution overwritten');
        else assert(current.resolved_at && current.resolved_by === null, 'Fixture issue not dispositioned');
      }
      assert.equal(Number((await tx`select count(*) n from public.erp_audit_records`)[0].n), auditCount + 42);
      const fixtures = await verifyBalances(tx);
      verification = { migration: filename, sha256: hash, verified_at: new Date().toISOString(), fixtures, closed_stock_issues: 21, jobs_remaining: 4, canonical_items: 18, opening_allocations: 27, appended_audit_events: 42, preserved_public_row_fingerprints: before, authorization: 'User explicitly declared reviewed stock testing data and allowed deliberate scenarios', automated_actor: null };
      await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values(${version},'live_test_stock_scenarios',${[text]})`;
      await tx`insert into supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) values(${version},${filename},${hash},'applied',${tx.json(verification)})`;
    });
    await fs.writeFile('docs/TEST_STOCK_SCENARIOS_VERIFICATION.json', JSON.stringify(verification, null, 2) + '\n');
    console.log('APPLIED AND VERIFIED:', filename, '21 fixtures; 18 canonical items; 27 allocations; 4 jobs unchanged.');
  }
} catch (error) {
  console.error(JSON.stringify({ code: error.code, message: error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[REDACTED]') }));
  process.exitCode = 1;
} finally { await sql.end(); }
