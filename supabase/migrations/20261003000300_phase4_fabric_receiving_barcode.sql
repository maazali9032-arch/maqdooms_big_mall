-- Phase 4: one Fabric + Batch barcode, internal Thans, Workshop receiving,
-- workflow-scoped CP and stable-barcode Owner SP revisions. No legacy backfill.
BEGIN;

CREATE TABLE public.fabric_entry_requests (
 request_id uuid PRIMARY KEY,
 fabric_stock_id uuid NOT NULL UNIQUE REFERENCES public.fabric_stock(id),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Payload includes CP: never expose it through the operational stock table.
ALTER TABLE public.fabric_entry_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.fabric_entry_requests TO authenticated;
GRANT ALL ON public.fabric_entry_requests TO service_role;
CREATE POLICY fabric_entry_requests_owner ON public.fabric_entry_requests FOR SELECT TO authenticated
 USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER fabric_entry_request_immutable BEFORE UPDATE OR DELETE ON public.fabric_entry_requests
 FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE FUNCTION public.can_receive_fabric() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.has_role(auth.uid(),'owner') OR
 (public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'inventory.receive'));
$$;

CREATE FUNCTION public.create_fabric_entry(p_request_id uuid,p_fabric uuid,p_batch uuid,p_lengths jsonb,p_cp bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_stock uuid; v_barcode uuid; v_payload jsonb; v_existing public.fabric_entry_requests%rowtype; r jsonb; v_length numeric;
BEGIN
 IF NOT public.can_receive_fabric() THEN RAISE EXCEPTION 'Stock Entry or Owner required'; END IF;
 IF p_request_id IS NULL OR p_cp IS NULL OR p_cp<0 OR p_cp>9007199254740991 OR
 jsonb_typeof(p_lengths) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Request ID, CP and Than lengths required'; END IF;
 IF jsonb_array_length(p_lengths) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Enter 1 to 500 internal Thans'; END IF;
 v_payload:=jsonb_build_object('fabric',p_fabric,'batch',p_batch,'lengths',p_lengths,'cp',p_cp);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,4));
 SELECT * INTO v_existing FROM public.fabric_entry_requests WHERE request_id=p_request_id;
 IF FOUND THEN
  IF NOT public.has_role(auth.uid(),'owner') AND v_existing.created_by<>auth.uid() THEN RAISE EXCEPTION 'Request belongs to another workflow'; END IF;
  IF v_existing.payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Request ID reused with different entry data'; END IF;
  RETURN v_existing.fabric_stock_id;
 END IF;
 PERFORM 1 FROM public.receiving_batches WHERE id=p_batch AND status='draft'
 AND (public.has_role(auth.uid(),'owner') OR created_by=auth.uid()) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Open owned receiving batch required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.fabrics WHERE id=p_fabric) THEN RAISE EXCEPTION 'Fabric required'; END IF;
 IF EXISTS(SELECT 1 FROM public.fabric_stock WHERE fabric_id=p_fabric AND batch_id=p_batch) THEN RAISE EXCEPTION 'Fabric + Batch already exists; edit its existing stock record'; END IF;
 -- UUID identity avoids resetting a sequence and remains stable across SP edits.
 v_stock:=gen_random_uuid();
 INSERT INTO public.barcodes(code,kind,created_by) VALUES('FAB-'||replace(v_stock::text,'-',''),'fabric',auth.uid()) RETURNING id INTO v_barcode;
 INSERT INTO public.fabric_stock(id,fabric_id,batch_id,barcode_id,entry_state,created_by)
 VALUES(v_stock,p_fabric,p_batch,v_barcode,'draft',auth.uid());
 FOR r IN SELECT value FROM jsonb_array_elements(p_lengths) LOOP
  v_length:=(r#>>'{}')::numeric;
  IF v_length IS NULL OR v_length<=0 OR v_length<>trunc(v_length) OR v_length>2147483647 THEN RAISE EXCEPTION 'Each Than needs a positive integer millimetre length'; END IF;
  INSERT INTO public.thaans(fabric_id,batch_id,fabric_stock_id,original_mm,status,created_by)
  VALUES(p_fabric,p_batch,v_stock,v_length::integer,'draft',auth.uid());
 END LOOP;
 PERFORM public.domain_stock_entry_cp(v_stock,p_cp);
 INSERT INTO public.fabric_entry_requests(request_id,fabric_stock_id,created_by,payload) VALUES(p_request_id,v_stock,auth.uid(),v_payload);
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'create_fabric_entry','fabric_stock',v_stock,v_payload,'ENTRY:'||p_request_id::text);
 RETURN v_stock;
