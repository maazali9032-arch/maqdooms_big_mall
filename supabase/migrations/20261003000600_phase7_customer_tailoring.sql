-- Phase 7 only. No historical data/backfill or applied SQL changes.
BEGIN;
CREATE TABLE public.customer_tailoring_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_by uuid NOT NULL REFERENCES public.profiles(id),
 source_location_id uuid NOT NULL REFERENCES public.locations(id),
 charge_version_id uuid NOT NULL REFERENCES public.tailoring_charge_versions(id),
 cuts jsonb NOT NULL CHECK(jsonb_typeof(cuts)='array'),
 fabric_cp_total_paise bigint NOT NULL CHECK(fabric_cp_total_paise>=0),
 tailoring_charge_paise bigint NOT NULL CHECK(tailoring_charge_paise>=0),
 final_customer_price_paise bigint GENERATED ALWAYS AS(fabric_cp_total_paise+tailoring_charge_paise) STORED,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customer_tailoring_quotes ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.customer_tailoring_quotes TO authenticated;
GRANT ALL ON public.customer_tailoring_quotes TO service_role;
CREATE POLICY phase7_owner_quotes ON public.customer_tailoring_quotes FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER phase7_quote_immutable BEFORE UPDATE OR DELETE ON public.customer_tailoring_quotes FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
ALTER TABLE public.customer_tailoring_jobs ADD COLUMN request_id uuid UNIQUE,
 ADD COLUMN request_payload jsonb, ADD COLUMN quote_id uuid UNIQUE REFERENCES public.customer_tailoring_quotes(id);
ALTER TABLE public.orders ADD COLUMN tailoring_request_id uuid UNIQUE;
CREATE INDEX phase7_jobs_history_idx ON public.customer_tailoring_jobs(created_at DESC,id) WHERE request_id IS NOT NULL;
CREATE INDEX phase7_issue_movement_idx ON public.inventory_movements(material_issue_line_id) WHERE kind='MATERIAL_ISSUE';
CREATE POLICY phase7_counter_orders ON public.orders FOR SELECT TO authenticated
 USING(public.has_role(auth.uid(),'counter') AND kind='customer_tailoring' AND status='completed' AND tailoring_request_id IS NOT NULL);
CREATE POLICY phase7_counter_order_items ON public.order_items FOR SELECT TO authenticated
 USING(public.has_role(auth.uid(),'counter') AND EXISTS(SELECT 1 FROM public.orders o WHERE o.id=order_id AND o.tailoring_request_id IS NOT NULL AND o.status='completed'));

-- Minimum setup needed to select the Phase 1 business hierarchy. Full editing,
-- reassignment, disabling and hierarchy management remain Phase 9.
CREATE FUNCTION public.setup_customer_tailoring_assignment(p_factory_code text,p_factory_name text,
 p_section_code text,p_section_name text,p_tailor_code text,p_tailor_name text,p_profile uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f uuid; s uuid; t uuid; a public.tailor_assignments%rowtype;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF nullif(btrim(p_factory_code),'') IS NULL OR nullif(btrim(p_factory_name),'') IS NULL
 OR nullif(btrim(p_tailor_code),'') IS NULL OR nullif(btrim(p_tailor_name),'') IS NULL THEN RAISE EXCEPTION 'Factory and real Tailor identity required'; END IF;
 IF p_profile IS NOT NULL AND NOT public.has_role(p_profile,'tailor') THEN RAISE EXCEPTION 'Active Tailor login required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('phase7-assignment',7));
 INSERT INTO public.tailoring_factories(code,name) VALUES(btrim(p_factory_code),btrim(p_factory_name)) ON CONFLICT(code) DO NOTHING;
 SELECT id INTO f FROM public.tailoring_factories WHERE code=btrim(p_factory_code) AND name=btrim(p_factory_name) AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Existing Factory must match active identity'; END IF;
 IF nullif(btrim(p_section_code),'') IS NOT NULL THEN
  IF nullif(btrim(p_section_name),'') IS NULL THEN RAISE EXCEPTION 'Section name required'; END IF;
  INSERT INTO public.tailoring_sections(factory_id,code,name) VALUES(f,btrim(p_section_code),btrim(p_section_name)) ON CONFLICT(factory_id,code) DO NOTHING;
  SELECT id INTO s FROM public.tailoring_sections WHERE factory_id=f AND code=btrim(p_section_code) AND name=btrim(p_section_name) AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Existing Section must match active Factory identity'; END IF;
 ELSIF nullif(btrim(p_section_name),'') IS NOT NULL THEN RAISE EXCEPTION 'Section code required'; END IF;
 INSERT INTO public.tailors(code,real_name,profile_id) VALUES(btrim(p_tailor_code),btrim(p_tailor_name),p_profile) ON CONFLICT(code) DO NOTHING;
 SELECT id INTO t FROM public.tailors WHERE code=btrim(p_tailor_code) AND real_name=btrim(p_tailor_name) AND profile_id IS NOT DISTINCT FROM p_profile AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Existing Tailor must match active identity'; END IF;
 SELECT * INTO a FROM public.tailor_assignments WHERE tailor_id=t AND valid_until IS NULL;
 IF FOUND THEN
  IF a.factory_id<>f OR a.section_id IS DISTINCT FROM s THEN RAISE EXCEPTION 'Tailor already assigned; hierarchy reassignment is Phase 9'; END IF;
  RETURN a.id;
 END IF;
 INSERT INTO public.tailor_assignments(tailor_id,factory_id,section_id) VALUES(t,f,s) RETURNING * INTO a;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value)
 VALUES(auth.uid(),'setup_customer_tailoring_assignment','tailor_assignments',a.id,to_jsonb(a));
 RETURN a.id;
