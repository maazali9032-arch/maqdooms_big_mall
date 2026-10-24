BEGIN;

-- Physical tailoring materials are tracked by container/roll/unit.  The old
-- pooled consumable ledger remains historical and is no longer used by this workflow.
INSERT INTO public.roles(key,label,description) VALUES
 ('tailor_staff','Tailor Staff','Views only work credited to this staff member')
ON CONFLICT(key) DO UPDATE SET label=excluded.label,description=excluded.description;

INSERT INTO public.permissions(key,label,domain) VALUES
 ('materials.receive_units','Receive material batches and generate unit barcodes','inventory'),
 ('materials.transfer_units','Assign complete material units to a factory Tailor','inventory'),
 ('materials.record_consumption','Record immutable job material consumption','tailoring'),
 ('materials.correct_consumption','Correct or reverse submitted material consumption','tailoring')
ON CONFLICT(key) DO UPDATE SET label=excluded.label,domain=excluded.domain;
INSERT INTO public.role_permissions(role_key,permission_key) VALUES
 ('stock_entry','materials.receive_units'),('stock_entry','materials.transfer_units'),
 ('tailor','materials.record_consumption')
ON CONFLICT DO NOTHING;

CREATE SEQUENCE public.material_batch_number MINVALUE 1 MAXVALUE 9999 START 1 NO CYCLE;
CREATE SEQUENCE public.material_unit_barcode_number MINVALUE 1 MAXVALUE 60466175 START 1 NO CYCLE;
REVOKE ALL ON SEQUENCE public.material_batch_number,public.material_unit_barcode_number FROM PUBLIC,anon,authenticated;

CREATE TABLE public.material_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL UNIQUE CHECK(code ~ '^MB[0-9]{4}$'),
 supplier_name text NOT NULL CHECK(btrim(supplier_name)<>''),
 supplier_reference text,
 shared_expense_paise bigint NOT NULL DEFAULT 0 CHECK(shared_expense_paise>=0),
 received_by uuid NOT NULL REFERENCES public.profiles(id),
 request_id uuid NOT NULL UNIQUE,
 request_payload jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.material_units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id uuid NOT NULL REFERENCES public.material_batches(id),
 material_id uuid NOT NULL REFERENCES public.materials(id),
 barcode text NOT NULL UNIQUE CHECK(barcode ~ '^M[0-9A-Z]{5}$'),
 ordinal integer NOT NULL CHECK(ordinal>0),
 initial_quantity numeric(18,3) NOT NULL CHECK(initial_quantity>0),
 remaining_quantity numeric(18,3) NOT NULL CHECK(remaining_quantity>=0 AND remaining_quantity<=initial_quantity),
 unit text NOT NULL CHECK(btrim(unit)<>''),
 net_purchase_paise bigint NOT NULL CHECK(net_purchase_paise>=0),
 recoverable_gst_paise bigint NOT NULL DEFAULT 0 CHECK(recoverable_gst_paise>=0),
 nonrecoverable_gst_paise bigint NOT NULL DEFAULT 0 CHECK(nonrecoverable_gst_paise>=0),
 allocated_expense_paise bigint NOT NULL DEFAULT 0 CHECK(allocated_expense_paise>=0),
 direct_cost_paise bigint NOT NULL DEFAULT 0 CHECK(direct_cost_paise>=0),
 landed_cost_paise bigint NOT NULL CHECK(landed_cost_paise>=0),
 cp_per_quantity_paise numeric(24,6) NOT NULL CHECK(cp_per_quantity_paise>=0),
 assigned_factory_id uuid REFERENCES public.tailoring_factories(id),
 assigned_tailor_id uuid REFERENCES public.tailors(id),
 received_by uuid NOT NULL REFERENCES public.profiles(id),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 exhausted_at timestamptz,
 UNIQUE(batch_id,material_id,ordinal),
 CHECK((assigned_factory_id IS NULL)=(assigned_tailor_id IS NULL))
);
CREATE INDEX material_units_batch_idx ON public.material_units(batch_id,material_id,ordinal);
CREATE INDEX material_units_custody_idx ON public.material_units(assigned_tailor_id,remaining_quantity);

