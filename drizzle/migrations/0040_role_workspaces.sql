-- Approved seven-role workspaces. No business-data backfill or consumption inference.
BEGIN;
ALTER TABLE public.production_jobs ADD COLUMN size text CHECK(size IS NULL OR (btrim(size)<>'' AND length(size)<=40));
ALTER TABLE public.production_jobs ADD COLUMN custom_design text CHECK(custom_design IS NULL OR (btrim(custom_design)<>'' AND length(custom_design)<=120));
ALTER TABLE public.production_jobs ALTER COLUMN design_id DROP NOT NULL;
ALTER TABLE public.finished_products ALTER COLUMN design_id DROP NOT NULL;
INSERT INTO public.roles(key,label,description) VALUES('production','Production','Issue fabric and manage production batches') ON CONFLICT(key) DO NOTHING;
INSERT INTO public.permissions(key,label,domain) VALUES
 ('production.view','View production work','production'),
 ('production.create','Issue fabric and create production','production'),
 ('production.progress','Update production progress','production'),
 ('production.receive','Receive whole production batch and generate piece barcodes','production'),
 ('stock.price_finished','Set finished-product SP in Workshop','stock') ON CONFLICT(key) DO NOTHING;
INSERT INTO public.role_permissions(role_key,permission_key) VALUES
 ('production','production.view'),('production','production.create'),('production','production.progress'),
 ('stock_entry','production.receive'),('stock_entry','stock.price_finished'),
 ('counter','production.view'),('counter','production.create') ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.permission_role_restriction(p_user uuid,p_permission text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN public.has_role(p_user,'owner') THEN NULL
 WHEN p_permission IN('inventory.view_cost','tailoring.view_costs','reports.view','audit.view','access.manage','pos.override_price_or_discount','stock.adjust','stock.return_from_tailor') THEN 'Owner-only: personal overrides cannot grant this action'
 WHEN p_permission IN('inventory.edit_others_thaans','inventory.view_others_cp','inventory.correct_others_cp') THEN 'Superseded: stock access now follows module/action permissions, not record creator'
 WHEN p_permission LIKE 'inventory.%' OR p_permission LIKE 'stock.%' THEN CASE WHEN NOT public.has_role(p_user,'stock_entry') THEN 'Stock Entry role required' END
 WHEN p_permission LIKE 'ecommerce.%' THEN CASE WHEN NOT public.has_role(p_user,'ecommerce_manager') THEN 'E-commerce role required' END
 WHEN p_permission='production.receive' THEN CASE WHEN NOT public.has_any_role(p_user,ARRAY['stock_entry','production','counter']) THEN 'Stock Entry or Production workflow role required' END
 WHEN p_permission LIKE 'production.%' THEN CASE WHEN NOT public.has_any_role(p_user,ARRAY['production','counter']) THEN 'Production or Counter role required' END
 WHEN p_permission LIKE 'pos.%' THEN CASE WHEN NOT public.has_role(p_user,'counter') THEN 'Counter role required' END
 WHEN p_permission='salesperson.view_work' AND NOT public.has_role(p_user,'salesperson') THEN 'Salesperson role required'
 WHEN p_permission='tailoring.manage_jobs' AND NOT public.has_any_role(p_user,ARRAY['counter','tailor']) THEN 'Counter or Tailor role required'
 ELSE NULL END;
$$;
CREATE OR REPLACE FUNCTION public.bootstrap_current_user(_full_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_role text;
  v_active boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM pg_advisory_xact_lock(73120402);
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_uid) THEN RAISE EXCEPTION 'Auth user required'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  INSERT INTO public.profiles(id, full_name, email, last_login)
  VALUES (v_uid, coalesce(_full_name, split_part(coalesce(v_email,'staff'),'@',1)), v_email, now())
  ON CONFLICT (id) DO UPDATE SET last_login = now(), email = excluded.email;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid) THEN
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE role_key = 'owner') THEN
      v_role := NULL; -- New staff wait for an Owner to assign their roles.
    ELSE
      v_role := 'owner';
    END IF;
    IF v_role IS NOT NULL THEN INSERT INTO public.user_roles(user_id, role_key) VALUES (v_uid, v_role) ON CONFLICT DO NOTHING; END IF;
  END IF;

  SELECT active INTO v_active FROM public.profiles WHERE id = v_uid;
  RETURN jsonb_build_object(
    'user_id', v_uid,
    'active', v_active,
    'roles', (
      SELECT coalesce(jsonb_agg(role_key ORDER BY role_key), '[]'::jsonb)
      FROM public.user_roles WHERE user_id = v_uid
    ),
    'permissions', CASE WHEN v_active THEN (
      SELECT coalesce(jsonb_agg(p.key ORDER BY p.key), '[]'::jsonb)
      FROM public.permissions p
      WHERE public.has_perm(v_uid, p.key)
    ) ELSE '[]'::jsonb END
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.create_owner_production_shared(p_request uuid, p_product uuid, p_design uuid, p_quantity integer, p_assignments jsonb, p_source uuid, p_items jsonb, p_notes text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE payload_value jsonb; saved public.production_requests%rowtype; result uuid; charge uuid; p_assignment uuid; selected_assignments jsonb; candidate uuid; first_assignment public.tailor_assignments%rowtype;
BEGIN
 IF NOT public.has_perm(auth.uid(),'production.create') THEN RAISE EXCEPTION 'Production creation permission required'; END IF;
 IF p_request IS NULL OR p_quantity IS NULL OR p_quantity<=0 OR nullif(btrim(p_reason),'') IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Production quantity, explicit materials, request and reason required'; END IF;
 IF jsonb_typeof(p_assignments) IS DISTINCT FROM 'array' OR jsonb_array_length(p_assignments) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Select one to 100 Tailors'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_assignments) x WHERE jsonb_typeof(x)<>'string') OR (SELECT count(DISTINCT value::uuid) FROM jsonb_array_elements_text(p_assignments))<>jsonb_array_length(p_assignments) THEN RAISE EXCEPTION 'Distinct Tailor assignments required'; END IF;
 SELECT jsonb_agg(value::uuid ORDER BY value::uuid) INTO selected_assignments FROM jsonb_array_elements_text(p_assignments);
 p_assignment:=(selected_assignments->>0)::uuid;
 payload_value:=jsonb_build_object('actor',auth.uid(),'product',p_product,'design',p_design,'quantity',p_quantity,'assignments',selected_assignments,'source',p_source,'items',p_items,'notes',p_notes,'reason',btrim(p_reason));
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
 IF p_design IS NOT NULL THEN PERFORM 1 FROM public.designs WHERE id=p_design AND active FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Active Design required'; END IF; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id
  LEFT JOIN public.tailoring_sections s ON s.id=a.section_id WHERE a.id=p_assignment AND a.valid_until IS NULL AND a.valid_from<=now() AND t.active AND f.active
  AND (s.id IS NULL OR s.active) AND (t.profile_id IS NULL OR public.has_role(t.profile_id,'tailor')))
 THEN RAISE EXCEPTION 'Current active Factory / Section / Tailor assignment required'; END IF;
 SELECT * INTO first_assignment FROM public.tailor_assignments WHERE id=p_assignment;
 FOR candidate IN SELECT value::uuid FROM jsonb_array_elements_text(selected_assignments) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections sec ON sec.id=a.section_id
   WHERE a.id=candidate AND a.factory_id=first_assignment.factory_id AND a.section_id IS NOT DISTINCT FROM first_assignment.section_id AND a.valid_until IS NULL AND a.valid_from<=now() AND t.active AND f.active AND (sec.id IS NULL OR sec.active) AND (t.profile_id IS NULL OR public.has_role(t.profile_id,'tailor')))
  THEN RAISE EXCEPTION 'All Tailors must have current active assignments in the selected Factory and Section'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x JOIN public.inventory_items i ON i.id=(x->>'inventory_item_id')::uuid WHERE i.thaan_id IS NOT NULL)
 THEN RAISE EXCEPTION 'Explicit required fabric is mandatory'; END IF;
 SELECT id INTO charge FROM public.design_charge_versions WHERE design_id=p_design ORDER BY revision DESC LIMIT 1;
 INSERT INTO public.production_jobs(code,product_id,design_id,design_charge_version_id,quantity,tailor_assignment_id,status,notes,created_by)
 VALUES('PJ-'||p_request::text,p_product,p_design,charge,p_quantity,p_assignment,'open',p_notes,auth.uid()) RETURNING id INTO result;
 INSERT INTO public.production_job_tailors(production_job_id,tailor_assignment_id,recorded_by) SELECT result,value::uuid,auth.uid() FROM jsonb_array_elements_text(selected_assignments);
 -- Quantities are the explicit total for the job, never multiplied by piece count or padded.
 PERFORM public.post_material_issue(p_request,'production',result,p_source,'required',p_items,p_reason);
 INSERT INTO public.production_requests VALUES(p_request,auth.uid(),payload_value,result,now());
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'create_owner_production','production_jobs',result,payload_value,'PJ-'||p_request::text);
 RETURN result;
END; $function$
;
CREATE OR REPLACE FUNCTION public.post_material_issue(p_request_id uuid, p_job_kind text, p_job uuid, p_source uuid, p_type text, p_items jsonb, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_payload jsonb; old_issue public.material_issues%rowtype; v_assignment uuid; v_status text; v_id uuid; v_line uuid;
 r jsonb; i public.inventory_items%rowtype; v_stock uuid; v_quantity numeric;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') AND NOT (public.has_role(auth.uid(),'counter') AND public.has_perm(auth.uid(),'pos.issue_to_tailoring')) AND NOT (p_job_kind='production' AND public.has_perm(auth.uid(),'production.create')) THEN RAISE EXCEPTION 'Owner or authorized Counter required'; END IF;
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
 IF p_job_kind='production' AND NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=p_source AND l.active AND (l.kind IN('workshop','showroom') OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom'))) THEN RAISE EXCEPTION 'Workshop or Showroom production source required'; END IF;
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
END; $function$
;
CREATE OR REPLACE FUNCTION public.progress_owner_production(p_request uuid, p_job uuid, p_expected_status text, p_status text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE payload_value jsonb; saved public.production_requests%rowtype; job public.production_jobs%rowtype;
BEGIN
 IF NOT (public.has_perm(auth.uid(),'production.progress') OR (public.has_role(auth.uid(),'tailor') AND public.has_perm(auth.uid(),'tailoring.manage_jobs'))) THEN RAISE EXCEPTION 'Owner or assigned Tailor required'; END IF;
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
 IF job.id IS NULL OR NOT (public.has_perm(auth.uid(),'production.progress') OR public.owns_production_job(job.id)) THEN RAISE EXCEPTION 'Assigned Production Job required'; END IF;
 IF job.status IS DISTINCT FROM p_expected_status THEN RAISE EXCEPTION 'Production status changed; refresh before proceeding'; END IF;
 UPDATE public.production_jobs SET status=p_status WHERE id=p_job;
 INSERT INTO public.production_requests VALUES(p_request,auth.uid(),payload_value,p_job,now());
 INSERT INTO public.production_status_events(job_id,request_id,previous_status,status,actor_id,reason) VALUES(p_job,p_request,job.status,p_status,auth.uid(),btrim(p_reason));
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference)
 VALUES(auth.uid(),'progress_owner_production','production_jobs',p_job,jsonb_build_object('status',job.status),jsonb_build_object('status',p_status),'PRODUCTION:'||p_request::text);
 RETURN p_job;
END; $function$
;
CREATE OR REPLACE FUNCTION public.owner_production_history(p_job uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT (public.has_perm(auth.uid(),'production.view') OR public.has_role(auth.uid(),'tailor')) THEN RAISE EXCEPTION 'Owner or assigned Tailor required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'History limit must be 1 to 100'; END IF;
 RETURN coalesce((SELECT jsonb_agg(r ORDER BY r->>'created_at' DESC,r->>'id') FROM (
 SELECT jsonb_build_object('id',j.id,'code',j.code,'product',p.name,'design',coalesce(d.name,j.custom_design),'quantity',j.quantity,'status',j.status,'size',j.size,'notes',j.notes,'received',EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE production_job_id=j.id),'created_at',j.created_at,
 'factory',f.name,'section',s.name,'tailor',t.real_name,'assignment_id',j.tailor_assignment_id,'tailors',public.production_tailor_names(j.id),
 'requirements',coalesce((SELECT jsonb_agg(jsonb_build_object('id',req.id,'fabric_stock_id',req.fabric_stock_id,'material_id',req.material_id,'quantity',req.quantity,'unit',req.unit,'issue_line_id',req.material_issue_line_id,'name',coalesce(fab.name,mat.name),'batch',b.code,'thaan_id',line.thaan_id) ORDER BY req.id) FROM public.job_material_requirements req LEFT JOIN public.fabric_stock fs ON fs.id=req.fabric_stock_id LEFT JOIN public.fabrics fab ON fab.id=fs.fabric_id LEFT JOIN public.receiving_batches b ON b.id=fs.batch_id LEFT JOIN public.materials mat ON mat.id=req.material_id LEFT JOIN public.material_issue_lines line ON line.id=req.material_issue_line_id WHERE req.production_job_id=j.id),'[]'::jsonb),
 'events',coalesce((SELECT jsonb_agg(jsonb_build_object('status',e.status,'previous_status',e.previous_status,'actor_id',e.actor_id,'reason',e.reason,'recorded_at',e.recorded_at) ORDER BY e.recorded_at,e.id) FROM public.production_status_events e WHERE e.job_id=j.id),'[]'::jsonb)) r
 FROM public.production_jobs j JOIN public.products p ON p.id=j.product_id LEFT JOIN public.designs d ON d.id=j.design_id
 JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id
 WHERE (p_job IS NULL OR j.id=p_job) AND (public.has_perm(auth.uid(),'production.view') OR public.owns_production_job(j.id))
 ORDER BY j.created_at DESC,j.id LIMIT p_limit) x),'[]'::jsonb);
END; $function$
;
CREATE OR REPLACE FUNCTION public.owner_production_catalog()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT public.has_perm(auth.uid(),'production.view') THEN RAISE EXCEPTION 'Production access required'; END IF;
 IF NOT public.has_role(auth.uid(),'owner') THEN RETURN jsonb_build_object('products',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'active',active) ORDER BY code) FROM public.products),'[]'::jsonb),'designs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'active',active) ORDER BY code) FROM public.designs),'[]'::jsonb)); END IF;
 RETURN jsonb_build_object('products',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.code) FROM public.products p),'[]'::jsonb),
 'designs',coalesce((SELECT jsonb_agg(to_jsonb(d)||jsonb_build_object('charge_version_id',v.id,'charge_paise',v.amount_paise) ORDER BY d.code)
 FROM public.designs d LEFT JOIN LATERAL(SELECT id,amount_paise FROM public.design_charge_versions WHERE design_id=d.id ORDER BY revision DESC LIMIT 1) v ON true),'[]'::jsonb));
END; $function$
;
CREATE OR REPLACE FUNCTION public.tailoring_assignment_options(p_factory uuid DEFAULT NULL::uuid, p_section uuid DEFAULT NULL::uuid, p_no_section boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','tailor','production']) THEN RAISE EXCEPTION 'Active tailoring role required'; END IF;
 IF p_no_section IS NULL OR (p_no_section AND p_section IS NOT NULL) THEN RAISE EXCEPTION 'Choose a Section or no Section'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.factory_name,x.section_name NULLS FIRST,x.tailor_code) FROM(
 SELECT a.id,a.factory_id,f.name factory_name,a.section_id,s.name section_name,a.tailor_id,t.code tailor_code,t.real_name tailor_name
 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id
 WHERE a.valid_until IS NULL AND a.valid_from<=now() AND t.active AND f.active AND (s.id IS NULL OR s.active)
 AND (t.profile_id IS NULL OR public.has_role(t.profile_id,'tailor'))
 AND (p_factory IS NULL OR a.factory_id=p_factory) AND (p_section IS NULL OR a.section_id=p_section)
 AND (NOT p_no_section OR a.section_id IS NULL)
 AND (public.has_any_role(auth.uid(),ARRAY['owner','counter','production']) OR public.owns_tailor_assignment(a.id))) x),'[]'::jsonb);
END; $function$
;
CREATE OR REPLACE FUNCTION public.guard_receiving_authorization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF auth.uid() IS NULL THEN
   IF current_setting('role') IN ('anon','authenticated') THEN RAISE EXCEPTION 'Authentication required'; END IF;
   RETURN NEW; -- migration/service maintenance; no browser bypass
 END IF;
 IF public.has_role(auth.uid(),'owner') THEN RETURN NEW; END IF;
 -- Only receipt-marked first measurement can pass another registrant's legacy guard.
 IF TG_TABLE_NAME='thaans' AND TG_OP='UPDATE' THEN
 IF OLD.original_mm IS NULL AND OLD.status='draft'
 AND NEW.original_mm>0 AND NEW.status='active'
 AND (to_jsonb(NEW)-'original_mm'-'status'-'updated_at')=(to_jsonb(OLD)-'original_mm'-'status'-'updated_at')
 AND public.can_edit_thaan_registration(OLD.created_by) AND public.has_perm(auth.uid(),'stock.measure_thaan')
 AND EXISTS(SELECT 1 FROM public.stock_registration_requests r JOIN public.stock_registration_variants v ON v.thaan_id=OLD.id
 WHERE r.action='measure_thaan' AND r.actor_id=auth.uid() AND r.result_id=OLD.id
 AND r.payload->>'barcode'=v.code AND (r.payload->>'length_mm')::integer=NEW.original_mm)
 AND NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=OLD.id) THEN RETURN NEW; END IF;
 END IF;

 -- Existing sale/issue RPCs may mark exhausted stock depleted. No other
 -- inventory field may change through this authorization exception.
 IF TG_TABLE_NAME='thaans' AND TG_OP='UPDATE' AND OLD.status='active' AND NEW.status='depleted'
 AND public.has_any_role(auth.uid(),ARRAY['counter','tailor','production'])
 AND (to_jsonb(NEW)-'status'-'updated_at')=(to_jsonb(OLD)-'status'-'updated_at') THEN RETURN NEW; END IF;
 IF NOT public.has_role(auth.uid(),'stock_entry') OR NOT public.has_perm(auth.uid(),'inventory.receive') THEN
   RAISE EXCEPTION 'Stock Entry role required';
 END IF;
 IF TG_TABLE_NAME='receiving_batches' THEN
   IF TG_OP='INSERT' THEN NEW.created_by:=auth.uid();
   ELSIF OLD.status<>'draft'
      OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'Authorised open receiving workflow required'; END IF;
 ELSE
   IF TG_OP='INSERT' THEN
     NEW.created_by:=auth.uid();
     IF NEW.price_paise IS NOT NULL OR NEW.status<>'draft' THEN RAISE EXCEPTION 'Only Owner controls SP and activation'; END IF;
   ELSE
     IF NOT public.can_enter_legacy_cp(OLD.id) OR NEW.created_by IS DISTINCT FROM OLD.created_by
        OR NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN RAISE EXCEPTION 'Authorised open receiving workflow required'; END IF;
     IF NEW.price_paise IS DISTINCT FROM OLD.price_paise THEN RAISE EXCEPTION 'Only Owner controls SP'; END IF;
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.receiving_batches WHERE id=NEW.batch_id AND status='draft') THEN
     RAISE EXCEPTION 'Authorised open receiving workflow required'; END IF;
 END IF;
 RETURN NEW;