END; $$;

CREATE FUNCTION public.set_customer_tailoring_charge(p_code text,p_name text,p_amount bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c uuid; v uuid; rev integer; amount bigint;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF nullif(btrim(p_code),'') IS NULL OR nullif(btrim(p_name),'') IS NULL OR p_amount IS NULL OR p_amount<0 OR p_amount>9007199254740991 THEN RAISE EXCEPTION 'Charge identity and nonnegative amount required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('phase7-charge:'||btrim(p_code),7));
 INSERT INTO public.tailoring_charges(code,name) VALUES(btrim(p_code),btrim(p_name)) ON CONFLICT(code) DO NOTHING;
 SELECT id INTO c FROM public.tailoring_charges WHERE code=btrim(p_code) AND name=btrim(p_name) AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Existing charge must match active identity'; END IF;
 SELECT id,revision,amount_paise INTO v,rev,amount FROM public.tailoring_charge_versions WHERE charge_id=c ORDER BY revision DESC LIMIT 1;
 IF amount=p_amount THEN RETURN v; END IF;
 INSERT INTO public.tailoring_charge_versions(charge_id,revision,amount_paise,recorded_by)
 VALUES(c,coalesce(rev,0)+1,p_amount,auth.uid()) RETURNING id INTO v;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value)
 VALUES(auth.uid(),'set_customer_tailoring_charge','tailoring_charge_versions',v,jsonb_build_object('charge_id',c,'amount_paise',p_amount));
 RETURN v;
END; $$;

CREATE FUNCTION public.customer_tailoring_catalog() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Owner or Counter required'; END IF;
 RETURN jsonb_build_object('stocks',coalesce((SELECT jsonb_agg(x-'sp_paise_per_m'-'sp_version_id') FROM jsonb_array_elements(public.direct_fabric_sale_catalog(NULL)) x),'[]'::jsonb),
 'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'factory_id',f.id,'factory_name',f.name,
 'section_id',s.id,'section_name',s.name,'tailor_id',t.id,'tailor_name',t.real_name,'tailor_code',t.code))
 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id WHERE a.valid_until IS NULL AND a.valid_from<=now() AND t.active AND f.active AND (s.id IS NULL OR s.active)
 AND (t.profile_id IS NULL OR public.has_role(t.profile_id,'tailor'))),'[]'::jsonb),
 'charges',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'name',c.name,'code',c.code) ||
 CASE WHEN public.has_role(auth.uid(),'owner') THEN jsonb_build_object('amount_paise',v.amount_paise) ELSE '{}'::jsonb END)
 FROM public.tailoring_charges c JOIN LATERAL(SELECT id,amount_paise FROM public.tailoring_charge_versions WHERE charge_id=c.id ORDER BY revision DESC LIMIT 1) v ON true WHERE c.active),'[]'::jsonb));