CREATE TABLE public.material_unit_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE,
 request_payload jsonb NOT NULL,
 material_unit_id uuid NOT NULL REFERENCES public.material_units(id),
 from_factory_id uuid REFERENCES public.tailoring_factories(id),
 from_tailor_id uuid REFERENCES public.tailors(id),
 to_factory_id uuid NOT NULL REFERENCES public.tailoring_factories(id),
 to_tailor_id uuid NOT NULL REFERENCES public.tailors(id),
 transferred_by uuid NOT NULL REFERENCES public.profiles(id),
 transferred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.tailor_staff_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 staff_profile_id uuid NOT NULL REFERENCES public.profiles(id),
 tailor_id uuid NOT NULL REFERENCES public.tailors(id),
 factory_id uuid NOT NULL REFERENCES public.tailoring_factories(id),
 assigned_by uuid NOT NULL REFERENCES public.profiles(id),
 valid_from timestamptz NOT NULL DEFAULT clock_timestamp(),
 valid_until timestamptz,
 CHECK(valid_until IS NULL OR valid_until>valid_from)
);
CREATE UNIQUE INDEX tailor_staff_current_assignment_idx ON public.tailor_staff_assignments(staff_profile_id) WHERE valid_until IS NULL;
CREATE INDEX tailor_staff_master_idx ON public.tailor_staff_assignments(tailor_id,factory_id) WHERE valid_until IS NULL;

CREATE TABLE public.job_material_consumptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE,
 request_payload jsonb NOT NULL,
 customer_tailoring_job_id uuid REFERENCES public.customer_tailoring_jobs(id),
 production_job_id uuid REFERENCES public.production_jobs(id),
 tailor_assignment_id uuid NOT NULL REFERENCES public.tailor_assignments(id),
 tailor_staff_assignment_id uuid NOT NULL REFERENCES public.tailor_staff_assignments(id),
 submitted_by uuid NOT NULL REFERENCES public.profiles(id),
 submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reversed_by uuid REFERENCES public.profiles(id),
 reversed_at timestamptz,
 reversal_reason text,
 CHECK(num_nonnulls(customer_tailoring_job_id,production_job_id)=1),
 UNIQUE NULLS NOT DISTINCT(customer_tailoring_job_id,production_job_id)
);
CREATE TABLE public.job_material_consumption_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 consumption_id uuid NOT NULL REFERENCES public.job_material_consumptions(id),
 material_unit_id uuid NOT NULL REFERENCES public.material_units(id),
 quantity numeric(18,3) NOT NULL CHECK(quantity>0),
 unit text NOT NULL,
 cp_per_quantity_paise numeric(24,6) NOT NULL CHECK(cp_per_quantity_paise>=0),
 amount_paise bigint NOT NULL CHECK(amount_paise>=0),
 UNIQUE(consumption_id,material_unit_id)
);

CREATE TABLE public.production_completion_costs (
 production_job_id uuid PRIMARY KEY REFERENCES public.production_jobs(id),
 stitching_total_paise bigint NOT NULL CHECK(stitching_total_paise>=0),
 recorded_by uuid NOT NULL REFERENCES public.profiles(id),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.gst_garment_slab_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 effective_from timestamptz NOT NULL,
 threshold_paise bigint NOT NULL CHECK(threshold_paise>=0),
 lower_rate_bps integer NOT NULL CHECK(lower_rate_bps BETWEEN 0 AND 10000),
 higher_rate_bps integer NOT NULL CHECK(higher_rate_bps BETWEEN 0 AND 10000),
 recorded_by uuid NOT NULL REFERENCES public.profiles(id),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX gst_garment_slabs_effective_idx ON public.gst_garment_slab_versions(effective_from DESC,recorded_at DESC);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['material_batches','material_units','material_unit_transfers','tailor_staff_assignments','job_material_consumptions','job_material_consumption_lines','production_completion_costs','gst_garment_slab_versions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
CREATE POLICY material_batches_read ON public.material_batches FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','stock_entry','tailor']));
CREATE POLICY material_units_read ON public.material_units FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) OR EXISTS(SELECT 1 FROM public.tailors t WHERE t.id=material_units.assigned_tailor_id AND t.profile_id=auth.uid()) OR EXISTS(SELECT 1 FROM public.tailor_staff_assignments s WHERE s.tailor_id=material_units.assigned_tailor_id AND s.staff_profile_id=auth.uid() AND s.valid_until IS NULL));
CREATE POLICY material_transfers_read ON public.material_unit_transfers FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) OR EXISTS(SELECT 1 FROM public.tailors t WHERE t.id=material_unit_transfers.to_tailor_id AND t.profile_id=auth.uid()));
CREATE POLICY tailor_staff_read ON public.tailor_staff_assignments FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner') OR staff_profile_id=auth.uid() OR EXISTS(SELECT 1 FROM public.tailors t WHERE t.id=tailor_staff_assignments.tailor_id AND t.profile_id=auth.uid()));
CREATE POLICY consumption_read ON public.job_material_consumptions FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) OR submitted_by=auth.uid() OR EXISTS(SELECT 1 FROM public.tailor_staff_assignments s WHERE s.id=tailor_staff_assignment_id AND s.staff_profile_id=auth.uid()));
CREATE POLICY consumption_lines_read ON public.job_material_consumption_lines FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.job_material_consumptions c WHERE c.id=consumption_id));
CREATE POLICY completion_cost_read ON public.production_completion_costs FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner') OR public.has_perm(auth.uid(),'production.receive'));
CREATE POLICY garment_slab_owner_read ON public.gst_garment_slab_versions FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));

