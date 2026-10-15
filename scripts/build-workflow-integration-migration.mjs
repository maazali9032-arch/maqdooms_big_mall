import fs from 'node:fs/promises';
import {functionSQL,mirrorMigration} from './workflow-sql.mjs';
let projection=await functionSQL('supabase/migrations/20261014000000_role_workspaces.sql','production_fabric_projection');
projection=projection.replace("'id',l.id,'name',l.name,'quantity_mm'","'id',l.id,'name',l.name,'kind',l.kind,'parent_id',l.parent_id,'quantity_mm'");
let salesperson=await functionSQL('supabase/migrations/20261011000200_salesperson_tailoring_pricing.sql','salesperson_work');
salesperson=salesperson.replace('j.id job_id,j.code job_code',`CASE WHEN o.kind='counter_bill' THEN EXISTS(SELECT 1 FROM public.counter_bill_payments WHERE bill_id=o.id) END paid,
 (SELECT jsonb_agg(jsonb_build_object('code',job.code,'garment',job.garment,'status',job.status,'delivery_date',detail.delivery_date,'factory',factory.name,'tailor',tailor.real_name) ORDER BY job.code) FROM public.counter_tailoring_details detail JOIN public.customer_tailoring_jobs job ON job.id=detail.job_id JOIN public.tailor_assignments assignment ON assignment.id=job.tailor_assignment_id JOIN public.tailoring_factories factory ON factory.id=assignment.factory_id JOIN public.tailors tailor ON tailor.id=assignment.tailor_id WHERE detail.bill_id=o.id) tailoring_jobs,
 j.id job_id,j.code job_code`);
salesperson=salesperson.replace("WHERE o.status='completed' AND", "WHERE o.status='completed' AND NOT(o.kind='customer_tailoring' AND EXISTS(SELECT 1 FROM public.counter_tailoring_details WHERE job_id=o.customer_tailoring_job_id)) AND");
let report=await functionSQL('supabase/migrations/20261015000400_counter_workspace.sql','owner_erp_report');
const ctStart=report.indexOf(" WHEN 'customer_tailoring' THEN");const ctEnd=report.indexOf(" WHEN 'configuration'",ctStart);
if(ctStart<0||ctEnd<0)throw Error('Customer report source missing');
report=report.slice(0,ctStart)+` WHEN 'customer_tailoring' THEN source_sql:=$q$
 SELECT d->>'id' row_key,(d->>'created_at')::timestamptz event_at,d||jsonb_build_object('fabric_cp_total_paise',d->>'cp_paise','final_customer_price_paise',d->>'total_paise','margin_paise',CASE WHEN d->>'cp_paise' IS NOT NULL AND d->>'total_paise' IS NOT NULL THEN ((d->>'total_paise')::bigint-(d->>'cp_paise')::bigint)::text END,'cost_basis','all_recorded_job_fabric_issues; excludes unrecorded labour') data FROM jsonb_array_elements(public.customer_tailoring_work()) d
 $q$;
`+report.slice(ctEnd);
report=report.replace("'product',p.name,'design',coalesce(d.name,j.custom_design),'factory'", "'product',public.production_job_document(j.id)->>'product','pieces',public.production_specifications(j.id),'design',public.production_job_document(j.id)->>'design','factory'");
report=report.replace("'design',coalesce(d.name,j.custom_design),'job',j.code", "'design',public.production_piece_context(p.id)->>'design','size',public.production_piece_context(p.id)->>'size','job',j.code");
let inspector=await functionSQL('supabase/migrations/20261015000200_barcode_inspector_legacy_evidence.sql','owner_barcode_inspect');
const jobIds="SELECT o.customer_tailoring_job_id FROM public.orders o WHERE o.id IN(SELECT id FROM root WHERE kind='order')";
inspector=inspector.replaceAll(jobIds,jobIds+" UNION SELECT customer_tailoring_job_id FROM public.order_items WHERE order_id IN(SELECT id FROM root WHERE kind='order')");
inspector=inspector.replace("OR o.customer_tailoring_job_id IN(SELECT id FROM selected_custom_jobs)","OR o.customer_tailoring_job_id IN(SELECT id FROM selected_custom_jobs) OR o.id IN(SELECT order_id FROM public.order_items WHERE customer_tailoring_job_id IN(SELECT id FROM selected_custom_jobs))");
inspector=inspector.replace("'design',coalesce(d.name,j.custom_design),'size',j.size", "'design',public.production_piece_context(p.id)->>'design','size',public.production_piece_context(p.id)->>'size'");
const additions=[
 ['counter_bills','order_id','created_at','actor_id',"order_id IN(SELECT id FROM selected_orders)",'Counter bill recorded'],
 ['counter_bill_payments','bill_id','paid_at','actor_id',"bill_id IN(SELECT id FROM selected_orders)",'Counter payment collected'],
 ['counter_tailoring_details','job_id','recorded_at',null,"job_id IN(SELECT id FROM selected_custom_jobs)",'Customer tailoring delivery and design'],
 ['customer_issue_fabric_costs','issue_line_id','recorded_at',null,"issue_line_id IN(SELECT id FROM public.material_issue_lines WHERE material_issue_id IN(SELECT id FROM selected_issues))",'Issue-time customer fabric CP'],
 ['production_piece_specs','production_job_id','recorded_at','recorded_by',"production_job_id IN(SELECT id FROM selected_jobs)",'Finished piece specification'],
];
const unions=additions.map(([table,id,time,actor,where,title])=>` SELECT '${table}:'||r.${id}${table==='production_piece_specs'?"||':'||r.piece_number":''} AS key,'${table}'::text AS source,r.${id} AS record_id,(to_jsonb(r)->>'${time}')::timestamptz AS event_at,${actor?`r.${actor}`:'NULL::uuid'} AS actor_id,'${title}'::text AS title,to_jsonb(r)${table==='counter_bills'?"-'payload'":''} AS data FROM public.${table} r WHERE ${where} UNION ALL\n`).join('');
inspector=inspector.replace(' ), records AS MATERIALIZED (',' ), records AS MATERIALIZED (\n'+unions);
await mirrorMigration('20261015000700','0049','workflow_integrations','BEGIN;\n'+projection+'\n'+salesperson+'\n'+await fs.readFile('scripts/workflow-integration-read.sql','utf8')+'\n'+report+'\n'+inspector+"\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n");