END; $$;

CREATE FUNCTION public.update_fabric_entry(p_stock uuid,p_lengths jsonb,p_cp bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.fabric_stock%rowtype; r jsonb; v_q numeric;
BEGIN
 IF NOT public.can_receive_fabric() THEN RAISE EXCEPTION 'Stock Entry or Owner required'; END IF;
 SELECT * INTO s FROM public.fabric_stock WHERE id=p_stock FOR UPDATE;
 IF NOT FOUND OR s.entry_state<>'draft' OR NOT EXISTS(SELECT 1 FROM public.fabric_entry_requests WHERE fabric_stock_id=s.id)
 OR (NOT public.has_role(auth.uid(),'owner') AND s.created_by IS DISTINCT FROM auth.uid()) THEN RAISE EXCEPTION 'Owned new-model draft required'; END IF;
 PERFORM 1 FROM public.receiving_batches WHERE id=s.batch_id AND status='draft' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Open receiving batch required'; END IF;
 IF jsonb_typeof(p_lengths) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Internal Than rows required'; END IF;
 IF jsonb_array_length(p_lengths)<>(SELECT count(*) FROM public.thaans WHERE fabric_stock_id=s.id)
 OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_lengths))<>jsonb_array_length(p_lengths) THEN RAISE EXCEPTION 'Supply each existing Than exactly once'; END IF;
 PERFORM 1 FROM public.thaans WHERE fabric_stock_id=s.id ORDER BY id FOR UPDATE;
 FOR r IN SELECT value FROM jsonb_array_elements(p_lengths) LOOP
  v_q:=(r->>'length_mm')::numeric;
  IF v_q IS NULL OR v_q<=0 OR v_q<>trunc(v_q) OR v_q>2147483647 THEN RAISE EXCEPTION 'Positive integer Than length required'; END IF;
  UPDATE public.thaans SET original_mm=v_q::integer,updated_at=now() WHERE id=(r->>'id')::uuid AND fabric_stock_id=s.id AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft Than must belong to this stock'; END IF;
 END LOOP;
 IF p_cp IS NULL OR p_cp>9007199254740991 THEN RAISE EXCEPTION 'CP required within supported money range'; END IF;
 PERFORM public.domain_stock_entry_cp(s.id,p_cp);
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value)
 VALUES(auth.uid(),'update_fabric_entry','fabric_stock',s.id,jsonb_build_object('lengths',p_lengths,'cp',p_cp));
END; $$;