CREATE FUNCTION public.new_material_unit_barcode() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n bigint; chars text:='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; encoded text:=''; code_value text;
BEGIN
 LOOP
  n:=nextval('public.material_unit_barcode_number'); encoded:='';
  FOR i IN 1..5 LOOP encoded:=substr(chars,(n%36)::integer+1,1)||encoded; n:=floor(n/36); END LOOP;
  code_value:='M'||encoded;
  IF NOT EXISTS(SELECT 1 FROM public.material_units WHERE barcode=code_value) THEN RETURN code_value; END IF;
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.new_material_unit_barcode() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.receive_material_unit_batch(p_request uuid,p_supplier text,p_reference text,p_shared_expense_paise bigint,p_lines jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.material_batches%rowtype; payload jsonb; batch_id uuid; batch_code text; line jsonb; unit_row jsonb; material public.materials%rowtype; total_net numeric; allocated bigint; landed bigint; qty numeric; ordinal_value integer:=0; unit_cost bigint;
BEGIN
 IF NOT public.has_perm(auth.uid(),'materials.receive_units') THEN RAISE EXCEPTION 'Material unit receiving permission required'; END IF;
 IF p_request IS NULL OR nullif(btrim(p_supplier),'') IS NULL OR p_shared_expense_paise IS NULL OR p_shared_expense_paise<0 OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Supplier, request and one to 100 material types required'; END IF;
 payload:=jsonb_build_object('actor',auth.uid(),'supplier',btrim(p_supplier),'reference',nullif(btrim(p_reference),''),'shared_expense_paise',p_shared_expense_paise,'lines',p_lines);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,71));
 SELECT * INTO saved FROM public.material_batches WHERE request_id=p_request;
 IF FOUND THEN IF saved.request_payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Retry requires the unchanged material batch'; END IF; RETURN saved.id; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) l WHERE jsonb_typeof(l->'units') IS DISTINCT FROM 'array' OR jsonb_array_length(l->'units') NOT BETWEEN 1 AND 500) THEN RAISE EXCEPTION 'Each material type requires one to 500 physical units'; END IF;
 SELECT coalesce(sum((u->>'net_purchase_paise')::numeric),0) INTO total_net FROM jsonb_array_elements(p_lines) l CROSS JOIN jsonb_array_elements(l->'units') u;
 IF total_net<=0 THEN RAISE EXCEPTION 'Positive net purchase value is required for proportional expense allocation'; END IF;
 batch_code:='MB'||lpad(nextval('public.material_batch_number')::text,4,'0');
 INSERT INTO public.material_batches(code,supplier_name,supplier_reference,shared_expense_paise,received_by,request_id,request_payload) VALUES(batch_code,btrim(p_supplier),nullif(btrim(p_reference),''),p_shared_expense_paise,auth.uid(),p_request,payload) RETURNING id INTO batch_id;
 FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF nullif(line->>'material_id','') IS NOT NULL THEN SELECT * INTO material FROM public.materials WHERE id=(line->>'material_id')::uuid AND active FOR UPDATE; END IF;
  IF material.id IS NULL THEN
   IF nullif(btrim(line->>'name'),'') IS NULL OR nullif(btrim(line->>'unit'),'') IS NULL THEN RAISE EXCEPTION 'New material name and unit required'; END IF;
   INSERT INTO public.materials(name,unit,qty_on_hand,cost_paise,active,category) VALUES(btrim(line->>'name'),btrim(line->>'unit'),0,0,true,coalesce(nullif(line->>'category',''),'other')) RETURNING * INTO material;
  END IF;
  ordinal_value:=0;
  FOR unit_row IN SELECT value FROM jsonb_array_elements(line->'units') LOOP
   ordinal_value:=ordinal_value+1; qty:=(unit_row->>'quantity')::numeric; unit_cost:=(unit_row->>'net_purchase_paise')::bigint;
   IF qty<=0 OR qty<>round(qty,3) OR unit_cost<0 OR coalesce((unit_row->>'recoverable_gst_paise')::bigint,0)<0 OR coalesce((unit_row->>'nonrecoverable_gst_paise')::bigint,0)<0 OR coalesce((unit_row->>'direct_cost_paise')::bigint,0)<0 THEN RAISE EXCEPTION 'Exact positive quantity and non-negative unit costs required'; END IF;
   allocated:=round(p_shared_expense_paise::numeric*unit_cost/total_net); landed:=unit_cost+coalesce((unit_row->>'nonrecoverable_gst_paise')::bigint,0)+coalesce((unit_row->>'direct_cost_paise')::bigint,0)+allocated;
   INSERT INTO public.material_units(batch_id,material_id,barcode,ordinal,initial_quantity,remaining_quantity,unit,net_purchase_paise,recoverable_gst_paise,nonrecoverable_gst_paise,allocated_expense_paise,direct_cost_paise,landed_cost_paise,cp_per_quantity_paise,received_by)
   VALUES(batch_id,material.id,public.new_material_unit_barcode(),ordinal_value,qty,qty,material.unit,unit_cost,coalesce((unit_row->>'recoverable_gst_paise')::bigint,0),coalesce((unit_row->>'nonrecoverable_gst_paise')::bigint,0),allocated,coalesce((unit_row->>'direct_cost_paise')::bigint,0),landed,landed::numeric/qty,auth.uid());
  END LOOP;
  material:=NULL;
 END LOOP;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'receive_material_unit_batch','material_batches',batch_id,payload,batch_code);
 RETURN batch_id;
