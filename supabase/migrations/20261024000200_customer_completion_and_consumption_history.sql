BEGIN;

CREATE OR REPLACE FUNCTION public.material_consumption_history(p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') AND NOT public.has_perm(auth.uid(),'materials.correct_consumption') THEN RAISE EXCEPTION 'Consumption correction permission required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'job_code',coalesce(p.code,j.code),'kind',CASE WHEN c.production_job_id IS NOT NULL THEN 'production' ELSE 'customer_tailoring' END,'staff_name',profile.full_name,'submitted_at',c.submitted_at,'reversed_at',c.reversed_at,'reversal_reason',c.reversal_reason,'lines',(SELECT jsonb_agg(jsonb_build_object('barcode',u.barcode,'material',m.name,'quantity',l.quantity,'unit',l.unit,'amount_paise',l.amount_paise) ORDER BY m.name,u.barcode) FROM public.job_material_consumption_lines l JOIN public.material_units u ON u.id=l.material_unit_id JOIN public.materials m ON m.id=u.material_id WHERE l.consumption_id=c.id)) ORDER BY c.submitted_at DESC) FROM (SELECT * FROM public.job_material_consumptions ORDER BY submitted_at DESC LIMIT greatest(1,least(coalesce(p_limit,100),200))) c JOIN public.tailor_staff_assignments s ON s.id=c.tailor_staff_assignment_id JOIN public.profiles profile ON profile.id=s.staff_profile_id LEFT JOIN public.production_jobs p ON p.id=c.production_job_id LEFT JOIN public.customer_tailoring_jobs j ON j.id=c.customer_tailoring_job_id),'[]'::jsonb);
END; $$;

CREATE TABLE IF NOT EXISTS public.customer_tailoring_completion_costs (
 job_id uuid PRIMARY KEY REFERENCES public.customer_tailoring_jobs(id),
 fabric_cp_paise bigint NOT NULL CHECK(fabric_cp_paise>=0), consumables_cp_paise bigint NOT NULL CHECK(consumables_cp_paise>=0),
 stitching_cp_paise bigint NOT NULL CHECK(stitching_cp_paise>=0), total_cp_paise bigint GENERATED ALWAYS AS(fabric_cp_paise+consumables_cp_paise+stitching_cp_paise) STORED,
 recorded_by uuid NOT NULL REFERENCES public.profiles(id), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.customer_tailoring_completion_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_tailoring_completion_costs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.customer_tailoring_completion_costs TO authenticated;
GRANT ALL ON public.customer_tailoring_completion_costs TO service_role;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customer_tailoring_completion_costs' AND policyname='customer_completion_cost_read') THEN CREATE POLICY customer_completion_cost_read ON public.customer_tailoring_completion_costs FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner') OR public.has_perm(auth.uid(),'production.receive')); END IF; END $$;
CREATE OR REPLACE FUNCTION public.save_customer_tailoring_completion_cost(p_job uuid,p_stitching_cp_paise bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE fabric_cp bigint; consumables_cp bigint; result public.customer_tailoring_completion_costs%rowtype;
BEGIN
 IF NOT public.has_perm(auth.uid(),'production.receive') OR p_stitching_cp_paise<0 THEN RAISE EXCEPTION 'Workshop receipt permission and stitching CP required'; END IF;
 SELECT fabric_cp_total_paise INTO fabric_cp FROM public.customer_tailoring_prices WHERE job_id=p_job ORDER BY revision DESC LIMIT 1; fabric_cp:=coalesce(fabric_cp,public.customer_job_fabric_cp(p_job),0);
 SELECT coalesce(sum(l.amount_paise),0) INTO consumables_cp FROM public.job_material_consumptions c JOIN public.job_material_consumption_lines l ON l.consumption_id=c.id WHERE c.customer_tailoring_job_id=p_job AND c.reversed_at IS NULL;
 INSERT INTO public.customer_tailoring_completion_costs(job_id,fabric_cp_paise,consumables_cp_paise,stitching_cp_paise,recorded_by) VALUES(p_job,fabric_cp,consumables_cp,p_stitching_cp_paise,auth.uid()) ON CONFLICT(job_id) DO UPDATE SET fabric_cp_paise=excluded.fabric_cp_paise,consumables_cp_paise=excluded.consumables_cp_paise,stitching_cp_paise=excluded.stitching_cp_paise,recorded_by=excluded.recorded_by,recorded_at=clock_timestamp() RETURNING * INTO result; RETURN to_jsonb(result);
END; $$;

REVOKE ALL ON FUNCTION public.material_consumption_history(integer),public.save_customer_tailoring_completion_cost(uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.material_consumption_history(integer),public.save_customer_tailoring_completion_cost(uuid,bigint) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