END; $function$
;
CREATE OR REPLACE FUNCTION public.complete_direct_fabric_sale(p_request_id uuid, p_source uuid, p_items jsonb, p_customer uuid, p_payment_confirmed boolean, p_reference text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE o public.orders%rowtype; payload jsonb; r jsonb; t public.thaans%rowtype;
 v_order uuid:=gen_random_uuid(); v_item uuid; v_sp public.fabric_stock_prices%rowtype;
 v_cp bigint; v_qty numeric; v_amount bigint; v_total bigint:=0; v_customer jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell')
 THEN RAISE EXCEPTION 'Authorized Owner or Counter required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=p_source AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom'))) THEN RAISE EXCEPTION 'Fabric sales require an active Showroom source'; END IF;
 IF p_request_id IS NULL OR p_source IS NULL OR p_payment_confirmed IS DISTINCT FROM true
 OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Request, source, cuts and received payment required'; END IF;
 IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 OR
 (SELECT count(DISTINCT value->>'inventory_item_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items)
 THEN RAISE EXCEPTION 'Supply 1 to 50 distinct internal Than cuts'; END IF;
 payload:=jsonb_build_object('source',p_source,'items',p_items,'customer',p_customer,'reference',nullif(btrim(p_reference),''),'payment_confirmed',true);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,6));
 SELECT * INTO o FROM public.orders WHERE sale_request_id=p_request_id;
 IF FOUND THEN
  IF o.sale_request_payload IS DISTINCT FROM payload OR (o.created_by IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(),'owner'))
   THEN RAISE EXCEPTION 'Sale request reused with different data or actor'; END IF;
  IF o.status<>'completed' THEN RAISE EXCEPTION 'Sale request is not completed'; END IF;
  RETURN o.id;
 END IF;
 IF p_customer IS NOT NULL THEN
  SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO v_customer FROM public.customers WHERE id=p_customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer does not exist'; END IF;
 ELSE v_customer:=jsonb_build_object('name','Walk-in customer'); END IF;
 -- Parent locks also serialize Owner CP/SP revisions; item and location locks
 -- follow the ledger/transfer ordering. Price is checked after locking.
 PERFORM 1 FROM public.fabric_stock s WHERE s.id IN(SELECT th.fabric_stock_id FROM public.thaans th
 JOIN public.inventory_items i ON i.thaan_id=th.id JOIN jsonb_array_elements(p_items) x ON i.id=(x->>'inventory_item_id')::uuid) ORDER BY s.id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items i JOIN jsonb_array_elements(p_items) x ON i.id=(x->>'inventory_item_id')::uuid ORDER BY i.id FOR UPDATE OF i;
 PERFORM 1 FROM public.locations WHERE id=p_source AND active AND kind IN ('workshop','showroom','showroom_sublocation') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Workshop or Showroom source required'; END IF;
 INSERT INTO public.orders(id,code,kind,customer_id,source_location_id,created_by,reference,sale_request_id,sale_request_payload,customer_snapshot,payment_confirmed_at)
 VALUES(v_order,'SALE-'||replace(v_order::text,'-',''),'direct_fabric_sale',p_customer,p_source,auth.uid(),nullif(btrim(p_reference),''),p_request_id,payload,v_customer,now());
 FOR r IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'inventory_item_id' LOOP
  v_qty:=(r->>'quantity')::numeric;
  IF v_qty IS NULL OR v_qty<=0 OR v_qty<>trunc(v_qty) OR v_qty>2147483647 THEN RAISE EXCEPTION 'Positive integer millimetre quantity required'; END IF;
  SELECT th.* INTO t FROM public.thaans th JOIN public.inventory_items i ON i.thaan_id=th.id
  JOIN public.fabric_stock s ON s.id=th.fabric_stock_id WHERE i.id=(r->>'inventory_item_id')::uuid
  AND i.unit='mm' AND th.status='active' AND s.entry_state IN ('complete','correcting','legacy_pending');
  IF NOT FOUND THEN RAISE EXCEPTION 'Located active internal Than required'; END IF;
  SELECT * INTO v_sp FROM public.fabric_stock_prices WHERE fabric_stock_id=t.fabric_stock_id ORDER BY revision DESC LIMIT 1;
  IF NOT FOUND OR v_sp.id IS DISTINCT FROM (r->>'sp_version_id')::uuid OR v_sp.sp_paise_per_m>9007199254740991
  THEN RAISE EXCEPTION 'Current SP changed or missing; refresh and review price'; END IF;
  v_amount:=round(v_qty*v_sp.sp_paise_per_m/1000);
  v_total:=v_total+v_amount;
  IF v_total>9007199254740991 THEN RAISE EXCEPTION 'Sale amount exceeds supported money range'; END IF;
  SELECT cp_paise_per_m INTO v_cp FROM public.fabric_stock_costs WHERE fabric_stock_id=t.fabric_stock_id ORDER BY revision DESC LIMIT 1;
  INSERT INTO public.order_items(order_id,fabric_stock_id,thaan_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise)
  VALUES(v_order,t.fabric_stock_id,t.id,v_qty,'mm',v_sp.sp_paise_per_m,v_amount) RETURNING id INTO v_item;
  INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise) VALUES(v_item,v_cp);
  INSERT INTO public.inventory_movements(kind,fabric_stock_id,thaan_id,inventory_item_id,quantity,unit,source_location_id,order_item_id,reason,reference,actor_id)
  VALUES('SALE',t.fabric_stock_id,t.id,(r->>'inventory_item_id')::uuid,v_qty,'mm',p_source,v_item,'Direct Fabric Sale','ORDER:'||v_order::text,auth.uid());
  IF public.inventory_balance((r->>'inventory_item_id')::uuid,NULL)=0 THEN
   UPDATE public.thaans SET status='depleted',updated_at=now() WHERE id=t.id;
  END IF;
 END LOOP;
 UPDATE public.orders SET status='completed',final_customer_price_paise=v_total,completed_at=now() WHERE id=v_order;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'complete_direct_fabric_sale','orders',v_order,jsonb_build_object('source',p_source,'total_paise',v_total,'items',p_items),'SALE:'||p_request_id::text);
 RETURN v_order;
END; $function$
;
CREATE OR REPLACE FUNCTION public.complete_counter_fabric_sale(p_request_id uuid, p_source uuid, p_items jsonb, p_customer uuid, p_payment_confirmed boolean, p_reference text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE o public.orders%rowtype; payload jsonb; r jsonb; t public.thaans%rowtype;
 v_order uuid:=gen_random_uuid(); v_item uuid; v_sp bigint;
 v_cp bigint; v_qty numeric; v_amount bigint; v_total bigint:=0; v_customer jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') OR NOT public.has_perm(auth.uid(),'pos.enter_price')
 THEN RAISE EXCEPTION 'Authorized Owner or Counter required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=p_source AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom'))) THEN RAISE EXCEPTION 'Fabric sales require an active Showroom source'; END IF;
 IF p_request_id IS NULL OR p_source IS NULL OR p_payment_confirmed IS DISTINCT FROM true
 OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Request, source, cuts and received payment required'; END IF;
 IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 OR
 (SELECT count(DISTINCT value->>'inventory_item_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items)
 THEN RAISE EXCEPTION 'Supply 1 to 50 distinct internal Than cuts'; END IF;
 payload:=jsonb_build_object('source',p_source,'items',p_items,'customer',p_customer,'reference',nullif(btrim(p_reference),''),'payment_confirmed',true);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,6));
 SELECT * INTO o FROM public.orders WHERE sale_request_id=p_request_id;
 IF FOUND THEN
  IF o.sale_request_payload IS DISTINCT FROM payload OR (o.created_by IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(),'owner'))
   THEN RAISE EXCEPTION 'Sale request reused with different data or actor'; END IF;
  IF o.status<>'completed' THEN RAISE EXCEPTION 'Sale request is not completed'; END IF;
  RETURN o.id;
 END IF;
 IF p_customer IS NOT NULL THEN
  SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO v_customer FROM public.customers WHERE id=p_customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer does not exist'; END IF;
 ELSE v_customer:=jsonb_build_object('name','Walk-in customer'); END IF;
 -- Parent locks also serialize Owner CP/SP revisions; item and location locks
 -- follow the ledger/transfer ordering. Price is checked after locking.
 PERFORM 1 FROM public.fabric_stock s WHERE s.id IN(SELECT th.fabric_stock_id FROM public.thaans th
 JOIN public.inventory_items i ON i.thaan_id=th.id JOIN jsonb_array_elements(p_items) x ON i.id=(x->>'inventory_item_id')::uuid) ORDER BY s.id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items i JOIN jsonb_array_elements(p_items) x ON i.id=(x->>'inventory_item_id')::uuid ORDER BY i.id FOR UPDATE OF i;
 PERFORM 1 FROM public.locations WHERE id=p_source AND active AND kind IN ('workshop','showroom','showroom_sublocation') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Workshop or Showroom source required'; END IF;
 INSERT INTO public.orders(id,code,kind,customer_id,source_location_id,created_by,reference,sale_request_id,sale_request_payload,customer_snapshot,payment_confirmed_at)
 VALUES(v_order,'SALE-'||replace(v_order::text,'-',''),'direct_fabric_sale',p_customer,p_source,auth.uid(),nullif(btrim(p_reference),''),p_request_id,payload,v_customer,now());
 FOR r IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'inventory_item_id' LOOP
  v_qty:=(r->>'quantity')::numeric;
  IF v_qty IS NULL OR v_qty<=0 OR v_qty<>trunc(v_qty) OR v_qty>2147483647 THEN RAISE EXCEPTION 'Positive integer millimetre quantity required'; END IF;
  SELECT th.* INTO t FROM public.thaans th JOIN public.inventory_items i ON i.thaan_id=th.id
  JOIN public.fabric_stock s ON s.id=th.fabric_stock_id WHERE i.id=(r->>'inventory_item_id')::uuid
  AND i.unit='mm' AND th.status='active' AND s.entry_state IN ('complete','correcting','legacy_pending');
  IF NOT FOUND THEN RAISE EXCEPTION 'Located active internal Than required'; END IF;
  IF jsonb_typeof(r->'sp_paise_per_m') IS DISTINCT FROM 'number' OR (r->>'sp_paise_per_m')::numeric<>trunc((r->>'sp_paise_per_m')::numeric) OR (r->>'sp_paise_per_m')::numeric<0 OR (r->>'sp_paise_per_m')::numeric>9007199254740991 THEN RAISE EXCEPTION 'Explicit nonnegative exact per-metre selling price required'; END IF;
  v_sp:=(r->>'sp_paise_per_m')::bigint;
  v_amount:=round(v_qty*v_sp/1000);
  v_total:=v_total+v_amount;
  IF v_total>9007199254740991 THEN RAISE EXCEPTION 'Sale amount exceeds supported money range'; END IF;
  SELECT cp_paise_per_m INTO v_cp FROM public.fabric_stock_costs WHERE fabric_stock_id=t.fabric_stock_id ORDER BY revision DESC LIMIT 1;
  INSERT INTO public.order_items(order_id,fabric_stock_id,thaan_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise)
  VALUES(v_order,t.fabric_stock_id,t.id,v_qty,'mm',v_sp,v_amount) RETURNING id INTO v_item;
  INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise) VALUES(v_item,v_cp);
  INSERT INTO public.inventory_movements(kind,fabric_stock_id,thaan_id,inventory_item_id,quantity,unit,source_location_id,order_item_id,reason,reference,actor_id)
  VALUES('SALE',t.fabric_stock_id,t.id,(r->>'inventory_item_id')::uuid,v_qty,'mm',p_source,v_item,'Direct Fabric Sale','ORDER:'||v_order::text,auth.uid());
  IF public.inventory_balance((r->>'inventory_item_id')::uuid,NULL)=0 THEN
   UPDATE public.thaans SET status='depleted',updated_at=now() WHERE id=t.id;
  END IF;
 END LOOP;
 UPDATE public.orders SET status='completed',final_customer_price_paise=v_total,completed_at=now() WHERE id=v_order;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'complete_counter_fabric_sale','orders',v_order,jsonb_build_object('source',p_source,'total_paise',v_total,'items',p_items),'SALE:'||p_request_id::text);
 RETURN v_order;
END; $function$
;
CREATE OR REPLACE FUNCTION public.complete_finished_product_sale(p_request uuid, p_source uuid, p_items jsonb, p_customer uuid, p_payment_confirmed boolean, p_reference text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE saved public.orders%rowtype; payload_value jsonb; customer_value jsonb; result uuid:=gen_random_uuid(); row_value jsonb; piece public.finished_products%rowtype; price public.finished_product_prices%rowtype; inv uuid; line_id uuid; total numeric:=0; cost_id uuid; reviewed_id uuid; cost_amount bigint; evidence jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') THEN RAISE EXCEPTION 'Authorized Owner or Counter required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=p_source AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom'))) THEN RAISE EXCEPTION 'Finished Product sales require an active Showroom source'; END IF;
 IF p_request IS NULL OR p_source IS NULL OR p_payment_confirmed IS DISTINCT FROM true OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Request, source, 1–50 pieces and confirmed received payment required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) WHERE jsonb_typeof(value)<>'object' OR (value-ARRAY['piece_id','sp_version_id'])<>'{}'::jsonb) THEN RAISE EXCEPTION 'Only explicit piece ID and expected SP version are accepted'; END IF;
 IF (SELECT count(DISTINCT value->>'piece_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Distinct explicit physical pieces required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'source',p_source,'items',p_items,'customer',p_customer,'payment_confirmed',true,'reference',nullif(btrim(p_reference),''));
 -- Shared with Phase 6: sale request IDs are unique across sale kinds.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,6));
 SELECT * INTO saved FROM public.orders WHERE sale_request_id=p_request;
 IF FOUND THEN
  IF saved.kind<>'finished_product_sale' OR saved.created_by IS DISTINCT FROM auth.uid() OR saved.sale_request_payload IS DISTINCT FROM payload_value OR saved.status<>'completed' THEN RAISE EXCEPTION 'Sale request already used with different data or actor'; END IF;
  RETURN saved.id;
 END IF;
 IF p_customer IS NULL THEN customer_value:=jsonb_build_object('name','Walk-in customer');
 ELSE SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO customer_value FROM public.customers WHERE id=p_customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'Existing customer required'; END IF;
 END IF;
 -- Job locks serialize Phase 12 SP/cost revisions. Then take the same stable
 -- inventory/location lock order used by transfers before locking piece rows.
 PERFORM 1 FROM public.production_jobs WHERE id IN(SELECT p.production_job_id FROM public.finished_products p JOIN jsonb_array_elements(p_items) x ON p.id=(x->>'piece_id')::uuid) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items WHERE finished_product_id IN(SELECT (value->>'piece_id')::uuid FROM jsonb_array_elements(p_items)) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.locations WHERE id=p_source AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active sale location required'; END IF;
 INSERT INTO public.orders(id,code,kind,customer_id,source_location_id,created_by,reference,sale_request_id,sale_request_payload,customer_snapshot,payment_confirmed_at)
 VALUES(result,'PRODUCT-SALE-'||replace(result::text,'-',''),'finished_product_sale',p_customer,p_source,auth.uid(),nullif(btrim(p_reference),''),p_request,payload_value,customer_value,now());
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'piece_id' LOOP
  SELECT * INTO piece FROM public.finished_products WHERE id=(row_value->>'piece_id')::uuid AND status='available' AND current_location_id=p_source FOR UPDATE;
  SELECT id INTO inv FROM public.inventory_items WHERE finished_product_id=piece.id AND unit='pc';
  IF piece.id IS NULL OR inv IS NULL OR public.inventory_balance(inv,p_source)<>1 THEN RAISE EXCEPTION 'Available physical piece at selected source required'; END IF;
  SELECT * INTO price FROM public.finished_product_prices WHERE finished_product_id=piece.id ORDER BY revision DESC LIMIT 1;
  IF price.id IS NULL OR price.id IS DISTINCT FROM (row_value->>'sp_version_id')::uuid OR price.sp_paise NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Saved Workshop SP changed or missing; refresh and review'; END IF;
  SELECT cost_version_id INTO reviewed_id FROM public.finished_product_price_reviews WHERE price_id=price.id;
  SELECT id INTO cost_id FROM public.production_cost_versions WHERE production_job_id=piece.production_job_id ORDER BY revision DESC LIMIT 1;
  SELECT amount_paise INTO cost_amount FROM public.finished_product_cost_allocations WHERE finished_product_id=piece.id AND cost_version_id=cost_id;
  IF reviewed_id IS NULL OR cost_amount IS NULL OR NOT EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=cost_id AND payload ? 'materials') THEN RAISE EXCEPTION 'Reviewed price and recorded production fabric CP required'; END IF;
  SELECT jsonb_build_object('quantity_snapshot',v.quantity_snapshot,'total_paise',(SELECT coalesce(sum(amount_paise),0) FROM public.production_cost_lines WHERE cost_version_id=v.id),'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.production_cost_lines l WHERE l.cost_version_id=v.id),'[]')) INTO evidence FROM public.production_cost_versions v WHERE v.id=cost_id;
  total:=total+price.sp_paise;
  IF total>9007199254740991 THEN RAISE EXCEPTION 'Total exceeds supported exact money range'; END IF;
  INSERT INTO public.order_items(order_id,finished_product_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) VALUES(result,piece.id,1,'pc',price.sp_paise,price.sp_paise) RETURNING id INTO line_id;
  INSERT INTO public.order_item_financials(order_item_id,production_cost_snapshot_paise) VALUES(line_id,cost_amount);
  INSERT INTO public.finished_product_sale_snapshots(order_item_id,price_version_id,cost_version_id,reviewed_cost_version_id,cost_evidence,item_snapshot) VALUES(line_id,price.id,cost_id,reviewed_id,evidence,(SELECT jsonb_build_object('barcode',b.code,'product',product.name,'design',coalesce(design.name,j.custom_design),'job_code',j.code,'piece_number',piece.piece_number,'source',loc.name,'actor',actor.full_name) FROM public.barcodes b JOIN public.products product ON product.id=piece.product_id LEFT JOIN public.designs design ON design.id=piece.design_id JOIN public.production_jobs j ON j.id=piece.production_job_id JOIN public.locations loc ON loc.id=p_source LEFT JOIN public.profiles actor ON actor.id=auth.uid() WHERE b.id=piece.barcode_id));
  INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference) VALUES(inv,'SALE',piece.id,1,'pc',p_source,line_id,auth.uid(),'Finished Product Sale','ORDER:'||result::text);
  UPDATE public.finished_products SET status='sold' WHERE id=piece.id;
 END LOOP;
 UPDATE public.orders SET status='completed',final_customer_price_paise=total::bigint,completed_at=now() WHERE id=result;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'complete_finished_product_sale','orders',result,jsonb_build_object('source',p_source,'total_paise',total,'items',p_items),'PRODUCT-SALE:'||p_request::text);
 RETURN result;