END; $$;

CREATE FUNCTION public.quote_customer_tailoring(p_source uuid,p_items jsonb,p_charge uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb; th public.thaans%rowtype; cp public.fabric_stock_costs%rowtype;
 cv public.tailoring_charge_versions%rowtype; qty numeric; amt bigint; total bigint:=0; cuts jsonb:='[]'; v uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.issue_to_tailoring') THEN RAISE EXCEPTION 'Authorized Owner or Counter required'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Internal Than cuts required'; END IF;
 IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 OR (SELECT count(DISTINCT value->>'inventory_item_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Supply 1 to 50 distinct cuts'; END IF;
 PERFORM 1 FROM public.tailoring_charges WHERE id=(SELECT charge_id FROM public.tailoring_charge_versions WHERE id=p_charge) AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active applicable charge required'; END IF;
 SELECT * INTO cv FROM public.tailoring_charge_versions WHERE id=p_charge;
 IF cv.id IS DISTINCT FROM (SELECT id FROM public.tailoring_charge_versions WHERE charge_id=cv.charge_id ORDER BY revision DESC LIMIT 1) THEN RAISE EXCEPTION 'Charge changed; refresh and select current charge'; END IF;
 PERFORM 1 FROM public.fabric_stock fs WHERE fs.id IN(SELECT t.fabric_stock_id FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id
 JOIN jsonb_array_elements(p_items) x ON i.id=(x->>'inventory_item_id')::uuid) ORDER BY fs.id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items i JOIN jsonb_array_elements(p_items) x ON i.id=(x->>'inventory_item_id')::uuid ORDER BY i.id FOR UPDATE OF i;
 PERFORM 1 FROM public.locations WHERE id=p_source AND active AND kind IN('workshop','showroom','showroom_sublocation') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active source required'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'inventory_item_id' LOOP
  qty:=(r->>'quantity')::numeric;
  IF qty IS NULL OR qty<=0 OR qty<>trunc(qty) OR qty>2147483647 THEN RAISE EXCEPTION 'Positive integer millimetres required'; END IF;
  SELECT t.* INTO th FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id JOIN public.fabric_stock fs ON fs.id=t.fabric_stock_id
  WHERE i.id=(r->>'inventory_item_id')::uuid AND t.status='active' AND fs.entry_state IN('complete','correcting','legacy_pending');
  IF NOT FOUND OR public.inventory_balance((r->>'inventory_item_id')::uuid,p_source)<qty THEN RAISE EXCEPTION 'Located stock insufficient'; END IF;
  SELECT * INTO cp FROM public.fabric_stock_costs WHERE fabric_stock_id=th.fabric_stock_id ORDER BY revision DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Owner must resolve missing fabric cost before pricing'; END IF;
  IF cp.cp_paise_per_m>9007199254740991 THEN RAISE EXCEPTION 'Fabric cost exceeds supported money range'; END IF;
  amt:=round(qty*cp.cp_paise_per_m/1000); total:=total+amt;
  IF total::numeric+cv.amount_paise>9007199254740991 THEN RAISE EXCEPTION 'Final amount exceeds supported range'; END IF;
  cuts:=cuts||jsonb_build_array(jsonb_build_object('inventory_item_id',r->>'inventory_item_id','thaan_id',th.id,'fabric_stock_id',th.fabric_stock_id,
   'quantity',qty,'cost_version_id',cp.id,'cp_paise_per_m',cp.cp_paise_per_m,'cp_amount_paise',amt));
 END LOOP;
 INSERT INTO public.customer_tailoring_quotes(created_by,source_location_id,charge_version_id,cuts,fabric_cp_total_paise,tailoring_charge_paise)
 VALUES(auth.uid(),p_source,cv.id,cuts,total,cv.amount_paise) RETURNING id INTO v;
 RETURN jsonb_build_object('quote_id',v,'final_customer_price_paise',total+cv.amount_paise);
END; $$;

CREATE FUNCTION public.create_customer_tailoring(p_request uuid,p_quote uuid,p_customer uuid,p_assignment uuid,p_garment text,p_notes text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE qt public.customer_tailoring_quotes%rowtype; j public.customer_tailoring_jobs%rowtype;
 payload jsonb; r jsonb; v_job uuid:=gen_random_uuid(); v_order uuid:=gen_random_uuid(); v_issue uuid; v_line uuid; v_item uuid; contact jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.issue_to_tailoring') THEN RAISE EXCEPTION 'Authorized Owner or Counter required'; END IF;
 IF p_request IS NULL OR nullif(btrim(p_garment),'') IS NULL THEN RAISE EXCEPTION 'Request and garment required'; END IF;
 payload:=jsonb_build_object('quote',p_quote,'customer',p_customer,'assignment',p_assignment,'garment',btrim(p_garment),'notes',nullif(btrim(p_notes),''));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,7));
 SELECT * INTO j FROM public.customer_tailoring_jobs WHERE request_id=p_request;
 IF FOUND THEN
  IF j.request_payload IS DISTINCT FROM payload OR (j.created_by IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'Request reused with different data or actor'; END IF;
  RETURN j.id;
 END IF;
 SELECT * INTO qt FROM public.customer_tailoring_quotes WHERE id=p_quote FOR UPDATE;
 IF NOT FOUND OR (qt.created_by IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'Owned quote required'; END IF;
 IF EXISTS(SELECT 1 FROM public.customer_tailoring_jobs WHERE quote_id=p_quote) THEN RAISE EXCEPTION 'Quote already booked; inspect existing job'; END IF;
 SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO contact FROM public.customers WHERE id=p_customer FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer required'; END IF;
 PERFORM 1 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id WHERE a.id=p_assignment AND a.valid_until IS NULL AND a.valid_from<=now() AND t.active AND f.active
 AND (s.id IS NULL OR s.active) AND (t.profile_id IS NULL OR public.has_role(t.profile_id,'tailor')) FOR UPDATE OF a,t,f;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Factory / Section / Tailor assignment required'; END IF;
 -- Section activity is locked too, while allowing no-section assignments.
 PERFORM 1 FROM public.tailoring_sections WHERE id=(SELECT section_id FROM public.tailor_assignments WHERE id=p_assignment) FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.tailoring_sections WHERE id=(SELECT section_id FROM public.tailor_assignments WHERE id=p_assignment) AND NOT active) THEN RAISE EXCEPTION 'Active Section required'; END IF;
 PERFORM 1 FROM public.tailoring_charges WHERE id=(SELECT charge_id FROM public.tailoring_charge_versions WHERE id=qt.charge_version_id) AND active FOR UPDATE;
 IF NOT FOUND OR qt.charge_version_id IS DISTINCT FROM (SELECT id FROM public.tailoring_charge_versions WHERE charge_id=(SELECT charge_id FROM public.tailoring_charge_versions WHERE id=qt.charge_version_id) ORDER BY revision DESC LIMIT 1) THEN RAISE EXCEPTION 'Charge changed; calculate a new quote'; END IF;
 PERFORM 1 FROM public.fabric_stock WHERE id IN(SELECT (x->>'fabric_stock_id')::uuid FROM jsonb_array_elements(qt.cuts) x) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items WHERE id IN(SELECT (x->>'inventory_item_id')::uuid FROM jsonb_array_elements(qt.cuts) x) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.locations WHERE id=qt.source_location_id AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Source inactive'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(qt.cuts) LOOP
  IF (r->>'cost_version_id')::uuid IS DISTINCT FROM (SELECT id FROM public.fabric_stock_costs WHERE fabric_stock_id=(r->>'fabric_stock_id')::uuid ORDER BY revision DESC LIMIT 1) THEN RAISE EXCEPTION 'Fabric cost changed; calculate a new quote'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.thaans WHERE id=(r->>'thaan_id')::uuid AND status='active') OR
   NOT EXISTS(SELECT 1 FROM public.fabric_stock WHERE id=(r->>'fabric_stock_id')::uuid AND entry_state IN('complete','correcting','legacy_pending')) THEN RAISE EXCEPTION 'Active stock required'; END IF;
 END LOOP;
 INSERT INTO public.customer_tailoring_jobs(id,code,customer_id,garment,tailor_assignment_id,tailoring_charge_version_id,status,notes,created_by,request_id,request_payload,quote_id)
 VALUES(v_job,'CT-'||replace(v_job::text,'-',''),p_customer,btrim(p_garment),p_assignment,qt.charge_version_id,'open',nullif(btrim(p_notes),''),auth.uid(),p_request,payload,qt.id);
 INSERT INTO public.customer_tailoring_prices(job_id,revision,fabric_cp_total_paise,tailoring_charge_paise,charge_version_id,recorded_by)
 VALUES(v_job,1,qt.fabric_cp_total_paise,qt.tailoring_charge_paise,qt.charge_version_id,auth.uid());
 INSERT INTO public.job_material_requirements(customer_tailoring_job_id,fabric_stock_id,quantity,unit)
 SELECT v_job,(x->>'fabric_stock_id')::uuid,sum((x->>'quantity')::numeric),'mm' FROM jsonb_array_elements(qt.cuts) x GROUP BY x->>'fabric_stock_id';
 INSERT INTO public.material_issues(code,customer_tailoring_job_id,tailor_assignment_id,source_location_id,issue_type,reason,issued_by)
 VALUES('MI-'||replace(v_job::text,'-',''),v_job,p_assignment,qt.source_location_id,'required','Required material for Customer Tailoring',auth.uid()) RETURNING id INTO v_issue;
 FOR r IN SELECT value FROM jsonb_array_elements(qt.cuts) ORDER BY value->>'inventory_item_id' LOOP
  INSERT INTO public.material_issue_lines(material_issue_id,fabric_stock_id,thaan_id,quantity,unit)
  VALUES(v_issue,(r->>'fabric_stock_id')::uuid,(r->>'thaan_id')::uuid,(r->>'quantity')::numeric,'mm') RETURNING id INTO v_line;
  INSERT INTO public.inventory_movements(kind,fabric_stock_id,thaan_id,inventory_item_id,quantity,unit,source_location_id,material_issue_line_id,customer_tailoring_job_id,reason,reference,actor_id)
  VALUES('MATERIAL_ISSUE',(r->>'fabric_stock_id')::uuid,(r->>'thaan_id')::uuid,(r->>'inventory_item_id')::uuid,(r->>'quantity')::numeric,'mm',qt.source_location_id,v_line,v_job,'Required material for Customer Tailoring','JOB:'||v_job::text,auth.uid());
  IF public.inventory_balance((r->>'inventory_item_id')::uuid,NULL)=0 THEN UPDATE public.thaans SET status='depleted',updated_at=now() WHERE id=(r->>'thaan_id')::uuid; END IF;
 END LOOP;
 INSERT INTO public.orders(id,code,kind,customer_id,customer_tailoring_job_id,source_location_id,status,final_customer_price_paise,created_by,customer_snapshot,completed_at,tailoring_request_id,reference)
 VALUES(v_order,'CT-ORDER-'||replace(v_job::text,'-',''),'customer_tailoring',p_customer,v_job,qt.source_location_id,'draft',qt.final_customer_price_paise,auth.uid(),contact,now(),p_request,'JOB:'||v_job::text);
 INSERT INTO public.order_items(order_id,customer_tailoring_job_id,quantity,unit,final_customer_price_paise)
 VALUES(v_order,v_job,1,'job',qt.final_customer_price_paise) RETURNING id INTO v_item;
 INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise,tailoring_charge_snapshot_paise)
 VALUES(v_item,qt.fabric_cp_total_paise,qt.tailoring_charge_paise);
 UPDATE public.orders SET status='completed' WHERE id=v_order;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'create_customer_tailoring','customer_tailoring_jobs',v_job,jsonb_build_object('order_id',v_order,'issue_id',v_issue,'final_customer_price_paise',qt.final_customer_price_paise),'REQUEST:'||p_request::text);
 RETURN v_job;