END; $$;

CREATE FUNCTION public.material_unit_catalog(p_search text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry','tailor','tailor_staff']) THEN RAISE EXCEPTION 'Material stock access required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.received_at DESC,x.batch_code,x.material_name,x.ordinal) FROM(
  SELECT u.id,u.barcode,u.ordinal,u.initial_quantity,u.remaining_quantity,u.unit,u.landed_cost_paise,u.cp_per_quantity_paise,u.assigned_factory_id,f.name factory_name,u.assigned_tailor_id,t.real_name tailor_name,u.exhausted_at,u.received_at,b.id batch_id,b.code batch_code,b.supplier_name,m.id material_id,m.name material_name,m.category
  FROM public.material_units u JOIN public.material_batches b ON b.id=u.batch_id JOIN public.materials m ON m.id=u.material_id LEFT JOIN public.tailoring_factories f ON f.id=u.assigned_factory_id LEFT JOIN public.tailors t ON t.id=u.assigned_tailor_id
  WHERE (public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) OR t.profile_id=auth.uid() OR EXISTS(SELECT 1 FROM public.tailor_staff_assignments s WHERE s.tailor_id=u.assigned_tailor_id AND s.staff_profile_id=auth.uid() AND s.valid_until IS NULL))
   AND (nullif(btrim(p_search),'') IS NULL OR u.barcode ILIKE '%'||btrim(p_search)||'%' OR b.code ILIKE '%'||btrim(p_search)||'%' OR m.name ILIKE '%'||btrim(p_search)||'%')
 )x),'[]'::jsonb);
END; $$;

CREATE FUNCTION public.transfer_material_unit(p_request uuid,p_barcode text,p_tailor uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.material_unit_transfers%rowtype; payload jsonb; u public.material_units%rowtype; assignment public.tailor_assignments%rowtype; result uuid;
BEGIN
 IF NOT public.has_perm(auth.uid(),'materials.transfer_units') THEN RAISE EXCEPTION 'Material transfer permission required'; END IF;
 payload:=jsonb_build_object('actor',auth.uid(),'barcode',upper(btrim(p_barcode)),'tailor',p_tailor);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,72)); SELECT * INTO saved FROM public.material_unit_transfers WHERE request_id=p_request;
 IF FOUND THEN IF saved.request_payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Retry requires unchanged transfer'; END IF; RETURN saved.id; END IF;
 SELECT * INTO u FROM public.material_units WHERE barcode=upper(btrim(p_barcode)) FOR UPDATE; IF u.id IS NULL OR u.remaining_quantity<=0 THEN RAISE EXCEPTION 'Available M material-unit barcode required'; END IF;
 SELECT * INTO assignment FROM public.tailor_assignments WHERE tailor_id=p_tailor AND valid_until IS NULL FOR SHARE; IF assignment.id IS NULL THEN RAISE EXCEPTION 'Master Tailor with one active factory required'; END IF;
 INSERT INTO public.material_unit_transfers(request_id,request_payload,material_unit_id,from_factory_id,from_tailor_id,to_factory_id,to_tailor_id,transferred_by) VALUES(p_request,payload,u.id,u.assigned_factory_id,u.assigned_tailor_id,assignment.factory_id,p_tailor,auth.uid()) RETURNING id INTO result;
 UPDATE public.material_units SET assigned_factory_id=assignment.factory_id,assigned_tailor_id=p_tailor WHERE id=u.id;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference) VALUES(auth.uid(),'transfer_material_unit','material_units',u.id,jsonb_build_object('factory',u.assigned_factory_id,'tailor',u.assigned_tailor_id),jsonb_build_object('factory',assignment.factory_id,'tailor',p_tailor),'MATERIAL-TRANSFER:'||p_request);
 RETURN result;
END; $$;