END; $function$
;
CREATE OR REPLACE FUNCTION public.complete_counter_fabric_sale(p_request_id uuid, p_source uuid, p_items jsonb, p_customer uuid, p_payment_confirmed boolean, p_reference text, p_salesperson uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE o public.orders%rowtype; payload jsonb; r jsonb; t public.thaans%rowtype;
 v_order uuid:=gen_random_uuid(); v_item uuid; v_sp bigint;
 v_cp bigint; v_qty numeric; v_amount bigint; v_total bigint:=0; v_customer jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') OR NOT public.has_perm(auth.uid(),'pos.enter_price')
 THEN RAISE EXCEPTION 'Authorized Owner or Counter required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=p_source AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom'))) THEN RAISE EXCEPTION 'Fabric sales require an active Showroom source'; END IF;
 IF p_request_id IS NULL OR p_source IS NULL OR p_payment_confirmed IS DISTINCT FROM true
 OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Request, source, cuts and received payment required'; END IF;
 IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 OR
 (SELECT count(DISTINCT value->>'inventory_item_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items)
 THEN RAISE EXCEPTION 'Supply 1 to 50 distinct internal Than cuts'; END IF;
 payload:=jsonb_build_object('salesperson',p_salesperson,'source',p_source,'items',p_items,'customer',p_customer,'reference',nullif(btrim(p_reference),''),'payment_confirmed',true);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,6));
 SELECT * INTO o FROM public.orders WHERE sale_request_id=p_request_id;
 IF FOUND THEN
  IF o.sale_request_payload IS DISTINCT FROM payload OR (o.created_by IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(),'owner'))
   THEN RAISE EXCEPTION 'Sale request reused with different data or actor'; END IF;
  IF o.status<>'completed' THEN RAISE EXCEPTION 'Sale request is not completed'; END IF;
  RETURN o.id;
 END IF;
 IF p_customer IS NOT NULL THEN
  SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO v_customer FROM public.customers WHERE id=p_customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer does not exist'; END IF;
 ELSE v_customer:=jsonb_build_object('name','Walk-in customer'); END IF;
 -- Parent locks also serialize Owner CP/SP revisions; item and location locks
 -- follow the ledger/transfer ordering. Price is checked after locking.
 PERFORM 1 FROM public.fabric_stock s WHERE s.id IN(SELECT th.fabric_stock_id FROM public.thaans th
 JOIN public.inventory_items i ON i.thaan_id=th.id JOIN jsonb_array_elements(p_items) x ON i.id=(x->>'inventory_item_id')::uuid) ORDER BY s.id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items i JOIN jsonb_array_elements(p_items) x ON i.id=(x->>'inventory_item_id')::uuid ORDER BY i.id FOR UPDATE OF i;
 PERFORM 1 FROM public.locations WHERE id=p_source AND active AND kind IN ('workshop','showroom','showroom_sublocation') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Workshop or Showroom source required'; END IF;
 INSERT INTO public.orders(id,code,kind,customer_id,source_location_id,created_by,salesperson_user_id,reference,sale_request_id,sale_request_payload,customer_snapshot,payment_confirmed_at)
 VALUES(v_order,'SALE-'||replace(v_order::text,'-',''),'direct_fabric_sale',p_customer,p_source,auth.uid(),p_salesperson,nullif(btrim(p_reference),''),p_request_id,payload,v_customer,now());
 FOR r IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'inventory_item_id' LOOP
  v_qty:=(r->>'quantity')::numeric;
  IF v_qty IS NULL OR v_qty<=0 OR v_qty<>trunc(v_qty) OR v_qty>2147483647 THEN RAISE EXCEPTION 'Positive integer millimetre quantity required'; END IF;
  SELECT th.* INTO t FROM public.thaans th JOIN public.inventory_items i ON i.thaan_id=th.id
  JOIN public.fabric_stock s ON s.id=th.fabric_stock_id WHERE i.id=(r->>'inventory_item_id')::uuid
  AND i.unit='mm' AND th.status='active' AND s.entry_state IN ('complete','correcting','legacy_pending');
  IF NOT FOUND THEN RAISE EXCEPTION 'Located active internal Than required'; END IF;
  IF jsonb_typeof(r->'sp_paise_per_m') IS DISTINCT FROM 'number' OR (r->>'sp_paise_per_m')::numeric<>trunc((r->>'sp_paise_per_m')::numeric) OR (r->>'sp_paise_per_m')::numeric<0 OR (r->>'sp_paise_per_m')::numeric>9007199254740991 THEN RAISE EXCEPTION 'Explicit nonnegative exact per-metre selling price required'; END IF;
  v_sp:=(r->>'sp_paise_per_m')::bigint;
  v_amount:=round(v_qty*v_sp/1000);
  v_total:=v_total+v_amount;
  IF v_total>9007199254740991 THEN RAISE EXCEPTION 'Sale amount exceeds supported money range'; END IF;
  SELECT cp_paise_per_m INTO v_cp FROM public.fabric_stock_costs WHERE fabric_stock_id=t.fabric_stock_id ORDER BY revision DESC LIMIT 1;
  INSERT INTO public.order_items(order_id,fabric_stock_id,thaan_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise)
  VALUES(v_order,t.fabric_stock_id,t.id,v_qty,'mm',v_sp,v_amount) RETURNING id INTO v_item;
  INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise) VALUES(v_item,v_cp);
  INSERT INTO public.inventory_movements(kind,fabric_stock_id,thaan_id,inventory_item_id,quantity,unit,source_location_id,order_item_id,reason,reference,actor_id)
  VALUES('SALE',t.fabric_stock_id,t.id,(r->>'inventory_item_id')::uuid,v_qty,'mm',p_source,v_item,'Direct Fabric Sale','ORDER:'||v_order::text,auth.uid());
  IF public.inventory_balance((r->>'inventory_item_id')::uuid,NULL)=0 THEN
   UPDATE public.thaans SET status='depleted',updated_at=now() WHERE id=t.id;
  END IF;
 END LOOP;
 UPDATE public.orders SET status='completed',final_customer_price_paise=v_total,completed_at=now() WHERE id=v_order;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'complete_counter_fabric_sale','orders',v_order,jsonb_build_object('source',p_source,'total_paise',v_total,'items',p_items),'SALE:'||p_request_id::text);
 RETURN v_order;
END; $function$
;
CREATE OR REPLACE FUNCTION public.complete_finished_product_sale(p_request uuid, p_source uuid, p_items jsonb, p_customer uuid, p_payment_confirmed boolean, p_reference text, p_salesperson uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE saved public.orders%rowtype; payload_value jsonb; customer_value jsonb; result uuid:=gen_random_uuid(); row_value jsonb; piece public.finished_products%rowtype; price public.finished_product_prices%rowtype; inv uuid; line_id uuid; total numeric:=0; cost_id uuid; reviewed_id uuid; cost_amount bigint; evidence jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') THEN RAISE EXCEPTION 'Authorized Owner or Counter required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=p_source AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom'))) THEN RAISE EXCEPTION 'Finished Product sales require an active Showroom source'; END IF;
 IF p_request IS NULL OR p_source IS NULL OR p_payment_confirmed IS DISTINCT FROM true OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Request, source, 1–50 pieces and confirmed received payment required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) WHERE jsonb_typeof(value)<>'object' OR (value-ARRAY['piece_id','sp_version_id'])<>'{}'::jsonb) THEN RAISE EXCEPTION 'Only explicit piece ID and expected SP version are accepted'; END IF;
 IF (SELECT count(DISTINCT value->>'piece_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Distinct explicit physical pieces required'; END IF;
 payload_value:=jsonb_build_object('salesperson',p_salesperson,'actor',auth.uid(),'source',p_source,'items',p_items,'customer',p_customer,'payment_confirmed',true,'reference',nullif(btrim(p_reference),''));
 -- Shared with Phase 6: sale request IDs are unique across sale kinds.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,6));
 SELECT * INTO saved FROM public.orders WHERE sale_request_id=p_request;
 IF FOUND THEN
  IF saved.kind<>'finished_product_sale' OR saved.created_by IS DISTINCT FROM auth.uid() OR saved.sale_request_payload IS DISTINCT FROM payload_value OR saved.status<>'completed' THEN RAISE EXCEPTION 'Sale request already used with different data or actor'; END IF;
  RETURN saved.id;
 END IF;
 IF p_customer IS NULL THEN customer_value:=jsonb_build_object('name','Walk-in customer');
 ELSE SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO customer_value FROM public.customers WHERE id=p_customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'Existing customer required'; END IF;
 END IF;
 -- Job locks serialize Phase 12 SP/cost revisions. Then take the same stable
 -- inventory/location lock order used by transfers before locking piece rows.
 PERFORM 1 FROM public.production_jobs WHERE id IN(SELECT p.production_job_id FROM public.finished_products p JOIN jsonb_array_elements(p_items) x ON p.id=(x->>'piece_id')::uuid) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items WHERE finished_product_id IN(SELECT (value->>'piece_id')::uuid FROM jsonb_array_elements(p_items)) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.locations WHERE id=p_source AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active sale location required'; END IF;
 INSERT INTO public.orders(id,code,kind,customer_id,source_location_id,created_by,salesperson_user_id,reference,sale_request_id,sale_request_payload,customer_snapshot,payment_confirmed_at)
 VALUES(result,'PRODUCT-SALE-'||replace(result::text,'-',''),'finished_product_sale',p_customer,p_source,auth.uid(),p_salesperson,nullif(btrim(p_reference),''),p_request,payload_value,customer_value,now());
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'piece_id' LOOP
  SELECT * INTO piece FROM public.finished_products WHERE id=(row_value->>'piece_id')::uuid AND status='available' AND current_location_id=p_source FOR UPDATE;
  SELECT id INTO inv FROM public.inventory_items WHERE finished_product_id=piece.id AND unit='pc';
  IF piece.id IS NULL OR inv IS NULL OR public.inventory_balance(inv,p_source)<>1 THEN RAISE EXCEPTION 'Available physical piece at selected source required'; END IF;
  SELECT * INTO price FROM public.finished_product_prices WHERE finished_product_id=piece.id ORDER BY revision DESC LIMIT 1;
  IF price.id IS NULL OR price.id IS DISTINCT FROM (row_value->>'sp_version_id')::uuid OR price.sp_paise NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Saved Workshop SP changed or missing; refresh and review'; END IF;
  SELECT cost_version_id INTO reviewed_id FROM public.finished_product_price_reviews WHERE price_id=price.id;
  SELECT id INTO cost_id FROM public.production_cost_versions WHERE production_job_id=piece.production_job_id ORDER BY revision DESC LIMIT 1;
  SELECT amount_paise INTO cost_amount FROM public.finished_product_cost_allocations WHERE finished_product_id=piece.id AND cost_version_id=cost_id;
  IF reviewed_id IS NULL OR cost_amount IS NULL OR NOT EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=cost_id AND payload ? 'materials') THEN RAISE EXCEPTION 'Reviewed price and recorded production fabric CP required'; END IF;
  SELECT jsonb_build_object('quantity_snapshot',v.quantity_snapshot,'total_paise',(SELECT coalesce(sum(amount_paise),0) FROM public.production_cost_lines WHERE cost_version_id=v.id),'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.production_cost_lines l WHERE l.cost_version_id=v.id),'[]')) INTO evidence FROM public.production_cost_versions v WHERE v.id=cost_id;
  total:=total+price.sp_paise;
  IF total>9007199254740991 THEN RAISE EXCEPTION 'Total exceeds supported exact money range'; END IF;
  INSERT INTO public.order_items(order_id,finished_product_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) VALUES(result,piece.id,1,'pc',price.sp_paise,price.sp_paise) RETURNING id INTO line_id;
  INSERT INTO public.order_item_financials(order_item_id,production_cost_snapshot_paise) VALUES(line_id,cost_amount);
  INSERT INTO public.finished_product_sale_snapshots(order_item_id,price_version_id,cost_version_id,reviewed_cost_version_id,cost_evidence,item_snapshot) VALUES(line_id,price.id,cost_id,reviewed_id,evidence,(SELECT jsonb_build_object('barcode',b.code,'product',product.name,'design',coalesce(design.name,j.custom_design),'job_code',j.code,'piece_number',piece.piece_number,'source',loc.name,'actor',actor.full_name) FROM public.barcodes b JOIN public.products product ON product.id=piece.product_id LEFT JOIN public.designs design ON design.id=piece.design_id JOIN public.production_jobs j ON j.id=piece.production_job_id JOIN public.locations loc ON loc.id=p_source LEFT JOIN public.profiles actor ON actor.id=auth.uid() WHERE b.id=piece.barcode_id));
  INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference) VALUES(inv,'SALE',piece.id,1,'pc',p_source,line_id,auth.uid(),'Finished Product Sale','ORDER:'||result::text);
  UPDATE public.finished_products SET status='sold' WHERE id=piece.id;
 END LOOP;
 UPDATE public.orders SET status='completed',final_customer_price_paise=total::bigint,completed_at=now() WHERE id=result;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'complete_finished_product_sale','orders',result,jsonb_build_object('source',p_source,'total_paise',total,'items',p_items),'PRODUCT-SALE:'||p_request::text);
 RETURN result;
END; $function$
;
CREATE OR REPLACE FUNCTION public.fabric_stock_catalog(p_barcode text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry']) THEN RAISE EXCEPTION 'Active operational role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'fabric_name',x->>'batch_code') FROM (
 SELECT jsonb_build_object('id',s.id,'fabric_id',f.id,'fabric_code',f.code,'fabric_name',f.name,'colour',f.colour,
 'batch_id',b.id,'batch_code',b.code,'barcode',bc.code,'entry_state',s.entry_state,'created_by',s.created_by,
 'sp_paise_per_m',(SELECT sp_paise_per_m FROM public.fabric_stock_prices WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1),
 'original_mm',coalesce((SELECT sum(original_mm) FROM public.thaans WHERE fabric_stock_id=s.id),0),
 'available_mm',coalesce((SELECT sum(CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL)
 ELSE coalesce((SELECT sum(delta_mm) FROM public.stock_movements WHERE thaan_id=t.id),0) END)
 FROM public.thaans t LEFT JOIN public.inventory_items i ON i.thaan_id=t.id WHERE t.fabric_stock_id=s.id),0),
 'unlocated_thans',(SELECT count(*) FROM public.thaans t WHERE fabric_stock_id=s.id AND status IN ('active','depleted') AND NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=t.id)),
 'thans',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'original_mm',t.original_mm,'status',t.status) ORDER BY t.created_at,t.id) FROM public.thaans t WHERE t.fabric_stock_id=s.id),'[]'::jsonb),
 'locations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',z.id,'name',z.name,'quantity_mm',z.qty)) FROM (
 SELECT l.id,l.name,sum(CASE WHEN m.destination_location_id=l.id THEN m.quantity ELSE -m.quantity END) qty
 FROM public.inventory_movements m JOIN public.locations l ON l.id IN (m.source_location_id,m.destination_location_id)
 WHERE m.fabric_stock_id=s.id AND m.inventory_item_id IS NOT NULL GROUP BY l.id,l.name
 HAVING sum(CASE WHEN m.destination_location_id=l.id THEN m.quantity ELSE -m.quantity END)<>0) z),'[]'::jsonb)) x
 FROM public.fabric_stock s JOIN public.fabrics f ON f.id=s.fabric_id JOIN public.receiving_batches b ON b.id=s.batch_id JOIN public.barcodes bc ON bc.id=s.barcode_id
 WHERE p_barcode IS NULL OR bc.code=btrim(p_barcode)) q),'[]'::jsonb);