END; $$;

CREATE FUNCTION public.guard_phase7_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%rowtype;
BEGIN
 IF TG_TABLE_NAME='customer_tailoring_jobs' THEN
  IF OLD.request_id IS NOT NULL AND (TG_OP='DELETE' OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')) THEN RAISE EXCEPTION 'Booked job identity and price selection are permanent'; END IF;
 ELSIF TG_TABLE_NAME='orders' THEN
  IF OLD.tailoring_request_id IS NOT NULL AND OLD.status='completed' THEN RAISE EXCEPTION 'Booked tailoring Order is permanent'; END IF;
 ELSIF TG_TABLE_NAME='order_items' THEN
  SELECT * INTO o FROM public.orders WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  IF o.tailoring_request_id IS NOT NULL AND o.status='completed' THEN RAISE EXCEPTION 'Booked tailoring Order item is permanent'; END IF;
  IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.orders WHERE id=OLD.order_id AND tailoring_request_id IS NOT NULL AND status='completed') THEN RAISE EXCEPTION 'Booked tailoring Order item is permanent'; END IF;
 ELSIF TG_TABLE_NAME='job_material_requirements' THEN
  IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM public.customer_tailoring_jobs WHERE id=OLD.customer_tailoring_job_id AND request_id IS NOT NULL) THEN RAISE EXCEPTION 'Booked required quantity is permanent'; END IF;
  IF TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM public.customer_tailoring_jobs WHERE id=NEW.customer_tailoring_job_id AND request_id IS NOT NULL) THEN
   IF EXISTS(SELECT 1 FROM public.job_material_requirements WHERE customer_tailoring_job_id=NEW.customer_tailoring_job_id AND fabric_stock_id=NEW.fabric_stock_id)
   OR NEW.material_id IS NOT NULL OR NEW.unit<>'mm' OR NEW.quantity IS DISTINCT FROM (
    SELECT sum((x->>'quantity')::numeric) FROM public.customer_tailoring_jobs j JOIN public.customer_tailoring_quotes q ON q.id=j.quote_id
    CROSS JOIN jsonb_array_elements(q.cuts) x WHERE j.id=NEW.customer_tailoring_job_id AND (x->>'fabric_stock_id')::uuid=NEW.fabric_stock_id)
   THEN RAISE EXCEPTION 'Required quantity must match the booked quote exactly once'; END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER phase7_job_history BEFORE UPDATE OR DELETE ON public.customer_tailoring_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_phase7_history();
