import {randomUUID} from 'node:crypto';

export async function showroomFloorsOnlyCases({db,q,one,denied,login,users,check,migration}) {
 await login(null);
 const tables=await q("select tablename from pg_tables where schemaname='public' order by tablename");
 const snapshot=async()=>{
  const result={};
  for(const {tablename} of tables) result[tablename]=await q(`select to_jsonb(t) row from public."${tablename}" t order by to_jsonb(t)::text`);
  return JSON.stringify(result);
 };
 const before=await snapshot();
 const root=await one("select id from locations where kind='showroom'");
 const workshop=await one("select id from locations where kind='workshop'");
 const priorHistory=JSON.stringify(await q('select * from inventory_movements where source_location_id=$1 or destination_location_id=$1 order by id',[root]));
 await db.exec(migration);
 check(before===await snapshot(),'Floor-only migration preserves every row in every public table');
 check(await one('select active from locations where id=$1',[root]),'Internal parent stays active for existing and future floors');
 check(priorHistory===JSON.stringify(await q('select * from inventory_movements where source_location_id=$1 or destination_location_id=$1 order by id',[root])),'Unassigned historical movements are unchanged');
 await login(users.owner);
 const floor=await one("select manage_showroom_location(null,$1,'New physical Showroom floor',true)",['FLOOR-'+randomUUID()]);
 check(await one('select parent_id from locations where id=$1',[floor])===root,'New floors still use the retained internal parent');
 check(!await one('select is_showroom_location($1)',[root])&&await one('select is_showroom_location($1)',[floor]),'Only physical floors qualify as saleable Showroom locations');
 for(const role of ['owner','stock_entry','counter','production','ecommerce_manager']){
  await login(users[role]);
  const rows=await q('select * from inventory_locations()');
  check(!rows.some(l=>l.id===root||l.kind==='showroom'),'No general Showroom option for '+role);
  if(role!=='ecommerce_manager')check(rows.some(l=>l.id===floor&&l.active)&&rows.some(l=>l.id===workshop&&l.active),'Physical floors and Workshop remain available for '+role);
  else check(!rows.some(l=>l.id===workshop),'E-commerce gains no Workshop visibility');
 }
 await login(users.owner);
 const summary=await one('select owner_location_summary()');
 check(!summary.some(l=>l.kind==='showroom')&&summary.some(l=>l.id===floor),'Administration lists physical floors without general Showroom');
 await login(null);
 const item=(await q("select i.id,i.thaan_id,i.unit,t.fabric_stock_id from inventory_items i join thaans t on t.id=i.thaan_id where inventory_balance(i.id,$1)>10 limit 1",[workshop]))[0];
 check(!!item,'Populated Workshop fabric fixture available');
 await login(users.owner);
 const transfer='select post_inventory_transfer($1,$2,$3,$4::jsonb,null)';
 const payload=JSON.stringify([{inventory_item_id:item.id,quantity:1}]);
 const beforeDenied=await one('select count(*) from inventory_movements');
 try{await one(transfer,[randomUUID(),workshop,root,payload]);check(false,'Root transfer unexpectedly succeeded');}catch(e){check(e.message.includes('General Showroom is unavailable'),'Backend rejects Owner transfer to general Showroom');}
 await denied("select record_inventory_correction($1,$2,'ADJUSTMENT',1,true,'No general location')",[item.id,root]);
 check(await one('select count(*) from inventory_movements')===beforeDenied,'Denied root operations post no stock movement');
 const request=randomUUID();
 const result=await one(transfer,[request,workshop,floor,payload]);
 check(await one(transfer,[request,workshop,floor,payload])===result,'Physical floor transfer and exact retry still work');
 await login(null);
 check(Number(await one('select inventory_balance($1,$2)',[item.id,floor]))===1,'Physical floor receives the selected amount once');
 await login(users.counter);
 await denied('select counter_scan_barcode($1,$2)',['any-barcode',root]);
 await login(null);
 const beforeRaw=await one('select count(*) from inventory_movements');
 await denied("insert into inventory_movements(kind,inventory_item_id,thaan_id,fabric_stock_id,quantity,unit,destination_location_id,reason,actor_id)values('INWARD',$1,$2,$3,1,'mm',$4,'Invalid root receipt',$5)",[item.id,item.thaan_id,item.fabric_stock_id,root,users.owner]);
 check(await one('select count(*) from inventory_movements')===beforeRaw,'Ledger trigger also blocks direct root receipts');
 const piece=(await q("select p.id,p.current_location_id floor from finished_products p join locations l on l.id=p.current_location_id join inventory_items i on i.finished_product_id=p.id where p.status='available' and l.kind='showroom_sublocation' and l.active and inventory_balance(i.id,l.id)=1 limit 1"))[0];
 check(!!piece,'Available finished-piece fixture on a physical floor');
 const movePiece='select transfer_finished_products($1,$2,$3,$4::jsonb,null)';
 await login(users.stock_entry);
 await denied(movePiece,[randomUUID(),piece.floor,workshop,JSON.stringify([piece.id])]);
 await login(users.owner);
 await one(movePiece,[randomUUID(),piece.floor,workshop,JSON.stringify([piece.id])]);
 check(await one('select current_location_id from finished_products where id=$1',[piece.id])===workshop,'Owner returns finished piece directly from floor to Workshop');
 await denied(movePiece,[randomUUID(),workshop,root,JSON.stringify([piece.id])]);
 await login(users.stock_entry);
 await one(movePiece,[randomUUID(),workshop,piece.floor,JSON.stringify([piece.id])]);
 await login(users.owner);
 check(await one('select current_location_id from finished_products where id=$1',[piece.id])===piece.floor,'Stock staff can still transfer a priced piece directly to its floor');
 await login(users.owner);
 const inactive=await one("select manage_showroom_location(null,$1,'Inactive floor',false)",['OFF-'+randomUUID()]);
 await denied(transfer,[randomUUID(),workshop,inactive,payload]);
 await login(users.counter);await denied('select owner_location_summary()');
 await login(null);await q('set role anon');await denied('select owner_location_summary()');await denied('select counter_scan_barcode($1,$2)',['any',floor]);await login(null);
}
