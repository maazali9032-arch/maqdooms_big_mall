import fs from "node:fs/promises";
import { functionSQL,mirrorMigration } from "./workflow-sql.mjs";
const role='supabase/migrations/20261014000000_role_workspaces.sql';
let shared=await functionSQL(role,'create_owner_production_shared');
shared=shared.replace(' AND a.section_id IS NOT DISTINCT FROM first_assignment.section_id','').replace('selected Factory and Section','selected Factory');
let receipt=await functionSQL(role,'complete_production_batch');
receipt=receipt.replace('VALUES(p_job,job.product_id,job.design_id,n,barcode,workshop,\'available\')',"VALUES(p_job,coalesce((SELECT product_id FROM public.production_piece_specs WHERE production_job_id=p_job AND piece_number=n),job.product_id),CASE WHEN EXISTS(SELECT 1 FROM public.production_piece_specs WHERE production_job_id=p_job) THEN (SELECT design_id FROM public.production_piece_specs WHERE production_job_id=p_job AND piece_number=n) ELSE job.design_id END,n,barcode,workshop,'available')");
let context=await functionSQL(role,'production_piece_context');
context=context.replace("'size',j.size", "'size',coalesce(spec.size,j.size)").replace("coalesce(d.name,j.custom_design)","coalesce(d.name,spec.custom_design,j.custom_design)").replace('JOIN public.production_jobs j ON', 'LEFT JOIN public.production_piece_specs spec ON spec.production_job_id=p.production_job_id AND spec.piece_number=p.piece_number JOIN public.production_jobs j ON').replace('d.id=j.design_id','d.id=p.design_id');
let catalog=await functionSQL(role,'finished_product_catalog');
catalog=catalog.replace("'size',j.size", "'size',public.production_piece_context(f.id)->>'size'").replace('coalesce(d.name,j.custom_design)',"public.production_piece_context(f.id)->>'design'");
let document=await functionSQL(role,'production_job_document');
document=document.replace(' RETURN result;'," result:=result||jsonb_build_object('pieces',public.production_specifications(job.id),'mixed',EXISTS(SELECT 1 FROM public.production_piece_specs s WHERE s.production_job_id=job.id AND (s.product_id,s.design_id,s.custom_design,s.size) IS DISTINCT FROM (job.product_id,job.design_id,job.custom_design,job.size)));\n IF result->>'mixed'='true' THEN result:=result||jsonb_build_object('product','Mixed products / sizes','design','Per-piece specifications','size',NULL); END IF;\n RETURN result;");
let history=await functionSQL(role,'owner_production_history');
history=history.replace('public.owner_production_history(', 'public.production_history_base(');
history+='\nREVOKE ALL ON FUNCTION public.production_history_base(uuid,integer) FROM PUBLIC,anon,authenticated;\n';
const wrapper=`CREATE OR REPLACE FUNCTION public.owner_production_history(p_job uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(row_value || public.production_job_document(row_value->>'id')), '[]') FROM jsonb_array_elements(public.production_history_base(p_job,p_limit)) row_value;
$$;`;
let dims=await functionSQL('supabase/migrations/20261015000400_counter_workspace.sql','capture_sale_analysis_dimensions');
dims=dims.replace('coalesce(design.name,job.custom_design),job.size',"coalesce(public.production_piece_context(piece.id)->>'design',design.name,job.custom_design),public.production_piece_context(piece.id)->>'size'");
// Saved public-web/old-counter snapshots must describe the actual piece, not the job header.
const sales=[];
for(const [file,name] of [['supabase/migrations/20261014000100_owner_business_analytics.sql','submit_paid_ecommerce_order'],['supabase/migrations/20261011000200_salesperson_tailoring_pricing.sql','complete_finished_product_sale']]){
 let fn=await functionSQL(file,name);
 fn=fn.replace(/coalesce\(design.name,j.custom_design\)/g,"public.production_piece_context(piece.id)->>'design'")
 .replace(/coalesce\(design.name,job.custom_design\)/g,"public.production_piece_context(piece.id)->>'design'")
 .replace(/'size',j.size/g,"'size',public.production_piece_context(piece.id)->>'size'");
 sales.push(fn);
}
const sql='BEGIN;\n'+await fs.readFile('scripts/mixed-production-schema.sql','utf8')+'\n'+[shared,receipt,context,catalog,document,history,wrapper,dims,...sales].join('\n')+"\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n";
await mirrorMigration('20261015000500','0047','mixed_production',sql);
