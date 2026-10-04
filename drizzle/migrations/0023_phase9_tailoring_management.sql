-- Phase 9 only: dynamic hierarchy management with preserved historical assignments.
BEGIN;
CREATE TABLE public.tailoring_management_requests (
 request_id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES public.profiles(id),
 payload jsonb NOT NULL,result_id uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tailoring_management_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tailoring_management_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.tailoring_management_requests TO authenticated;
GRANT ALL ON public.tailoring_management_requests TO service_role;
CREATE POLICY phase9_owner_request_read ON public.tailoring_management_requests FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER phase9_requests_immutable BEFORE UPDATE OR DELETE ON public.tailoring_management_requests FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE INDEX phase9_request_actor_time_idx ON public.tailoring_management_requests(actor_id,recorded_at);

CREATE FUNCTION public.guard_phase9_hierarchy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Hierarchy and assignments are retained; deactivate or create a new assignment'; END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='tailor_assignments' THEN
   IF OLD.valid_until IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Closed assignment history is permanent'; END IF;
   IF OLD.valid_until IS NULL AND NEW.valid_until IS NOT NULL AND NEW.valid_until>clock_timestamp() THEN RAISE EXCEPTION 'Cannot close an assignment in the future'; END IF;
  ELSE
   IF NEW.code IS DISTINCT FROM OLD.code THEN RAISE EXCEPTION 'Business code/ID is permanent'; END IF;
   IF TG_TABLE_NAME='tailoring_sections' THEN
    IF NEW.factory_id IS DISTINCT FROM OLD.factory_id THEN RAISE EXCEPTION 'Section Factory is permanent; create a new Section'; END IF;
   ELSIF TG_TABLE_NAME='tailors' THEN
    IF OLD.profile_id IS NOT NULL AND NEW.profile_id IS DISTINCT FROM OLD.profile_id
     AND EXISTS(SELECT 1 FROM public.tailor_assignments WHERE tailor_id=OLD.id) THEN RAISE EXCEPTION 'Assigned Tailor login identity is permanent; disable the Tailor instead'; END IF;
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['tailoring_factories','tailoring_sections','tailors','tailor_assignments'] LOOP
  EXECUTE format('CREATE TRIGGER phase9_hierarchy_history BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_phase9_hierarchy()',t);
 END LOOP;
END; $$;

CREATE FUNCTION public.manage_tailoring_entity(p_request uuid,p_kind text,p_id uuid,p_code text,p_name text,p_active boolean,p_factory uuid DEFAULT NULL,p_profile uuid DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload_value jsonb; previous_value jsonb; result_value jsonb; saved public.tailoring_management_requests%rowtype; result uuid;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_request IS NULL OR p_kind IS NULL OR p_kind NOT IN('factory','section','tailor') OR nullif(btrim(p_code),'') IS NULL OR nullif(btrim(p_name),'') IS NULL OR p_active IS NULL OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Kind, code, real name, active state, request and reason required'; END IF;
 IF (p_kind<>'section' AND p_factory IS NOT NULL) OR (p_kind<>'tailor' AND p_profile IS NOT NULL) THEN RAISE EXCEPTION 'Unexpected hierarchy relationship'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'kind',p_kind,'id',p_id,'code',btrim(p_code),'name',btrim(p_name),'active',p_active,'factory',p_factory,'profile',p_profile,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,9));
 SELECT * INTO saved FROM public.tailoring_management_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Management request already used with different data'; END IF;
  RETURN saved.result_id;
 END IF;
 -- Shared with Phase 7's retained setup RPC; no competing hierarchy creation.
 PERFORM pg_advisory_xact_lock(hashtextextended('phase7-assignment',7));
 IF p_kind='factory' THEN
  IF p_id IS NULL THEN INSERT INTO public.tailoring_factories(code,name,active) VALUES(btrim(p_code),btrim(p_name),p_active) RETURNING id INTO result;
  ELSE
   SELECT to_jsonb(f) INTO previous_value FROM public.tailoring_factories f WHERE id=p_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Factory not found'; END IF;
   UPDATE public.tailoring_factories SET code=btrim(p_code),name=btrim(p_name),active=p_active WHERE id=p_id RETURNING id INTO result;
  END IF;
  SELECT to_jsonb(f) INTO result_value FROM public.tailoring_factories f WHERE id=result;
 ELSIF p_kind='section' THEN
  PERFORM 1 FROM public.tailoring_factories WHERE id=p_factory AND (active OR NOT p_active) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Valid Factory required; active Sections require active Factory'; END IF;
  IF p_id IS NULL THEN INSERT INTO public.tailoring_sections(factory_id,code,name,active) VALUES(p_factory,btrim(p_code),btrim(p_name),p_active) RETURNING id INTO result;
  ELSE
   SELECT to_jsonb(s) INTO previous_value FROM public.tailoring_sections s WHERE id=p_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Section not found'; END IF;
   UPDATE public.tailoring_sections SET factory_id=p_factory,code=btrim(p_code),name=btrim(p_name),active=p_active WHERE id=p_id RETURNING id INTO result;
  END IF;
  SELECT to_jsonb(s) INTO result_value FROM public.tailoring_sections s WHERE id=result;
 ELSE
  IF p_profile IS NOT NULL AND p_active AND NOT public.has_role(p_profile,'tailor') THEN RAISE EXCEPTION 'Active Tailor login required'; END IF;
  IF p_id IS NULL THEN INSERT INTO public.tailors(code,real_name,profile_id,active) VALUES(btrim(p_code),btrim(p_name),p_profile,p_active) RETURNING id INTO result;
  ELSE
   SELECT to_jsonb(t) INTO previous_value FROM public.tailors t WHERE id=p_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Tailor not found'; END IF;
   UPDATE public.tailors SET code=btrim(p_code),real_name=btrim(p_name),profile_id=p_profile,active=p_active WHERE id=p_id RETURNING id INTO result;
  END IF;
  SELECT to_jsonb(t) INTO result_value FROM public.tailors t WHERE id=result;
 END IF;
 INSERT INTO public.tailoring_management_requests(request_id,actor_id,payload,result_id) VALUES(p_request,auth.uid(),payload_value,result);
 IF previous_value IS DISTINCT FROM result_value THEN
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference)
  VALUES(auth.uid(),'manage_tailoring_'||p_kind,CASE p_kind WHEN 'factory' THEN 'tailoring_factories' WHEN 'section' THEN 'tailoring_sections' ELSE 'tailors' END,result,previous_value,result_value,'HIERARCHY:'||p_request::text);
 END IF;
 RETURN result;