CREATE FUNCTION public.complete_fabric_entry(p_stock uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.fabric_stock%rowtype; t public.thaans%rowtype; v_item uuid; v_workshop uuid;
BEGIN
 IF NOT public.can_receive_fabric() THEN RAISE EXCEPTION 'Stock Entry or Owner required'; END IF;
 SELECT * INTO s FROM public.fabric_stock WHERE id=p_stock FOR UPDATE;
 IF NOT FOUND OR (NOT public.has_role(auth.uid(),'owner') AND s.created_by IS DISTINCT FROM auth.uid()) THEN RAISE EXCEPTION 'Owned workflow required'; END IF;
 IF s.entry_state='complete' THEN RETURN s.id; END IF;
 IF s.entry_state='legacy_pending' THEN RAISE EXCEPTION 'Legacy stock requires explicit reconciliation, not new receipt'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.fabric_stock_costs WHERE fabric_stock_id=s.id) THEN RAISE EXCEPTION 'CP required before completion'; END IF;
 IF s.entry_state='draft' THEN
  IF NOT EXISTS(SELECT 1 FROM public.fabric_entry_requests WHERE fabric_stock_id=s.id) THEN RAISE EXCEPTION 'New-model entry required'; END IF;
  PERFORM 1 FROM public.receiving_batches WHERE id=s.batch_id AND status='draft' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Open receiving batch required'; END IF;
  SELECT id INTO v_workshop FROM public.locations WHERE kind='workshop' AND active;
  IF v_workshop IS NULL THEN RAISE EXCEPTION 'Active Workshop required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.thaans WHERE fabric_stock_id=s.id) THEN RAISE EXCEPTION 'Internal Thans required'; END IF;
  FOR t IN SELECT * FROM public.thaans WHERE fabric_stock_id=s.id ORDER BY id FOR UPDATE LOOP
   IF t.status<>'draft' OR t.original_mm IS NULL OR t.original_mm<=0 OR t.barcode IS NOT NULL
   OR EXISTS(SELECT 1 FROM public.stock_movements WHERE thaan_id=t.id)
   OR EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=t.id) THEN RAISE EXCEPTION 'Clean internal draft Than required'; END IF;
   UPDATE public.thaans SET status='active',updated_at=now() WHERE id=t.id;
   INSERT INTO public.inventory_items(thaan_id,unit,legacy_quantity_snapshot,reconciled_by,reason)
   VALUES(t.id,'mm',0,auth.uid(),'New fabric received into Workshop') RETURNING id INTO v_item;
   INSERT INTO public.inventory_movements(inventory_item_id,kind,thaan_id,fabric_stock_id,quantity,unit,destination_location_id,reference,reason,actor_id)
   VALUES(v_item,'INWARD',t.id,s.id,t.original_mm,'mm',v_workshop,'RECEIPT:'||s.id::text,'New fabric received into Workshop',auth.uid());
  END LOOP;
 END IF;
 UPDATE public.fabric_stock SET entry_state='complete' WHERE id=s.id;
 -- A batch may contain several fabrics; do not close unrelated draft work.
 IF NOT EXISTS(SELECT 1 FROM public.fabric_stock WHERE batch_id=s.batch_id AND entry_state IN ('draft','legacy_pending'))
 AND NOT EXISTS(SELECT 1 FROM public.thaans WHERE batch_id=s.batch_id AND status='draft') THEN
  UPDATE public.receiving_batches SET status='committed',committed_at=coalesce(committed_at,now()) WHERE id=s.batch_id AND status='draft';
 END IF;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value)
 VALUES(auth.uid(),'complete_fabric_entry','fabric_stock',s.id,jsonb_build_object('previous_state',s.entry_state,'state','complete'));
 RETURN s.id;
END; $$;

CREATE FUNCTION public.open_fabric_cp_correction(p_stock uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required to open completed-stock correction'; END IF;
 IF p_reason IS NULL OR btrim(p_reason)='' THEN RAISE EXCEPTION 'Correction reason required'; END IF;
 PERFORM 1 FROM public.fabric_stock WHERE id=p_stock AND entry_state='complete' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Completed stock required'; END IF;
 UPDATE public.fabric_stock SET entry_state='correcting' WHERE id=p_stock;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value)
 VALUES(auth.uid(),'open_fabric_cp_correction','fabric_stock',p_stock,jsonb_build_object('reason',btrim(p_reason)));
END; $$;

CREATE FUNCTION public.owner_set_fabric_sp(p_stock uuid,p_sp bigint,p_reason text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_revision integer;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Only Owner controls SP'; END IF;
 IF p_sp IS NULL OR p_sp<0 OR p_sp>9007199254740991 OR p_reason IS NULL OR btrim(p_reason)='' THEN RAISE EXCEPTION 'Nonnegative SP and reason required'; END IF;
 PERFORM 1 FROM public.fabric_stock WHERE id=p_stock FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fabric Stock not found'; END IF;
 SELECT coalesce(max(revision),0)+1 INTO v_revision FROM public.fabric_stock_prices WHERE fabric_stock_id=p_stock;
 INSERT INTO public.fabric_stock_prices(fabric_stock_id,revision,sp_paise_per_m,recorded_by,reason)
 VALUES(p_stock,v_revision,p_sp,auth.uid(),btrim(p_reason));
 -- New receipts have no separate legacy SP copy. Old historical prices stay intact.
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value)
 VALUES(auth.uid(),'owner_set_fabric_sp','fabric_stock',p_stock,jsonb_build_object('revision',v_revision,'sp',p_sp,'reason',btrim(p_reason)));
 RETURN p_sp;
END; $$;

CREATE FUNCTION public.fabric_stock_catalog(p_barcode text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry','ecommerce_manager']) THEN RAISE EXCEPTION 'Active operational role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'fabric_name',x->>'batch_code') FROM (
 SELECT jsonb_build_object('id',s.id,'fabric_id',f.id,'fabric_code',f.code,'fabric_name',f.name,
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
END; $$;

CREATE FUNCTION public.fabric_stock_history(p_stock uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry','ecommerce_manager']) THEN RAISE EXCEPTION 'Active operational role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.occurred_at DESC) FROM (
 SELECT id,kind,thaan_id,quantity,unit,source_location_id,destination_location_id,reference,reason,actor_id,occurred_at
 FROM public.inventory_movements WHERE fabric_stock_id=p_stock ORDER BY occurred_at DESC,id DESC LIMIT 200) x),'[]'::jsonb);
