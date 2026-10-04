-- Phase 8 only. No legacy backfill, guessed balances, automatic wastage or repricing.
BEGIN;
ALTER TABLE public.materials ADD COLUMN category text NOT NULL DEFAULT 'other'
 CHECK(category IN ('buttons','thread','padding','other'));
CREATE TABLE public.consumable_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL UNIQUE,
 request_payload jsonb NOT NULL, material_id uuid NOT NULL REFERENCES public.materials(id),
 inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id),
 destination_location_id uuid NOT NULL REFERENCES public.locations(id),
 quantity numeric(18,3) NOT NULL CHECK(quantity>0), unit text NOT NULL,
 reason text NOT NULL CHECK(btrim(reason)<>''), received_by uuid NOT NULL REFERENCES public.profiles(id),
 received_at timestamptz NOT NULL DEFAULT now()
);
-- Cost entry is confined to receipt submission; no ongoing Stock Entry cost read.
CREATE TABLE public.consumable_receipt_costs (
 receipt_id uuid PRIMARY KEY REFERENCES public.consumable_receipts(id),
 cp_paise_per_unit bigint NOT NULL CHECK(cp_paise_per_unit BETWEEN 0 AND 2147483647)
);
-- Private retry payload: contains initial receipt CP; never returned to browser readers.
REVOKE ALL ON public.consumable_receipts,public.consumable_receipt_costs FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,request_id,material_id,inventory_item_id,destination_location_id,quantity,unit,reason,received_by,received_at)
 ON public.consumable_receipts TO authenticated;
GRANT SELECT ON public.consumable_receipt_costs TO authenticated;
GRANT ALL ON public.consumable_receipts,public.consumable_receipt_costs TO service_role;
ALTER TABLE public.consumable_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumable_receipt_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY phase8_receipts_read ON public.consumable_receipts FOR SELECT TO authenticated USING
 (public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'stock_entry') AND received_by=auth.uid()));
CREATE POLICY phase8_receipt_cost_owner ON public.consumable_receipt_costs FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE INDEX phase8_receipts_material_idx ON public.consumable_receipts(material_id,received_at,id);
CREATE TRIGGER phase8_receipts_immutable BEFORE UPDATE OR DELETE ON public.consumable_receipts FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER phase8_receipt_costs_immutable BEFORE UPDATE OR DELETE ON public.consumable_receipt_costs FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
ALTER TABLE public.material_issues ADD COLUMN request_id uuid UNIQUE;
ALTER TABLE public.material_issues ADD COLUMN request_payload jsonb;
CREATE INDEX phase8_issue_assignment_time_idx ON public.material_issues(tailor_assignment_id,issued_at,id);
CREATE INDEX phase8_issue_material_idx ON public.material_issue_lines(material_id,material_issue_id);
ALTER TABLE public.inventory_movements ADD COLUMN consumable_receipt_id uuid UNIQUE REFERENCES public.consumable_receipts(id);
ALTER TABLE public.job_material_requirements ADD COLUMN material_issue_line_id uuid UNIQUE REFERENCES public.material_issue_lines(id);
CREATE FUNCTION public.guard_phase8_requirement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.material_issue_line_id IS NOT NULL THEN RAISE EXCEPTION 'Issued requirement is permanent'; END IF;
 IF TG_OP<>'DELETE' AND NEW.material_issue_line_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM public.material_issue_lines l JOIN public.material_issues mi ON mi.id=l.material_issue_id
 JOIN public.inventory_movements mov ON mov.material_issue_line_id=l.id
 WHERE l.id=NEW.material_issue_line_id AND mi.request_id IS NOT NULL AND mi.issue_type='required'
 AND (NEW.customer_tailoring_job_id,NEW.production_job_id,NEW.fabric_stock_id,NEW.material_id,NEW.quantity,NEW.unit)
 IS NOT DISTINCT FROM (mi.customer_tailoring_job_id,mi.production_job_id,l.fabric_stock_id,l.material_id,l.quantity,l.unit))
 THEN RAISE EXCEPTION 'Requirement must match its explicitly posted required issue'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER phase8_requirement_history BEFORE INSERT OR UPDATE OR DELETE ON public.job_material_requirements FOR EACH ROW EXECUTE FUNCTION public.guard_phase8_requirement();
