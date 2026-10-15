import {randomUUID} from 'node:crypto';
export async function definitionRemovalCases({q,one,denied,login,users,check}){
 await login(users.owner);
 const floor=await one("select manage_showroom_location(null,$1,'Delete acceptance empty floor',true)",['DEL-'+randomUUID()]);
 const product=await one("select manage_production_catalog($1,'product',null,$2,'Delete acceptance product',true,null,'Disposable definition')",[randomUUID(),'DEL-'+randomUUID()]);
 const design=await one("select manage_production_catalog($1,'design',null,$2,'Delete acceptance design',true,50000,'Disposable definition')",[randomUUID(),'DEL-'+randomUUID()]);
 const api='select owner_delete_definition($1,$2,$3,$4,$5)';
 await denied(api,[randomUUID(),'product',product,'Stale name',true]);
 check((await one('select owner_production_catalog()')).products.some(p=>p.id===product),'Stale delete preserves current definition');
 const rooms=await one('select owner_location_summary()');const root=rooms.find(l=>l.kind==='showroom');const stocked=rooms.find(l=>l.kind==='showroom_sublocation'&&l.fabric_thaans>0);
 check(root&&stocked,'General Showroom and stocked floors are visible together');
 await denied(api,[randomUUID(),'floor',root.id,root.name,root.active]);
 await denied(api,[randomUUID(),'floor',stocked.id,stocked.name,stocked.active]);
 for(const [kind,id,name] of [['floor',floor,'Delete acceptance empty floor'],['product',product,'Delete acceptance product'],['design',design,'Delete acceptance design']]){
  const request=randomUUID();check(await one(api,[request,kind,id,name,true])===id,'Owner deletes '+kind+' from future work');check(await one(api,[request,kind,id,name,true])===id,'Exact deletion retry is idempotent');
  await denied(api,[request,kind,id,name+' changed',true]);
 }
 const locationRows=await q('select * from inventory_locations()');check(!locationRows.some(l=>l.id===floor),'Deleted floor absent from all location pickers');
 const catalog=await one('select owner_production_catalog()');check(!catalog.products.some(p=>p.id===product)&&!catalog.designs.some(d=>d.id===design),'Deleted products/designs absent from administration');
 const work=await one('select tailoring_work_catalog()');check(!work.products.some(p=>p.id===product)&&!work.designs.some(d=>d.id===design),'Deleted definitions cannot be chosen for new work');
 await denied('select manage_showroom_location($1,$2,$3,true)',[floor,'ANY','Reactivated floor']);
 await denied("select manage_production_catalog($1,'product',$2,$3,'Reactivated product',true,null,'Attempted revival')",[randomUUID(),product,'ANY']);
 await login(null);check(await one('select count(*) from locations where id=$1',[floor])===1&&await one('select count(*) from products where id=$1',[product])===1&&await one('select count(*) from designs where id=$1',[design])===1,'Definition identity rows retained for references');check(await one('select count(*) from design_charge_versions where design_id=$1',[design])===1,'Recorded design charge history retained');
 const used=(await q('select p.id,p.name,p.active,j.id job from products p join production_jobs j on j.product_id=p.id where p.active limit 1'))[0];
 await login(users.owner);const prior=await one('select production_job_document($1)',[used.job]);await one(api,[randomUUID(),'product',used.id,used.name,used.active]);const after=await one('select production_job_document($1)',[used.job]);check(after.product===prior.product&&after.quantity===prior.quantity&&after.cp_total_paise===prior.cp_total_paise,'Deleting a used product preserves existing production identity, quantity and CP');
 const activity=await one('select stock_activity(200,null,null,null)');check(activity.every(r=>r.source!=='Showroom'&&r.destination!=='Showroom'),'Root Showroom history explicitly identifies unassigned floor');
 for(const role of ['stock_entry','counter','production','tailor','salesperson','ecommerce_manager']){await login(users[role]);await denied(api,[randomUUID(),'floor',floor,'Delete acceptance empty floor',true]);await denied('select owner_location_summary()');check(await one('select count(*) from owner_definition_deletions')===0,'Staff cannot inspect deletion history');}
 await login(users.production);const staffCatalog=await one('select owner_production_catalog()');check(!staffCatalog.products.some(p=>p.id===product)&&!staffCatalog.designs.some(d=>d.id===design),'Existing staff catalogue also excludes deleted definitions');
 await login(null);await denied('update owner_definition_deletions set actor_id=$1',[users.owner]);await q('set role anon');await denied(api,[randomUUID(),'product',product,'Delete acceptance product',true]);await login(null);
}
