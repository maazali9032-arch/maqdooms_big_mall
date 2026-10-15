import assert from 'node:assert/strict';
import {functionSQL,mirrorMigration} from './workflow-sql.mjs';
let bill=await functionSQL('supabase/migrations/20261015000400_counter_workspace.sql','complete_counter_bill');
const replace=(before,after)=>{assert(bill.includes(before),'Missing bill anchor '+before.slice(0,70));bill=bill.replace(before,after);};
replace('group_price bigint;','group_price bigint; fabric_amount numeric; stitching bigint; priced_cuts jsonb; plain_cuts jsonb; priced_cut jsonb;');
replace("  IF jsonb_typeof(row_value) IS DISTINCT FROM 'object' OR (row_value-ARRAY['items','garment','delivery_date','assignment_id','total_paise','notes','design_id','custom_design'])<>'{}' OR nullif(row_value->>'delivery_date','') IS NULL OR jsonb_typeof(row_value->'total_paise') IS DISTINCT FROM 'number' OR (row_value->>'total_paise')::numeric<>trunc((row_value->>'total_paise')::numeric) THEN RAISE EXCEPTION 'Tailoring garment, delivery date, assignment, fabric cuts and exact whole-job total required'; END IF;",`  IF NOT (row_value ? 'stitching_paise') THEN RAISE EXCEPTION 'Refresh POS: enter fabric prices and the separate stitching charge'; END IF;
  IF jsonb_typeof(row_value) IS DISTINCT FROM 'object' OR (row_value-ARRAY['items','garment','delivery_date','assignment_id','stitching_paise','notes','design_id','custom_design'])<>'{}' OR nullif(row_value->>'delivery_date','') IS NULL OR jsonb_typeof(row_value->'stitching_paise') IS DISTINCT FROM 'number' OR (row_value->>'stitching_paise')::numeric<>trunc((row_value->>'stitching_paise')::numeric) OR (row_value->>'stitching_paise')::numeric NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Tailoring garment, delivery date, assignment, priced fabric cuts and exact stitching charge required'; END IF;
  IF NOT public.has_perm(auth.uid(),'pos.enter_price') THEN RAISE EXCEPTION 'Fabric sale pricing permission required'; END IF;
  IF jsonb_typeof(row_value->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(row_value->'items') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'One to 100 priced fabric cuts required'; END IF;`);
replace("  group_price:=(row_value->>'total_paise')::bigint;",`  fabric_amount:=0; priced_cuts:='[]'; plain_cuts:='[]'; stitching:=(row_value->>'stitching_paise')::bigint;
  FOR priced_cut IN SELECT value FROM jsonb_array_elements(row_value->'items') LOOP
   IF jsonb_typeof(priced_cut) IS DISTINCT FROM 'object' OR (priced_cut-ARRAY['inventory_item_id','quantity','sp_paise_per_m'])<>'{}' OR nullif(priced_cut->>'inventory_item_id','') IS NULL OR jsonb_typeof(priced_cut->'quantity') IS DISTINCT FROM 'number' OR (priced_cut->>'quantity')::numeric<>trunc((priced_cut->>'quantity')::numeric) OR (priced_cut->>'quantity')::numeric NOT BETWEEN 1 AND 2147483647 OR jsonb_typeof(priced_cut->'sp_paise_per_m') IS DISTINCT FROM 'number' OR (priced_cut->>'sp_paise_per_m')::numeric<>trunc((priced_cut->>'sp_paise_per_m')::numeric) OR (priced_cut->>'sp_paise_per_m')::numeric NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Explicit fabric identity, exact millimetres and per-metre price required'; END IF;
   amount:=round((priced_cut->>'quantity')::numeric*(priced_cut->>'sp_paise_per_m')::numeric/1000);
   fabric_amount:=fabric_amount+amount;
   priced_cuts:=priced_cuts||jsonb_build_array(priced_cut||jsonb_build_object('amount_paise',amount));
   plain_cuts:=plain_cuts||jsonb_build_array(priced_cut-'sp_paise_per_m');
  END LOOP;
  IF fabric_amount+stitching NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Tailoring amount exceeds supported exact money range'; END IF;
  group_price:=(fabric_amount+stitching)::bigint;`);
replace("p_source,row_value->'items',group_price",'p_source,plain_cuts,group_price');
replace("  INSERT INTO public.order_items(order_id,customer_tailoring_job_id,quantity,unit,final_customer_price_paise)",`  INSERT INTO public.counter_tailoring_sale_prices(job_id,fabric_lines,fabric_amount_paise,stitching_paise,total_paise,recorded_by)
  VALUES(booked_job,priced_cuts,fabric_amount::bigint,stitching,group_price,auth.uid());
  INSERT INTO public.order_items(order_id,customer_tailoring_job_id,quantity,unit,final_customer_price_paise)`);
let print=await functionSQL('supabase/migrations/20261015000400_counter_workspace.sql','capture_counter_print_record');
const anchor="'delivery_date',detail.delivery_date,";assert(print.includes(anchor));
print=print.replace(anchor,anchor+"\n 'fabric_amount_paise',(SELECT fabric_amount_paise::text FROM public.counter_tailoring_sale_prices WHERE job_id=job.id),'stitching_paise',(SELECT stitching_paise::text FROM public.counter_tailoring_sale_prices WHERE job_id=job.id),");
const schema=`CREATE TABLE public.counter_tailoring_sale_prices(
 job_id uuid PRIMARY KEY REFERENCES public.counter_tailoring_details(job_id),
 fabric_lines jsonb NOT NULL CHECK(jsonb_typeof(fabric_lines)='array' AND jsonb_array_length(fabric_lines) BETWEEN 1 AND 100),
 fabric_amount_paise bigint NOT NULL CHECK(fabric_amount_paise BETWEEN 0 AND 9007199254740991),
 stitching_paise bigint NOT NULL CHECK(stitching_paise BETWEEN 0 AND 9007199254740991),
 total_paise bigint NOT NULL CHECK(total_paise BETWEEN 0 AND 9007199254740991 AND total_paise=fabric_amount_paise+stitching_paise),
 recorded_by uuid NOT NULL REFERENCES public.profiles(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.counter_tailoring_sale_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.counter_tailoring_sale_prices FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.counter_tailoring_sale_prices TO authenticated;
GRANT ALL ON public.counter_tailoring_sale_prices TO service_role;
CREATE POLICY tailoring_sale_price_read ON public.counter_tailoring_sale_prices FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','counter']));
CREATE TRIGGER tailoring_sale_price_immutable BEFORE UPDATE OR DELETE ON public.counter_tailoring_sale_prices FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
`;
await mirrorMigration('20261015001200','0054','counter_stitching_pricing','BEGIN;\n'+schema+'\n'+bill+'\n'+print+"\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n");
