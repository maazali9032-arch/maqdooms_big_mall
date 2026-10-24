BEGIN;

-- This follow-up is deliberately idempotent so environments that received the
-- first Phase-1 file before the final GST additions converge safely.
CREATE TABLE IF NOT EXISTS public.gst_garment_slab_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), effective_from timestamptz NOT NULL,
 threshold_paise bigint NOT NULL CHECK(threshold_paise>=0), lower_rate_bps integer NOT NULL CHECK(lower_rate_bps BETWEEN 0 AND 10000),
 higher_rate_bps integer NOT NULL CHECK(higher_rate_bps BETWEEN 0 AND 10000), recorded_by uuid NOT NULL REFERENCES public.profiles(id), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS gst_garment_slabs_effective_idx ON public.gst_garment_slab_versions(effective_from DESC,recorded_at DESC);
ALTER TABLE public.gst_garment_slab_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gst_garment_slab_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.gst_garment_slab_versions TO authenticated;
GRANT ALL ON public.gst_garment_slab_versions TO service_role;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='gst_garment_slab_versions' AND policyname='garment_slab_owner_read') THEN CREATE POLICY garment_slab_owner_read ON public.gst_garment_slab_versions FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner')); END IF; END $$;

CREATE OR REPLACE FUNCTION public.gst_garment_slab_settings() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE row_value public.gst_garment_slab_versions%rowtype; BEGIN IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF; SELECT * INTO row_value FROM public.gst_garment_slab_versions ORDER BY effective_from DESC,recorded_at DESC LIMIT 1; RETURN CASE WHEN row_value.id IS NULL THEN jsonb_build_object('threshold_paise','250000','lower_rate_bps',500,'higher_rate_bps',1800,'effective_from',clock_timestamp()) ELSE to_jsonb(row_value) END; END; $$;
CREATE OR REPLACE FUNCTION public.owner_save_gst_garment_slabs(p_effective_from timestamptz,p_threshold_paise bigint,p_lower_rate_bps integer,p_higher_rate_bps integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid; BEGIN IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF; IF p_effective_from IS NULL OR p_threshold_paise<0 OR p_lower_rate_bps NOT BETWEEN 0 AND 10000 OR p_higher_rate_bps NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Valid garment GST threshold and rates required'; END IF; INSERT INTO public.gst_garment_slab_versions(effective_from,threshold_paise,lower_rate_bps,higher_rate_bps,recorded_by) VALUES(p_effective_from,p_threshold_paise,p_lower_rate_bps,p_higher_rate_bps,auth.uid()) RETURNING id INTO result; INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'save_gst_garment_slabs','gst_garment_slab_versions',result,jsonb_build_object('threshold_paise',p_threshold_paise,'lower_rate_bps',p_lower_rate_bps,'higher_rate_bps',p_higher_rate_bps,'effective_from',p_effective_from),'GST-GARMENT:'||result); RETURN result; END; $$;
CREATE OR REPLACE FUNCTION public.gst_discounted_garment_rate(p_unit_sp_paise bigint,p_at timestamptz DEFAULT clock_timestamp()) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE slab public.gst_garment_slab_versions%rowtype; BEGIN SELECT * INTO slab FROM public.gst_garment_slab_versions WHERE effective_from<=p_at ORDER BY effective_from DESC,recorded_at DESC LIMIT 1; IF slab.id IS NULL THEN RETURN CASE WHEN p_unit_sp_paise<=250000 THEN 500 ELSE 1800 END; END IF; RETURN CASE WHEN p_unit_sp_paise<=slab.threshold_paise THEN slab.lower_rate_bps ELSE slab.higher_rate_bps END; END; $$;
DO $$ DECLARE original text; revised text; BEGIN original:=pg_get_functiondef('public.record_counter_bill_discount_revision(uuid,integer)'::regprocedure); IF position('gst_discounted_garment_rate' IN original)=0 THEN revised:=replace(original,'public.gst_calculate_amount(scaled.entered,(line->>''rate_bps'')::integer,(invoice->>''price_mode'')::text,(invoice->>''supply_type'')::text)','public.gst_calculate_amount(scaled.entered,CASE WHEN line->>''component''=''finished_sale'' THEN public.gst_discounted_garment_rate(round(scaled.entered/greatest((line->>''quantity'')::numeric,1))::bigint) ELSE (line->>''rate_bps'')::integer END,(invoice->>''price_mode'')::text,(invoice->>''supply_type'')::text)'); IF revised=original THEN RAISE EXCEPTION 'Counter discount GST insertion point not found'; END IF; EXECUTE revised; END IF; END $$;

ALTER TABLE public.job_material_consumptions DROP CONSTRAINT IF EXISTS job_material_consumptions_customer_tailoring_job_id_production_job_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS job_material_consumptions_active_job_idx ON public.job_material_consumptions(customer_tailoring_job_id,production_job_id) NULLS NOT DISTINCT WHERE reversed_at IS NULL;
CREATE OR REPLACE FUNCTION public.reverse_job_material_consumption(p_consumption uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE row_value public.job_material_consumptions%rowtype; line record;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') AND NOT public.has_perm(auth.uid(),'materials.correct_consumption') THEN RAISE EXCEPTION 'Owner or specifically authorized correction user required'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Correction reason required'; END IF;
 SELECT * INTO row_value FROM public.job_material_consumptions WHERE id=p_consumption FOR UPDATE; IF row_value.id IS NULL OR row_value.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Active consumption submission required'; END IF;
 FOR line IN SELECT * FROM public.job_material_consumption_lines WHERE consumption_id=p_consumption ORDER BY material_unit_id FOR UPDATE LOOP UPDATE public.material_units SET remaining_quantity=remaining_quantity+line.quantity,exhausted_at=NULL WHERE id=line.material_unit_id; END LOOP;
 UPDATE public.job_material_consumptions SET reversed_by=auth.uid(),reversed_at=clock_timestamp(),reversal_reason=btrim(p_reason) WHERE id=p_consumption;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference) VALUES(auth.uid(),'reverse_job_material_consumption','job_material_consumptions',p_consumption,to_jsonb(row_value),jsonb_build_object('reversed',true,'reason',btrim(p_reason)),'MATERIAL-CORRECTION:'||p_consumption);
END; $$;
CREATE FUNCTION public.material_consumption_history(p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') AND NOT public.has_perm(auth.uid(),'materials.correct_consumption') THEN RAISE EXCEPTION 'Consumption correction permission required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'job_code',coalesce(p.code,j.code),'kind',CASE WHEN c.production_job_id IS NOT NULL THEN 'production' ELSE 'customer_tailoring' END,'staff_name',profile.full_name,'submitted_at',c.submitted_at,'reversed_at',c.reversed_at,'reversal_reason',c.reversal_reason,'lines',(SELECT jsonb_agg(jsonb_build_object('barcode',u.barcode,'material',m.name,'quantity',l.quantity,'unit',l.unit,'amount_paise',l.amount_paise) ORDER BY m.name,u.barcode) FROM public.job_material_consumption_lines l JOIN public.material_units u ON u.id=l.material_unit_id JOIN public.materials m ON m.id=u.material_id WHERE l.consumption_id=c.id)) ORDER BY c.submitted_at DESC) FROM (SELECT * FROM public.job_material_consumptions ORDER BY submitted_at DESC LIMIT greatest(1,least(coalesce(p_limit,100),200))) c JOIN public.tailor_staff_assignments s ON s.id=c.tailor_staff_assignment_id JOIN public.profiles profile ON profile.id=s.staff_profile_id LEFT JOIN public.production_jobs p ON p.id=c.production_job_id LEFT JOIN public.customer_tailoring_jobs j ON j.id=c.customer_tailoring_job_id),'[]'::jsonb);
END; $$;