CREATE FUNCTION public.material_transfer_destinations() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_perm(auth.uid(),'materials.transfer_units') THEN RAISE EXCEPTION 'Material transfer permission required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('tailor_id',t.id,'tailor_name',t.real_name,'factory_id',f.id,'factory_name',f.name) ORDER BY f.name,t.real_name) FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id AND t.active JOIN public.tailoring_factories f ON f.id=a.factory_id AND f.active WHERE a.valid_until IS NULL),'[]'::jsonb);
END; $$;

CREATE FUNCTION public.owner_assign_tailor_staff(p_staff uuid,p_tailor uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE assignment public.tailor_assignments%rowtype; current_row public.tailor_staff_assignments%rowtype; result uuid;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.user_roles r ON r.user_id=p.id AND r.role_key='tailor_staff' WHERE p.id=p_staff AND p.active) THEN RAISE EXCEPTION 'Active Tailor Staff login required'; END IF;
 SELECT * INTO assignment FROM public.tailor_assignments WHERE tailor_id=p_tailor AND valid_until IS NULL; IF assignment.id IS NULL THEN RAISE EXCEPTION 'Master Tailor with active factory required'; END IF;
 SELECT * INTO current_row FROM public.tailor_staff_assignments WHERE staff_profile_id=p_staff AND valid_until IS NULL FOR UPDATE;
 IF current_row.tailor_id=p_tailor THEN RETURN current_row.id; END IF;
 IF current_row.id IS NOT NULL THEN UPDATE public.tailor_staff_assignments SET valid_until=clock_timestamp() WHERE id=current_row.id; END IF;
 INSERT INTO public.tailor_staff_assignments(staff_profile_id,tailor_id,factory_id,assigned_by) VALUES(p_staff,p_tailor,assignment.factory_id,auth.uid()) RETURNING id INTO result; RETURN result;
END; $$;

CREATE FUNCTION public.tailor_material_scan(p_code text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE master public.tailors%rowtype; result jsonb;
BEGIN
 SELECT * INTO master FROM public.tailors WHERE profile_id=auth.uid() AND active; IF master.id IS NULL THEN RAISE EXCEPTION 'Master Tailor login required'; END IF;
 SELECT jsonb_build_object('id',j.id,'code',coalesce(j.scan_code,j.code),'kind',j.kind,'status',j.status,'factory_id',a.factory_id,'tailor_id',a.tailor_id,'title',j.title,
  'staff',coalesce((SELECT jsonb_agg(jsonb_build_object('assignment_id',s.id,'profile_id',s.staff_profile_id,'name',p.full_name) ORDER BY p.full_name) FROM public.tailor_staff_assignments s JOIN public.profiles p ON p.id=s.staff_profile_id WHERE s.tailor_id=master.id AND s.factory_id=a.factory_id AND s.valid_until IS NULL),'[]'::jsonb),
  'units',coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'barcode',u.barcode,'material',m.name,'remaining',u.remaining_quantity,'unit',u.unit) ORDER BY m.name,u.barcode) FROM public.material_units u JOIN public.materials m ON m.id=u.material_id WHERE u.assigned_tailor_id=master.id AND u.assigned_factory_id=a.factory_id AND u.remaining_quantity>0),'[]'::jsonb)) INTO result
 FROM (SELECT id,code,scan_code,status,tailor_assignment_id,'production'::text kind,'Production '||coalesce(code,'') title FROM public.production_jobs
  UNION ALL SELECT id,code,scan_code,status,tailor_assignment_id,'customer_tailoring','Customer stitching '||coalesce(garment,'') FROM public.customer_tailoring_jobs) j
 JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id WHERE upper(j.code)=upper(btrim(p_code)) OR upper(coalesce(j.scan_code,''))=upper(btrim(p_code));
 IF result IS NULL OR result->>'tailor_id'<>master.id::text THEN RAISE EXCEPTION 'This job is not assigned to the signed-in Master Tailor'; END IF; RETURN result;
END; $$;

