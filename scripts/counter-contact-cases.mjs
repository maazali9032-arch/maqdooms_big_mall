import {randomUUID} from 'node:crypto';
export async function counterContactCases({db,q,one,denied,login,users,check,migration}){
 await login(null);
 const tables=await q("select tablename from pg_tables where schemaname='public' order by tablename");
 const snapshot=async()=>{const rows={};for(const {tablename} of tables)rows[tablename]=await q(`select to_jsonb(t) row from public."${tablename}" t order by to_jsonb(t)::text`);return JSON.stringify(rows);};
 const before=await snapshot();
 const legacy=(await q("select request_id,order_id,payload from counter_bills where actor_id=$1 and payload->>'contact' like '% %' limit 1",[users.counter]))[0];
 check(!!legacy,'Historical formatted-contact request is available for retry');
 await db.exec(migration);
 check(before===await snapshot(),'Contact validation preserves every pre-existing public row');
 const stock=(await q("select i.id,l.id floor from inventory_items i join thaans t on t.id=i.thaan_id join locations l on l.kind='showroom_sublocation' and l.active where t.status='active' and inventory_balance(i.id,l.id)>1000 limit 1"))[0];
 check(!!stock,'A physical floor has stock for disposable contact tests');
 const call='select complete_counter_bill($1,$2,$3::jsonb,$4::jsonb,$5,$6,null,$7,$8)';
 const items=JSON.stringify([{kind:'fabric',inventory_item_id:stock.id,quantity:100,sp_paise_per_m:1000}]);
 for(const contact of ['letters','987a321','98 76','+919876']){
  await login(null);const prior=await snapshot();await login(users.counter);
  let rejected=false;try{await one(call,[randomUUID(),stock.floor,items,'[]',true,users.salesperson,'Contact validation fixture',contact]);}catch(e){rejected=e.message.includes('digits only');}
  check(rejected,'Backend rejects nondigit contact: '+contact);
  await login(null);check(prior===await snapshot(),'Invalid contact leaves no customer, bill, stock, cost or audit write');
 }
 await login(users.counter);
 const receipts=[];
 for(const contact of ['009876543210','009876543210',null,'']){
  const request=randomUUID();const args=[request,stock.floor,items,'[]',true,users.salesperson,null,contact];
  const bill=await one(call,args);check(await one(call,args)===bill,'Digit or optional contact bill retry stays idempotent');
  receipts.push(await one('select counter_bill($1)',[bill]));
 }
 check(receipts[0].customer.phone==='009876543210','Leading zeros are preserved');
 await login(null);
 check(await one('select count(distinct customer_id) from orders where id=any($1::uuid[])',[receipts.slice(0,2).map(r=>r.id)])===1,'A saved numeric contact is reused');
 check(receipts.slice(2).every(r=>!r.customer.phone),'Contact remains optional');
 await login(users.counter);const p=legacy.payload;
 check(await one(call,[legacy.request_id,p.source,JSON.stringify(p.items),JSON.stringify(p.tailoring),p.paid,p.salesperson,p.name,p.contact])===legacy.order_id,'Exact historical formatted-contact retry returns its original bill');
 await login(null);check(!await one("select has_function_privilege('anon','guard_counter_contact_digits()','EXECUTE')"),'Anonymous trigger execution grant remains closed');
 for(const role of ['stock_entry','production','tailor','salesperson','ecommerce_manager']){await login(users[role]);await denied(call,[randomUUID(),stock.floor,items,'[]',true,users.salesperson,null,'009876543210']);}
 await login(null);
}