-- Extend the Phase 7 guard only for linked consumables. Quoted fabric/order history remains sealed.
CREATE OR REPLACE FUNCTION public.guard_phase7_history() RETURNS trigger
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
   IF NEW.material_id IS NOT NULL THEN
    IF TG_OP<>'INSERT' OR NEW.material_issue_line_id IS NULL THEN RAISE EXCEPTION 'Consumable requirement must reference its explicit required issue'; END IF;
    -- The Phase 8 relationship guard verifies line, job, quantity, type and posting.
   ELSIF EXISTS(SELECT 1 FROM public.job_material_requirements WHERE customer_tailoring_job_id=NEW.customer_tailoring_job_id AND fabric_stock_id=NEW.fabric_stock_id)
   OR NEW.unit<>'mm' OR NEW.quantity IS DISTINCT FROM (
    SELECT sum((x->>'quantity')::numeric) FROM public.customer_tailoring_jobs j JOIN public.customer_tailoring_quotes q ON q.id=j.quote_id
    CROSS JOIN jsonb_array_elements(q.cuts) x WHERE j.id=NEW.customer_tailoring_job_id AND (x->>'fabric_stock_id')::uuid=NEW.fabric_stock_id)
   THEN RAISE EXCEPTION 'Required quantity must match the booked quote exactly once'; END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE FUNCTION public.guard_consumable_receipt_link() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.consumable_receipts%rowtype;
BEGIN
 IF NEW.consumable_receipt_id IS NOT NULL THEN
  SELECT * INTO r FROM public.consumable_receipts WHERE id=NEW.consumable_receipt_id;
  IF NEW.kind<>'INWARD' OR num_nonnulls(NEW.thaan_id,NEW.fabric_stock_id,NEW.finished_product_id,NEW.source_location_id,NEW.stock_transfer_line_id,NEW.material_issue_line_id,NEW.order_item_id)<>0
   OR (NEW.material_id,NEW.inventory_item_id,NEW.destination_location_id,NEW.quantity,NEW.unit,NEW.actor_id)
    IS DISTINCT FROM (r.material_id,r.inventory_item_id,r.destination_location_id,r.quantity,r.unit,r.received_by)
  THEN RAISE EXCEPTION 'Consumable receipt movement must match its receipt'; END IF;
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER phase8_receipt_movement_guard BEFORE INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.guard_consumable_receipt_link();

CREATE FUNCTION public.receive_consumable(p_request_id uuid,p_material uuid,p_name text,p_unit text,p_category text,p_location uuid,p_quantity numeric,p_cp bigint,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_payload jsonb; r public.consumable_receipts%rowtype; m public.materials%rowtype; i public.inventory_items%rowtype; v_id uuid;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') AND NOT (public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'inventory.receive')) THEN RAISE EXCEPTION 'Owner or authorized Stock Entry required'; END IF;
 IF p_request_id IS NULL OR p_location IS NULL OR p_quantity IS NULL OR p_quantity<=0 OR p_quantity>=1000000000000000 OR p_quantity<>round(p_quantity,3)
  OR p_cp IS NULL OR p_cp NOT BETWEEN 0 AND 2147483647 OR p_reason IS NULL OR btrim(p_reason)='' THEN RAISE EXCEPTION 'Exact quantity, entry CP, location, reason and request ID required'; END IF;
 v_payload:=jsonb_build_object('actor',auth.uid(),'material',p_material,'name',btrim(p_name),'unit',btrim(p_unit),'category',p_category,'location',p_location,'quantity',p_quantity,'cp',p_cp,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,8));
 SELECT * INTO r FROM public.consumable_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF r.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Receipt request already used with different data'; END IF;
  RETURN r.id;
 END IF;
 IF p_material IS NULL THEN
  IF p_name IS NULL OR btrim(p_name)='' OR p_unit IS NULL OR btrim(p_unit)='' OR p_category IS NULL OR p_category NOT IN ('buttons','thread','padding','other') THEN RAISE EXCEPTION 'Name, consumable unit and category required'; END IF;
  INSERT INTO public.materials(name,unit,qty_on_hand,cost_paise,active,category)
   VALUES(btrim(p_name),btrim(p_unit),0,p_cp,true,p_category) RETURNING * INTO m;
  INSERT INTO public.inventory_items(material_id,unit,legacy_quantity_snapshot,reconciled_by,reason)
   VALUES(m.id,m.unit,0,auth.uid(),'New Phase 8 consumable: receipts are ledger stock') RETURNING * INTO i;
 ELSE
  SELECT * INTO m FROM public.materials WHERE id=p_material AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active consumable required'; END IF;
  SELECT * INTO i FROM public.inventory_items WHERE material_id=m.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Explicit legacy location reconciliation required before receipt'; END IF;
 END IF;
 PERFORM 1 FROM public.locations WHERE id=p_location AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active destination required'; END IF;
 IF public.inventory_balance(i.id,NULL)+p_quantity>=1000000000000000 THEN RAISE EXCEPTION 'Consumable balance exceeds supported range'; END IF;
 INSERT INTO public.consumable_receipts(request_id,request_payload,material_id,inventory_item_id,destination_location_id,quantity,unit,reason,received_by)
 VALUES(p_request_id,v_payload,m.id,i.id,p_location,p_quantity,m.unit,btrim(p_reason),auth.uid()) RETURNING id INTO v_id;
 INSERT INTO public.consumable_receipt_costs VALUES(v_id,p_cp);
 INSERT INTO public.inventory_movements(kind,material_id,inventory_item_id,quantity,unit,destination_location_id,consumable_receipt_id,reason,reference,actor_id)
 VALUES('INWARD',m.id,i.id,p_quantity,m.unit,p_location,v_id,btrim(p_reason),'REC-'||p_request_id::text,auth.uid());
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'receive_consumable','consumable_receipts',v_id,jsonb_build_object('material',m.id,'quantity',p_quantity,'unit',m.unit,'location',p_location),'REC-'||p_request_id::text);
 RETURN v_id;