CREATE FUNCTION public.submit_job_material_consumption(p_request uuid,p_job_kind text,p_job uuid,p_staff_assignment uuid,p_lines jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE master public.tailors%rowtype; job_assignment uuid; staff public.tailor_staff_assignments%rowtype; payload jsonb; result uuid; row_value jsonb; u public.material_units%rowtype; qty numeric; amount bigint;
BEGIN
 IF NOT public.has_perm(auth.uid(),'materials.record_consumption') THEN RAISE EXCEPTION 'Material consumption permission required'; END IF;
 SELECT * INTO master FROM public.tailors WHERE profile_id=auth.uid() AND active; IF master.id IS NULL THEN RAISE EXCEPTION 'Master Tailor login required'; END IF;
 IF p_job_kind='production' THEN SELECT tailor_assignment_id INTO job_assignment FROM public.production_jobs WHERE id=p_job AND status IN('issued','in_progress','completed');
 ELSIF p_job_kind='customer_tailoring' THEN SELECT tailor_assignment_id INTO job_assignment FROM public.customer_tailoring_jobs WHERE id=p_job AND status IN('open','in_progress','completed'); ELSE RAISE EXCEPTION 'Production or customer-tailoring job required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tailor_assignments a WHERE a.id=job_assignment AND a.tailor_id=master.id) THEN RAISE EXCEPTION 'Job belongs to another Master Tailor'; END IF;
 SELECT * INTO staff FROM public.tailor_staff_assignments WHERE id=p_staff_assignment AND tailor_id=master.id AND valid_until IS NULL; IF staff.id IS NULL THEN RAISE EXCEPTION 'Active Tailor Staff under this Master Tailor required'; END IF;
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 OR (SELECT count(DISTINCT upper(value->>'barcode')) FROM jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) THEN RAISE EXCEPTION 'One to 100 distinct material-unit scans required'; END IF;
 payload:=jsonb_build_object('actor',auth.uid(),'job_kind',p_job_kind,'job',p_job,'staff_assignment',p_staff_assignment,'lines',p_lines);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,73));
 IF EXISTS(SELECT 1 FROM public.job_material_consumptions WHERE request_id=p_request) THEN RETURN (SELECT id FROM public.job_material_consumptions WHERE request_id=p_request AND request_payload=payload); END IF;
 INSERT INTO public.job_material_consumptions(request_id,request_payload,customer_tailoring_job_id,production_job_id,tailor_assignment_id,tailor_staff_assignment_id,submitted_by) VALUES(p_request,payload,CASE WHEN p_job_kind='customer_tailoring' THEN p_job END,CASE WHEN p_job_kind='production' THEN p_job END,job_assignment,p_staff_assignment,auth.uid()) RETURNING id INTO result;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  SELECT * INTO u FROM public.material_units WHERE barcode=upper(btrim(row_value->>'barcode')) FOR UPDATE; qty:=(row_value->>'quantity')::numeric;
  IF u.id IS NULL OR u.assigned_tailor_id<>master.id OR u.assigned_factory_id<>staff.factory_id THEN RAISE EXCEPTION 'Every M unit must be assigned to this Master Tailor and factory'; END IF;
  IF qty<=0 OR qty<>round(qty,3) OR qty>u.remaining_quantity THEN RAISE EXCEPTION 'Consumption must be positive and cannot exceed the unit balance'; END IF;
  amount:=round(qty*u.cp_per_quantity_paise);
  INSERT INTO public.job_material_consumption_lines(consumption_id,material_unit_id,quantity,unit,cp_per_quantity_paise,amount_paise) VALUES(result,u.id,qty,u.unit,u.cp_per_quantity_paise,amount);
  UPDATE public.material_units SET remaining_quantity=remaining_quantity-qty,exhausted_at=CASE WHEN remaining_quantity-qty=0 THEN clock_timestamp() END WHERE id=u.id;
 END LOOP;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'submit_job_material_consumption','job_material_consumptions',result,payload,'MATERIAL-CONSUME:'||p_request); RETURN result;
END; $$;

CREATE FUNCTION public.tailor_staff_work_summary() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'tailor_staff') THEN RAISE EXCEPTION 'Tailor Staff login required'; END IF;
 RETURN jsonb_build_object('month_count',(SELECT count(*) FROM public.job_material_consumptions c JOIN public.tailor_staff_assignments s ON s.id=c.tailor_staff_assignment_id WHERE s.staff_profile_id=auth.uid() AND c.reversed_at IS NULL AND c.submitted_at>=date_trunc('month',now())),
  'work',coalesce((SELECT jsonb_agg(jsonb_build_object('submitted_at',c.submitted_at,'job_code',coalesce(p.code,j.code),'kind',CASE WHEN c.production_job_id IS NOT NULL THEN 'production' ELSE 'customer_tailoring' END,'materials',(SELECT jsonb_agg(jsonb_build_object('barcode',u.barcode,'material',m.name,'quantity',l.quantity,'unit',l.unit)) FROM public.job_material_consumption_lines l JOIN public.material_units u ON u.id=l.material_unit_id JOIN public.materials m ON m.id=u.material_id WHERE l.consumption_id=c.id)) ORDER BY c.submitted_at DESC) FROM public.job_material_consumptions c JOIN public.tailor_staff_assignments s ON s.id=c.tailor_staff_assignment_id LEFT JOIN public.production_jobs p ON p.id=c.production_job_id LEFT JOIN public.customer_tailoring_jobs j ON j.id=c.customer_tailoring_job_id WHERE s.staff_profile_id=auth.uid() AND c.reversed_at IS NULL),'[]'::jsonb));
END; $$;

