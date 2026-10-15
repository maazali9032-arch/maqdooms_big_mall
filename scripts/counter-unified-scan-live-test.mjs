/** Existing-record acceptance only. No stock, bill or role writes. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import postgres from 'postgres';
process.loadEnvFile('.env');
const sql=postgres(process.env.LOVABLE_DB_MIGRATION_URL,{ssl:'require',max:1,connect_timeout:15,onnotice:()=>{}});
let checks=0;const check=(v,label)=>{assert(v,label);checks++;};
try{
 const users=await sql`select p.id,array_agg(r.role_key) roles from profiles p join user_roles r on r.user_id=p.id where p.active group by p.id`;
 const counter=users.find(u=>u.roles.includes('counter')&&!u.roles.includes('owner'));
 check(!!counter,'An existing Counter account is available');
 const floor=(await sql`select id from locations where active and kind='showroom_sublocation' order by code limit 1`)[0];
 check(!!floor,'A defined physical floor exists');
 const read=(id,query,args=[])=>sql.begin(async tx=>{await tx.unsafe('set transaction read only');await tx`select set_config('request.jwt.claim.sub',${id??''},true)`;await tx.unsafe('set local role authenticated');return (await tx.unsafe(query,args))[0]?.result;});
 for(const [query,args,expected] of [
  ['select counter_scan_barcode($1,$2) result',['__UNKNOWN_COUNTER_SCAN__',floor.id],null],
  ['select counter_bill($1) result',['__UNKNOWN_COUNTER_SCAN__'],null],
  ['select customer_tailoring_work($1) result',['__UNKNOWN_COUNTER_SCAN__'],[]],
  ['select production_job_document($1) result',['__UNKNOWN_COUNTER_SCAN__'],null],
 ])check(JSON.stringify(await read(counter.id,query,args))===JSON.stringify(expected),'Unknown identity remains unmatched in the existing resolver path');
 const bills=await sql`select o.code from orders o join counter_bills b on b.order_id=o.id order by o.created_at desc limit 5`;
 for(const {code} of bills){const receipt=await read(counter.id,'select counter_bill($1) result',[code]);const jobs=await read(counter.id,'select customer_tailoring_work($1) result',[code]);check(receipt?.code===code,'Existing bill is loadable by its printed barcode');check(jobs.every(j=>j.bill_id===receipt.id&&j.cp_paise==null),'Tailoring jobs link to the bill and do not expose CP to Counter');}
 const productions=await sql`select code from production_jobs order by created_at desc limit 5`;
 for(const {code} of productions){const doc=await read(counter.id,'select production_job_document($1) result',[code]);check(doc?.code===code&&doc.cp_total_paise==null,'Counter loads existing Production ID with protected CP');}
 const [stock]=await sql`select coalesce(v.code,t.barcode,b.code) barcode,l.id floor from inventory_items i join thaans t on t.id=i.thaan_id join fabric_stock s on s.id=t.fabric_stock_id join barcodes b on b.id=s.barcode_id left join stock_registration_variants v on v.thaan_id=t.id join locations l on l.kind='showroom_sublocation' and l.active where inventory_balance(i.id,l.id)>0 limit 1`;
 if(stock){const item=await read(counter.id,'select counter_scan_barcode($1,$2) result',[stock.barcode,stock.floor]);check(item?.kind==='fabric'&&item.barcode===stock.barcode,'Existing physical Thaan is recognized on its recorded floor');}
 for(const u of users.filter(u=>!u.roles.includes('owner')&&!u.roles.includes('counter'))){let blocked=false;try{await read(u.id,'select counter_scan_barcode($1,$2) result',['__UNKNOWN_COUNTER_SCAN__',floor.id]);}catch{blocked=true;}check(blocked,'Other staff cannot use Counter barcode lookup');}
 await fs.writeFile('docs/COUNTER_UNIFIED_SCAN_LIVE_VERIFICATION.json',JSON.stringify({verified_at:new Date().toISOString(),passed:true,checks,read_only_transactions:true,existing_bills_checked:bills.length,existing_productions_checked:productions.length,live_writes:false},null,2)+'\n');
 console.log('PASS: '+checks+' read-only Counter acceptance checks');
}finally{await sql.end();}