END; $$;

CREATE FUNCTION public.assign_tailor(p_request uuid,p_tailor uuid,p_factory uuid,p_section uuid,p_expected_assignment uuid,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload_value jsonb; saved public.tailoring_management_requests%rowtype; old_assignment public.tailor_assignments%rowtype; result uuid; changed_at timestamptz;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_request IS NULL OR p_tailor IS NULL OR p_factory IS NULL OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Tailor, Factory, request and assignment reason required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'kind','assignment','tailor',p_tailor,'factory',p_factory,'section',p_section,'expected',p_expected_assignment,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,9));
 SELECT * INTO saved FROM public.tailoring_management_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Management request already used with different data'; END IF;
  RETURN saved.result_id;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('phase7-assignment',7));
 PERFORM 1 FROM public.tailoring_factories WHERE id=p_factory AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Factory required'; END IF;
 IF p_section IS NOT NULL THEN
  PERFORM 1 FROM public.tailoring_sections WHERE id=p_section AND factory_id=p_factory AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active Section in selected Factory required'; END IF;
 END IF;
 PERFORM 1 FROM public.tailors WHERE id=p_tailor AND active AND (profile_id IS NULL OR public.has_role(profile_id,'tailor')) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active business Tailor and optional active Tailor login required'; END IF;
 SELECT * INTO old_assignment FROM public.tailor_assignments WHERE tailor_id=p_tailor AND valid_until IS NULL FOR UPDATE;
 IF old_assignment.id IS DISTINCT FROM p_expected_assignment THEN RAISE EXCEPTION 'Assignment changed; refresh before assigning'; END IF;
 IF old_assignment.factory_id=p_factory AND old_assignment.section_id IS NOT DISTINCT FROM p_section THEN result:=old_assignment.id;
 ELSE
  changed_at:=clock_timestamp();
  IF old_assignment.id IS NOT NULL THEN
   changed_at:=greatest(changed_at,old_assignment.valid_from+interval '1 microsecond');
   UPDATE public.tailor_assignments SET valid_until=changed_at WHERE id=old_assignment.id;
  END IF;
  INSERT INTO public.tailor_assignments(tailor_id,factory_id,section_id,valid_from) VALUES(p_tailor,p_factory,p_section,changed_at) RETURNING id INTO result;
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference)
  SELECT auth.uid(),'assign_tailor','tailor_assignments',result,CASE WHEN old_assignment.id IS NOT NULL THEN to_jsonb(old_assignment) END,to_jsonb(a)||jsonb_build_object('reason',btrim(p_reason)),'HIERARCHY:'||p_request::text FROM public.tailor_assignments a WHERE id=result;
 END IF;
 INSERT INTO public.tailoring_management_requests(request_id,actor_id,payload,result_id) VALUES(p_request,auth.uid(),payload_value,result);
 RETURN result;