END; $$;

CREATE FUNCTION public.manage_consumable(p_material uuid,p_name text,p_category text,p_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old_value jsonb;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_name IS NULL OR btrim(p_name)='' OR p_category IS NULL OR p_category NOT IN ('buttons','thread','padding','other') OR p_active IS NULL THEN RAISE EXCEPTION 'Name, category and active state required'; END IF;
 SELECT to_jsonb(m)-'cost_paise'-'price_paise' INTO old_value FROM public.materials m WHERE id=p_material FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Consumable not found'; END IF;
 UPDATE public.materials SET name=btrim(p_name),category=p_category,active=p_active WHERE id=p_material;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value)
 VALUES(auth.uid(),'manage_consumable','materials',p_material,old_value,jsonb_build_object('name',btrim(p_name),'category',p_category,'active',p_active));
END; $$;

CREATE FUNCTION public.consumable_catalog() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry','counter','ecommerce_manager']) THEN RAISE EXCEPTION 'Active stock role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name,x.id) FROM (
 SELECT m.id,m.name,m.category,m.unit,m.active,i.id inventory_item_id,
 CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL) END quantity,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'quantity',public.inventory_balance(i.id,l.id)) ORDER BY l.name,l.id)
 FROM public.locations l WHERE l.active AND i.id IS NOT NULL AND public.inventory_balance(i.id,l.id)>0),'[]'::jsonb) locations
 FROM public.materials m LEFT JOIN public.inventory_items i ON i.material_id=m.id
 WHERE m.active OR public.has_role(auth.uid(),'owner')) x),'[]'::jsonb);
END; $$;

CREATE FUNCTION public.material_issue_jobs() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','tailor']) THEN RAISE EXCEPTION 'Active job role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id) FROM(
 SELECT j.id,j.code,j.kind,j.status,j.created_at,a.id assignment_id,f.id factory_id,f.name factory_name,
 s.id section_id,s.name section_name,t.id tailor_id,t.code tailor_code,t.real_name tailor_name
 FROM (SELECT id,code,'customer_tailoring'::text kind,status,created_at,tailor_assignment_id FROM public.customer_tailoring_jobs
 UNION ALL SELECT id,code,'production',status,created_at,tailor_assignment_id FROM public.production_jobs) j
 JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id
 WHERE public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR public.owns_tailor_assignment(a.id)) x),'[]'::jsonb);
END; $$;

