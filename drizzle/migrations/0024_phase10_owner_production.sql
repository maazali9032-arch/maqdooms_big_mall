-- Phase 10: Owner Production only. No existing rows changed, no finished pieces/costing.
BEGIN;
CREATE TABLE public.production_requests (
 request_id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES public.profiles(id),
 payload jsonb NOT NULL, result_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.production_status_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.production_jobs(id),
 request_id uuid NOT NULL UNIQUE REFERENCES public.production_requests(request_id),
 previous_status text NOT NULL CHECK(previous_status IN('open','in_progress')),
 status text NOT NULL CHECK(status IN('in_progress','completed')),
 actor_id uuid NOT NULL REFERENCES public.profiles(id), reason text NOT NULL CHECK(btrim(reason)<>''),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX phase10_request_actor_time_idx ON public.production_requests(actor_id,recorded_at);
CREATE INDEX phase10_status_job_time_idx ON public.production_status_events(job_id,recorded_at);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['production_requests','production_status_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  EXECUTE format('CREATE POLICY phase10_owner_read ON public.%I FOR SELECT TO authenticated USING(public.has_role(auth.uid(),''owner''))',t);
  EXECUTE format('CREATE TRIGGER phase10_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite()',t);
 END LOOP;
END; $$;
CREATE POLICY phase10_assigned_status_read ON public.production_status_events FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.production_jobs j WHERE j.id=job_id AND public.owns_tailor_assignment(j.tailor_assignment_id)));

CREATE FUNCTION public.guard_phase10_production() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Production history is retained'; END IF;
 IF TG_TABLE_NAME IN('products','designs') THEN
  IF NEW.code IS DISTINCT FROM OLD.code THEN RAISE EXCEPTION 'Catalogue code is permanent'; END IF;
 ELSE
  IF (NEW.code,NEW.product_id,NEW.design_id,NEW.quantity,NEW.tailor_assignment_id,NEW.design_charge_version_id,NEW.notes,NEW.created_by,NEW.created_at)
   IS DISTINCT FROM (OLD.code,OLD.product_id,OLD.design_id,OLD.quantity,OLD.tailor_assignment_id,OLD.design_charge_version_id,OLD.notes,OLD.created_by,OLD.created_at)
  THEN RAISE EXCEPTION 'Issued Production Job identity, quantity, assignment and snapshots are permanent'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF NOT ((OLD.status='open' AND NEW.status='in_progress') OR (OLD.status='in_progress' AND NEW.status='completed'))
   THEN RAISE EXCEPTION 'Production must progress open to in_progress to completed'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.job_material_requirements r JOIN public.inventory_movements m ON m.material_issue_line_id=r.material_issue_line_id
    WHERE r.production_job_id=OLD.id AND r.fabric_stock_id IS NOT NULL AND m.kind='MATERIAL_ISSUE')
   THEN RAISE EXCEPTION 'Actual required fabric issue is required before production'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['products','designs','production_jobs'] LOOP
  EXECUTE format('CREATE TRIGGER phase10_history_guard BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_phase10_production()',t);
 END LOOP;
END; $$;

CREATE FUNCTION public.manage_production_catalog(p_request uuid,p_kind text,p_id uuid,p_code text,p_name text,p_active boolean,p_charge_paise bigint,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload_value jsonb; saved public.production_requests%rowtype; result uuid; previous_value jsonb; result_value jsonb;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_request IS NULL OR p_kind IS NULL OR p_kind NOT IN('product','design') OR nullif(btrim(p_code),'') IS NULL OR nullif(btrim(p_name),'') IS NULL OR p_active IS NULL OR nullif(btrim(p_reason),'') IS NULL
  OR p_charge_paise<0 OR (p_kind='product' AND p_charge_paise IS NOT NULL) THEN RAISE EXCEPTION 'Explicit valid catalogue values, request and reason required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'kind',p_kind,'id',p_id,'code',btrim(p_code),'name',btrim(p_name),'active',p_active,'charge',p_charge_paise,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,10));
 SELECT * INTO saved FROM public.production_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Production request already used with different data'; END IF;
  RETURN saved.result_id;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('phase10-catalog',10));
 IF p_kind='product' THEN
  IF p_id IS NULL THEN INSERT INTO public.products(code,name,active) VALUES(btrim(p_code),btrim(p_name),p_active) RETURNING id INTO result;
  ELSE
   SELECT to_jsonb(p) INTO previous_value FROM public.products p WHERE id=p_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
   UPDATE public.products SET code=btrim(p_code),name=btrim(p_name),active=p_active WHERE id=p_id RETURNING id INTO result;
  END IF;
  SELECT to_jsonb(p) INTO result_value FROM public.products p WHERE id=result;
 ELSE
  IF p_id IS NULL THEN INSERT INTO public.designs(code,name,active) VALUES(btrim(p_code),btrim(p_name),p_active) RETURNING id INTO result;
  ELSE
   SELECT to_jsonb(d) INTO previous_value FROM public.designs d WHERE id=p_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Design not found'; END IF;
   UPDATE public.designs SET code=btrim(p_code),name=btrim(p_name),active=p_active WHERE id=p_id RETURNING id INTO result;
  END IF;
  IF p_charge_paise IS NOT NULL THEN
   INSERT INTO public.design_charge_versions(design_id,revision,amount_paise,recorded_by)
    SELECT result,coalesce(max(revision),0)+1,p_charge_paise,auth.uid() FROM public.design_charge_versions WHERE design_id=result;
  END IF;
  SELECT to_jsonb(d)||jsonb_build_object('explicit_charge_paise',p_charge_paise) INTO result_value FROM public.designs d WHERE id=result;
 END IF;
 INSERT INTO public.production_requests VALUES(p_request,auth.uid(),payload_value,result,now());
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference)
 VALUES(auth.uid(),'manage_production_'||p_kind,CASE p_kind WHEN 'product' THEN 'products' ELSE 'designs' END,result,previous_value,result_value,'PRODUCTION:'||p_request::text);
 RETURN result;