END; $function$
;
CREATE OR REPLACE FUNCTION public.consumable_catalog()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry','counter']) THEN RAISE EXCEPTION 'Active stock role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name,x.id) FROM (
 SELECT m.id,m.name,m.category,m.unit,m.active,i.id inventory_item_id,
 CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL) END quantity,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'quantity',public.inventory_balance(i.id,l.id)) ORDER BY l.name,l.id)
 FROM public.locations l WHERE l.active AND i.id IS NOT NULL AND public.inventory_balance(i.id,l.id)>0),'[]'::jsonb) locations
 FROM public.materials m LEFT JOIN public.inventory_items i ON i.material_id=m.id
 WHERE m.active OR public.has_role(auth.uid(),'owner')) x),'[]'::jsonb);
END; $function$
;
CREATE OR REPLACE FUNCTION public.inventory_catalog()
 RETURNS TABLE(item_kind text, item_id uuid, inventory_item_id uuid, label text, unit text, quantity numeric, unlinked_movements bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry']) THEN RAISE EXCEPTION 'Active inventory role required'; END IF;
 RETURN QUERY
 SELECT 'fabric',t.id,i.id,coalesce(f.name,'Unlinked fabric')||' / '||coalesce(b.code,'Unlinked batch')||' / Than '||coalesce(t.barcode,t.id::text),'mm',
 CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL) ELSE coalesce((SELECT sum(m.delta_mm) FROM public.stock_movements m WHERE m.thaan_id=t.id),0) END,
 (SELECT count(*) FROM public.inventory_movements m WHERE m.thaan_id=t.id AND m.inventory_item_id IS NULL)
 FROM public.thaans t LEFT JOIN public.inventory_items i ON i.thaan_id=t.id LEFT JOIN public.fabrics f ON f.id=t.fabric_id LEFT JOIN public.receiving_batches b ON b.id=t.batch_id
 UNION ALL SELECT 'consumable',m.id,i.id,m.name,m.unit,CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL) ELSE m.qty_on_hand END,(SELECT count(*) FROM public.inventory_movements x WHERE x.material_id=m.id AND x.inventory_item_id IS NULL)
 FROM public.materials m LEFT JOIN public.inventory_items i ON i.material_id=m.id
 UNION ALL SELECT 'finished_product',p.id,i.id,pr.name||' / Piece '||p.piece_number::text,'pc',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL) ELSE CASE WHEN p.status='available' THEN 1 ELSE 0 END END,(SELECT count(*) FROM public.inventory_movements x WHERE x.finished_product_id=p.id AND x.inventory_item_id IS NULL)
 FROM public.finished_products p JOIN public.products pr ON pr.id=p.product_id LEFT JOIN public.inventory_items i ON i.finished_product_id=p.id;
END; $function$
;
CREATE OR REPLACE FUNCTION public.material_available_qty(p_material uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry']) AND NOT(public.has_role(auth.uid(),'tailor') AND (
 EXISTS(SELECT 1 FROM public.tailoring_job_lines l JOIN public.tailoring_jobs j ON j.id=l.job_id WHERE l.material_id=p_material AND j.tailor_id=auth.uid()) OR
 EXISTS(SELECT 1 FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id WHERE l.material_id=p_material AND public.owns_tailor_assignment(i.tailor_assignment_id)))) THEN RAISE EXCEPTION 'Active inventory role or assigned material required'; END IF;
 SELECT id INTO v_id FROM public.inventory_items WHERE material_id=p_material;
 IF FOUND THEN RETURN public.inventory_balance(v_id,NULL); END IF;
 RETURN (SELECT qty_on_hand FROM public.materials WHERE id=p_material);
END; $function$
;
CREATE OR REPLACE FUNCTION public.workshop_fabric_inventory()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) THEN RAISE EXCEPTION 'Authorized inventory role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY batch_created_at DESC,batch_id,group_position NULLS FIRST,group_id,ordinal NULLS LAST,thaan_id) FROM (
 SELECT t.id thaan_id,s.id stock_id,b.id batch_id,b.code batch_code,b.created_at batch_created_at,b.received_on arrival_date,
 coalesce(rb.provider_name,sp.name,'Unknown supplier') supplier,coalesce(g.id::text,f.id::text) group_id,coalesce(g.name,f.name) type_name,g.label_position group_position,
 t.rack,f.design,v.ordinal,coalesce(v.code,t.barcode,bc.code) barcode,(v.id IS NOT NULL) registered,f.name name,coalesce(f.colour,v.draft_details->>'colour') colour,
 t.original_mm,coalesce(t.original_mm,(v.draft_details->>'length_mm')::integer) saved_length_mm,t.status,
 CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,w.id) END workshop_mm,
 (i.id IS NULL AND t.original_mm IS NOT NULL) unlocated,
 (public.can_view_thaan_cp(s.created_by)) cp_visible,
 CASE WHEN public.can_view_thaan_cp(s.created_by) THEN coalesce(c.cp_paise_per_m,(v.draft_details->>'cp')::bigint) END cp_paise_per_m,
 (nullif(btrim(f.name),'') IS NULL OR nullif(btrim(coalesce(g.name,f.name)),'') IS NULL OR coalesce(t.original_mm,(v.draft_details->>'length_mm')::integer,0)<=0 OR coalesce(c.cp_paise_per_m,(v.draft_details->>'cp')::bigint,0)<=0) incomplete,
 (public.has_perm(auth.uid(),'inventory.edit_thaan') AND public.can_edit_thaan_registration(s.created_by)) can_edit,
 public.has_perm(auth.uid(),'inventory.correct_cp') can_correct_cp,public.has_perm(auth.uid(),'inventory.correct_workshop') can_correct_length,
 public.has_perm(auth.uid(),'inventory.fill_missing_cp') can_fill_cp,
 md5(concat_ws(':',t.xmin::text,f.xmin::text,g.xmin::text,v.xmin::text,coalesce(c.revision,0),CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,w.id)::text END)) version
 FROM public.thaans t JOIN public.fabric_stock s ON s.id=t.fabric_stock_id JOIN public.fabrics f ON f.id=s.fabric_id
 JOIN public.receiving_batches b ON b.id=s.batch_id JOIN public.barcodes bc ON bc.id=s.barcode_id
 LEFT JOIN public.suppliers sp ON sp.id=b.supplier_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id
 LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id LEFT JOIN public.stock_registration_batches rb ON rb.batch_id=b.id
 LEFT JOIN public.inventory_items i ON i.thaan_id=t.id
 LEFT JOIN LATERAL(SELECT revision,cp_paise_per_m FROM public.fabric_stock_costs WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1)c ON true
 CROSS JOIN(SELECT id FROM public.locations WHERE kind='workshop' AND active)w
 WHERE t.status NOT IN('archived','depleted') AND (t.original_mm IS NULL OR i.id IS NULL OR public.inventory_balance(i.id,w.id)>0)
 )r),'[]'::jsonb); END; $function$
;
ALTER POLICY "read fabrics" ON public.fabrics USING(has_any_role(auth.uid(), ARRAY['owner'::text, 'stock_entry'::text, 'counter'::text, 'tailor'::text]));
ALTER POLICY "inventory_items_operational_read" ON public.inventory_items USING((has_any_role(auth.uid(), ARRAY['owner'::text, 'counter'::text, 'stock_entry'::text]) OR (has_role(auth.uid(), 'tailor'::text) AND ((EXISTS ( SELECT 1
   FROM (tailoring_job_lines l
     JOIN tailoring_jobs j ON ((j.id = l.job_id)))
  WHERE ((j.tailor_id = auth.uid()) AND ((l.thaan_id = inventory_items.thaan_id) OR (l.material_id = inventory_items.material_id))))) OR (EXISTS ( SELECT 1
   FROM (material_issue_lines l
     JOIN material_issues i ON ((i.id = l.material_issue_id)))
  WHERE (owns_tailor_assignment(i.tailor_assignment_id) AND ((l.thaan_id = inventory_items.thaan_id) OR (l.material_id = inventory_items.material_id)))))))));
ALTER POLICY "phase3_movement_operational_read" ON public.inventory_movements USING((has_any_role(auth.uid(), ARRAY['counter'::text, 'stock_entry'::text]) OR (has_role(auth.uid(), 'tailor'::text) AND ((EXISTS ( SELECT 1
   FROM customer_tailoring_jobs j
  WHERE ((j.id = inventory_movements.customer_tailoring_job_id) AND owns_tailor_assignment(j.tailor_assignment_id)))) OR (EXISTS ( SELECT 1
   FROM production_jobs j
  WHERE ((j.id = inventory_movements.production_job_id) AND owns_tailor_assignment(j.tailor_assignment_id))))))));
ALTER POLICY "read stock_movements" ON public.stock_movements USING((has_any_role(auth.uid(), ARRAY['owner'::text, 'counter'::text, 'stock_entry'::text]) OR (has_role(auth.uid(), 'tailor'::text) AND (EXISTS ( SELECT 1
   FROM tailoring_jobs j
  WHERE ((j.id = stock_movements.job_id) AND (j.tailor_id = auth.uid())))))));
ALTER POLICY "read thaans" ON public.thaans USING((has_any_role(auth.uid(), ARRAY['owner'::text, 'counter'::text, 'stock_entry'::text]) OR (has_role(auth.uid(), 'tailor'::text) AND (EXISTS ( SELECT 1
   FROM (tailoring_job_lines l
     JOIN tailoring_jobs j ON ((j.id = l.job_id)))
  WHERE ((l.thaan_id = thaans.id) AND (j.tailor_id = auth.uid())))))));
DROP POLICY phase3_ecommerce_locations ON public.locations;
CREATE POLICY production_locations ON public.locations FOR SELECT TO authenticated USING(public.has_perm(auth.uid(),'production.view') AND active AND kind IN('workshop','showroom','showroom_sublocation'));
ALTER POLICY "read holds" ON public.holds USING(public.has_any_perm(auth.uid(),ARRAY['inventory.receive','pos.sell','pos.issue_to_tailoring','reports.view']));
-- A location is saleable only when it is an active Showroom or its active floor.
CREATE FUNCTION public.is_showroom_location(p_location uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id
 WHERE l.id=p_location AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom')));
$$;
REVOKE ALL ON FUNCTION public.is_showroom_location(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_showroom_location(uuid) TO authenticated;

CREATE FUNCTION public.production_fabric_projection(p_barcode text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN

 RETURN coalesce((SELECT jsonb_agg(r ORDER BY r->>'fabric_name',r->>'barcode') FROM (
 SELECT jsonb_build_object('id',s.id,'fabric_name',coalesce(g.name,f.name),'batch_code',b.code,
 'colour',f.colour,'barcode',coalesce(v.code,t.barcode,bc.code),
 'cuts',jsonb_build_array(jsonb_build_object('inventory_item_id',i.id,'thaan_id',t.id,
 'locations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'quantity_mm',public.inventory_balance(i.id,l.id)) ORDER BY l.name)
 FROM public.locations l WHERE l.active AND (l.kind='workshop' OR public.is_showroom_location(l.id)) AND public.inventory_balance(i.id,l.id)>0),'[]'::jsonb)))) r
 FROM public.thaans t JOIN public.fabric_stock s ON s.id=t.fabric_stock_id JOIN public.fabrics f ON f.id=s.fabric_id
 JOIN public.receiving_batches b ON b.id=s.batch_id JOIN public.barcodes bc ON bc.id=s.barcode_id JOIN public.inventory_items i ON i.thaan_id=t.id
 LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id
 WHERE t.status='active' AND t.original_mm>0 AND coalesce((SELECT cp_paise_per_m FROM public.fabric_stock_costs WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1),0)>0 AND (p_barcode IS NULL OR btrim(p_barcode) IN(v.code,t.barcode,bc.code))
 AND EXISTS(SELECT 1 FROM public.locations l WHERE l.active AND (l.kind='workshop' OR public.is_showroom_location(l.id)) AND public.inventory_balance(i.id,l.id)>0)
 )q),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.production_fabric_projection(text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.production_fabric_catalog(p_barcode text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN IF NOT public.has_perm(auth.uid(),'production.view') THEN RAISE EXCEPTION 'Production view permission required'; END IF;RETURN public.production_fabric_projection(p_barcode);END; $$;
REVOKE ALL ON FUNCTION public.production_fabric_catalog(text) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.production_fabric_catalog(text) TO authenticated;

CREATE FUNCTION public.pos_reserve_variants(p_barcode text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE type_name text;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Counter required'; END IF;
 SELECT coalesce(g.name,f.name) INTO type_name FROM public.thaans t JOIN public.fabric_stock s ON s.id=t.fabric_stock_id
 JOIN public.fabrics f ON f.id=s.fabric_id JOIN public.barcodes bc ON bc.id=s.barcode_id
 LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id
 WHERE btrim(p_barcode) IN(v.code,t.barcode,bc.code) LIMIT 1;
 RETURN coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(public.production_fabric_projection(NULL)) x
 WHERE x->>'fabric_name'=type_name),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.pos_reserve_variants(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pos_reserve_variants(text) TO authenticated;

-- Safe projection; no Workshop/factory balances, CP, suppliers or staff fields.
CREATE FUNCTION public.showroom_stock(p_kind text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','ecommerce_manager']) THEN RAISE EXCEPTION 'E-commerce role required'; END IF;
 IF p_kind IS NOT NULL AND p_kind NOT IN('fabric','product') THEN RAISE EXCEPTION 'Fabric or product required'; END IF;
 RETURN public.showroom_stock_projection(p_kind);
END; $$;

CREATE FUNCTION public.showroom_stock_projection(p_kind text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(r ORDER BY r->>'name',r->>'barcode'),'[]'::jsonb) FROM (
 SELECT jsonb_build_object('kind','fabric','id',t.id,'barcode',coalesce(v.code,t.barcode,bc.code),'name',coalesce(g.name,f.name),
 'colour',f.colour,'available_mm',sum(public.inventory_balance(i.id,l.id)),
 'locations',jsonb_agg(jsonb_build_object('name',l.name,'quantity_mm',public.inventory_balance(i.id,l.id)) ORDER BY l.name)) r
 FROM public.thaans t JOIN public.fabric_stock s ON s.id=t.fabric_stock_id JOIN public.fabrics f ON f.id=s.fabric_id
 JOIN public.barcodes bc ON bc.id=s.barcode_id JOIN public.inventory_items i ON i.thaan_id=t.id
 LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id
 JOIN public.locations l ON public.is_showroom_location(l.id) AND public.inventory_balance(i.id,l.id)>0
 WHERE t.status='active' AND t.original_mm>0 AND coalesce((SELECT cp_paise_per_m FROM public.fabric_stock_costs WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1),0)>0 AND (p_kind IS NULL OR p_kind='fabric') GROUP BY t.id,v.code,bc.code,f.name,f.colour,g.name
 UNION ALL
 SELECT jsonb_build_object('kind','product','id',p.id,'barcode',bc.code,'name',product.name,'design',coalesce(d.name,j.custom_design),'size',j.size,
 'available_pieces',1,'locations',jsonb_build_array(jsonb_build_object('name',l.name,'quantity',1)))
 FROM public.finished_products p JOIN public.products product ON product.id=p.product_id LEFT JOIN public.designs d ON d.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id
 JOIN public.barcodes bc ON bc.id=p.barcode_id JOIN public.inventory_items i ON i.finished_product_id=p.id
 JOIN public.locations l ON l.id=p.current_location_id AND public.is_showroom_location(l.id)
 WHERE p.status='available' AND public.inventory_balance(i.id,l.id)=1 AND (p_kind IS NULL OR p_kind='product')
 )q;
$$;
REVOKE ALL ON FUNCTION public.showroom_stock_projection(text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.ecommerce_listing_stock() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','ecommerce_manager']) THEN RAISE EXCEPTION 'E-commerce role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('listing_id',l.id,'kind',CASE WHEN EXISTS(SELECT 1 FROM public.listing_finished_product_links WHERE listing_id=l.id) THEN 'product' ELSE 'fabric' END,'stock',coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(public.showroom_stock_projection(NULL)) x WHERE (x->>'kind'='fabric' AND EXISTS(SELECT 1 FROM public.listing_thaan_links WHERE listing_id=l.id AND thaan_id=(x->>'id')::uuid)) OR (x->>'kind'='product' AND EXISTS(SELECT 1 FROM public.listing_finished_product_links WHERE listing_id=l.id AND finished_product_id=(x->>'id')::uuid))),'[]'::jsonb))) FROM public.listings l),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.ecommerce_listing_stock() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecommerce_listing_stock() TO authenticated;
REVOKE ALL ON FUNCTION public.showroom_stock(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.showroom_stock(text) TO authenticated;

CREATE TABLE public.listing_finished_product_links (
 listing_id uuid NOT NULL REFERENCES public.listings(id),finished_product_id uuid NOT NULL REFERENCES public.finished_products(id),
 PRIMARY KEY(listing_id,finished_product_id)
);
ALTER TABLE public.listing_finished_product_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_finished_product_links FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.listing_finished_product_links TO authenticated;
GRANT ALL ON public.listing_finished_product_links TO service_role;
CREATE POLICY listing_product_read ON public.listing_finished_product_links FOR SELECT TO authenticated USING(public.has_perm(auth.uid(),'ecommerce.link_stock'));
CREATE TRIGGER listing_product_audit AFTER INSERT OR DELETE ON public.listing_finished_product_links FOR EACH ROW EXECUTE FUNCTION public.capture_owner_domain_audit();

CREATE FUNCTION public.link_showroom_listing(p_listing uuid,p_kind text,p_stock uuid,p_link boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_perm(auth.uid(),'ecommerce.link_stock') THEN RAISE EXCEPTION 'Listing link permission required'; END IF;
 IF p_listing IS NULL OR p_stock IS NULL OR p_link IS NULL OR p_kind NOT IN('fabric','product') OR p_kind IS NULL THEN RAISE EXCEPTION 'Listing and stock required'; END IF;
 PERFORM 1 FROM public.listings WHERE id=p_listing FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Listing required'; END IF;
 IF p_link AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.showroom_stock_projection(p_kind)) x WHERE x->>'id'=p_stock::text) THEN RAISE EXCEPTION 'Stock must be available in Showroom'; END IF;
 IF p_link AND ((p_kind='fabric' AND EXISTS(SELECT 1 FROM public.listing_finished_product_links WHERE listing_id=p_listing)) OR (p_kind='product' AND EXISTS(SELECT 1 FROM public.listing_thaan_links WHERE listing_id=p_listing))) THEN RAISE EXCEPTION 'Use separate listings for fabric metres and finished pieces'; END IF;
 IF p_link THEN UPDATE public.listings SET stock_mode='linked' WHERE id=p_listing; END IF;
 IF p_kind='fabric' THEN
  IF p_link THEN INSERT INTO public.listing_thaan_links VALUES(p_listing,p_stock) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM public.listing_thaan_links WHERE listing_id=p_listing AND thaan_id=p_stock; END IF;
 ELSE
  IF p_link THEN INSERT INTO public.listing_finished_product_links VALUES(p_listing,p_stock) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM public.listing_finished_product_links WHERE listing_id=p_listing AND finished_product_id=p_stock; END IF;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.link_showroom_listing(uuid,text,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_showroom_listing(uuid,text,uuid,boolean) TO authenticated;
-- Do not permit direct browser linking of hidden Workshop Thaans.
REVOKE INSERT,UPDATE,DELETE ON public.listing_thaan_links FROM authenticated;

CREATE FUNCTION public.storefront_catalog() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'slug',l.slug,'title',l.title,'description',l.description,'images',l.images,
 'price_paise',l.price_paise,'sale_price_paise',l.sale_price_paise,'category',l.category,
 'availability',CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(public.showroom_stock_projection(NULL)) x WHERE (x->>'kind'='fabric' AND EXISTS(SELECT 1 FROM public.listing_thaan_links WHERE listing_id=l.id AND thaan_id=(x->>'id')::uuid)) OR (x->>'kind'='product' AND EXISTS(SELECT 1 FROM public.listing_finished_product_links WHERE listing_id=l.id AND finished_product_id=(x->>'id')::uuid))) THEN 'available' ELSE 'sold_out' END,
 'stock',coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(public.showroom_stock_projection(NULL)) x WHERE
 (x->>'kind'='fabric' AND EXISTS(SELECT 1 FROM public.listing_thaan_links k WHERE k.listing_id=l.id AND k.thaan_id=(x->>'id')::uuid)) OR
 (x->>'kind'='product' AND EXISTS(SELECT 1 FROM public.listing_finished_product_links k WHERE k.listing_id=l.id AND k.finished_product_id=(x->>'id')::uuid))),'[]'::jsonb)) ORDER BY l.slug),'[]'::jsonb)
 FROM public.listings l WHERE l.published AND l.stock_mode='linked';