CREATE FUNCTION public.post_material_issue(p_request_id uuid,p_job_kind text,p_job uuid,p_source uuid,p_type text,p_items jsonb,p_reason text) RETURNS uuid
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
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id WHERE a.id=v_assignment AND a.valid_from<=now() AND a.valid_until IS NULL AND t.active AND f.active AND (s.id IS NULL OR s.active)) THEN RAISE EXCEPTION 'Active job assignment required'; END IF;
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

CREATE FUNCTION public.material_issue_history(p_job uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','tailor']) THEN RAISE EXCEPTION 'Active job role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.issued_at DESC,x.id) FROM(
 SELECT mi.id,mi.code,mi.customer_tailoring_job_id,mi.production_job_id,coalesce(cj.code,pj.code) job_code,
 mi.issue_type,mi.reason,mi.issued_by,pr.full_name issuer_name,mi.issued_at,mi.source_location_id,l.name source_name,
 mi.tailor_assignment_id,a.factory_id,f.name factory_name,a.section_id,s.name section_name,a.tailor_id,t.code tailor_code,t.real_name tailor_name,
 (SELECT jsonb_agg(jsonb_build_object('id',ml.id,'material_id',ml.material_id,'name',coalesce(mat.name,fab.name),'category',mat.category,
 'fabric_stock_id',ml.fabric_stock_id,'thaan_id',ml.thaan_id,'batch_code',b.code,'barcode',bc.code,'quantity',ml.quantity,'unit',ml.unit,'movement_id',mov.id) ORDER BY ml.id)
 FROM public.material_issue_lines ml LEFT JOIN public.materials mat ON mat.id=ml.material_id
 LEFT JOIN public.fabric_stock fs ON fs.id=ml.fabric_stock_id LEFT JOIN public.fabrics fab ON fab.id=fs.fabric_id
 LEFT JOIN public.receiving_batches b ON b.id=fs.batch_id LEFT JOIN public.barcodes bc ON bc.id=fs.barcode_id
 LEFT JOIN public.inventory_movements mov ON mov.material_issue_line_id=ml.id WHERE ml.material_issue_id=mi.id) lines
 FROM public.material_issues mi JOIN public.tailor_assignments a ON a.id=mi.tailor_assignment_id
 JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections s ON s.id=a.section_id
 JOIN public.tailors t ON t.id=a.tailor_id JOIN public.locations l ON l.id=mi.source_location_id LEFT JOIN public.profiles pr ON pr.id=mi.issued_by
 LEFT JOIN public.customer_tailoring_jobs cj ON cj.id=mi.customer_tailoring_job_id LEFT JOIN public.production_jobs pj ON pj.id=mi.production_job_id
 WHERE (p_job IS NULL OR p_job IN(mi.customer_tailoring_job_id,mi.production_job_id))
 AND (public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR public.owns_tailor_assignment(a.id))
 ORDER BY mi.issued_at DESC,mi.id LIMIT greatest(1,least(coalesce(p_limit,100),200))) x),'[]'::jsonb);
END; $$;
CREATE FUNCTION public.consumable_receipt_history(p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) THEN RAISE EXCEPTION 'Receipt role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.received_at DESC,x.id) FROM(
 SELECT r.id,r.material_id,m.name,r.quantity,r.unit,r.destination_location_id,l.name destination_name,r.reason,r.received_by,r.received_at
 FROM public.consumable_receipts r JOIN public.materials m ON m.id=r.material_id JOIN public.locations l ON l.id=r.destination_location_id
 WHERE public.has_role(auth.uid(),'owner') OR r.received_by=auth.uid()
 ORDER BY r.received_at DESC,r.id LIMIT greatest(1,least(coalesce(p_limit,100),200))) x),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.guard_consumable_receipt_link() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_phase8_requirement() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.receive_consumable(uuid,uuid,text,text,text,uuid,numeric,bigint,text),public.manage_consumable(uuid,text,text,boolean),
 public.consumable_catalog(),public.material_issue_jobs(),public.post_material_issue(uuid,text,uuid,uuid,text,jsonb,text),
 public.material_issue_history(uuid,integer),public.consumable_receipt_history(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.receive_consumable(uuid,uuid,text,text,text,uuid,numeric,bigint,text),public.manage_consumable(uuid,text,text,boolean),
 public.consumable_catalog(),public.material_issue_jobs(),public.post_material_issue(uuid,text,uuid,uuid,text,jsonb,text),
 public.material_issue_history(uuid,integer),public.consumable_receipt_history(integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