END; $$;

CREATE FUNCTION public.create_owner_production(p_request uuid,p_product uuid,p_design uuid,p_quantity integer,p_assignment uuid,p_source uuid,p_items jsonb,p_notes text,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload_value jsonb; saved public.production_requests%rowtype; result uuid; charge uuid;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_request IS NULL OR p_quantity IS NULL OR p_quantity<=0 OR nullif(btrim(p_reason),'') IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Production quantity, explicit materials, request and reason required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'product',p_product,'design',p_design,'quantity',p_quantity,'assignment',p_assignment,'source',p_source,'items',p_items,'notes',p_notes,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,10));
 SELECT * INTO saved FROM public.production_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Production request already used with different data'; END IF;
  RETURN saved.result_id;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('phase7-assignment',7));
 -- Shared catalogue lock prevents charge/configuration changes between validation and snapshot.
 PERFORM pg_advisory_xact_lock(hashtextextended('phase10-catalog',10));
 PERFORM 1 FROM public.products WHERE id=p_product AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Product required'; END IF;
 PERFORM 1 FROM public.designs WHERE id=p_design AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Design required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id
  LEFT JOIN public.tailoring_sections s ON s.id=a.section_id WHERE a.id=p_assignment AND a.valid_until IS NULL AND a.valid_from<=now() AND t.active AND f.active
  AND (s.id IS NULL OR s.active) AND (t.profile_id IS NULL OR public.has_role(t.profile_id,'tailor')))
 THEN RAISE EXCEPTION 'Current active Factory / Section / Tailor assignment required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x JOIN public.inventory_items i ON i.id=(x->>'inventory_item_id')::uuid WHERE i.thaan_id IS NOT NULL)
 THEN RAISE EXCEPTION 'Explicit required fabric is mandatory'; END IF;
 SELECT id INTO charge FROM public.design_charge_versions WHERE design_id=p_design ORDER BY revision DESC LIMIT 1;
 INSERT INTO public.production_jobs(code,product_id,design_id,design_charge_version_id,quantity,tailor_assignment_id,status,notes,created_by)
 VALUES('PJ-'||p_request::text,p_product,p_design,charge,p_quantity,p_assignment,'open',p_notes,auth.uid()) RETURNING id INTO result;
 -- Quantities are the explicit total for the job, never multiplied by piece count or padded.
 PERFORM public.post_material_issue(p_request,'production',result,p_source,'required',p_items,p_reason);
 INSERT INTO public.production_requests VALUES(p_request,auth.uid(),payload_value,result,now());
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'create_owner_production','production_jobs',result,payload_value,'PJ-'||p_request::text);
 RETURN result;
END; $$;