CREATE FUNCTION public.save_production_completion_cost(p_job uuid,p_stitching_total_paise bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_perm(auth.uid(),'production.receive') OR p_stitching_total_paise IS NULL OR p_stitching_total_paise<0 THEN RAISE EXCEPTION 'Workshop receipt permission and whole-job stitching CP required'; END IF;
 IF EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE production_job_id=p_job) THEN
  IF EXISTS(SELECT 1 FROM public.production_completion_costs WHERE production_job_id=p_job AND stitching_total_paise=p_stitching_total_paise) THEN RETURN; END IF;
  RAISE EXCEPTION 'Production cost is finalized with the receipt';
 END IF;
 INSERT INTO public.production_completion_costs VALUES(p_job,p_stitching_total_paise,auth.uid(),clock_timestamp()) ON CONFLICT(production_job_id) DO UPDATE SET stitching_total_paise=excluded.stitching_total_paise,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at;
END; $$;

CREATE FUNCTION public.gst_garment_slab_settings() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE row_value public.gst_garment_slab_versions%rowtype;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 SELECT * INTO row_value FROM public.gst_garment_slab_versions ORDER BY effective_from DESC,recorded_at DESC LIMIT 1;
 RETURN CASE WHEN row_value.id IS NULL THEN jsonb_build_object('threshold_paise','250000','lower_rate_bps',500,'higher_rate_bps',1800,'effective_from',clock_timestamp()) ELSE to_jsonb(row_value) END;
END; $$;
CREATE FUNCTION public.owner_save_gst_garment_slabs(p_effective_from timestamptz,p_threshold_paise bigint,p_lower_rate_bps integer,p_higher_rate_bps integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_effective_from IS NULL OR p_threshold_paise<0 OR p_lower_rate_bps NOT BETWEEN 0 AND 10000 OR p_higher_rate_bps NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Valid garment GST threshold and rates required'; END IF;
 INSERT INTO public.gst_garment_slab_versions(effective_from,threshold_paise,lower_rate_bps,higher_rate_bps,recorded_by) VALUES(p_effective_from,p_threshold_paise,p_lower_rate_bps,p_higher_rate_bps,auth.uid()) RETURNING id INTO result;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'save_gst_garment_slabs','gst_garment_slab_versions',result,jsonb_build_object('threshold_paise',p_threshold_paise,'lower_rate_bps',p_lower_rate_bps,'higher_rate_bps',p_higher_rate_bps,'effective_from',p_effective_from),'GST-GARMENT:'||result); RETURN result;
END; $$;
CREATE FUNCTION public.gst_discounted_garment_rate(p_unit_sp_paise bigint,p_at timestamptz DEFAULT clock_timestamp()) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE slab public.gst_garment_slab_versions%rowtype;
BEGIN
 SELECT * INTO slab FROM public.gst_garment_slab_versions WHERE effective_from<=p_at ORDER BY effective_from DESC,recorded_at DESC LIMIT 1;
 IF slab.id IS NULL THEN RETURN CASE WHEN p_unit_sp_paise<=250000 THEN 500 ELSE 1800 END; END IF;
 RETURN CASE WHEN p_unit_sp_paise<=slab.threshold_paise THEN slab.lower_rate_bps ELSE slab.higher_rate_bps END;
END; $$;

DO $$ DECLARE original text; revised text; BEGIN
 original:=pg_get_functiondef('public.record_counter_bill_discount_revision(uuid,integer)'::regprocedure);
 revised:=replace(original,'public.gst_calculate_amount(scaled.entered,(line->>''rate_bps'')::integer,(invoice->>''price_mode'')::text,(invoice->>''supply_type'')::text)',
  'public.gst_calculate_amount(scaled.entered,CASE WHEN line->>''component''=''finished_sale'' THEN public.gst_discounted_garment_rate(round(scaled.entered/greatest((line->>''quantity'')::numeric,1))::bigint) ELSE (line->>''rate_bps'')::integer END,(invoice->>''price_mode'')::text,(invoice->>''supply_type'')::text)');
 IF revised=original THEN RAISE EXCEPTION 'Counter discount GST insertion point not found'; END IF; EXECUTE revised;
END $$;