CREATE TRIGGER phase7_order_history BEFORE UPDATE OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_phase7_history();
CREATE TRIGGER phase7_order_item_history BEFORE INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.guard_phase7_history();
CREATE TRIGGER phase7_requirement_history BEFORE INSERT OR UPDATE OR DELETE ON public.job_material_requirements FOR EACH ROW EXECUTE FUNCTION public.guard_phase7_history();
CREATE FUNCTION public.guard_phase7_issue_once() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.material_issue_line_id IS NOT NULL THEN
  PERFORM 1 FROM public.inventory_items WHERE id=NEW.inventory_item_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.inventory_movements WHERE material_issue_line_id=NEW.material_issue_line_id) THEN RAISE EXCEPTION 'Material Issue line already posted'; END IF;
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER phase7_issue_once BEFORE INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.guard_phase7_issue_once();

CREATE FUNCTION public.set_customer_tailoring_status(p_job uuid,p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.customer_tailoring_jobs%rowtype;
BEGIN
 SELECT * INTO j FROM public.customer_tailoring_jobs WHERE id=p_job AND request_id IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Booked Customer Tailoring Job required'; END IF;
 IF NOT public.has_perm(auth.uid(),'tailoring.manage_jobs') AND NOT (public.has_role(auth.uid(),'counter') AND public.has_perm(auth.uid(),'pos.issue_to_tailoring')) THEN RAISE EXCEPTION 'Job permission required'; END IF;
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) AND NOT public.owns_tailor_assignment(j.tailor_assignment_id) THEN RAISE EXCEPTION 'Assigned Tailor required'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('open','in_progress','ready','delivered','cancelled') THEN RAISE EXCEPTION 'Valid job status required'; END IF;
 IF p_status=j.status THEN RETURN; END IF;
 -- Retain existing job-status semantics. No unconfirmed transition graph or
 -- automatic inventory return/repricing is inferred from cancellation/reopening.
 UPDATE public.customer_tailoring_jobs SET status=p_status WHERE id=j.id;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value)
 VALUES(auth.uid(),'set_customer_tailoring_status','customer_tailoring_jobs',j.id,jsonb_build_object('status',j.status),jsonb_build_object('status',p_status));