CREATE FUNCTION public.progress_owner_production(p_request uuid,p_job uuid,p_expected_status text,p_status text,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload_value jsonb; saved public.production_requests%rowtype; job public.production_jobs%rowtype;
BEGIN
 IF NOT (public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'tailor') AND public.has_perm(auth.uid(),'tailoring.manage_jobs'))) THEN RAISE EXCEPTION 'Owner or assigned Tailor required'; END IF;
 IF p_request IS NULL OR nullif(btrim(p_reason),'') IS NULL OR p_status IS NULL OR p_status NOT IN('in_progress','completed') OR p_expected_status IS NULL
 THEN RAISE EXCEPTION 'Expected status, next status, request and reason required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'job',p_job,'expected',p_expected_status,'status',p_status,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,10));
 SELECT * INTO saved FROM public.production_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Production request already used with different data'; END IF;
  RETURN saved.result_id;
 END IF;
 SELECT * INTO job FROM public.production_jobs WHERE id=p_job FOR UPDATE;
 IF job.id IS NULL OR NOT (public.has_role(auth.uid(),'owner') OR public.owns_tailor_assignment(job.tailor_assignment_id)) THEN RAISE EXCEPTION 'Assigned Production Job required'; END IF;
 IF job.status IS DISTINCT FROM p_expected_status THEN RAISE EXCEPTION 'Production status changed; refresh before proceeding'; END IF;
 UPDATE public.production_jobs SET status=p_status WHERE id=p_job;
 INSERT INTO public.production_requests VALUES(p_request,auth.uid(),payload_value,p_job,now());
 INSERT INTO public.production_status_events(job_id,request_id,previous_status,status,actor_id,reason) VALUES(p_job,p_request,job.status,p_status,auth.uid(),btrim(p_reason));
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference)
 VALUES(auth.uid(),'progress_owner_production','production_jobs',p_job,jsonb_build_object('status',job.status),jsonb_build_object('status',p_status),'PRODUCTION:'||p_request::text);
 RETURN p_job;
END; $$;

CREATE FUNCTION public.owner_production_catalog() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 RETURN jsonb_build_object('products',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.code) FROM public.products p),'[]'::jsonb),
 'designs',coalesce((SELECT jsonb_agg(to_jsonb(d)||jsonb_build_object('charge_version_id',v.id,'charge_paise',v.amount_paise) ORDER BY d.code)
 FROM public.designs d LEFT JOIN LATERAL(SELECT id,amount_paise FROM public.design_charge_versions WHERE design_id=d.id ORDER BY revision DESC LIMIT 1) v ON true),'[]'::jsonb));
END; $$;
CREATE FUNCTION public.owner_production_history(p_job uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'tailor')) THEN RAISE EXCEPTION 'Owner or assigned Tailor required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'History limit must be 1 to 100'; END IF;
 RETURN coalesce((SELECT jsonb_agg(r ORDER BY r->>'created_at' DESC,r->>'id') FROM (
 SELECT jsonb_build_object('id',j.id,'code',j.code,'product',p.name,'design',d.name,'quantity',j.quantity,'status',j.status,'notes',j.notes,'created_at',j.created_at,
 'factory',f.name,'section',s.name,'tailor',t.real_name,'assignment_id',j.tailor_assignment_id,
 'requirements',coalesce((SELECT jsonb_agg(jsonb_build_object('id',req.id,'fabric_stock_id',req.fabric_stock_id,'material_id',req.material_id,'quantity',req.quantity,'unit',req.unit,'issue_line_id',req.material_issue_line_id,'name',coalesce(fab.name,mat.name),'batch',b.code,'thaan_id',line.thaan_id) ORDER BY req.id) FROM public.job_material_requirements req LEFT JOIN public.fabric_stock fs ON fs.id=req.fabric_stock_id LEFT JOIN public.fabrics fab ON fab.id=fs.fabric_id LEFT JOIN public.receiving_batches b ON b.id=fs.batch_id LEFT JOIN public.materials mat ON mat.id=req.material_id LEFT JOIN public.material_issue_lines line ON line.id=req.material_issue_line_id WHERE req.production_job_id=j.id),'[]'::jsonb),
 'events',coalesce((SELECT jsonb_agg(jsonb_build_object('status',e.status,'previous_status',e.previous_status,'actor_id',e.actor_id,'reason',e.reason,'recorded_at',e.recorded_at) ORDER BY e.recorded_at,e.id) FROM public.production_status_events e WHERE e.job_id=j.id),'[]'::jsonb)) r
 FROM public.production_jobs j JOIN public.products p ON p.id=j.product_id JOIN public.designs d ON d.id=j.design_id
 JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id
 WHERE (p_job IS NULL OR j.id=p_job) AND (public.has_role(auth.uid(),'owner') OR public.owns_tailor_assignment(j.tailor_assignment_id))
 ORDER BY j.created_at DESC,j.id LIMIT p_limit) x),'[]'::jsonb);
END; $$;
-- Private trigger and narrow browser RPC allowlist; financial catalogue stays Owner only.
REVOKE ALL ON FUNCTION public.guard_phase10_production() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('manage_production_catalog','create_owner_production','progress_owner_production','owner_production_catalog','owner_production_history') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',f);
 END LOOP;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