CREATE TABLE public.customer_tailoring_completion_costs (
 job_id uuid PRIMARY KEY REFERENCES public.customer_tailoring_jobs(id),
 fabric_cp_paise bigint NOT NULL CHECK(fabric_cp_paise>=0), consumables_cp_paise bigint NOT NULL CHECK(consumables_cp_paise>=0),
 stitching_cp_paise bigint NOT NULL CHECK(stitching_cp_paise>=0), total_cp_paise bigint GENERATED ALWAYS AS(fabric_cp_paise+consumables_cp_paise+stitching_cp_paise) STORED,
 recorded_by uuid NOT NULL REFERENCES public.profiles(id), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.customer_tailoring_completion_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_tailoring_completion_costs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.customer_tailoring_completion_costs TO authenticated;
GRANT ALL ON public.customer_tailoring_completion_costs TO service_role;
CREATE POLICY customer_completion_cost_read ON public.customer_tailoring_completion_costs FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner') OR public.has_perm(auth.uid(),'production.receive'));
CREATE FUNCTION public.save_customer_tailoring_completion_cost(p_job uuid,p_stitching_cp_paise bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE fabric_cp bigint; consumables_cp bigint; result public.customer_tailoring_completion_costs%rowtype;
BEGIN
 IF NOT public.has_perm(auth.uid(),'production.receive') OR p_stitching_cp_paise<0 THEN RAISE EXCEPTION 'Workshop receipt permission and stitching CP required'; END IF;
 SELECT fabric_cp_total_paise INTO fabric_cp FROM public.customer_tailoring_prices WHERE job_id=p_job ORDER BY revision DESC LIMIT 1; fabric_cp:=coalesce(fabric_cp,public.customer_job_fabric_cp(p_job),0);
 SELECT coalesce(sum(l.amount_paise),0) INTO consumables_cp FROM public.job_material_consumptions c JOIN public.job_material_consumption_lines l ON l.consumption_id=c.id WHERE c.customer_tailoring_job_id=p_job AND c.reversed_at IS NULL;
 INSERT INTO public.customer_tailoring_completion_costs(job_id,fabric_cp_paise,consumables_cp_paise,stitching_cp_paise,recorded_by) VALUES(p_job,fabric_cp,consumables_cp,p_stitching_cp_paise,auth.uid()) ON CONFLICT(job_id) DO UPDATE SET fabric_cp_paise=excluded.fabric_cp_paise,consumables_cp_paise=excluded.consumables_cp_paise,stitching_cp_paise=excluded.stitching_cp_paise,recorded_by=excluded.recorded_by,recorded_at=clock_timestamp() RETURNING * INTO result; RETURN to_jsonb(result);
END; $$;

REVOKE ALL ON FUNCTION public.gst_garment_slab_settings(),public.owner_save_gst_garment_slabs(timestamptz,bigint,integer,integer),public.gst_discounted_garment_rate(bigint,timestamptz),public.reverse_job_material_consumption(uuid,text),public.material_consumption_history(integer),public.save_customer_tailoring_completion_cost(uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gst_garment_slab_settings(),public.owner_save_gst_garment_slabs(timestamptz,bigint,integer,integer),public.reverse_job_material_consumption(uuid,text),public.material_consumption_history(integer),public.save_customer_tailoring_completion_cost(uuid,bigint) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