END; $$;

CREATE FUNCTION public.customer_tailoring_history(p_job uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','tailor']) THEN RAISE EXCEPTION 'Active tailoring role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id) FROM(
 SELECT j.id,j.code,j.garment,j.status,j.notes,j.created_by,j.created_at,a.id assignment_id,
 f.name factory_name,s.name section_name,t.code tailor_code,t.real_name tailor_name,
 o.id order_id,o.code order_code,o.customer_snapshot,o.source_location_id,l.name source_name,
 CASE WHEN public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN o.final_customer_price_paise END final_customer_price_paise,
 (SELECT jsonb_agg(jsonb_build_object('fabric_stock_id',req.fabric_stock_id,'quantity_mm',req.quantity)) FROM public.job_material_requirements req WHERE req.customer_tailoring_job_id=j.id) requirements,
 (SELECT jsonb_agg(jsonb_build_object('issue_id',mi.id,'issue_code',mi.code,'issued_by',mi.issued_by,'issued_at',mi.issued_at,
 'fabric_name',fab.name,'batch_code',b.code,'barcode',bc.code,'thaan_id',ml.thaan_id,'quantity_mm',ml.quantity,'movement_id',m.id))
 FROM public.material_issues mi JOIN public.material_issue_lines ml ON ml.material_issue_id=mi.id
 JOIN public.fabric_stock fs ON fs.id=ml.fabric_stock_id JOIN public.fabrics fab ON fab.id=fs.fabric_id
 JOIN public.receiving_batches b ON b.id=fs.batch_id JOIN public.barcodes bc ON bc.id=fs.barcode_id
 LEFT JOIN public.inventory_movements m ON m.material_issue_line_id=ml.id WHERE mi.customer_tailoring_job_id=j.id) issues
 FROM public.customer_tailoring_jobs j JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id
 JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections s ON s.id=a.section_id
 JOIN public.tailors t ON t.id=a.tailor_id JOIN public.orders o ON o.customer_tailoring_job_id=j.id AND o.tailoring_request_id IS NOT NULL
 JOIN public.locations l ON l.id=o.source_location_id WHERE j.request_id IS NOT NULL AND (p_job IS NULL OR j.id=p_job)
 AND (public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR public.owns_tailor_assignment(a.id))
 ORDER BY j.created_at DESC,j.id LIMIT greatest(1,least(coalesce(p_limit,50),200))) x),'[]'::jsonb);