END; $$;

-- Prevent bypassing the canonical receipt/SP identity through old direct editors.
CREATE FUNCTION public.guard_phase4_fabric_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='fabric_stock' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Fabric Stock identity is permanent'; END IF;
  IF EXISTS(SELECT 1 FROM public.fabric_entry_requests WHERE fabric_stock_id=OLD.id)
  AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'Stock entry ownership is permanent'; END IF;
 ELSE
  IF TG_OP='INSERT' AND auth.uid() IS NOT NULL AND NEW.barcode IS NOT NULL THEN
   RAISE EXCEPTION 'New stock uses one Fabric + Batch barcode, not per-Than labels';
  END IF;
  IF EXISTS(SELECT 1 FROM public.fabric_entry_requests WHERE fabric_stock_id=coalesce(NEW.fabric_stock_id,OLD.fabric_stock_id)) THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Internal Than history is permanent'; END IF;
   IF NEW.barcode IS NOT NULL OR NEW.price_paise IS NOT NULL THEN RAISE EXCEPTION 'Use one Fabric Barcode and Owner Fabric Stock SP'; END IF;
   IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'owner') AND NOT EXISTS(
    SELECT 1 FROM public.fabric_stock WHERE id=NEW.fabric_stock_id AND created_by=auth.uid() AND entry_state='draft'
   ) THEN RAISE EXCEPTION 'Owned open Fabric Stock draft required for internal Than edits'; END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER phase4_stock_identity BEFORE UPDATE OR DELETE ON public.fabric_stock FOR EACH ROW EXECUTE FUNCTION public.guard_phase4_fabric_identity();
CREATE TRIGGER phase4_than_identity BEFORE INSERT OR UPDATE OR DELETE ON public.thaans FOR EACH ROW EXECUTE FUNCTION public.guard_phase4_fabric_identity();

-- Existing dashboard/overview must count new Workshop receipts from the same
-- authority, and must not classify SP-optional internal Thans as incomplete.
CREATE OR REPLACE VIEW public.v_thaan_overview WITH(security_invoker=true) AS
 SELECT t.id,t.barcode,t.status,t.original_mm,t.width_mm,t.price_paise,t.rack,t.created_at,t.updated_at,
 t.batch_id,b.code batch_code,s.name supplier_name,f.id fabric_id,f.name fabric_name,f.code fabric_code,
 f.category,f.colour,f.design,coalesce(m.available_mm,0)::integer available_mm,coalesce(m.held_mm,0)::integer held_mm,
 (t.original_mm IS NULL OR (t.barcode IS NOT NULL AND t.price_paise IS NULL)) is_incomplete,
 greatest((SELECT max(created_at) FROM public.stock_movements WHERE thaan_id=t.id),
 (SELECT max(occurred_at) FROM public.inventory_movements WHERE thaan_id=t.id)) last_movement_at
 FROM public.thaans t LEFT JOIN public.fabrics f ON f.id=t.fabric_id
 LEFT JOIN public.receiving_batches b ON b.id=t.batch_id LEFT JOIN public.suppliers s ON s.id=b.supplier_id
 LEFT JOIN public.v_thaan_stock m ON m.thaan_id=t.id;

-- Existing scoped CP API is reused, including closed-workflow denial and append-only revisions.
REVOKE ALL ON FUNCTION public.can_receive_fabric(),public.guard_phase4_fabric_identity() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_fabric_entry(uuid,uuid,uuid,jsonb,bigint),public.update_fabric_entry(uuid,jsonb,bigint),
 public.complete_fabric_entry(uuid),public.open_fabric_cp_correction(uuid,text),public.owner_set_fabric_sp(uuid,bigint,text),
 public.fabric_stock_catalog(text),public.fabric_stock_history(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_fabric_entry(uuid,uuid,uuid,jsonb,bigint),public.update_fabric_entry(uuid,jsonb,bigint),
 public.complete_fabric_entry(uuid),public.open_fabric_cp_correction(uuid,text),public.owner_set_fabric_sp(uuid,bigint,text),
 public.fabric_stock_catalog(text),public.fabric_stock_history(uuid) TO authenticated;
COMMIT;