$$;
REVOKE ALL ON FUNCTION public.storefront_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront_catalog() TO anon,authenticated;

CREATE FUNCTION public.listing_showroom_availability() RETURNS TABLE(listing_id uuid,linked_thaans integer,largest_piece_mm integer,total_linked_mm integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT l.id,count(t.id)::integer,coalesce(max(greatest(0,z.qty-coalesce(h.held,0))),0)::integer,coalesce(sum(z.qty),0)::integer
 FROM public.listings l LEFT JOIN public.listing_thaan_links k ON k.listing_id=l.id
 LEFT JOIN public.thaans t ON t.id=k.thaan_id AND t.status='active' LEFT JOIN public.inventory_items i ON i.thaan_id=t.id
 LEFT JOIN LATERAL(SELECT sum(public.inventory_balance(i.id,loc.id)) qty FROM public.locations loc WHERE public.is_showroom_location(loc.id)) z ON true
 LEFT JOIN LATERAL(SELECT sum(length_mm) held FROM public.holds WHERE thaan_id=t.id AND status='active' AND expires_at>now()) h ON true
 WHERE public.has_any_role(auth.uid(),ARRAY['owner','ecommerce_manager']) OR l.published
 GROUP BY l.id;
$$;
REVOKE ALL ON FUNCTION public.listing_showroom_availability() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listing_showroom_availability() TO authenticated,anon;
CREATE OR REPLACE VIEW public.v_listing_availability WITH(security_invoker=true) AS SELECT * FROM public.listing_showroom_availability();

CREATE FUNCTION public.owner_register_staff(p_user uuid,p_name text,p_roles text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE email_value text;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF nullif(btrim(p_name),'') IS NULL OR length(btrim(p_name))>120 OR cardinality(p_roles) NOT BETWEEN 1 AND 7 OR p_roles IS NULL OR EXISTS(SELECT 1 FROM unnest(p_roles) r WHERE r IS NULL OR r NOT IN('owner','stock_entry','counter','ecommerce_manager','salesperson','tailor','production')) THEN RAISE EXCEPTION 'Name and defined roles required'; END IF;
 SELECT email INTO email_value FROM auth.users WHERE id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'Auth account required'; END IF;
 IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user) THEN
  IF (SELECT array_agg(role_key ORDER BY role_key) FROM public.user_roles WHERE user_id=p_user)=(SELECT array_agg(DISTINCT role ORDER BY role) FROM unnest(p_roles) role)
   AND EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user AND full_name=btrim(p_name) AND email=email_value) THEN RETURN; END IF;
  RAISE EXCEPTION 'Account already has roles; use permission management';
 END IF;
 INSERT INTO public.profiles(id,full_name,email) VALUES(p_user,btrim(p_name),email_value) ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name,email=excluded.email;
 INSERT INTO public.user_roles(user_id,role_key) SELECT p_user,role FROM unnest(p_roles) role;
