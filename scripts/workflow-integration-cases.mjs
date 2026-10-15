import {randomUUID} from 'node:crypto';
export async function workflowIntegrationCases({q,one,denied,login,users,check}){
 await login(users.owner);
 const factory=await one("select manage_tailoring_entity($1,'factory',null,$2,'Owner Shared Factory',true,null,null,'Disposable definition')",[randomUUID(),'OWF-'+randomUUID()]);
 const request=randomUUID();const assigned=await one('select owner_assign_factory_user($1,$2,$3,null)',[request,users.other_stock,factory]);
 check(assigned===await one('select owner_assign_factory_user($1,$2,$3,null)',[request,users.other_stock,factory]),'Owner existing-user factory assignment retries exactly once');
 const choices=await one('select tailoring_assignment_options()');check(choices.some(a=>a.id===assigned&&a.factory_id===factory),'Single shared definition appears in work choices');
 check((await one('select owner_factory_users()')).some(u=>u.id===users.other_stock&&u.roles.includes('stock_entry')&&u.roles.includes('tailor')),'Explicit Owner assignment retains previous role and adds Tailor');
 for(const role of ['counter','stock_entry','production','tailor','salesperson','ecommerce_manager']){await login(users[role]);await denied('select owner_factory_users()');await denied('select owner_assign_factory_user($1,$2,$3,null)',[randomUUID(),users.other_stock,factory]);}
 await login(null);
 const job=(await q('select d.job_id,d.bill_id,o.code,i.source_location_id,line.thaan_id,v.code barcode from counter_tailoring_details d join orders o on o.id=d.bill_id join material_issues i on i.customer_tailoring_job_id=d.job_id join material_issue_lines line on line.material_issue_id=i.id join stock_registration_variants v on v.thaan_id=line.thaan_id order by i.issued_at limit 1'))[0];
 await login(users.owner);
 let facts=(await one("select owner_erp_report('sales_lines',null,null,null,200)")).rows.find(r=>r.data.order_id===job.bill_id&&r.data.kind==='customer_tailoring');const oldCP=BigInt(facts.data.cost_paise),oldMargin=BigInt(facts.data.margin_paise);
 await login(users.counter);await one('select issue_additional_customer_fabric($1,$2,$3,$4,500)',[randomUUID(),job.job_id,job.source_location_id,job.barcode]);
 await login(users.owner);facts=(await one("select owner_erp_report('sales_lines',null,null,null,200)")).rows.find(r=>r.data.order_id===job.bill_id&&r.data.kind==='customer_tailoring');
 check(BigInt(facts.data.cost_paise)>oldCP&&BigInt(facts.data.margin_paise)<oldMargin,'Paid original job margin follows later captured fabric CP');
 const work=(await one('select customer_tailoring_work($1)',[job.code]))[0];check(work.fabrics.length>=3&&work.created_at&&work.cp_paise===facts.data.cost_paise,'Work page exposes all actual issues and current recorded CP');
 const report=(await one("select owner_erp_report('customer_tailoring',null,null,null,200)")).rows.find(r=>r.data.id===job.job_id);check(report.data.fabric_cp_total_paise===work.cp_paise,'Customer job report and paid-line report reconcile CP');
 let result=await one('select owner_barcode_inspect($1,null,null,100)',[job.code]);const events=[...result.events,...result.undated_records];
 check(result.items.some(i=>i.barcode===job.barcode),'Inspector follows combined-bill tailoring cuts');check(events.some(e=>e.source==='counter_bill_payments')&&events.some(e=>e.source==='customer_issue_fabric_costs'),'Inspector includes recorded payment and additional-issue CP evidence');
 await login(users.counter);check((await one('select customer_tailoring_work($1)',[job.code]))[0].cp_paise===null,'Counter work projection protects CP');await denied('select customer_job_fabric_cp($1)',[job.job_id]);await denied('select owner_barcode_inspect($1,null,null,100)',[job.code]);await denied('select workshop_receipt_queue()');
 await login(users.salesperson);const workRows=await one('select salesperson_work(null,null,null,200)');const credited=workRows.find(r=>r.id===job.bill_id);check(credited&&credited.tailoring_jobs.some(j=>j.code===work.code)&&!workRows.some(r=>r.job_id===job.job_id),'Salesperson sees own combined bill once with linked job progress');check(!JSON.stringify(workRows).includes('cp_paise'),'Salesperson work never exposes CP');
 await login(users.stock_entry);check(Array.isArray(await one('select workshop_receipt_queue()')),'Stock Entry can see whole-batch Workshop receipt queue');
 await login(users.production);check((await one('select ongoing_production_work()')).every(j=>['open','in_progress'].includes(j.status)),'Ongoing production reads active jobs independently of finished history');
 await login(null);
}
