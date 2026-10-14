/** Read-only post-commit verification; no fixture creation or business writes. */
import postgres from "postgres";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
process.loadEnvFile(".env");
const sql=postgres(process.env.LOVABLE_DB_MIGRATION_URL,{ssl:"require",max:1,connect_timeout:15,onnotice:()=>{}});
try {
  const proof=await sql.begin("read only",async tx=>{
    const owner=(await tx`select p.id from public.profiles p join public.user_roles r on r.user_id=p.id where p.active and r.role_key='owner' order by p.id limit 1`)[0];
    assert(owner,"Owner login preserved");
    await tx`select set_config('request.jwt.claim.sub',${owner.id},true)`;
    const counts=(await tx`select (select count(*) from public.thaans)::int thaans,(select count(*) from public.receiving_batches)::int batches,(select count(*) from public.sales)::int sales,(select count(*) from public.tailoring_jobs)::int tailoring_jobs,(select count(*) from public.online_orders)::int online_orders,(select count(*) from public.inventory_movements)::int inventory_movements,(select count(*) from public.profiles)::int staff_accounts,(select count(*) from public.customers)::int customers,(select count(*) from public.suppliers)::int suppliers,(select count(*) from public.locations)::int locations,(select count(*) from public.audit_log)::int legacy_audit,(select count(*) from public.erp_audit_records)::int audit_records,(select count(*) from public.domain_reconciliation where resolved_at is null)::int unresolved_legacy,(select coalesce(sum(qty_on_hand),0) from public.materials)::text material_stock,(select coalesce(sum(qty),0) from public.listing_variants)::text listing_variant_stock`)[0];
    for(const key of ['thaans','batches','sales','tailoring_jobs','online_orders','inventory_movements','unresolved_legacy','material_stock','listing_variant_stock']) assert.equal(Number(counts[key]),0,'Unexpected live value: '+key);
    assert.equal(counts.staff_accounts,6);assert.equal(counts.customers,4);assert.equal(counts.suppliers,6);assert.equal(counts.locations,4);assert.equal(counts.legacy_audit,24);assert(counts.audit_records>=436);
    await tx.unsafe('set local role authenticated');
    const stock=(await tx`select public.workshop_fabric_inventory() rows`)[0].rows;
    assert.equal(stock.length,0);
    const catalog=(await tx`select public.stock_registration_catalog() data`)[0].data;
    assert(Array.isArray(catalog),'Expected registration batch array');
    assert.equal(catalog.length,0);
    return {verified_at:new Date().toISOString(),counts,workshop_rows:stock.length,stock_catalog_batch_count:catalog.length,passed:true};
  });
  await fs.writeFile('docs/TEST_STOCK_RESET_VERIFICATION.json',JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify(proof));
}catch(error){console.error(JSON.stringify({code:error.code,message:error.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[REDACTED]')}));process.exitCode=1;}finally{await sql.end();}