END; $$;

CREATE FUNCTION public.owner_tailoring_hierarchy() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 RETURN jsonb_build_object(
 'factories',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.code) FROM public.tailoring_factories f),'[]'::jsonb),
 'sections',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.factory_id,s.code) FROM public.tailoring_sections s),'[]'::jsonb),
 'tailors',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.code) FROM public.tailors t),'[]'::jsonb),
 'assignments',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.valid_from DESC,a.id) FROM public.tailor_assignments a),'[]'::jsonb),
 'profiles',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) ORDER BY p.full_name,p.id) FROM public.profiles p WHERE public.has_role(p.id,'tailor')),'[]'::jsonb));
END; $$;

CREATE FUNCTION public.tailoring_assignment_options(p_factory uuid DEFAULT NULL,p_section uuid DEFAULT NULL,p_no_section boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','tailor']) THEN RAISE EXCEPTION 'Active tailoring role required'; END IF;
 IF p_no_section IS NULL OR (p_no_section AND p_section IS NOT NULL) THEN RAISE EXCEPTION 'Choose a Section or no Section'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.factory_name,x.section_name NULLS FIRST,x.tailor_code) FROM(
 SELECT a.id,a.factory_id,f.name factory_name,a.section_id,s.name section_name,a.tailor_id,t.code tailor_code,t.real_name tailor_name
 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id
 WHERE a.valid_until IS NULL AND a.valid_from<=now() AND t.active AND f.active AND (s.id IS NULL OR s.active)
 AND (t.profile_id IS NULL OR public.has_role(t.profile_id,'tailor'))
 AND (p_factory IS NULL OR a.factory_id=p_factory) AND (p_section IS NULL OR a.section_id=p_section)
 AND (NOT p_no_section OR a.section_id IS NULL)
 AND (public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR public.owns_tailor_assignment(a.id))) x),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.guard_phase9_hierarchy() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.manage_tailoring_entity(uuid,text,uuid,text,text,boolean,uuid,uuid,text),public.assign_tailor(uuid,uuid,uuid,uuid,uuid,text),public.owner_tailoring_hierarchy(),public.tailoring_assignment_options(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_tailoring_entity(uuid,text,uuid,text,text,boolean,uuid,uuid,text),public.assign_tailor(uuid,uuid,uuid,uuid,uuid,text),public.owner_tailoring_hierarchy(),public.tailoring_assignment_options(uuid,uuid,boolean) TO authenticated;
-- The next function replacement is copied from Phase 8 with only the assignment
-- lifetime predicate relaxed for existing jobs. Reassignment does not move jobs.
CREATE OR REPLACE FUNCTION public.post_material_issue(p_request_id uuid,p_job_kind text,p_job uuid,p_source uuid,p_type text,p_items jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_payload jsonb; old_issue public.material_issues%rowtype; v_assignment uuid; v_status text; v_id uuid; v_line uuid;
 r jsonb; i public.inventory_items%rowtype; v_stock uuid; v_quantity numeric;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') AND NOT (public.has_role(auth.uid(),'counter') AND public.has_perm(auth.uid(),'pos.issue_to_tailoring')) THEN RAISE EXCEPTION 'Owner or authorized Counter required'; END IF;
 IF p_request_id IS NULL OR p_job_kind IS NULL OR p_job_kind NOT IN ('customer_tailoring','production') OR p_job IS NULL OR p_source IS NULL OR p_type IS NULL OR p_type NOT IN ('required','additional')
  OR p_reason IS NULL OR btrim(p_reason)='' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Job, source, issue type, items, request ID and reason required'; END IF;
 IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'One to 100 issue lines required'; END IF;
 v_payload:=jsonb_build_object('actor',auth.uid(),'job_kind',p_job_kind,'job',p_job,'source',p_source,'type',p_type,'items',p_items,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,8));
 SELECT * INTO old_issue FROM public.material_issues WHERE request_id=p_request_id;
 IF FOUND THEN
  IF old_issue.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Issue request already used with different data'; END IF;
  RETURN old_issue.id;
 END IF;
 IF p_job_kind='customer_tailoring' THEN
  SELECT tailor_assignment_id,status INTO v_assignment,v_status FROM public.customer_tailoring_jobs WHERE id=p_job FOR UPDATE;
 ELSE
  SELECT tailor_assignment_id,status INTO v_assignment,v_status FROM public.production_jobs WHERE id=p_job FOR UPDATE;
 END IF;
 IF v_assignment IS NULL OR v_status NOT IN ('open','in_progress') THEN RAISE EXCEPTION 'Open or in-progress canonical job required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id WHERE a.id=v_assignment AND a.valid_from<=now() AND t.active AND f.active AND (s.id IS NULL OR s.active)) THEN RAISE EXCEPTION 'Active job assignment required'; END IF;
 IF (SELECT count(DISTINCT value->>'inventory_item_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Duplicate or missing issue item'; END IF;
 -- Same stable item/location lock order as transfers; serialize all outgoing quantities.
 PERFORM 1 FROM public.materials WHERE id IN(SELECT inv.material_id FROM public.inventory_items inv
 JOIN jsonb_array_elements(p_items) x ON inv.id=(x->>'inventory_item_id')::uuid) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items WHERE id IN(SELECT (value->>'inventory_item_id')::uuid FROM jsonb_array_elements(p_items)) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.locations WHERE id=p_source AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active issue source required'; END IF;
 INSERT INTO public.material_issues(code,customer_tailoring_job_id,production_job_id,tailor_assignment_id,source_location_id,issue_type,reason,issued_by,request_id,request_payload)
 VALUES('MI-'||p_request_id::text,CASE WHEN p_job_kind='customer_tailoring' THEN p_job END,CASE WHEN p_job_kind='production' THEN p_job END,
 v_assignment,p_source,p_type,btrim(p_reason),auth.uid(),p_request_id,v_payload) RETURNING id INTO v_id;
 FOR r IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  SELECT * INTO i FROM public.inventory_items WHERE id=(r->>'inventory_item_id')::uuid;
  v_quantity:=(r->>'quantity')::numeric; v_stock:=NULL;
  IF i.id IS NULL OR i.finished_product_id IS NOT NULL OR v_quantity IS NULL OR v_quantity<=0 OR v_quantity>=1000000000000000 OR v_quantity<>round(v_quantity,3)
   OR (i.thaan_id IS NOT NULL AND v_quantity<>trunc(v_quantity)) THEN RAISE EXCEPTION 'Exact positive fabric or consumable quantity required'; END IF;
  IF i.material_id IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.materials WHERE id=i.material_id AND active) THEN RAISE EXCEPTION 'Active consumable required'; END IF;
  ELSE
   SELECT t.fabric_stock_id INTO v_stock FROM public.thaans t JOIN public.fabric_stock fs ON fs.id=t.fabric_stock_id
    WHERE t.id=i.thaan_id AND t.status='active' AND fs.entry_state IN ('complete','correcting','legacy_pending');
   IF v_stock IS NULL THEN RAISE EXCEPTION 'Available Fabric + Batch Than required'; END IF;
   -- Booking already issues exact required fabric. Extra fabric is always explicit Additional Material Issue.
   IF p_type='required' AND p_job_kind='customer_tailoring' THEN RAISE EXCEPTION 'Required Customer Tailoring fabric is issued at booking; use Additional Material Issue'; END IF;
  END IF;
  INSERT INTO public.material_issue_lines(material_issue_id,fabric_stock_id,thaan_id,material_id,quantity,unit)
  VALUES(v_id,v_stock,i.thaan_id,i.material_id,v_quantity,i.unit) RETURNING id INTO v_line;
  INSERT INTO public.inventory_movements(kind,inventory_item_id,fabric_stock_id,thaan_id,material_id,quantity,unit,source_location_id,material_issue_line_id,customer_tailoring_job_id,production_job_id,reason,reference,actor_id)
  VALUES('MATERIAL_ISSUE',i.id,v_stock,i.thaan_id,i.material_id,v_quantity,i.unit,p_source,v_line,
   CASE WHEN p_job_kind='customer_tailoring' THEN p_job END,CASE WHEN p_job_kind='production' THEN p_job END,btrim(p_reason),'MI-'||p_request_id::text,auth.uid());
  IF p_type='required' THEN
   INSERT INTO public.job_material_requirements(customer_tailoring_job_id,production_job_id,fabric_stock_id,material_id,quantity,unit,material_issue_line_id)
   VALUES(CASE WHEN p_job_kind='customer_tailoring' THEN p_job END,CASE WHEN p_job_kind='production' THEN p_job END,v_stock,i.material_id,v_quantity,i.unit,v_line);
  END IF;
 END LOOP;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'post_material_issue','material_issues',v_id,v_payload,'MI-'||p_request_id::text);
 RETURN v_id;
END; $$;


NOTIFY pgrst, 'reload schema';
COMMIT;