-- Append actual unit consumption and whole-job stitching CP to the newly-created
-- production cost version, then reallocate the complete CP equally over all pieces.
CREATE FUNCTION public.apply_material_completion_cost(p_job uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE version_id uuid; total bigint; quantity_value integer; base bigint; remainder integer; stitching bigint;
BEGIN
 SELECT v.id,v.quantity_snapshot INTO version_id,quantity_value FROM public.production_cost_versions v WHERE v.production_job_id=p_job ORDER BY v.revision DESC LIMIT 1 FOR UPDATE;
 IF version_id IS NULL THEN RAISE EXCEPTION 'Production cost version required'; END IF;
 IF EXISTS(SELECT 1 FROM public.production_cost_lines WHERE cost_version_id=version_id AND category='tailoring_production' AND description='Whole-job stitching CP entered at Workshop receipt') THEN RETURN; END IF;
 SELECT stitching_total_paise INTO stitching FROM public.production_completion_costs WHERE production_job_id=p_job; IF stitching IS NULL THEN RAISE EXCEPTION 'Enter the whole-job stitching CP before receiving finished pieces'; END IF;
 INSERT INTO public.production_cost_lines(cost_version_id,category,amount_paise,description) SELECT version_id,'other_consumables',coalesce(sum(l.amount_paise),0),'Actual barcode-scanned consumables used by Master Tailor' FROM public.job_material_consumptions c JOIN public.job_material_consumption_lines l ON l.consumption_id=c.id WHERE c.production_job_id=p_job AND c.reversed_at IS NULL HAVING coalesce(sum(l.amount_paise),0)>0;
 INSERT INTO public.production_cost_lines(cost_version_id,category,amount_paise,description) VALUES(version_id,'tailoring_production',stitching,'Whole-job stitching CP entered at Workshop receipt');
 SELECT coalesce(sum(amount_paise),0) INTO total FROM public.production_cost_lines WHERE cost_version_id=version_id; base:=floor(total::numeric/quantity_value); remainder:=(total-base*quantity_value)::integer;
 DELETE FROM public.finished_product_cost_allocations WHERE cost_version_id=version_id;
 INSERT INTO public.finished_product_cost_allocations(finished_product_id,production_job_id,cost_version_id,amount_paise) SELECT id,p_job,version_id,base+CASE WHEN row_number() OVER(ORDER BY piece_number)<=remainder THEN 1 ELSE 0 END FROM public.finished_products WHERE production_job_id=p_job;
 UPDATE public.production_cost_requests SET payload=payload||jsonb_build_object('actual_material_units',true,'whole_job_stitching_paise',stitching) WHERE result_id=version_id;
END; $$;

DO $$ DECLARE original text; BEGIN
 original:=pg_get_functiondef('public.receive_production_barcode_priced(uuid,text,jsonb)'::regprocedure);
 IF position('apply_material_completion_cost' IN original)=0 THEN
  EXECUTE replace(original,' RETURN job.id;',' PERFORM public.apply_material_completion_cost(job.id);'||chr(10)||' RETURN job.id;');
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.owner_register_staff(p_user uuid,p_name text,p_roles text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE email_value text;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF nullif(btrim(p_name),'') IS NULL OR length(btrim(p_name))>120 OR cardinality(p_roles) NOT BETWEEN 1 AND 8 OR p_roles IS NULL OR EXISTS(SELECT 1 FROM unnest(p_roles) r WHERE r IS NULL OR r NOT IN('owner','stock_entry','counter','ecommerce_manager','salesperson','tailor','tailor_staff','production')) THEN RAISE EXCEPTION 'Name and defined roles required'; END IF;
 SELECT email INTO email_value FROM auth.users WHERE id=p_user; IF NOT FOUND THEN RAISE EXCEPTION 'Auth account required'; END IF;
 IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user) THEN RAISE EXCEPTION 'Account already has roles; use permission management'; END IF;
 INSERT INTO public.profiles(id,full_name,email) VALUES(p_user,btrim(p_name),email_value) ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name,email=excluded.email;
 INSERT INTO public.user_roles(user_id,role_key) SELECT p_user,role FROM unnest(p_roles) role;
END; $$;

REVOKE ALL ON FUNCTION public.receive_material_unit_batch(uuid,text,text,bigint,jsonb),public.material_unit_catalog(text),public.transfer_material_unit(uuid,text,uuid),public.material_transfer_destinations(),public.owner_assign_tailor_staff(uuid,uuid),public.tailor_material_scan(text),public.submit_job_material_consumption(uuid,text,uuid,uuid,jsonb),public.tailor_staff_work_summary(),public.save_production_completion_cost(uuid,bigint),public.gst_garment_slab_settings(),public.owner_save_gst_garment_slabs(timestamptz,bigint,integer,integer),public.gst_discounted_garment_rate(bigint,timestamptz),public.apply_material_completion_cost(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.receive_material_unit_batch(uuid,text,text,bigint,jsonb),public.material_unit_catalog(text),public.transfer_material_unit(uuid,text,uuid),public.material_transfer_destinations(),public.owner_assign_tailor_staff(uuid,uuid),public.tailor_material_scan(text),public.submit_job_material_consumption(uuid,text,uuid,uuid,jsonb),public.tailor_staff_work_summary(),public.save_production_completion_cost(uuid,bigint),public.gst_garment_slab_settings(),public.owner_save_gst_garment_slabs(timestamptz,bigint,integer,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.apply_material_completion_cost(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_material_completion_cost(uuid) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