END; $$;
CREATE FUNCTION public.owner_customer_tailoring_costs(p_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 RETURN(SELECT jsonb_build_object('fabric_cp_total_paise',q.fabric_cp_total_paise,'tailoring_charge_paise',q.tailoring_charge_paise,
 'final_customer_price_paise',q.final_customer_price_paise,'cuts',q.cuts,'charge_version_id',q.charge_version_id)
 FROM public.customer_tailoring_jobs j JOIN public.customer_tailoring_quotes q ON q.id=j.quote_id WHERE j.id=p_job);
END; $$;
REVOKE ALL ON FUNCTION public.guard_phase7_history(),public.guard_phase7_issue_once() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.setup_customer_tailoring_assignment(text,text,text,text,text,text,uuid),public.set_customer_tailoring_charge(text,text,bigint),
 public.customer_tailoring_catalog(),public.quote_customer_tailoring(uuid,jsonb,uuid),public.create_customer_tailoring(uuid,uuid,uuid,uuid,text,text),
 public.set_customer_tailoring_status(uuid,text),public.customer_tailoring_history(uuid,integer),public.owner_customer_tailoring_costs(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.setup_customer_tailoring_assignment(text,text,text,text,text,text,uuid),public.set_customer_tailoring_charge(text,text,bigint),
 public.customer_tailoring_catalog(),public.quote_customer_tailoring(uuid,jsonb,uuid),public.create_customer_tailoring(uuid,uuid,uuid,uuid,text,text),
 public.set_customer_tailoring_status(uuid,text),public.customer_tailoring_history(uuid,integer),public.owner_customer_tailoring_costs(uuid) TO authenticated;
COMMIT;
