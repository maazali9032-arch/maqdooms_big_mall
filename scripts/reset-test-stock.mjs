/** One-off approved test-stock maintenance. Never invoked by the application.
 * Default: read-only inspection. --apply-approved-test-reset: atomic reset after
 * private, verified public-data backup. No CASCADE, trigger disabling or DDL.
 * Keep accounts, catalog definitions, settings and all existing audit evidence.
 */
import postgres from "postgres";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

process.loadEnvFile(".env");
const apply = process.argv.includes("--apply-approved-test-reset");
const rehearse = process.argv.includes("--rehearse-approved-test-reset");
const write = apply || rehearse;
const sql = postgres(process.env.LOVABLE_DB_MIGRATION_URL, {
  ssl: "require", max: 1, connect_timeout: 15, onnotice: () => {},
});
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const roots = [
  "thaans", "receiving_batches", "fabric_stock", "barcodes", "inventory_items",
  "sales", "tailoring_jobs", "online_orders", "stock_registration_batches",
  "stock_registration_fabric_types", "stock_registration_variants",
  "stock_registration_requests", "fabric_entry_requests",
  "tailoring_management_requests", "production_requests", "production_cost_requests",
  "finished_product_transfer_requests",
];
const protectedTables = new Set([
  "profiles", "roles", "permissions", "role_permissions", "user_roles",
  "user_permission_overrides", "customers", "suppliers", "locations", "fabrics",
  "materials", "listings", "listing_variants", "audit_log", "erp_audit_records",
  "domain_reconciliation", "products", "designs", "tailoring_charges",
  "tailoring_factories", "tailoring_sections", "tailors", "whatsapp_templates",
]);
const mutablePreserved = new Set(["materials", "listing_variants", "domain_reconciliation", "erp_audit_records"]);
const maintenanceId = randomUUID();
const privateDirectory = path.join(os.homedir(), ".codex", "private-backups", "maqdooms", maintenanceId);
let result;
let committed = false;
try {
  result = await sql.begin(write ? "" : "read only", async tx => {
    await tx.unsafe("set local lock_timeout='15s'");
    await tx.unsafe("set local statement_timeout='90s'");
    const tables = (await tx`select tablename from pg_tables where schemaname='public' order by tablename`).map(r=>r.tablename);
    const fks = await tx`select c.relname child,p.relname parent,n.nspname child_schema, pn.nspname parent_schema from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_class p on p.oid=k.confrelid join pg_namespace n on n.oid=c.relnamespace join pg_namespace pn on pn.oid=p.relnamespace where k.contype='f'`;
    const targets = new Set(roots);
    for (const t of roots) assert(tables.includes(t), "Expected table missing: " + t);
    let changed = true;
    while(changed) {
      changed=false;
      for(const fk of fks) if(fk.parent_schema==='public' && targets.has(fk.parent)) {
        if(fk.child_schema==='supabase_migrations' && fk.child==='erp_test_stock_fixtures') continue;
        assert(fk.child_schema==='public', "External dependency requires review: " + fk.child_schema + '.' + fk.child);
        if(!targets.has(fk.child)) {targets.add(fk.child);changed=true;}
      }
    }
    for(const table of targets) assert(!protectedTables.has(table), "Protected table in dependency closure: " + table);
    const targetNames=[...targets].sort();
    const fixtureExists=Boolean((await tx`select to_regclass('supabase_migrations.erp_test_stock_fixtures') rel`)[0].rel);
    if(write) {
      // Stable full snapshot; no other app writer can change rows during reset.
      await tx.unsafe('lock table ' + tables.map(t=>'public.'+quote(t)).join(',')+' in access exclusive mode');
      if(fixtureExists) await tx.unsafe('lock table supabase_migrations.erp_test_stock_fixtures in access exclusive mode');
    }
    const before={};
    for(const table of tables) before[table]=(await tx.unsafe('select to_jsonb(t)::text value from public.'+quote(table)+' t order by to_jsonb(t)::text')).map(r=>JSON.parse(r.value));
    const plan=targetNames.map(table=>({table,rows:before[table].length}));
    const fixtureRows=fixtureExists?(await tx`select to_jsonb(t)::text value from supabase_migrations.erp_test_stock_fixtures t order by legacy_id`).map(r=>JSON.parse(r.value)):[];
    if(fixtureExists) plan.push({table:'supabase_migrations.erp_test_stock_fixtures',rows:fixtureRows.length});
    const migrationLedger=await tx`select md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by filename),'')) digest from supabase_migrations.erp_execution_history t`;
    const authBefore=await tx`select count(*)::int n,md5(coalesce(string_agg(md5(to_jsonb(u)::text),',' order by id),'')) digest from auth.users u`;
    const catalog=async()=>({
      columns:await tx`select * from information_schema.columns where table_schema='public' order by table_name,ordinal_position`,
      functions:await tx`select p.oid::text id,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' order by p.oid`,
      tables:await tx`select c.oid::text id,c.relname,c.relacl::text acl,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.oid`,
      triggers:await tx`select t.oid::text id,pg_get_triggerdef(t.oid) definition,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by t.oid`,
      constraints:await tx`select k.oid::text id,pg_get_constraintdef(k.oid) definition from pg_constraint k join pg_namespace n on n.oid=k.connamespace where n.nspname='public' order by k.oid`,
      policies:await tx`select * from pg_policies where schemaname='public' order by tablename,policyname`,
      sequences:await tx`select * from pg_sequences where schemaname='public' order by sequencename`,
    });
    const schemaBefore=await catalog();
    const owners=await tx`select p.id from public.profiles p join public.user_roles r on r.user_id=p.id where p.active and r.role_key='owner' order by p.id`;
    assert(owners.length>0,"Active Owner required");
    const unresolved=before.domain_reconciliation.filter(r=>!r.resolved_at && targets.has(r.legacy_table));
    const report={id:maintenanceId,at:new Date().toISOString(),applied:false,plan,
      zero_legacy_material_balances:before.materials.filter(r=>Number(r.qty_on_hand)!==0).length,
      zero_listing_variant_quantities:before.listing_variants.filter(r=>Number(r.qty)!==0).length,
      resolve_removed_test_record_assessments:unresolved.length,
      catalog_and_users_preserved:true,existing_audit_retained:true};
    if(!write) return report;
    await fs.mkdir(privateDirectory,{recursive:true});
    const backup={format:"maqdooms-public-data-snapshot-v1",maintenanceId,created_at:report.at,rows:before,test_stock_fixture_metadata:fixtureRows,catalog:schemaBefore,auth_fingerprint:authBefore,migration_ledger_fingerprint:migrationLedger};
    const serialized=JSON.stringify(backup);
    const backupPath=path.join(privateDirectory,'public-data-before-reset.json');
    await fs.writeFile(backupPath,serialized,{flag:'wx',mode:0o600});
    const disk=await fs.readFile(backupPath,'utf8');
    assert.equal(hash(JSON.parse(disk)),hash(backup),"Backup read-back mismatch");
    report.backup_path=backupPath;
    report.backup_sha256=createHash('sha256').update(disk).digest('hex');
    await tx`select set_config('request.jwt.claim.sub',${owners[0].id},true)`;
    // Single explicit RESTRICT list: FK changes cannot silently expand reset scope.
    await tx.unsafe('truncate table '+[...targetNames.map(t=>'public.'+quote(t)),...(fixtureExists?['supabase_migrations.erp_test_stock_fixtures']:[])].join(',')+' continue identity restrict');
    await tx`update public.materials set qty_on_hand=0 where qty_on_hand<>0`;
    await tx`update public.listing_variants set qty=0 where qty<>0`;
    if(unresolved.length) await tx`update public.domain_reconciliation set resolved_at=clock_timestamp(),resolved_by=${owners[0].id},resolution=${'Owner-authorized test-stock reset '+maintenanceId+': linked test record removed; not a reconstructed job classification.'} where id in ${tx(unresolved.map(r=>r.id))} and resolved_at is null`;
    await tx`insert into public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference) values(${owners[0].id},'test_stock_reset','test_stock_maintenance',${maintenanceId},${tx.json({counts:plan})},${tx.json({stock_empty:true,accounts_preserved:true,backup_sha256:report.backup_sha256,execution:'administrative database maintenance by Codex at human request'})},${'Explicit owner-authorized reset of existing test stock and linked test transactions'})`;
    for(const table of tables) {
      const after=(await tx.unsafe('select to_jsonb(t)::text value from public.'+quote(table)+' t order by to_jsonb(t)::text')).map(r=>JSON.parse(r.value));
      if(targets.has(table)) assert.equal(after.length,0,'Target not empty: '+table);
      else if(!mutablePreserved.has(table)) assert.deepEqual(after,before[table],'Preserved table changed: '+table);
      else if(table==='erp_audit_records') {
        const ids=new Map(after.map(r=>[r.id,r]));
        for(const row of before[table]) assert.deepEqual(ids.get(row.id),row,'Audit history rewritten');
      } else {
        const ids=new Map(after.map(r=>[r.id,r]));
        assert.equal(after.length,before[table].length,'Preserved row removed: '+table);
        for(const row of before[table]) {
          const a={...ids.get(row.id)},b={...row};
          if(table==='materials'){assert.equal(Number(a.qty_on_hand),0);delete a.qty_on_hand;delete b.qty_on_hand;}
          if(table==='listing_variants'){assert.equal(Number(a.qty),0);delete a.qty;delete b.qty;}
          if(table==='domain_reconciliation' && unresolved.some(r=>r.id===row.id)) {
            assert(a.resolved_at && a.resolved_by===owners[0].id && a.resolution.includes(maintenanceId));
            for(const k of ['resolved_at','resolved_by','resolution']){delete a[k];delete b[k];}
          }
          assert.deepEqual(a,b,'Unexpected preserved row change: '+table);
        }
      }
    }
    assert.deepEqual(await catalog(),schemaBefore,'Schema, permissions or sequences changed');
    assert.deepEqual(await tx`select md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by filename),'')) digest from supabase_migrations.erp_execution_history t`,migrationLedger,'Migration history changed');
    if(fixtureExists) assert.equal(Number((await tx`select count(*) n from supabase_migrations.erp_test_stock_fixtures`)[0].n),0,'Old test fixture metadata remains');
    assert.deepEqual(await tx`select count(*)::int n,md5(coalesce(string_agg(md5(to_jsonb(u)::text),',' order by id),'')) digest from auth.users u`,authBefore,'Login accounts changed');
    assert.deepEqual((await tx`select public.workshop_fabric_inventory() rows`)[0].rows,[], 'Workshop inventory not empty');
    report.applied=true;report.verified_at=new Date().toISOString();
    if(rehearse) {
      const rollback=new Error('Intentional rehearsal rollback');
      rollback.rehearsalReport={...report,applied:false,rehearsal_passed:true,rolled_back:true};
      throw rollback;
    }
    return report;
  });
  if(apply) {
    committed = true;
    result.committed_at=new Date().toISOString();
    await fs.writeFile(path.join(privateDirectory,'reset-result.json'),JSON.stringify(result,null,2),{mode:0o600});
  }
  console.log(JSON.stringify(result,null,2));
} catch(error) {
  if(error.rehearsalReport) {
    console.log(JSON.stringify(error.rehearsalReport,null,2));
    await fs.writeFile(path.join(privateDirectory,'rehearsal-result.json'),JSON.stringify(error.rehearsalReport,null,2),{mode:0o600});
  } else {
  console.error(JSON.stringify({code:error.code,message:error.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[REDACTED]'),transaction_rolled_back:!committed,committed}));
  process.exitCode=1;
  }
} finally {await sql.end();}