END; $$;
REVOKE ALL ON FUNCTION public.owner_register_staff(uuid,text,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_register_staff(uuid,text,text[]) TO authenticated;

CREATE FUNCTION public.update_account_name(p_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_active_staff(auth.uid()) OR nullif(btrim(p_name),'') IS NULL OR length(btrim(p_name))>120 THEN RAISE EXCEPTION 'Active account and a name up to 120 characters required'; END IF;
 UPDATE public.profiles SET full_name=btrim(p_name) WHERE id=auth.uid();
END; $$;
REVOKE ALL ON FUNCTION public.update_account_name(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_account_name(text) TO authenticated;
-- Production issuance, fixed issue-time CP, size/custom design, Workshop receipt/SP.
-- These are prospective records. No historical CP, size or consumption is inferred.
CREATE TABLE public.production_issue_fabric_costs (
 issue_line_id uuid PRIMARY KEY REFERENCES public.material_issue_lines(id),
 fabric_cost_id uuid NOT NULL REFERENCES public.fabric_stock_costs(id),
 cp_paise_per_m bigint NOT NULL CHECK(cp_paise_per_m>0),
 amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 0 AND 9007199254740991),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.production_issue_fabric_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_issue_fabric_costs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.production_issue_fabric_costs TO authenticated;
GRANT ALL ON public.production_issue_fabric_costs TO service_role;
CREATE POLICY production_issue_cost_read ON public.production_issue_fabric_costs FOR SELECT TO authenticated USING(public.has_perm(auth.uid(),'inventory.view_registered_cp'));
CREATE TRIGGER production_issue_cost_immutable BEFORE UPDATE OR DELETE ON public.production_issue_fabric_costs FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE TABLE public.production_batch_requests (
 request_id uuid PRIMARY KEY REFERENCES public.production_requests(request_id),
 production_job_id uuid NOT NULL UNIQUE REFERENCES public.production_jobs(id),
 actor_id uuid NOT NULL REFERENCES public.profiles(id),payload jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.production_batch_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_batch_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.production_batch_requests TO authenticated;
GRANT ALL ON public.production_batch_requests TO service_role;
CREATE POLICY production_batch_request_read ON public.production_batch_requests FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER production_batch_request_immutable BEFORE UPDATE OR DELETE ON public.production_batch_requests FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE FUNCTION public.capture_production_fabric_cost(p_line uuid,p_stock uuid,p_quantity numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cost public.fabric_stock_costs%rowtype; amount numeric;
BEGIN
 PERFORM 1 FROM public.fabric_stock WHERE id=p_stock FOR UPDATE;
 SELECT * INTO cost FROM public.fabric_stock_costs WHERE fabric_stock_id=p_stock ORDER BY revision DESC LIMIT 1;
 IF cost.id IS NULL OR cost.cp_paise_per_m<=0 THEN RAISE EXCEPTION 'Record positive Thaan CP before issuing production fabric'; END IF;
 amount:=round(p_quantity*cost.cp_paise_per_m/1000);
 IF amount NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Issued fabric cost exceeds supported money range'; END IF;
 INSERT INTO public.production_issue_fabric_costs VALUES(p_line,cost.id,cost.cp_paise_per_m,amount,clock_timestamp());
END; $$;
REVOKE ALL ON FUNCTION public.capture_production_fabric_cost(uuid,uuid,numeric) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.guard_production_descriptor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='finished_products' THEN
  IF NOT EXISTS(SELECT 1 FROM public.production_jobs WHERE id=NEW.production_job_id AND product_id=NEW.product_id AND design_id IS NOT DISTINCT FROM NEW.design_id) THEN RAISE EXCEPTION 'Piece product/design must match production'; END IF;
 ELSE
  IF (NEW.size,NEW.custom_design) IS DISTINCT FROM(OLD.size,OLD.custom_design) AND NOT(OLD.size IS NULL AND OLD.custom_design IS NULL AND OLD.status='open' AND OLD.created_by=auth.uid() AND NOT EXISTS(SELECT 1 FROM public.production_batch_requests WHERE production_job_id=OLD.id)) THEN RAISE EXCEPTION 'Issued production size and custom design are permanent'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER production_descriptor_immutable BEFORE UPDATE ON public.production_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_production_descriptor();
CREATE TRIGGER production_piece_descriptor BEFORE INSERT ON public.finished_products FOR EACH ROW EXECUTE FUNCTION public.guard_production_descriptor();
CREATE FUNCTION public.check_production_design() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job public.production_jobs%rowtype;
BEGIN
 SELECT * INTO job FROM public.production_jobs WHERE id=NEW.id;
 IF TG_OP='INSERT' AND nullif(btrim(job.size),'') IS NULL THEN RAISE EXCEPTION 'Production size required'; END IF;
 IF (job.design_id IS NULL AND nullif(btrim(job.custom_design),'') IS NULL) OR (job.design_id IS NOT NULL AND job.custom_design IS NOT NULL) THEN RAISE EXCEPTION 'Select a predefined design or enter a custom design'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER production_design_complete AFTER INSERT OR UPDATE ON public.production_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_production_design();
REVOKE ALL ON FUNCTION public.guard_production_descriptor(),public.check_production_design() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.create_production_batch(p_request uuid,p_product uuid,p_design uuid,p_custom_design text,p_size text,p_quantity integer,p_assignments jsonb,p_source uuid,p_items jsonb,p_notes text,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload_value jsonb; saved public.production_batch_requests%rowtype; result uuid;
BEGIN
 IF NOT public.has_perm(auth.uid(),'production.create') THEN RAISE EXCEPTION 'Production creation permission required'; END IF;
 p_custom_design:=nullif(btrim(p_custom_design),'');p_size:=nullif(btrim(p_size),'');
 IF p_size IS NULL OR length(p_size)>40 OR (p_design IS NULL)=(p_custom_design IS NULL) OR length(p_custom_design)>120 THEN RAISE EXCEPTION 'Size and either predefined or custom design required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'product',p_product,'design',p_design,'custom_design',p_custom_design,'size',p_size,'quantity',p_quantity,'assignments',p_assignments,'source',p_source,'items',p_items,'notes',p_notes,'reason',p_reason);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,10));
 SELECT * INTO saved FROM public.production_batch_requests WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Production request reused with different details'; END IF;RETURN saved.production_job_id; END IF;
 IF EXISTS(SELECT 1 FROM public.production_requests WHERE request_id=p_request) THEN RAISE EXCEPTION 'Request belongs to another production workflow'; END IF;
 result:=public.create_owner_production_shared(p_request,p_product,p_design,p_quantity,p_assignments,p_source,p_items,p_notes,p_reason);
 UPDATE public.production_jobs SET size=p_size,custom_design=p_custom_design WHERE id=result;
 INSERT INTO public.production_batch_requests VALUES(p_request,result,auth.uid(),payload_value,clock_timestamp());
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.create_production_batch(uuid,uuid,uuid,text,text,integer,jsonb,uuid,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_production_batch(uuid,uuid,uuid,text,text,integer,jsonb,uuid,jsonb,text,text) TO authenticated;

CREATE FUNCTION public.production_job_document(p_code text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE job public.production_jobs%rowtype; result jsonb; known boolean; total bigint; fabric_count integer;
BEGIN
 SELECT * INTO job FROM public.production_jobs WHERE code=btrim(p_code) OR id::text=btrim(p_code);
 IF job.id IS NULL THEN RETURN NULL; END IF;
 IF NOT(public.has_perm(auth.uid(),'production.view') OR public.has_perm(auth.uid(),'production.receive') OR (public.has_role(auth.uid(),'tailor') AND public.owns_production_job(job.id))) THEN RAISE EXCEPTION 'Production workflow access required'; END IF;
 SELECT count(*)::integer,count(c.issue_line_id)=count(*),sum(c.amount_paise)::bigint INTO fabric_count,known,total
 FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id LEFT JOIN public.production_issue_fabric_costs c ON c.issue_line_id=l.id WHERE i.production_job_id=job.id AND l.thaan_id IS NOT NULL;
 result:=jsonb_build_object('id',job.id,'code',job.code,'size',job.size,'quantity',job.quantity,'status',job.status,
 'product',(SELECT name FROM public.products WHERE id=job.product_id),'design',coalesce((SELECT name FROM public.designs WHERE id=job.design_id),job.custom_design),'design_code',(SELECT code FROM public.designs WHERE id=job.design_id),
 'tailors',public.production_tailor_names(job.id),'created_at',job.created_at,
 'issued_at',(SELECT min(issued_at) FROM public.material_issues WHERE production_job_id=job.id),
 'finished_at',(SELECT max(recorded_at) FROM public.production_status_events WHERE job_id=job.id AND status='completed'),
 'received_at',(SELECT recorded_at FROM public.finished_product_receipts WHERE production_job_id=job.id),
 'fabrics',coalesce((SELECT jsonb_agg(jsonb_build_object('barcode',coalesce(v.code,t.barcode,bc.code),'name',f.name,'quantity_mm',l.quantity,'source',loc.name,'issued_at',i.issued_at,'issue_type',i.issue_type) ORDER BY i.issued_at,l.id) FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id JOIN public.thaans t ON t.id=l.thaan_id JOIN public.fabric_stock s ON s.id=l.fabric_stock_id JOIN public.fabrics f ON f.id=s.fabric_id JOIN public.barcodes bc ON bc.id=s.barcode_id JOIN public.locations loc ON loc.id=i.source_location_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id WHERE i.production_job_id=job.id),'[]'::jsonb));
 IF public.can_view_thaan_cp(NULL) THEN result:=result||jsonb_build_object('cp_total_paise',CASE WHEN known AND fabric_count>0 THEN total END,'cp_basis','All issued fabric, including additional issues','cost_known',known AND fabric_count>0); END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.production_job_document(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.production_job_document(text) TO authenticated;

CREATE FUNCTION public.issue_additional_production_fabric(p_request uuid,p_code text,p_barcode text,p_source uuid,p_quantity_mm integer,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job uuid; item uuid;
BEGIN
 IF NOT(public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'counter') AND public.has_perm(auth.uid(),'pos.issue_to_tailoring'))) THEN RAISE EXCEPTION 'Counter production issue permission required'; END IF;
 SELECT id INTO job FROM public.production_jobs WHERE code=btrim(p_code) OR id::text=btrim(p_code);
 SELECT i.id INTO item FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id JOIN public.fabric_stock s ON s.id=t.fabric_stock_id JOIN public.barcodes b ON b.id=s.barcode_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id WHERE t.status='active' AND btrim(p_barcode) IN(v.code,t.barcode,b.code);
 IF (SELECT count(*) FROM public.thaans t JOIN public.fabric_stock s ON s.id=t.fabric_stock_id JOIN public.barcodes b ON b.id=s.barcode_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id WHERE t.status='active' AND btrim(p_barcode) IN(v.code,t.barcode,b.code))<>1 THEN RAISE EXCEPTION 'Scan a unique physical Thaan barcode'; END IF;
 IF job IS NULL OR item IS NULL OR p_quantity_mm IS NULL OR p_quantity_mm<=0 THEN RAISE EXCEPTION 'Production ID, active Thaan barcode and positive metres required'; END IF;
 RETURN public.post_material_issue(p_request,'production',job,p_source,'additional',jsonb_build_array(jsonb_build_object('inventory_item_id',item,'quantity',p_quantity_mm)),p_reason);
END; $$;
REVOKE ALL ON FUNCTION public.issue_additional_production_fabric(uuid,text,text,uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_additional_production_fabric(uuid,text,text,uuid,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_production_batch(p_request uuid,p_job uuid,p_expected_status text,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job public.production_jobs%rowtype; saved public.finished_product_receipts%rowtype; payload_value jsonb;
 workshop uuid; piece uuid; barcode uuid; inv uuid; n integer; known boolean; total numeric; base_amount bigint; remainder integer; cost_version uuid; material_payload jsonb;
BEGIN
 IF NOT public.has_perm(auth.uid(),'production.receive') THEN RAISE EXCEPTION 'Production receipt permission required'; END IF;
 IF p_request IS NULL OR p_job IS NULL OR p_expected_status IS DISTINCT FROM 'completed' OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Completed job and whole-batch receipt confirmation required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'job',p_job,'expected_status',p_expected_status,'reason',btrim(p_reason),'cost_basis','issued_fabric','material_consumption','not_recorded');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,11));
 SELECT * INTO saved FROM public.finished_product_receipts WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Receipt request reused with different data or actor'; END IF;RETURN saved.production_job_id; END IF;
 SELECT * INTO job FROM public.production_jobs WHERE id=p_job FOR UPDATE;
 IF job.id IS NULL OR job.status<>'completed' THEN RAISE EXCEPTION 'Completed production job required'; END IF;
 IF EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE production_job_id=p_job) OR EXISTS(SELECT 1 FROM public.finished_products WHERE production_job_id=p_job) THEN RAISE EXCEPTION 'Whole production batch already received'; END IF;
 SELECT count(*)>0 AND count(c.issue_line_id)=count(*),sum(c.amount_paise),jsonb_agg(jsonb_build_object('issue_line_id',l.id,'quantity',l.quantity,'amount_paise',c.amount_paise)) INTO known,total,material_payload FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id LEFT JOIN public.production_issue_fabric_costs c ON c.issue_line_id=l.id WHERE i.production_job_id=job.id AND l.thaan_id IS NOT NULL;
 IF NOT known OR total IS NULL THEN RAISE EXCEPTION 'Issue-time fabric CP is not recorded; Owner reconciliation is required'; END IF;
 IF total>9007199254740991 THEN RAISE EXCEPTION 'Production CP exceeds supported money range'; END IF;
 SELECT id INTO workshop FROM public.locations WHERE active AND kind='workshop' FOR UPDATE;
 IF workshop IS NULL THEN RAISE EXCEPTION 'Active Workshop required'; END IF;
 INSERT INTO public.finished_product_receipts VALUES(p_request,p_job,auth.uid(),workshop,payload_value,btrim(p_reason),clock_timestamp());
 FOR n IN 1..job.quantity LOOP
  INSERT INTO public.barcodes(code,kind,created_by) VALUES('PRD-'||replace(gen_random_uuid()::text,'-',''),'product',auth.uid()) RETURNING id INTO barcode;
  INSERT INTO public.finished_products(production_job_id,product_id,design_id,piece_number,barcode_id,current_location_id,status) VALUES(p_job,job.product_id,job.design_id,n,barcode,workshop,'available') RETURNING id INTO piece;
  INSERT INTO public.finished_product_receipt_pieces VALUES(piece,p_request);
  INSERT INTO public.inventory_items(finished_product_id,unit,legacy_quantity_snapshot,reconciled_by,reason) VALUES(piece,'pc',0,auth.uid(),btrim(p_reason)) RETURNING id INTO inv;
  INSERT INTO public.inventory_movements(kind,inventory_item_id,finished_product_id,quantity,unit,destination_location_id,production_job_id,actor_id,reason,reference) VALUES('PRODUCTION',inv,piece,1,'pc',workshop,p_job,auth.uid(),btrim(p_reason),'PRODUCTION:'||p_request::text);
 END LOOP;
 INSERT INTO public.production_cost_versions(production_job_id,revision,quantity_snapshot,recorded_by,reason) SELECT p_job,coalesce(max(revision),0)+1,job.quantity,auth.uid(),'Recorded issued fabric CP including additional issues; actual consumption is not inferred' FROM public.production_cost_versions WHERE production_job_id=p_job RETURNING id INTO cost_version;
 INSERT INTO public.production_cost_lines(cost_version_id,category,amount_paise,description,fabric_cost_id,material_issue_line_id)
 SELECT cost_version,'fabric',c.amount_paise,'Issued fabric CP captured at issue time',c.fabric_cost_id,l.id FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id JOIN public.production_issue_fabric_costs c ON c.issue_line_id=l.id WHERE i.production_job_id=p_job AND l.thaan_id IS NOT NULL;
 base_amount:=floor(total/job.quantity);remainder:=(total-base_amount*job.quantity)::integer;
 INSERT INTO public.finished_product_cost_allocations(finished_product_id,production_job_id,cost_version_id,amount_paise)
 SELECT id,p_job,cost_version,base_amount+CASE WHEN row_number() OVER(ORDER BY piece_number)<=remainder THEN 1 ELSE 0 END FROM public.finished_products WHERE production_job_id=p_job;
 INSERT INTO public.production_cost_requests VALUES(p_request,auth.uid(),p_job,jsonb_build_object('materials',material_payload,'basis','issued_fabric','actual_consumption','not_recorded'),cost_version,now());
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'receive_production_batch','production_jobs',p_job,payload_value||jsonb_build_object('received_pieces',job.quantity,'cost_version',cost_version),'PRODUCTION:'||p_request::text);
 RETURN p_job;
END; $$;

CREATE FUNCTION public.set_workshop_product_sp(p_request uuid,p_job uuid,p_updates jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.production_cost_requests%rowtype; payload_value jsonb; version uuid; row_value jsonb; piece public.finished_products%rowtype; price uuid; amount bigint;
BEGIN
 IF NOT public.has_perm(auth.uid(),'stock.price_finished') THEN RAISE EXCEPTION 'Workshop finished-product price permission required'; END IF;
 IF p_request IS NULL OR p_job IS NULL OR nullif(btrim(p_reason),'') IS NULL OR jsonb_typeof(p_updates) IS DISTINCT FROM 'array' OR jsonb_array_length(p_updates) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Production job, explicit prices and confirmation required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'job',p_job,'updates',p_updates,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,12));
 SELECT * INTO saved FROM public.production_cost_requests WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Price request reused with different values'; END IF;RETURN saved.result_id; END IF;
 PERFORM 1 FROM public.production_jobs WHERE id=p_job FOR UPDATE;
 SELECT id INTO version FROM public.production_cost_versions WHERE production_job_id=p_job ORDER BY revision DESC LIMIT 1;
 IF version IS NULL OR NOT EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=version AND payload ? 'materials') THEN RAISE EXCEPTION 'Recorded production CP required'; END IF;
 IF (SELECT count(DISTINCT value->>'piece_id') FROM jsonb_array_elements(p_updates))<>jsonb_array_length(p_updates) THEN RAISE EXCEPTION 'Distinct pieces required'; END IF;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_updates) ORDER BY value->>'piece_id' LOOP
  IF jsonb_typeof(row_value)<>'object' OR (row_value-ARRAY['piece_id','sp_paise'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Only piece ID and SP accepted'; END IF;
  SELECT * INTO piece FROM public.finished_products WHERE id=(row_value->>'piece_id')::uuid AND production_job_id=p_job AND status='available' FOR UPDATE;
  amount:=(row_value->>'sp_paise')::bigint;
  IF piece.id IS NULL OR amount IS NULL OR amount NOT BETWEEN 0 AND 9007199254740991 OR NOT EXISTS(SELECT 1 FROM public.locations WHERE id=piece.current_location_id AND active AND kind='workshop') OR NOT EXISTS(SELECT 1 FROM public.finished_product_cost_allocations WHERE finished_product_id=piece.id AND cost_version_id=version) THEN RAISE EXCEPTION 'Available Workshop piece and recorded CP required'; END IF;
  INSERT INTO public.finished_product_prices(finished_product_id,revision,sp_paise,recorded_by) SELECT piece.id,coalesce(max(revision),0)+1,amount,auth.uid() FROM public.finished_product_prices WHERE finished_product_id=piece.id RETURNING id INTO price;
  INSERT INTO public.finished_product_price_reviews VALUES(price,version,p_request,btrim(p_reason));
 END LOOP;
 INSERT INTO public.production_cost_requests VALUES(p_request,auth.uid(),p_job,payload_value,p_job,now());
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'set_workshop_product_sp','production_jobs',p_job,payload_value,'PRICE:'||p_request::text);
 RETURN p_job;
END; $$;
REVOKE ALL ON FUNCTION public.set_workshop_product_sp(uuid,uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_workshop_product_sp(uuid,uuid,jsonb,text) TO authenticated;

CREATE FUNCTION public.production_piece_context(p_piece uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('size',j.size,'design',coalesce(d.name,j.custom_design),'design_code',d.code,'production_job_id',j.id,'production_quantity',j.quantity,
 'issued_at',(SELECT min(issued_at) FROM public.material_issues WHERE production_job_id=j.id),
 'finished_at',(SELECT max(recorded_at) FROM public.production_status_events WHERE job_id=j.id AND status='completed'),
 'received_at',(SELECT recorded_at FROM public.finished_product_receipts WHERE production_job_id=j.id),
 'sp_paise',(SELECT sp_paise FROM public.finished_product_prices WHERE finished_product_id=p.id ORDER BY revision DESC LIMIT 1),
 'cp_visible',public.can_view_thaan_cp(NULL),'cp_paise',CASE WHEN public.can_view_thaan_cp(NULL) THEN (SELECT a.amount_paise FROM public.finished_product_cost_allocations a JOIN public.production_cost_versions v ON v.id=a.cost_version_id WHERE a.finished_product_id=p.id ORDER BY v.revision DESC LIMIT 1) END)
 FROM public.finished_products p JOIN public.production_jobs j ON j.id=p.production_job_id LEFT JOIN public.designs d ON d.id=j.design_id WHERE p.id=p_piece;
$$;
REVOKE ALL ON FUNCTION public.production_piece_context(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.workshop_production_pieces(p_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT(public.has_perm(auth.uid(),'production.receive') OR public.has_perm(auth.uid(),'stock.price_finished')) THEN RAISE EXCEPTION 'Workshop production access required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'job_id',p.production_job_id,'barcode',b.code,'product',product.name,'piece_number',p.piece_number,'status',p.status,'location_kind',loc.kind)||public.production_piece_context(p.id) ORDER BY p.piece_number) FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id JOIN public.locations loc ON loc.id=p.current_location_id WHERE p.production_job_id=p_job),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.workshop_production_pieces(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workshop_production_pieces(uuid) TO authenticated;

CREATE FUNCTION public.guard_finished_workshop_price() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.kind='TRANSFER' AND NEW.finished_product_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.locations WHERE id=NEW.source_location_id AND kind='workshop') AND public.is_showroom_location(NEW.destination_location_id) AND NOT EXISTS(SELECT 1 FROM public.finished_product_prices price JOIN public.finished_product_price_reviews review ON review.price_id=price.id WHERE price.finished_product_id=NEW.finished_product_id) THEN RAISE EXCEPTION 'Set finished-product SP in Workshop before transfer to Showroom'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER finished_workshop_price_guard BEFORE INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.guard_finished_workshop_price();
REVOKE ALL ON FUNCTION public.guard_finished_workshop_price() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.finished_product_catalog(p_barcode text DEFAULT NULL::text, p_job uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE owner boolean:=public.has_role(auth.uid(),'owner'); counter boolean:=public.has_role(auth.uid(),'counter');
BEGIN
 IF NOT (owner OR counter OR public.has_role(auth.uid(),'tailor')) THEN RAISE EXCEPTION 'Owner, Counter or assigned Tailor required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Limit must be 1 to 100'; END IF;
 RETURN coalesce((SELECT jsonb_agg(row_value ORDER BY (row_value->>'piece_number')::integer,row_value->>'id') FROM (
 SELECT jsonb_build_object('size',j.size,'production_quantity',j.quantity,'issued_at',(SELECT min(issued_at) FROM public.material_issues WHERE production_job_id=j.id),'finished_at',(SELECT max(recorded_at) FROM public.production_status_events WHERE job_id=j.id AND status='completed'),'id',f.id,'barcode',b.code,'piece_number',f.piece_number,'product',p.name,'product_id',p.id,'design',coalesce(d.name,j.custom_design),'design_id',d.id,
 'production_job_id',j.id,'production_job',j.code,'job_quantity',j.quantity,'job_status',j.status,'status',f.status,'created_at',f.created_at,
 'factory',factory.name,'section',s.name,'tailor',t.real_name,'assignment_id',j.tailor_assignment_id,'tailors',public.production_tailor_names(j.id),
 'location_id',f.current_location_id,'location',loc.name,'inventory_item_id',inv.id,
 'quantity_at_location',CASE WHEN inv.id IS NOT NULL THEN public.inventory_balance(inv.id,f.current_location_id) ELSE NULL END,
 'available',f.status='available' AND inv.id IS NOT NULL AND public.inventory_balance(inv.id,f.current_location_id)=1,
 'materials',coalesce((SELECT jsonb_agg(jsonb_build_object('issue_line_id',fm.material_issue_line_id,'quantity',fm.quantity,'unit',fm.unit,
 'name',coalesce(fab.name,mat.name),'fabric_stock_id',fs.id,'fabric_barcode',fb.code,'batch',batch.code,'thaan_id',l.thaan_id,'material_id',l.material_id)
 ORDER BY fm.id) FROM public.finished_product_materials fm JOIN public.material_issue_lines l ON l.id=fm.material_issue_line_id
 LEFT JOIN public.fabric_stock fs ON fs.id=l.fabric_stock_id LEFT JOIN public.fabrics fab ON fab.id=fs.fabric_id LEFT JOIN public.barcodes fb ON fb.id=fs.barcode_id
 LEFT JOIN public.receiving_batches batch ON batch.id=fs.batch_id LEFT JOIN public.materials mat ON mat.id=l.material_id WHERE fm.finished_product_id=f.id),'[]'::jsonb),
 'production_history',coalesce((SELECT jsonb_agg(jsonb_build_object('previous_status',e.previous_status,'status',e.status,'reason',e.reason,'actor_id',e.actor_id,'recorded_at',e.recorded_at) ORDER BY e.recorded_at,e.id) FROM public.production_status_events e WHERE e.job_id=j.id),'[]'::jsonb),
 'receipt', (SELECT jsonb_build_object('reason',r.reason,'actor_id',r.actor_id,'recorded_at',r.recorded_at,'workshop_id',r.workshop_id) FROM public.finished_product_receipts r WHERE r.production_job_id=j.id),
 'sp_paise',CASE WHEN owner OR counter THEN (SELECT sp_paise FROM public.finished_product_prices WHERE finished_product_id=f.id ORDER BY revision DESC LIMIT 1) END,
 'pricing_status',CASE WHEN EXISTS(SELECT 1 FROM public.finished_product_prices WHERE finished_product_id=f.id) THEN 'priced' ELSE 'not_set' END)
 || CASE WHEN owner THEN jsonb_build_object('production_summary',public.production_piece_summary(j.id),'production_cost_paise',(SELECT a.amount_paise FROM public.finished_product_cost_allocations a JOIN public.production_cost_versions v ON v.id=a.cost_version_id WHERE a.finished_product_id=f.id ORDER BY v.revision DESC LIMIT 1),'cost_version_id',(SELECT v.id FROM public.production_cost_versions v WHERE v.production_job_id=j.id ORDER BY v.revision DESC LIMIT 1)) ELSE '{}'::jsonb END row_value
 FROM public.finished_products f JOIN public.barcodes b ON b.id=f.barcode_id AND b.kind='product'
 JOIN public.production_jobs j ON j.id=f.production_job_id JOIN public.products p ON p.id=f.product_id LEFT JOIN public.designs d ON d.id=f.design_id
 JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories factory ON factory.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id JOIN public.locations loc ON loc.id=f.current_location_id
 LEFT JOIN public.inventory_items inv ON inv.finished_product_id=f.id
 WHERE (p_barcode IS NULL OR b.code=btrim(p_barcode)) AND (p_job IS NULL OR j.id=p_job)
 AND (owner OR counter OR public.owns_production_job(j.id))
 ORDER BY j.created_at DESC,j.id,f.piece_number LIMIT p_limit) x),'[]'::jsonb);
END; $function$
;
CREATE OR REPLACE FUNCTION public.finished_product_inventory(p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb;
BEGIN
 IF NOT (public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'stock.transfer_finished'))) THEN RAISE EXCEPTION 'Authorized finished-product transfer staff required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Limit must be 1–200'; END IF;
 SELECT coalesce(jsonb_agg(row_value ORDER BY id),'[]') INTO result FROM (
 SELECT p.id,jsonb_build_object('id',p.id,'barcode',b.code,'piece_number',p.piece_number,'product',product.name,'design',coalesce(design.name,j.custom_design),'job_id',j.id,'job_code',j.code,'status',p.status,'location_id',p.current_location_id,'location',location.name,'location_kind',location.kind,'location_active',location.active,'inventory_item_id',i.id,'quantity',coalesce(balance.quantity,0),'available',p.status='available' AND coalesce(balance.quantity,0)=1,'created_at',p.created_at)||public.production_piece_context(p.id) row_value
 FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id LEFT JOIN public.designs design ON design.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id JOIN public.locations location ON location.id=p.current_location_id LEFT JOIN public.inventory_items i ON i.finished_product_id=p.id LEFT JOIN public.v_inventory_location_balances balance ON balance.inventory_item_id=i.id AND balance.location_id=p.current_location_id
 WHERE p_after IS NULL OR p.id>p_after ORDER BY p.id LIMIT p_limit
 ) rows;
 RETURN result;
END; $function$
;
CREATE OR REPLACE FUNCTION public.finished_product_transfer_scan(p_barcode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb;
BEGIN
 IF NOT (public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'stock.transfer_finished'))) THEN RAISE EXCEPTION 'Authorized finished-product transfer staff required'; END IF;
 IF nullif(btrim(p_barcode),'') IS NULL THEN RAISE EXCEPTION 'Product Barcode required'; END IF;
 SELECT coalesce(jsonb_agg(row_value ORDER BY id),'[]') INTO result FROM (
 SELECT p.id,jsonb_build_object('id',p.id,'barcode',b.code,'piece_number',p.piece_number,'product',product.name,'design',coalesce(design.name,j.custom_design),'job_id',j.id,'job_code',j.code,'status',p.status,'location_id',p.current_location_id,'location',location.name,'location_kind',location.kind,'location_active',location.active,'inventory_item_id',i.id,'quantity',coalesce(balance.quantity,0),'available',p.status='available' AND coalesce(balance.quantity,0)=1,'created_at',p.created_at)||public.production_piece_context(p.id) row_value
 FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id LEFT JOIN public.designs design ON design.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id JOIN public.locations location ON location.id=p.current_location_id LEFT JOIN public.inventory_items i ON i.finished_product_id=p.id LEFT JOIN public.v_inventory_location_balances balance ON balance.inventory_item_id=i.id AND balance.location_id=p.current_location_id
 WHERE b.code=btrim(p_barcode) ORDER BY p.id LIMIT 1
 ) rows;
 RETURN result;
END; $function$
;
CREATE OR REPLACE FUNCTION public.finished_product_order_history(p_order uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE owner boolean:=public.has_role(auth.uid(),'owner');
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Owner or Counter required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Limit must be 1–200'; END IF;
 RETURN coalesce((SELECT jsonb_agg(row_value ORDER BY created_at DESC,id) FROM (
 SELECT o.id,o.created_at,jsonb_build_object('id',o.id,'code',o.code,'customer_snapshot',o.customer_snapshot,'source_location_id',o.source_location_id,'source',coalesce((SELECT s.item_snapshot->>'source' FROM public.finished_product_sale_snapshots s JOIN public.order_items it ON it.id=s.order_item_id WHERE it.order_id=o.id LIMIT 1),loc.name),'final_customer_price_paise',o.final_customer_price_paise,'reference',o.reference,'created_by',o.created_by,'actor',coalesce((SELECT s.item_snapshot->>'actor' FROM public.finished_product_sale_snapshots s JOIN public.order_items it ON it.id=s.order_item_id WHERE it.order_id=o.id LIMIT 1),actor.full_name),'created_at',o.created_at,'completed_at',o.completed_at,'payment_confirmed_at',o.payment_confirmed_at,'additional_charges_paise',0,
 'items',(SELECT jsonb_agg(jsonb_build_object('id',it.id,'piece_id',p.id,'barcode',coalesce(snapshot.item_snapshot->>'barcode',b.code),'piece_number',p.piece_number,'product',coalesce(snapshot.item_snapshot->>'product',product.name),'design',coalesce(snapshot.item_snapshot->>'design',coalesce(design.name,j.custom_design)),'job_code',coalesce(snapshot.item_snapshot->>'job_code',j.code),'quantity',it.quantity,'unit',it.unit,'sp_paise',it.sp_snapshot_paise,'final_customer_price_paise',it.final_customer_price_paise,'movement_id',m.id)
 ||CASE WHEN owner THEN jsonb_build_object('production_cost_paise',financial.production_cost_snapshot_paise,'price_version_id',snapshot.price_version_id,'cost_version_id',snapshot.cost_version_id,'reviewed_cost_version_id',snapshot.reviewed_cost_version_id,'cost_evidence',snapshot.cost_evidence) ELSE '{}'::jsonb END ORDER BY it.id)
 FROM public.order_items it JOIN public.finished_products p ON p.id=it.finished_product_id JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id LEFT JOIN public.designs design ON design.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id LEFT JOIN public.inventory_movements m ON m.order_item_id=it.id AND m.kind='SALE' LEFT JOIN public.order_item_financials financial ON financial.order_item_id=it.id LEFT JOIN public.finished_product_sale_snapshots snapshot ON snapshot.order_item_id=it.id WHERE it.order_id=o.id)) row_value
 FROM public.orders o JOIN public.locations loc ON loc.id=o.source_location_id LEFT JOIN public.profiles actor ON actor.id=o.created_by
 WHERE o.kind='finished_product_sale' AND o.status='completed' AND o.sale_request_id IS NOT NULL AND (p_order IS NULL OR o.id=p_order) ORDER BY o.created_at DESC,o.id DESC LIMIT p_limit
 ) x),'[]'::jsonb);
END; $function$
;
CREATE OR REPLACE FUNCTION public.finished_product_sale_scan(p_barcode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE piece public.finished_products%rowtype; result jsonb; counts jsonb; price_id uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Owner or Counter required'; END IF;
 IF nullif(btrim(p_barcode),'') IS NULL THEN RAISE EXCEPTION 'Product Barcode required'; END IF;
 SELECT p.* INTO piece FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id WHERE b.code=btrim(p_barcode) AND b.kind='product';
 IF piece.id IS NULL THEN RETURN NULL; END IF;
 result:=public.finished_product_catalog(btrim(p_barcode),NULL,1)->0;
 SELECT id INTO price_id FROM public.finished_product_prices WHERE finished_product_id=piece.id ORDER BY revision DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(jsonb_build_object('location_id',id,'name',name,'kind',kind,'parent_id',parent_id,'active',active,'quantity',quantity) ORDER BY kind,id),'[]') INTO counts FROM (
 SELECT l.id,l.name,l.kind,l.parent_id,l.active,count(p.id) FILTER(WHERE p.status='available' AND public.inventory_balance(i.id,l.id)=1) quantity
 FROM public.locations l LEFT JOIN public.finished_products p ON p.current_location_id=l.id AND p.production_job_id=piece.production_job_id LEFT JOIN public.inventory_items i ON i.finished_product_id=p.id GROUP BY l.id
 ) x;
 SELECT jsonb_agg(c||jsonb_build_object('subtree_quantity',(c->>'quantity')::integer+(SELECT coalesce(sum((child->>'quantity')::integer),0) FROM jsonb_array_elements(counts) child WHERE child->>'parent_id'=c->>'location_id')) ORDER BY c->>'kind',c->>'location_id') INTO counts FROM jsonb_array_elements(counts) c;
 result:=result||jsonb_build_object('sp_version_id',price_id,'saleable_source',public.is_showroom_location(piece.current_location_id),'location_active',(SELECT active FROM public.locations WHERE id=piece.current_location_id),'identical_scope','production_job','identical_available',(SELECT coalesce(sum((value->>'quantity')::integer),0) FROM jsonb_array_elements(counts)),'locations',counts);
 IF public.has_role(auth.uid(),'owner') THEN
  result:=result||jsonb_build_object('production_summary',public.production_piece_summary(piece.production_job_id),'production_cost',public.owner_production_costs(piece.production_job_id));
 END IF;
 RETURN result;
END; $function$
;
CREATE OR REPLACE FUNCTION public.post_material_issue(p_request_id uuid, p_job_kind text, p_job uuid, p_source uuid, p_type text, p_items jsonb, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_payload jsonb; old_issue public.material_issues%rowtype; v_assignment uuid; v_status text; v_id uuid; v_line uuid;
 r jsonb; i public.inventory_items%rowtype; v_stock uuid; v_quantity numeric;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') AND NOT (public.has_role(auth.uid(),'counter') AND public.has_perm(auth.uid(),'pos.issue_to_tailoring')) AND NOT (p_job_kind='production' AND public.has_perm(auth.uid(),'production.create')) THEN RAISE EXCEPTION 'Owner or authorized Counter required'; END IF;
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
 PERFORM 1 FROM public.fabric_stock WHERE id IN(SELECT t.fabric_stock_id FROM public.inventory_items inv JOIN public.thaans t ON t.id=inv.thaan_id JOIN jsonb_array_elements(p_items) x ON inv.id=(x->>'inventory_item_id')::uuid) ORDER BY id FOR UPDATE;
 -- Same stable item/location lock order as transfers; serialize all outgoing quantities.
 PERFORM 1 FROM public.materials WHERE id IN(SELECT inv.material_id FROM public.inventory_items inv
 JOIN jsonb_array_elements(p_items) x ON inv.id=(x->>'inventory_item_id')::uuid) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items WHERE id IN(SELECT (value->>'inventory_item_id')::uuid FROM jsonb_array_elements(p_items)) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.locations WHERE id=p_source AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active issue source required'; END IF;
 IF p_job_kind='production' AND NOT EXISTS(SELECT 1 FROM public.locations WHERE id=p_source AND active AND (kind='workshop' OR public.is_showroom_location(id))) THEN RAISE EXCEPTION 'Workshop or Showroom source required'; END IF;
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
  IF p_job_kind='production' AND i.thaan_id IS NOT NULL THEN PERFORM public.capture_production_fabric_cost(v_line,v_stock,v_quantity); END IF;
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
END; $function$
;
CREATE OR REPLACE FUNCTION public.registration_insert_thans(p_group uuid, p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE g public.stock_registration_fabric_types%rowtype; row jsonb; code text; f uuid; b uuid; s uuid; th uuid; item uuid; workshop uuid; length_mm numeric; cp bigint; BEGIN
 SELECT * INTO g FROM public.stock_registration_fabric_types WHERE id=p_group FOR UPDATE;
 IF NOT FOUND OR NOT public.can_receive_fabric() OR NOT public.has_perm(auth.uid(),'stock.generate_labels') THEN RAISE EXCEPTION 'Authorised registered Fabric Type required'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Add 1–500 Thans per submission; more can be added later'; END IF;
 SELECT id INTO workshop FROM public.locations WHERE kind='workshop' AND active;
 IF workshop IS NULL THEN RAISE EXCEPTION 'Active Workshop required'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR (row-'length_mm'-'cp_paise_per_m')<>'{}'::jsonb THEN RAISE EXCEPTION 'Only length and optional CP allowed'; END IF;
  length_mm:=(row->>'length_mm')::numeric; cp:=(row->>'cp_paise_per_m')::bigint;
  IF (length_mm IS NOT NULL AND (length_mm<=0 OR length_mm<>trunc(length_mm) OR length_mm>2147483647))  OR (cp IS NOT NULL AND (cp<0 OR cp>9007199254740991)) THEN RAISE EXCEPTION 'Positive exact millimetres and optional nonnegative CP required'; END IF;
  IF length_mm IS NOT NULL AND NOT public.has_perm(auth.uid(),'stock.measure_thaan') THEN RAISE EXCEPTION 'Actual measurement permission required'; END IF;
  code:=g.code||public.registration_variant_suffix(g.next_ordinal);
  INSERT INTO public.fabrics(code,name) VALUES(code,g.name) RETURNING id INTO f;
  INSERT INTO public.barcodes(code,kind,created_by) VALUES(code,'fabric',auth.uid()) RETURNING id INTO b;
  INSERT INTO public.fabric_stock(fabric_id,batch_id,barcode_id,created_by) VALUES(f,g.batch_id,b,auth.uid()) RETURNING id INTO s;
  INSERT INTO public.thaans(fabric_id,batch_id,fabric_stock_id,original_mm,status,created_by) VALUES(f,g.batch_id,s,CASE WHEN length_mm>0 AND cp>0 THEN length_mm::integer END,'draft',auth.uid()) RETURNING id INTO th;
  IF cp>0 THEN
   INSERT INTO public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m,recorded_by,reason) VALUES(s,1,cp,auth.uid(),'CP recorded during Than registration');
  END IF;
  IF length_mm>0 AND cp>0 THEN
  UPDATE public.thaans SET status='active',updated_at=now() WHERE id=th;
  INSERT INTO public.inventory_items(thaan_id,unit,legacy_quantity_snapshot,reconciled_by,reason) VALUES(th,'mm',0,auth.uid(),'Registered physical Than') RETURNING id INTO item;
  INSERT INTO public.inventory_movements(inventory_item_id,thaan_id,fabric_stock_id,kind,quantity,unit,destination_location_id,reason,reference,actor_id) VALUES(item,th,s,'INWARD',length_mm,'mm',workshop,'Registered physical Than received','REGISTRATION:'||code,auth.uid());
  UPDATE public.fabric_stock SET entry_state='complete' WHERE id=s;
  END IF;
  INSERT INTO public.stock_registration_variants(fabric_type_id,ordinal,code,fabric_stock_id,thaan_id,created_by,draft_details) VALUES(g.id,g.next_ordinal,code,s,th,auth.uid(),jsonb_strip_nulls(jsonb_build_object('length_mm',length_mm,'cp',cp)));
  g.next_ordinal:=g.next_ordinal+1;
 END LOOP;
 UPDATE public.stock_registration_fabric_types SET next_ordinal=g.next_ordinal WHERE id=g.id;
END; $function$
;
CREATE OR REPLACE FUNCTION public.complete_barcode_thaan(p_request uuid, p_barcode text, p_colour text, p_length_mm integer, p_cp bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE payload jsonb; result uuid; v public.stock_registration_variants%rowtype; th public.thaans%rowtype; item uuid; workshop uuid; existing_cp bigint; existing_colour text; BEGIN
 p_colour:=nullif(btrim(p_colour),'');
 payload:=jsonb_build_object('barcode',btrim(p_barcode),'colour',btrim(p_colour),'length_mm',p_length_mm,'cp',p_cp);
 IF NOT public.has_perm(auth.uid(),'stock.measure_thaan') THEN RAISE EXCEPTION 'Actual measurement permission required'; END IF;
 result:=public.registration_request_result(p_request,'measure_thaan',payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_length_mm IS NULL OR p_length_mm<=0 OR (p_cp IS NOT NULL AND (p_cp<0 OR p_cp>9007199254740991)) THEN RAISE EXCEPTION 'Positive millimetres and optional colour/nonnegative CP required'; END IF;
 SELECT * INTO v FROM public.stock_registration_variants WHERE code=btrim(p_barcode) FOR UPDATE;
 IF NOT FOUND OR NOT public.can_edit_thaan_registration(v.created_by) THEN RAISE EXCEPTION 'Authorised registered barcode required to complete details'; END IF;
 IF (p_colour IS NOT NULL AND v.draft_details ? 'colour' AND v.draft_details->>'colour'<>p_colour) OR (v.draft_details ? 'length_mm' AND (v.draft_details->>'length_mm')::integer<>p_length_mm) OR (p_cp IS NOT NULL AND v.draft_details ? 'cp' AND (v.draft_details->>'cp')::bigint>0 AND (v.draft_details->>'cp')::bigint<>p_cp) THEN RAISE EXCEPTION 'Saved partial details cannot be overwritten'; END IF;
 
 IF p_cp IS NOT NULL AND NOT public.can_view_thaan_cp(v.created_by) THEN RAISE EXCEPTION 'Fabric CP entry/view permission required'; END IF;
 SELECT * INTO th FROM public.thaans WHERE id=v.thaan_id FOR UPDATE;
 p_cp:=coalesce(p_cp,(v.draft_details->>'cp')::bigint);
 PERFORM 1 FROM public.fabric_stock WHERE id=v.fabric_stock_id FOR UPDATE;
 IF th.original_mm IS NOT NULL AND th.original_mm IS DISTINCT FROM p_length_mm THEN RAISE EXCEPTION 'Recorded original length cannot be overwritten'; END IF;
 SELECT colour INTO existing_colour FROM public.fabrics WHERE id=th.fabric_id;
 IF p_colour IS NOT NULL AND existing_colour IS NOT NULL AND existing_colour<>p_colour THEN RAISE EXCEPTION 'Recorded colour cannot be overwritten'; END IF;
 SELECT cp_paise_per_m INTO existing_cp FROM public.fabric_stock_costs WHERE fabric_stock_id=v.fabric_stock_id ORDER BY revision DESC LIMIT 1;
 IF coalesce(p_cp,existing_cp,0)<=0 THEN RAISE EXCEPTION 'Positive CP and length required before stock becomes active'; END IF;
 IF p_cp IS NOT NULL AND existing_cp IS NOT NULL AND existing_cp<>p_cp THEN RAISE EXCEPTION 'Recorded CP cannot be overwritten'; END IF;
 IF p_cp IS NOT NULL AND existing_cp IS NULL AND th.original_mm IS NOT NULL AND NOT public.has_perm(auth.uid(),'inventory.fill_missing_cp') THEN RAISE EXCEPTION 'Missing CP permission required'; END IF;
 INSERT INTO public.stock_registration_requests VALUES(p_request,'measure_thaan',payload,v.thaan_id,auth.uid(),now());
 IF th.original_mm IS NULL THEN
  IF th.status<>'draft' OR EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=th.id) THEN RAISE EXCEPTION 'Unmeasured draft Than required'; END IF;
  SELECT id INTO workshop FROM public.locations WHERE kind='workshop' AND active FOR UPDATE;
  IF workshop IS NULL THEN RAISE EXCEPTION 'Active Workshop required'; END IF;
  UPDATE public.thaans SET original_mm=p_length_mm,status='active',updated_at=now() WHERE id=th.id;
  INSERT INTO public.inventory_items(thaan_id,unit,legacy_quantity_snapshot,reconciled_by,reason) VALUES(th.id,'mm',0,auth.uid(),'Barcode Than actual measurement') RETURNING id INTO item;
  INSERT INTO public.inventory_movements(inventory_item_id,thaan_id,fabric_stock_id,kind,quantity,unit,destination_location_id,reason,reference,actor_id) VALUES(item,th.id,v.fabric_stock_id,'INWARD',p_length_mm,'mm',workshop,'Actual measured Than received','MEASURED:'||v.code,auth.uid());
  UPDATE public.fabric_stock SET entry_state='complete' WHERE id=v.fabric_stock_id;
 END IF;
 IF existing_colour IS NULL AND p_colour IS NOT NULL THEN UPDATE public.fabrics SET colour=btrim(p_colour) WHERE id=th.fabric_id; END IF;
 IF v.details_recorded_at IS NULL THEN UPDATE public.stock_registration_variants SET details_recorded_at=now() WHERE id=v.id; END IF;
 IF p_cp IS NOT NULL AND existing_cp IS NULL THEN INSERT INTO public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m,recorded_by,reason) VALUES(v.fabric_stock_id,1,p_cp,auth.uid(),'Actual CP recorded by barcode scan'); END IF;
 RETURN v.thaan_id; END; $function$
;
CREATE OR REPLACE FUNCTION public.save_registered_thaan_details(p_request uuid, p_barcode text, p_colour text DEFAULT NULL::text, p_length_mm integer DEFAULT NULL::integer, p_cp bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE payload jsonb; result uuid; v public.stock_registration_variants%rowtype; th public.thaans%rowtype; saved jsonb; input jsonb; key text; actual_colour text; actual_cp bigint; actual_length integer; BEGIN
 IF NOT public.has_perm(auth.uid(),'stock.measure_thaan') THEN RAISE EXCEPTION 'Actual measurement permission required'; END IF;
 input:=jsonb_strip_nulls(jsonb_build_object('colour',nullif(btrim(p_colour),''),'length_mm',p_length_mm,'cp',p_cp));
 IF input='{}'::jsonb OR (p_length_mm IS NOT NULL AND p_length_mm<=0) OR (p_cp IS NOT NULL AND (p_cp<0 OR p_cp>9007199254740991)) THEN RAISE EXCEPTION 'Enter actual colour, positive millimetres or nonnegative CP'; END IF;
 payload:=jsonb_build_object('barcode',btrim(p_barcode),'input',input);
 IF NOT public.can_receive_fabric() OR p_request IS NULL THEN RAISE EXCEPTION 'Authorized Stock Entry and request required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,11));
 IF EXISTS(SELECT 1 FROM public.stock_registration_requests WHERE request_id=p_request) THEN
  SELECT r.result_id INTO result FROM public.stock_registration_requests r WHERE r.request_id=p_request AND r.actor_id=auth.uid() AND r.action='thaan_partial_details' AND r.payload->'barcode'=to_jsonb(btrim(p_barcode)) AND r.payload->'input'=input;
  IF result IS NULL THEN RAISE EXCEPTION 'Request already used by different actor/action/data'; END IF;
  RETURN result;
 END IF;
 SELECT * INTO v FROM public.stock_registration_variants WHERE code=btrim(p_barcode) FOR UPDATE;
 IF NOT FOUND OR NOT public.can_edit_thaan_registration(v.created_by) THEN RAISE EXCEPTION 'Authorised registered barcode required'; END IF;
 IF p_cp IS NOT NULL AND NOT public.can_view_thaan_cp(v.created_by) THEN RAISE EXCEPTION 'Fabric CP entry/view permission required'; END IF;
 SELECT * INTO th FROM public.thaans WHERE id=v.thaan_id FOR UPDATE;
 PERFORM 1 FROM public.fabric_stock WHERE id=v.fabric_stock_id FOR UPDATE;
 SELECT colour INTO actual_colour FROM public.fabrics WHERE id=th.fabric_id;
 SELECT cp_paise_per_m INTO actual_cp FROM public.fabric_stock_costs WHERE fabric_stock_id=v.fabric_stock_id ORDER BY revision DESC LIMIT 1;
 IF (p_length_mm IS NOT NULL AND th.original_mm IS NOT NULL AND p_length_mm<>th.original_mm) OR (nullif(btrim(p_colour),'') IS NOT NULL AND actual_colour IS NOT NULL AND btrim(p_colour)<>actual_colour) OR (p_cp IS NOT NULL AND actual_cp IS NOT NULL AND p_cp<>actual_cp) THEN RAISE EXCEPTION 'Saved actual details cannot be overwritten'; END IF;
 saved:=v.draft_details;
 FOREACH key IN ARRAY ARRAY['colour','length_mm','cp'] LOOP
  IF input ? key THEN
   IF saved ? key AND NOT(key='cp' AND coalesce((saved->>'cp')::bigint,0)=0 AND p_cp>0) AND saved->key IS DISTINCT FROM input->key THEN RAISE EXCEPTION 'Saved detail cannot be overwritten: %',key; END IF;
   saved:=saved||jsonb_build_object(key,input->key);
  END IF;
 END LOOP;
 IF p_cp IS NOT NULL AND actual_cp IS NULL AND th.original_mm IS NOT NULL AND NOT public.has_perm(auth.uid(),'inventory.fill_missing_cp') THEN RAISE EXCEPTION 'Missing CP permission required'; END IF;
 INSERT INTO public.stock_registration_requests VALUES(p_request,'thaan_partial_details',payload||jsonb_build_object('details',saved),th.id,auth.uid(),now());
 UPDATE public.stock_registration_variants SET draft_details=saved WHERE id=v.id AND draft_details IS DISTINCT FROM saved;
 actual_length:=coalesce(th.original_mm,(saved->>'length_mm')::integer);
 actual_colour:=coalesce(actual_colour,saved->>'colour');
 IF actual_length>0 AND coalesce(actual_cp,(saved->>'cp')::bigint,0)>0 THEN
  PERFORM public.complete_barcode_thaan(gen_random_uuid(),v.code,actual_colour,actual_length,p_cp);
 END IF;
 RETURN th.id; END; $function$
;
CREATE OR REPLACE FUNCTION public.edit_workshop_thaan(p_request uuid,p_thaan uuid,p_version text,p_changes jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.thaans%rowtype; v public.stock_registration_variants%rowtype; current_row jsonb; v_payload jsonb; result uuid; details jsonb; item uuid; workshop uuid; qty integer; balance numeric; cp bigint; oldcp bigint; rev integer; BEGIN
 IF NOT public.can_receive_fabric() OR NOT public.has_perm(auth.uid(),'inventory.edit_thaan') THEN RAISE EXCEPTION 'Inventory editing permission required'; END IF;
 IF jsonb_typeof(p_changes) IS DISTINCT FROM 'object' OR p_changes='{}'::jsonb OR (p_changes-'name'-'type_name'-'colour'-'length_mm'-'cp_paise_per_m')<>'{}'::jsonb THEN RAISE EXCEPTION 'Explicit allowed changes required'; END IF;
 v_payload:=jsonb_build_object('thaan',p_thaan,'version',p_version,'changes',p_changes,'reason',nullif(btrim(p_reason),''));
 IF p_request IS NULL THEN RAISE EXCEPTION 'Request required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,11));
 IF EXISTS(SELECT 1 FROM public.stock_registration_requests WHERE request_id=p_request) THEN
  SELECT r.result_id INTO result FROM public.stock_registration_requests r WHERE r.request_id=p_request AND r.actor_id=auth.uid() AND r.action='inventory_detail_edit' AND r.payload-'details'-'group_id'-'type_name'-'colour'=v_payload;
  IF result IS NULL THEN RAISE EXCEPTION 'Request already used by different actor/action/data'; END IF; RETURN result;
 END IF;
 SELECT * INTO v FROM public.stock_registration_variants WHERE thaan_id=p_thaan FOR UPDATE;
 SELECT * INTO t FROM public.thaans WHERE id=p_thaan FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Thaan required'; END IF;
 IF v.fabric_type_id IS NOT NULL THEN PERFORM 1 FROM public.stock_registration_fabric_types WHERE id=v.fabric_type_id FOR UPDATE; END IF;
 PERFORM 1 FROM public.fabric_stock WHERE id=t.fabric_stock_id FOR UPDATE;
 SELECT id INTO item FROM public.inventory_items WHERE thaan_id=t.id FOR UPDATE;
 SELECT value INTO current_row FROM jsonb_array_elements(public.workshop_fabric_inventory()) WHERE value->>'thaan_id'=p_thaan::text;
 IF current_row IS NULL OR NOT(current_row->>'can_edit')::boolean THEN RAISE EXCEPTION 'Authorized Workshop Thaan required'; END IF;
 IF p_version IS DISTINCT FROM current_row->>'version' THEN RAISE EXCEPTION 'Stock changed; refresh and review before saving'; END IF;
 IF p_changes ? 'name' AND nullif(btrim(p_changes->>'name'),'') IS NULL OR p_changes ? 'type_name' AND nullif(btrim(p_changes->>'type_name'),'') IS NULL OR p_changes ? 'colour' AND nullif(btrim(p_changes->>'colour'),'') IS NULL THEN RAISE EXCEPTION 'Entered names/colour cannot be empty'; END IF;
 IF p_changes ? 'type_name' AND v.id IS NULL THEN RAISE EXCEPTION 'Legacy Fabric Type grouping cannot be reassigned'; END IF;
 details:=coalesce(v.draft_details,'{}'::jsonb);
 IF p_changes ? 'cp_paise_per_m' THEN
  cp:=(p_changes->>'cp_paise_per_m')::bigint;
  IF cp IS NULL OR (t.original_mm IS NOT NULL AND cp<=0) OR cp<0 OR cp>9007199254740991 OR NOT(current_row->>'cp_visible')::boolean THEN RAISE EXCEPTION 'Visible exact CP required'; END IF;
  oldcp:=(current_row->>'cp_paise_per_m')::bigint;
  IF NOT(current_row->>'can_correct_cp')::boolean AND NOT(coalesce(oldcp,0)=0 AND (current_row->>'can_fill_cp')::boolean) THEN RAISE EXCEPTION 'CP correction permission required'; END IF;
  details:=details||jsonb_build_object('cp',cp);
 END IF;
 IF p_changes ? 'length_mm' THEN
  qty:=(p_changes->>'length_mm')::integer;
  IF qty IS NULL OR qty<0 OR (t.original_mm IS NULL AND qty=0) THEN RAISE EXCEPTION 'Exact nonnegative Workshop length / positive first measurement required'; END IF;
  IF t.original_mm IS NULL THEN
   IF v.id IS NULL OR NOT public.has_perm(auth.uid(),'stock.measure_thaan') THEN RAISE EXCEPTION 'Registered draft measurement permission required'; END IF;
   details:=details||jsonb_build_object('length_mm',qty);
  ELSIF item IS NULL OR NOT public.has_perm(auth.uid(),'inventory.correct_workshop') THEN RAISE EXCEPTION 'Reconciled Workshop quantity correction permission required'; END IF;
 END IF;
 IF p_changes ? 'colour' THEN details:=details||jsonb_build_object('colour',btrim(p_changes->>'colour')); END IF;
 v_payload:=v_payload||jsonb_build_object('details',details,'group_id',v.fabric_type_id,'type_name',btrim(p_changes->>'type_name'),'colour',btrim(p_changes->>'colour'));
 INSERT INTO public.stock_registration_requests VALUES(p_request,'inventory_detail_edit',v_payload,t.id,auth.uid(),now());
 IF v.id IS NOT NULL THEN UPDATE public.stock_registration_variants SET draft_details=details WHERE id=v.id; END IF;
 IF p_changes ? 'name' THEN UPDATE public.fabrics SET name=btrim(p_changes->>'name') WHERE id=t.fabric_id; END IF;
 IF p_changes ? 'type_name' THEN UPDATE public.stock_registration_fabric_types SET name=btrim(p_changes->>'type_name') WHERE id=v.fabric_type_id; END IF;
 IF t.original_mm IS NULL AND v.id IS NOT NULL THEN
  IF details ? 'length_mm' AND coalesce((details->>'cp')::bigint,oldcp,0)>0 THEN PERFORM public.complete_barcode_thaan(gen_random_uuid(),v.code,details->>'colour',(details->>'length_mm')::integer,CASE WHEN p_changes ? 'cp_paise_per_m' THEN (details->>'cp')::bigint END); END IF;
 ELSE
  IF p_changes ? 'colour' THEN UPDATE public.fabrics SET colour=btrim(p_changes->>'colour') WHERE id=t.fabric_id; END IF;
  IF p_changes ? 'cp_paise_per_m' AND cp IS DISTINCT FROM oldcp THEN
   SELECT coalesce(max(revision),0)+1 INTO rev FROM public.fabric_stock_costs WHERE fabric_stock_id=t.fabric_stock_id;
   INSERT INTO public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m,recorded_by,reason) VALUES(t.fabric_stock_id,rev,cp,auth.uid(),nullif(btrim(p_reason),''));
  END IF;
  IF p_changes ? 'length_mm' THEN
   SELECT id INTO workshop FROM public.locations WHERE kind='workshop' AND active;
   balance:=public.inventory_balance(item,workshop);
   IF qty<>balance THEN
    INSERT INTO public.inventory_movements(inventory_item_id,thaan_id,fabric_stock_id,kind,quantity,unit,source_location_id,destination_location_id,reason,reference,actor_id)
    VALUES(item,t.id,t.fabric_stock_id,'ADJUSTMENT',abs(qty-balance),'mm',CASE WHEN qty<balance THEN workshop END,CASE WHEN qty>balance THEN workshop END,coalesce(nullif(btrim(p_reason),''),'Workshop balance correction; user reason not recorded'),'INVEDIT:'||p_request::text,auth.uid());
   END IF;
  END IF;
 END IF;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference) VALUES(auth.uid(),'edit_workshop_thaan','thaans',t.id,current_row-'cp_paise_per_m',v_payload,'INVEDIT:'||p_request::text);
 RETURN t.id; END; $$;
CREATE OR REPLACE FUNCTION public.guard_label_variant_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Registered barcode history is permanent'; END IF;
 IF (to_jsonb(NEW)-'details_recorded_at'-'draft_details') IS DISTINCT FROM (to_jsonb(OLD)-'details_recorded_at'-'draft_details') THEN RAISE EXCEPTION 'Registered barcode identity is permanent'; END IF;
 IF NEW.draft_details IS DISTINCT FROM OLD.draft_details THEN
  IF NOT EXISTS(SELECT 1 FROM public.stock_registration_requests r WHERE r.action IN('thaan_partial_details','inventory_detail_edit') AND r.actor_id=auth.uid() AND r.result_id=OLD.thaan_id AND r.payload->'details'=NEW.draft_details AND (r.action='inventory_detail_edit' OR NEW.draft_details @> CASE WHEN coalesce((OLD.draft_details->>'cp')::bigint,0)=0 THEN OLD.draft_details-'cp' ELSE OLD.draft_details END)) THEN RAISE EXCEPTION 'Only authenticated missing-details completion allowed'; END IF;
 END IF;
 IF NEW.details_recorded_at IS DISTINCT FROM OLD.details_recorded_at AND (OLD.details_recorded_at IS NOT NULL OR NEW.details_recorded_at IS NULL OR NOT EXISTS(SELECT 1 FROM public.thaans WHERE id=NEW.thaan_id AND original_mm>0 AND status IN('active','depleted','archived'))) THEN RAISE EXCEPTION 'Only first actual measurement timestamp allowed'; END IF;
 RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.registered_thaan_details(p_barcode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT public.can_receive_fabric() THEN RAISE EXCEPTION 'Authorized Stock Entry required'; END IF;
 RETURN (SELECT jsonb_build_object('code',v.code,'thaan_id',th.id,'stock_id',fs.id,'batch_id',b.id,'batch_code',b.code,'supplier',rb.provider_name,'arrival_date',b.received_on,'remarks',b.notes,'fabric_type_id',g.id,'fabric_type',g.name,'colour',coalesce((SELECT colour FROM public.fabrics WHERE id=th.fabric_id),v.draft_details->>'colour'),'saved_length_mm',coalesce(th.original_mm,(v.draft_details->>'length_mm')::integer),'original_mm',th.original_mm,'status',th.status,'measured',th.original_mm IS NOT NULL,'can_complete',public.has_perm(auth.uid(),'stock.measure_thaan') AND public.can_edit_thaan_registration(v.created_by),'can_set_cp',public.can_view_thaan_cp(v.created_by),'cp_visible',public.can_view_thaan_cp(v.created_by),'cp_missing',coalesce((SELECT cp_paise_per_m FROM public.fabric_stock_costs WHERE fabric_stock_id=fs.id ORDER BY revision DESC LIMIT 1),(v.draft_details->>'cp')::bigint,0)<=0,'cp_paise_per_m',CASE WHEN public.can_view_thaan_cp(v.created_by) THEN coalesce((SELECT cp_paise_per_m FROM public.fabric_stock_costs WHERE fabric_stock_id=fs.id ORDER BY revision DESC LIMIT 1),(v.draft_details->>'cp')::bigint) END,'available_mm',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL) END,'locations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',loc.id,'name',loc.name,'quantity_mm',public.inventory_balance(i.id,loc.id)) ORDER BY loc.name,loc.id) FROM public.locations loc WHERE i.id IS NOT NULL AND public.inventory_balance(i.id,loc.id)>0),'[]'::jsonb))
 FROM public.stock_registration_variants v JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id JOIN public.stock_registration_batches rb ON rb.batch_id=g.batch_id JOIN public.receiving_batches b ON b.id=rb.batch_id JOIN public.thaans th ON th.id=v.thaan_id JOIN public.fabric_stock fs ON fs.id=v.fabric_stock_id LEFT JOIN public.inventory_items i ON i.thaan_id=th.id WHERE v.code=btrim(p_barcode));
END; $function$
;
-- Prospective ledger safety: drafts may retain entered values but never usable stock.
CREATE FUNCTION public.guard_usable_fabric() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE th public.thaans%rowtype; cp bigint;
BEGIN
 IF NEW.thaan_id IS NULL OR NEW.kind NOT IN('INWARD','TRANSFER','SALE','MATERIAL_ISSUE') THEN RETURN NULL; END IF;
 SELECT * INTO th FROM public.thaans WHERE id=NEW.thaan_id;
 SELECT cp_paise_per_m INTO cp FROM public.fabric_stock_costs WHERE fabric_stock_id=th.fabric_stock_id ORDER BY revision DESC LIMIT 1;
 IF th.original_mm IS NULL OR th.original_mm<=0 OR coalesce(cp,0)<=0 OR th.status NOT IN('active','depleted') THEN RAISE EXCEPTION 'Positive length and CP required before fabric receipt, transfer, sale or issue'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER usable_fabric_ledger AFTER INSERT ON public.inventory_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_usable_fabric();
REVOKE ALL ON FUNCTION public.guard_usable_fabric() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.guard_active_thaan() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE th public.thaans%rowtype; cp bigint;
BEGIN
 FOR th IN SELECT * FROM public.thaans WHERE (TG_TABLE_NAME='thaans' AND id=NEW.id) OR (TG_TABLE_NAME='fabric_stock_costs' AND fabric_stock_id=NEW.fabric_stock_id) LOOP
 IF th.status='active' THEN
  SELECT cp_paise_per_m INTO cp FROM public.fabric_stock_costs WHERE fabric_stock_id=th.fabric_stock_id ORDER BY revision DESC LIMIT 1;
  IF coalesce(th.original_mm,0)<=0 OR coalesce(cp,0)<=0 THEN RAISE EXCEPTION 'Active Thaan requires positive recorded length and CP'; END IF;
 END IF;
 END LOOP;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER active_thaan_complete AFTER INSERT OR UPDATE ON public.thaans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_active_thaan();
CREATE CONSTRAINT TRIGGER active_thaan_cp AFTER INSERT ON public.fabric_stock_costs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_active_thaan();
REVOKE ALL ON FUNCTION public.guard_active_thaan() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.guard_new_tailor_login() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.profile_id IS NULL OR NOT public.has_role(NEW.profile_id,'tailor') THEN RAISE EXCEPTION 'Choose an active Tailor account or create it in Add Staff'; END IF;RETURN NEW;
END; $$;
CREATE TRIGGER new_tailor_login BEFORE INSERT ON public.tailors FOR EACH ROW EXECUTE FUNCTION public.guard_new_tailor_login();
REVOKE ALL ON FUNCTION public.guard_new_tailor_login() FROM PUBLIC,anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
