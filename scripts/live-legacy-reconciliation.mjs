/** Apply only the fully analyzed, guarded legacy reconciliation migration. */
import postgres from 'postgres';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
process.loadEnvFile('.env');
const filename = '20261003000900_live_legacy_reconciliation.sql';
const version = filename.split('_')[0];
const text = await fs.readFile('supabase/migrations/' + filename, 'utf8');
assert.equal(text, await fs.readFile('drizzle/migrations/0019_live_legacy_reconciliation.sql', 'utf8'));
const hash = createHash('sha256').update(text).digest('hex');
const sql = postgres(process.env.LOVABLE_DB_MIGRATION_URL, { ssl: 'require', max: 1, connect_timeout: 15, onnotice: () => {} });
let tables;
const target = '5b35b172-0d1a-4ca3-834a-c3f61279b4fe';
const fingerprint = async (tx, ignoredAudit = false) => {
  const out = {};
  for (const name of tables) {
    let where = '';
    if (name === 'domain_reconciliation') where = " where id<>'" + target + "'";
    if (name === 'erp_audit_records' && ignoredAudit) where = " where reference is distinct from '" + filename + "'";
    const table = 'public."' + name.replaceAll('"', '""') + '"';
    out[name] = (await tx.unsafe(`select count(*)::int as count,md5(coalesce(string_agg(row::text,E'\n' order by row::text),'')) as digest from(select to_jsonb(r) row from ${table} r${where}) x`))[0];
  }
  return out;
};
try {
  console.log('Connected:', (await sql`select current_database() as db`)[0].db);
  const recorded = await sql`select sha256 from supabase_migrations.erp_execution_history where version=${version}`;
  if (recorded.length) {
    assert.equal(recorded[0].sha256, hash, 'Recorded migration differs');
    console.log('Already recorded; no migration re-executed:', filename);
  } else {
    let verification;
    tables = (await sql`select tablename from pg_tables where schemaname='public' order by tablename`).map(t => t.tablename);
    await sql.begin(async tx => {
      await tx.unsafe("set local lock_timeout='10s';set local statement_timeout='60s'");
      const before = await fingerprint(tx);
      const oldTarget = (await tx`select * from public.domain_reconciliation where id=${target}`)[0];
      const oldAudits = Number((await tx`select count(*) as n from public.erp_audit_records`)[0].n);
      await tx.unsafe(text.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, ''));
      const after = await fingerprint(tx, true);
      assert.deepEqual(after, before, 'Unapproved existing public row change');
      const newTarget = (await tx`select * from public.domain_reconciliation where id=${target}`)[0];
      for (const key of ['id', 'legacy_table', 'legacy_id', 'issue', 'details', 'created_at']) assert.deepEqual(newTarget[key], oldTarget[key]);
      assert(newTarget.resolved_at && newTarget.resolved_by === null && newTarget.resolution.includes('Historical physical location remains unknown'));
      assert.equal(Number((await tx`select count(*) as n from public.erp_audit_records`)[0].n), oldAudits + 1);
      assert.equal(Number((await tx`select count(*) as n from public.domain_reconciliation where resolved_at is null`)[0].n), 25);
      assert.equal(Number((await tx`select count(*) as n from supabase_migrations.erp_legacy_reconciliation_assessments`)[0].n), 26);
      assert.equal(Number((await tx`select count(*) as n from public.inventory_items`)[0].n), 0);
      assert.equal(Number((await tx`select count(*) as n from public.inventory_movements`)[0].n), 0);
      verification = { migration: filename, sha256: hash, verified_at: new Date().toISOString(), resolved: 1, remaining: 25, assessments: 26, unchanged_public_row_fingerprints: before, scope: 'One depleted current-stock location issue only; no historical location inference, inventory migration or guessed opening balance', automated_actor: null };
      await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values(${version},'live_legacy_reconciliation',${[text]})`;
      await tx`insert into supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) values(${version},${filename},${hash},'applied',${tx.json(verification)})`;
    });
    await fs.writeFile('docs/LEGACY_RECONCILIATION_VERIFICATION.json', JSON.stringify(verification, null, 2) + '\n');
    console.log('APPLIED AND VERIFIED:', filename, '1 issue resolved; 25 Owner issues retained; historical business rows unchanged.');
  }
  const state = await sql`select issue,count(*)::int as total,count(*) filter(where resolved_at is not null)::int as resolved,count(*) filter(where resolved_at is null)::int as remaining from public.domain_reconciliation group by issue order by issue`;
  console.log(JSON.stringify(state));
} catch (error) {
  console.error(JSON.stringify({ code: error.code, message: error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[REDACTED]') }));
  process.exitCode = 1;
} finally { await sql.end(); }
