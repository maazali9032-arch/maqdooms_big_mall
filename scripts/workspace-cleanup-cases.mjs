import { randomUUID } from "node:crypto";
export async function workspaceCleanupCases({q,one,denied,login,users,check}) {
  await login(users.stock_entry);
  const batch=await one("select create_barcode_batch_with_details($1,'Cleanup Provider','2026-10-15',null,$2::jsonb)",[randomUUID(),JSON.stringify([{name:'Cotton',quantity:2,rows:[{length_mm:10000,cp_paise_per_m:30000},{length_mm:9000,cp_paise_per_m:30000}]}])]);
  const variants=(await one('select stock_registration_catalog($1)',[batch]))[0].fabric_types[0].variants;
  await login(null);
  const stock=(await q("select i.id,l.id source from inventory_items i cross join locations l where i.thaan_id=$1 and l.kind='workshop'",[variants[0].thaan_id]))[0];
  await login(users.owner);
  const showroom=await one("select manage_showroom_location(null,$1,'Cleanup Showroom Floor',true)",['CLEAN-'+randomUUID()]);
  await login(users.stock_entry);
  const request=randomUUID(),payload=JSON.stringify([{inventory_item_id:stock.id,quantity:2000}]);
  const transfer=await one('select post_inventory_transfer($1,$2,$3,$4::jsonb,null)',[request,stock.source,showroom,payload]);
  check(await one("select post_inventory_transfer($1,$2,$3,$4::jsonb,'')",[request,stock.source,showroom,payload])===transfer,'Blank optional transfer note has identical retry semantics');
  const history=await one('select stock_activity(200,null,null,$1)',[variants[0].code]);
  check(history.some(r=>r.kind==='TRANSFER'&&r.source==='Workshop'&&r.destination==='Cleanup Showroom Floor'&&Number(r.quantity)===2000),'Actual transfer visible in current stock history');
  check(history.every(r=>r.barcode===variants[0].code),'History search retains exact barcode identity');
  check(!JSON.stringify(history).includes('cp_paise'),'Stock activity exposes no costs');
  const first=await one('select stock_activity(1,null,null,null)');
  const next=await one('select stock_activity(1,$1,$2,null)',[first[0].occurred_at,first[0].id]);
  check(next[0].id!==first[0].id,'Stock activity cursor advances');
  await denied('select stock_activity(201,null,null,null)');
  await denied('select stock_activity(50,now(),null,null)');
  for(const role of ['counter','production','tailor','salesperson','ecommerce_manager']) {await login(users[role]);await denied('select stock_activity()');await denied('select fabric_inventory_archive()');}
  await login(users.owner);check(Array.isArray(await one('select fabric_inventory_archive()')),'Owner archive read available');
  await login(null);await q('set role anon');await denied('select stock_activity()');await denied('select fabric_inventory_archive()');await login(null);
}
