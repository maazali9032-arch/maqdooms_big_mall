-- Phase 3: explicit location reconciliation, a single ledger authority per item,
-- atomic transfers and controlled corrections. No guessed opening balances.
BEGIN;

CREATE TABLE public.inventory_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 thaan_id uuid UNIQUE REFERENCES public.thaans(id),
 material_id uuid UNIQUE REFERENCES public.materials(id),
 finished_product_id uuid UNIQUE REFERENCES public.finished_products(id),
 unit text NOT NULL CHECK(btrim(unit)<>''),
 legacy_quantity_snapshot numeric(18,3) NOT NULL CHECK(legacy_quantity_snapshot>=0),
 reconciled_by uuid NOT NULL REFERENCES public.profiles(id),
 reconciled_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL CHECK(btrim(reason)<>''),
 CHECK(num_nonnulls(thaan_id,material_id,finished_product_id)=1),
 CHECK(thaan_id IS NULL OR unit='mm'),
 CHECK(finished_product_id IS NULL OR unit='pc')
);
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.inventory_items TO authenticated;
GRANT ALL ON public.inventory_items TO service_role;
CREATE POLICY inventory_items_operational_read ON public.inventory_items FOR SELECT TO authenticated USING(
 public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry','ecommerce_manager']) OR
 (public.has_role(auth.uid(),'tailor') AND (
 EXISTS(SELECT 1 FROM public.tailoring_job_lines l JOIN public.tailoring_jobs j ON j.id=l.job_id WHERE j.tailor_id=auth.uid() AND (l.thaan_id=inventory_items.thaan_id OR l.material_id=inventory_items.material_id)) OR
 EXISTS(SELECT 1 FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id WHERE public.owns_tailor_assignment(i.tailor_assignment_id) AND (l.thaan_id=inventory_items.thaan_id OR l.material_id=inventory_items.material_id)) )));
CREATE TRIGGER inventory_item_history_immutable BEFORE UPDATE OR DELETE ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

ALTER TABLE public.inventory_movements ADD COLUMN inventory_item_id uuid REFERENCES public.inventory_items(id);
-- NOT VALID preserves any pre-existing unlinked domain history, without making
-- it an opening balance. New writes require a reconciled item; validate when clean.
ALTER TABLE public.inventory_movements ADD CONSTRAINT movement_authority_required CHECK(inventory_item_id IS NOT NULL) NOT VALID;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.inventory_movements WHERE inventory_item_id IS NULL) THEN
 ALTER TABLE public.inventory_movements VALIDATE CONSTRAINT movement_authority_required; END IF; END $$;
CREATE INDEX inventory_movements_item_location_idx ON public.inventory_movements(inventory_item_id,occurred_at,id);
ALTER TABLE public.stock_transfers ADD COLUMN request_id uuid UNIQUE;
ALTER TABLE public.stock_transfers ADD COLUMN request_payload jsonb;
ALTER TABLE public.stock_transfers ADD COLUMN posted_at timestamptz;

CREATE FUNCTION public.inventory_balance(p_item uuid,p_location uuid DEFAULT NULL) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(sum(CASE WHEN destination_location_id IS NOT NULL AND (p_location IS NULL OR destination_location_id=p_location) THEN quantity ELSE 0 END)
 -sum(CASE WHEN source_location_id IS NOT NULL AND (p_location IS NULL OR source_location_id=p_location) THEN quantity ELSE 0 END),0)
 FROM public.inventory_movements WHERE inventory_item_id=p_item;
$$;
-- Private arithmetic helper: public readers below apply role/RLS first.
REVOKE ALL ON FUNCTION public.inventory_balance(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.guard_location_operations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Locations are retained; deactivate an empty sublocation'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.code IS DISTINCT FROM OLD.code THEN RAISE EXCEPTION 'Location code is immutable'; END IF;
  IF OLD.kind IN ('workshop','showroom') AND (NOT NEW.active OR NEW.name IS DISTINCT FROM OLD.name) THEN RAISE EXCEPTION 'Workshop and Showroom roots are permanent'; END IF;
  IF OLD.active AND NOT NEW.active THEN
   IF EXISTS(SELECT 1 FROM public.inventory_items i WHERE public.inventory_balance(i.id,OLD.id)<>0)
   OR EXISTS(SELECT 1 FROM public.finished_products p WHERE p.current_location_id=OLD.id AND p.status='available') THEN
    RAISE EXCEPTION 'Move stock out before deactivating this location'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER locations_operation_guard BEFORE UPDATE OR DELETE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.guard_location_operations();
CREATE FUNCTION public.manage_showroom_location(p_id uuid,p_code text,p_name text,p_active boolean DEFAULT true) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_parent uuid; v_old jsonb;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_name IS NULL OR btrim(p_name)='' OR p_code IS NULL OR btrim(p_code)='' OR p_active IS NULL THEN RAISE EXCEPTION 'Code, name and active state required'; END IF;
 SELECT id INTO v_parent FROM public.locations WHERE kind='showroom' AND active;
 IF p_id IS NULL THEN
  INSERT INTO public.locations(code,name,kind,parent_id,active) VALUES(btrim(p_code),btrim(p_name),'showroom_sublocation',v_parent,p_active) RETURNING id INTO v_id;
 ELSE
  SELECT to_jsonb(l) INTO v_old FROM public.locations l WHERE id=p_id AND kind='showroom_sublocation' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Showroom sublocation not found'; END IF;
  UPDATE public.locations SET code=btrim(p_code),name=btrim(p_name),active=p_active WHERE id=p_id RETURNING id INTO v_id;
 END IF;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value)
 SELECT auth.uid(),'manage_showroom_location','locations',v_id,v_old,to_jsonb(l) FROM public.locations l WHERE id=v_id;
 RETURN v_id;
END; $$;

CREATE FUNCTION public.guard_inventory_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i public.inventory_items%rowtype; v_balance numeric; v_total numeric; v_location uuid;
BEGIN
 SELECT * INTO i FROM public.inventory_items WHERE id=NEW.inventory_item_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reconciled inventory item required'; END IF;
 IF (NEW.thaan_id,NEW.material_id,NEW.finished_product_id,NEW.unit) IS DISTINCT FROM (i.thaan_id,i.material_id,i.finished_product_id,i.unit) THEN RAISE EXCEPTION 'Movement identity/unit must match inventory authority'; END IF;
 IF auth.uid() IS NOT NULL AND NEW.actor_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Movement actor must be caller'; END IF;
 IF NEW.actor_id IS NULL THEN RAISE EXCEPTION 'Movement actor required'; END IF;
 IF NEW.reason IS NULL OR btrim(NEW.reason)='' THEN RAISE EXCEPTION 'Movement reason required'; END IF;
 IF NEW.kind IN ('INWARD','PRODUCTION','RETURN') AND (NEW.source_location_id IS NOT NULL OR NEW.destination_location_id IS NULL) THEN RAISE EXCEPTION 'Incoming movement requires destination only'; END IF;
 IF NEW.kind IN ('SALE','MATERIAL_ISSUE','TAILORING','WASTAGE') AND (NEW.source_location_id IS NULL OR NEW.destination_location_id IS NOT NULL) THEN RAISE EXCEPTION 'Outgoing movement requires source only'; END IF;
 IF NEW.kind='ADJUSTMENT' AND num_nonnulls(NEW.source_location_id,NEW.destination_location_id)<>1 THEN RAISE EXCEPTION 'Adjustment requires one direction'; END IF;
 IF NEW.kind='TRANSFER' AND NOT EXISTS(SELECT 1 FROM public.stock_transfer_lines l JOIN public.stock_transfers t ON t.id=l.transfer_id WHERE l.id=NEW.stock_transfer_line_id AND t.status='draft') THEN RAISE EXCEPTION 'Transfer movement requires an open posting transaction'; END IF;
 IF NEW.kind='SALE' AND NOT EXISTS(SELECT 1 FROM public.order_items l JOIN public.orders o ON o.id=l.order_id
 WHERE l.id=NEW.order_item_id AND o.kind IN ('direct_fabric_sale','finished_product_sale') AND o.source_location_id=NEW.source_location_id
 AND (l.thaan_id,l.fabric_stock_id,l.finished_product_id,l.quantity,l.unit) IS NOT DISTINCT FROM (NEW.thaan_id,NEW.fabric_stock_id,NEW.finished_product_id,NEW.quantity,NEW.unit)) THEN RAISE EXCEPTION 'Sale movement must match its Order item and source'; END IF;
 -- Lock locations in stable order, preventing a simultaneous deactivation.
 FOR v_location IN SELECT id FROM public.locations WHERE id IN (NEW.source_location_id,NEW.destination_location_id) ORDER BY id FOR UPDATE LOOP
  IF NOT EXISTS(SELECT 1 FROM public.locations WHERE id=v_location AND active) THEN RAISE EXCEPTION 'Active location required'; END IF;
 END LOOP;
 IF NEW.source_location_id IS NOT NULL THEN
  v_balance:=public.inventory_balance(i.id,NEW.source_location_id);
  IF v_balance<NEW.quantity THEN RAISE EXCEPTION 'Insufficient stock at source location'; END IF;
 END IF;
 v_total:=public.inventory_balance(i.id,NULL)+CASE WHEN NEW.source_location_id IS NULL THEN NEW.quantity WHEN NEW.destination_location_id IS NULL THEN -NEW.quantity ELSE 0 END;
 IF i.finished_product_id IS NOT NULL AND v_total NOT IN (0,1) THEN RAISE EXCEPTION 'A physical Finished Product has at most one piece'; END IF;
 IF i.thaan_id IS NOT NULL AND v_total>2147483647 THEN RAISE EXCEPTION 'Than balance exceeds supported millimetre range'; END IF;
 IF i.finished_product_id IS NOT NULL AND NEW.source_location_id IS NULL AND NEW.reference IS DISTINCT FROM 'OPENING:'||i.id::text
 AND NOT EXISTS(SELECT 1 FROM public.locations WHERE id=NEW.destination_location_id AND kind='workshop') THEN RAISE EXCEPTION 'Finished Products enter Workshop before transfer'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER inventory_movement_balance_guard BEFORE INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_movement();

-- Any old RPC/direct write sees the same physical-item lock used at cutover.
CREATE FUNCTION public.guard_legacy_inventory_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_item uuid;
BEGIN
 IF TG_TABLE_NAME='stock_movements' THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Legacy movement history is append-only'; END IF;
  PERFORM 1 FROM public.thaans WHERE id=NEW.thaan_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=NEW.thaan_id) THEN RAISE EXCEPTION 'Location ledger is authoritative; use location-aware stock operations'; END IF;
  IF coalesce((SELECT sum(delta_mm) FROM public.stock_movements WHERE thaan_id=NEW.thaan_id),0)+NEW.delta_mm<0 THEN RAISE EXCEPTION 'Legacy stock cannot become negative'; END IF;
 ELSIF TG_TABLE_NAME='holds' THEN
  IF NEW.status='active' AND NEW.expires_at>now() THEN
   PERFORM 1 FROM public.thaans WHERE id=NEW.thaan_id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=NEW.thaan_id) THEN RAISE EXCEPTION 'Location-aware reservations required for reconciled stock'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='thaans' THEN
  IF EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=OLD.id) AND (NEW.fabric_id,NEW.batch_id,NEW.fabric_stock_id,NEW.original_mm) IS DISTINCT FROM (OLD.fabric_id,OLD.batch_id,OLD.fabric_stock_id,OLD.original_mm) THEN RAISE EXCEPTION 'Reconciled Than identity and original length are historical'; END IF;
 ELSIF TG_TABLE_NAME='materials' THEN
  IF EXISTS(SELECT 1 FROM public.inventory_items WHERE material_id=OLD.id) AND (NEW.unit,NEW.qty_on_hand) IS DISTINCT FROM (OLD.unit,OLD.qty_on_hand) THEN RAISE EXCEPTION 'Location ledger is authoritative for consumable quantity/unit'; END IF;
 ELSE
  SELECT id INTO v_item FROM public.inventory_items WHERE finished_product_id=OLD.id;
  IF v_item IS NOT NULL AND NEW.current_location_id IS DISTINCT FROM OLD.current_location_id AND public.inventory_balance(v_item,NEW.current_location_id)<>1 THEN RAISE EXCEPTION 'Finished Product location must match its ledger'; END IF;
  IF v_item IS NOT NULL AND ((NEW.status='available' AND public.inventory_balance(v_item,NULL)<>1) OR (NEW.status IN ('sold','archived') AND public.inventory_balance(v_item,NULL)<>0)) THEN RAISE EXCEPTION 'Finished Product status must match its ledger count'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER legacy_movement_authority BEFORE INSERT OR UPDATE OR DELETE ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_inventory_authority();
CREATE TRIGGER legacy_hold_authority BEFORE INSERT OR UPDATE ON public.holds FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_inventory_authority();
CREATE TRIGGER legacy_thaan_identity BEFORE UPDATE ON public.thaans FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_inventory_authority();
CREATE TRIGGER legacy_material_authority BEFORE UPDATE ON public.materials FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_inventory_authority();
CREATE TRIGGER finished_product_location_authority BEFORE UPDATE ON public.finished_products FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_inventory_authority();

CREATE FUNCTION public.reconcile_inventory_item(p_kind text,p_item_id uuid,p_allocations jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_thaan uuid; v_material uuid; v_piece uuid; v_stock uuid; v_unit text; v_quantity numeric; v_id uuid;
 v_location uuid; v_current_location uuid; v_row jsonb; v_q numeric; v_sum numeric:=0; v_alloc_count integer;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_reason IS NULL OR btrim(p_reason)='' OR jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Explicit location allocations and reason required'; END IF;
 IF p_kind='fabric' THEN
  SELECT t.id,t.fabric_stock_id INTO v_thaan,v_stock FROM public.thaans t WHERE t.id=p_item_id AND t.status IN ('active','depleted') FOR UPDATE;
  IF v_thaan IS NULL OR v_stock IS NULL THEN RAISE EXCEPTION 'Active/depleted Than with Fabric + Batch identity required'; END IF;
  IF EXISTS(SELECT 1 FROM public.holds WHERE thaan_id=v_thaan AND status='active' AND expires_at>now()) THEN RAISE EXCEPTION 'Release unlocated legacy holds before reconciliation'; END IF;
  SELECT coalesce(sum(delta_mm),0) INTO v_quantity FROM public.stock_movements WHERE thaan_id=v_thaan;
  v_unit:='mm';
 ELSIF p_kind='consumable' THEN
  SELECT id,unit,qty_on_hand INTO v_material,v_unit,v_quantity FROM public.materials WHERE id=p_item_id AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active consumable required'; END IF;
 ELSIF p_kind='finished_product' THEN
  SELECT id,current_location_id INTO v_piece,v_current_location FROM public.finished_products WHERE id=p_item_id AND status='available' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Available genealogically linked Finished Product required'; END IF;
  v_unit:='pc'; v_quantity:=1;
 ELSE RAISE EXCEPTION 'Unknown item kind'; END IF;
 IF v_quantity<0 OR v_quantity IS NULL OR v_quantity<>round(v_quantity,3) THEN RAISE EXCEPTION 'Resolve invalid legacy quantity before reconciliation'; END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=v_thaan OR material_id=v_material OR finished_product_id=v_piece) THEN RAISE EXCEPTION 'Item already reconciled'; END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_movements WHERE thaan_id=v_thaan OR material_id=v_material OR finished_product_id=v_piece) THEN RAISE EXCEPTION 'Existing unlinked domain movements require explicit reconciliation first'; END IF;
 SELECT count(DISTINCT value->>'location_id') INTO v_alloc_count FROM jsonb_array_elements(p_allocations);
 IF v_alloc_count<>jsonb_array_length(p_allocations) THEN RAISE EXCEPTION 'Duplicate/missing allocation location'; END IF;
 -- Stable location lock order also serializes deactivation and transfer posting.
 PERFORM 1 FROM public.locations WHERE id IN (SELECT (value->>'location_id')::uuid FROM jsonb_array_elements(p_allocations)) ORDER BY id FOR UPDATE;
 FOR v_row IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
  v_location:=(v_row->>'location_id')::uuid; v_q:=(v_row->>'quantity')::numeric;
  IF v_q IS NULL OR v_q<=0 OR v_q<>round(v_q,3) OR (v_unit='mm' AND v_q<>trunc(v_q)) THEN RAISE EXCEPTION 'Positive exact-unit allocation required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.locations WHERE id=v_location AND active) THEN RAISE EXCEPTION 'Active allocation location required'; END IF;
  IF v_piece IS NOT NULL AND (v_q<>1 OR v_location<>v_current_location) THEN RAISE EXCEPTION 'Piece allocation must match its verified current location'; END IF;
  v_sum:=v_sum+v_q;
 END LOOP;
 IF v_sum<>v_quantity THEN RAISE EXCEPTION 'Allocations must equal current legacy quantity (%)',v_quantity; END IF;
 INSERT INTO public.inventory_items(thaan_id,material_id,finished_product_id,unit,legacy_quantity_snapshot,reconciled_by,reason)
 VALUES(v_thaan,v_material,v_piece,v_unit,v_quantity,auth.uid(),btrim(p_reason)) RETURNING id INTO v_id;
 FOR v_row IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
  INSERT INTO public.inventory_movements(inventory_item_id,kind,thaan_id,fabric_stock_id,material_id,finished_product_id,quantity,unit,destination_location_id,reference,reason,actor_id)
  VALUES(v_id,'ADJUSTMENT',v_thaan,v_stock,v_material,v_piece,(v_row->>'quantity')::numeric,v_unit,(v_row->>'location_id')::uuid,'OPENING:'||v_id::text,btrim(p_reason),auth.uid());
 END LOOP;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'reconcile_inventory_item','inventory_items',v_id,jsonb_build_object('legacy_quantity',v_quantity,'unit',v_unit,'allocations',p_allocations,'reason',btrim(p_reason)),'OPENING:'||v_id::text);
 RETURN v_id;
END; $$;

CREATE FUNCTION public.post_inventory_transfer(p_request_id uuid,p_source uuid,p_destination uuid,p_items jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_existing public.stock_transfers%rowtype; v_payload jsonb; r jsonb; i public.inventory_items%rowtype; v_line uuid; v_q numeric; v_stock uuid; v_location uuid;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required for stock transfer'; END IF;
 IF p_request_id IS NULL OR p_source IS NULL OR p_destination IS NULL OR p_source=p_destination OR p_reason IS NULL OR btrim(p_reason)='' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Distinct locations, items, request ID and reason required'; END IF;
 v_payload:=jsonb_build_object('source',p_source,'destination',p_destination,'items',p_items,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,3));
 SELECT * INTO v_existing FROM public.stock_transfers WHERE request_id=p_request_id;
 IF FOUND THEN
  IF v_existing.request_payload IS DISTINCT FROM v_payload OR v_existing.status<>'posted' THEN RAISE EXCEPTION 'Transfer request ID already used with different data'; END IF;
  RETURN v_existing.id;
 END IF;
 IF (SELECT count(DISTINCT value->>'inventory_item_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Duplicate/missing transfer item'; END IF;
 PERFORM 1 FROM public.inventory_items WHERE id IN (SELECT (value->>'inventory_item_id')::uuid FROM jsonb_array_elements(p_items)) ORDER BY id FOR UPDATE;
 FOR v_location IN SELECT id FROM public.locations WHERE id IN (p_source,p_destination) ORDER BY id FOR UPDATE LOOP
  IF NOT EXISTS(SELECT 1 FROM public.locations WHERE id=v_location AND active) THEN RAISE EXCEPTION 'Active transfer locations required'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM public.locations WHERE id IN (p_source,p_destination) AND active)<>2 THEN RAISE EXCEPTION 'Active transfer locations required'; END IF;
 INSERT INTO public.stock_transfers(code,source_location_id,destination_location_id,status,reason,created_by,request_id,request_payload)
 VALUES('TRF-'||p_request_id::text,p_source,p_destination,'draft',btrim(p_reason),auth.uid(),p_request_id,v_payload) RETURNING id INTO v_id;
 FOR r IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'inventory_item_id' LOOP
  SELECT * INTO i FROM public.inventory_items WHERE id=(r->>'inventory_item_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciled item required'; END IF;
  v_q:=(r->>'quantity')::numeric;
  IF v_q IS NULL OR v_q<=0 OR v_q<>round(v_q,3) THEN RAISE EXCEPTION 'Positive exact-unit transfer quantity required'; END IF;
  SELECT fabric_stock_id INTO v_stock FROM public.thaans WHERE id=i.thaan_id;
  INSERT INTO public.stock_transfer_lines(transfer_id,thaan_id,fabric_stock_id,material_id,finished_product_id,quantity,unit)
  VALUES(v_id,i.thaan_id,v_stock,i.material_id,i.finished_product_id,v_q,i.unit) RETURNING id INTO v_line;
  INSERT INTO public.inventory_movements(inventory_item_id,kind,thaan_id,fabric_stock_id,material_id,finished_product_id,quantity,unit,source_location_id,destination_location_id,stock_transfer_line_id,reference,reason,actor_id)
  VALUES(i.id,'TRANSFER',i.thaan_id,v_stock,i.material_id,i.finished_product_id,v_q,i.unit,p_source,p_destination,v_line,'TRF-'||p_request_id::text,btrim(p_reason),auth.uid());
  IF i.finished_product_id IS NOT NULL THEN UPDATE public.finished_products SET current_location_id=p_destination WHERE id=i.finished_product_id AND status='available'; IF NOT FOUND THEN RAISE EXCEPTION 'Finished Product not available'; END IF; END IF;
 END LOOP;
 UPDATE public.stock_transfers SET status='posted',posted_at=now() WHERE id=v_id;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'post_inventory_transfer','stock_transfers',v_id,v_payload,'TRF-'||p_request_id::text);
 RETURN v_id;
END; $$;

CREATE FUNCTION public.record_inventory_correction(p_item uuid,p_location uuid,p_kind text,p_quantity numeric,p_incoming boolean,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i public.inventory_items%rowtype; v_id uuid; v_stock uuid;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_kind NOT IN ('ADJUSTMENT','RETURN','WASTAGE') OR p_incoming IS NULL OR (p_kind='RETURN' AND NOT p_incoming) OR (p_kind='WASTAGE' AND p_incoming) OR p_quantity IS NULL OR p_quantity<=0 OR p_quantity<>round(p_quantity,3) OR p_reason IS NULL OR btrim(p_reason)='' THEN RAISE EXCEPTION 'Explicit valid correction, direction, quantity and reason required'; END IF;
 SELECT * INTO i FROM public.inventory_items WHERE id=p_item FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reconciled item required'; END IF;
 SELECT fabric_stock_id INTO v_stock FROM public.thaans WHERE id=i.thaan_id;
 INSERT INTO public.inventory_movements(inventory_item_id,kind,thaan_id,fabric_stock_id,material_id,finished_product_id,quantity,unit,source_location_id,destination_location_id,reason,actor_id)
 VALUES(i.id,p_kind,i.thaan_id,v_stock,i.material_id,i.finished_product_id,p_quantity,i.unit,CASE WHEN NOT p_incoming THEN p_location END,CASE WHEN p_incoming THEN p_location END,btrim(p_reason),auth.uid()) RETURNING id INTO v_id;
 IF i.finished_product_id IS NOT NULL THEN
  IF p_incoming THEN UPDATE public.finished_products SET current_location_id=p_location,status='available' WHERE id=i.finished_product_id;
  ELSE UPDATE public.finished_products SET status='archived' WHERE id=i.finished_product_id AND public.inventory_balance(i.id,NULL)=0; END IF;
 END IF;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value)
 VALUES(auth.uid(),'record_inventory_correction','inventory_movements',v_id,jsonb_build_object('kind',p_kind,'quantity',p_quantity,'unit',i.unit,'location',p_location,'incoming',p_incoming,'reason',btrim(p_reason)));
 RETURN v_id;
END; $$;

-- Retain posted transfer history and draft identity once created. Public writes
-- are RPC-only; guards protect trusted accidental edits as well.
CREATE FUNCTION public.guard_posted_transfer_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='stock_transfers' THEN
  IF TG_OP='DELETE' OR OLD.status<>'draft' OR (NEW.id,NEW.code,NEW.source_location_id,NEW.destination_location_id,NEW.reason,NEW.created_by,NEW.request_id,NEW.request_payload) IS DISTINCT FROM (OLD.id,OLD.code,OLD.source_location_id,OLD.destination_location_id,OLD.reason,OLD.created_by,OLD.request_id,OLD.request_payload) THEN RAISE EXCEPTION 'Transfer history/identity cannot be rewritten'; END IF;
  IF NEW.status='posted' AND (NEW.posted_at IS NULL OR NOT EXISTS(SELECT 1 FROM public.stock_transfer_lines WHERE transfer_id=NEW.id) OR EXISTS(SELECT 1 FROM public.stock_transfer_lines l WHERE l.transfer_id=NEW.id AND NOT EXISTS(SELECT 1 FROM public.inventory_movements m WHERE m.stock_transfer_line_id=l.id))) THEN RAISE EXCEPTION 'Every transfer line must be posted atomically'; END IF;
 ELSE
  IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM public.stock_transfers WHERE id=NEW.transfer_id AND status='draft') THEN RAISE EXCEPTION 'Transfer lines are immutable after posting'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER transfer_history_guard BEFORE UPDATE OR DELETE ON public.stock_transfers FOR EACH ROW EXECUTE FUNCTION public.guard_posted_transfer_history();
CREATE TRIGGER transfer_line_history_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_transfer_lines FOR EACH ROW EXECUTE FUNCTION public.guard_posted_transfer_history();

CREATE VIEW public.v_inventory_location_balances WITH(security_invoker=true) AS
 WITH deltas AS (
 SELECT inventory_item_id,destination_location_id location_id,quantity delta FROM public.inventory_movements WHERE destination_location_id IS NOT NULL
 UNION ALL SELECT inventory_item_id,source_location_id,-quantity FROM public.inventory_movements WHERE source_location_id IS NOT NULL)
 SELECT i.id inventory_item_id,i.thaan_id,i.material_id,i.finished_product_id,i.unit,d.location_id,sum(d.delta)::numeric quantity
 FROM public.inventory_items i JOIN deltas d ON d.inventory_item_id=i.id
 WHERE public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry','ecommerce_manager']) GROUP BY i.id,d.location_id;
GRANT SELECT ON public.v_inventory_location_balances TO authenticated;
CREATE POLICY phase3_movement_operational_read ON public.inventory_movements FOR SELECT TO authenticated USING(
 public.has_any_role(auth.uid(),ARRAY['counter','stock_entry','ecommerce_manager']) OR
 (public.has_role(auth.uid(),'tailor') AND (
 EXISTS(SELECT 1 FROM public.customer_tailoring_jobs j WHERE j.id=customer_tailoring_job_id AND public.owns_tailor_assignment(j.tailor_assignment_id)) OR
 EXISTS(SELECT 1 FROM public.production_jobs j WHERE j.id=production_job_id AND public.owns_tailor_assignment(j.tailor_assignment_id)) )));
CREATE POLICY phase3_ecommerce_locations ON public.locations FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'ecommerce_manager'));

CREATE OR REPLACE FUNCTION public.thaan_available_mm(p_thaan uuid) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry','ecommerce_manager']) AND NOT(public.has_role(auth.uid(),'tailor') AND EXISTS(SELECT 1 FROM public.tailoring_job_lines l JOIN public.tailoring_jobs j ON j.id=l.job_id WHERE l.thaan_id=p_thaan AND j.tailor_id=auth.uid())) THEN RAISE EXCEPTION 'Active operational role or assigned material required'; END IF;
 SELECT id INTO v_id FROM public.inventory_items WHERE thaan_id=p_thaan;
 IF FOUND THEN RETURN public.inventory_balance(v_id,NULL)::integer; END IF;
 RETURN coalesce((SELECT sum(delta_mm) FROM public.stock_movements WHERE thaan_id=p_thaan),0)::integer;
END; $$;
CREATE OR REPLACE VIEW public.v_thaan_stock WITH(security_invoker=true) AS
 SELECT t.id thaan_id,public.thaan_available_mm(t.id) available_mm,
 coalesce((SELECT sum(h.length_mm) FROM public.holds h WHERE h.thaan_id=t.id AND h.status='active' AND h.expires_at>now()),0)::integer held_mm
 FROM public.thaans t;

CREATE FUNCTION public.inventory_catalog() RETURNS TABLE(item_kind text,item_id uuid,inventory_item_id uuid,label text,unit text,quantity numeric,unlinked_movements bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry','ecommerce_manager']) THEN RAISE EXCEPTION 'Active inventory role required'; END IF;
 RETURN QUERY
 SELECT 'fabric',t.id,i.id,coalesce(f.name,'Unlinked fabric')||' / '||coalesce(b.code,'Unlinked batch')||' / Than '||coalesce(t.barcode,t.id::text),'mm',
 CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL) ELSE coalesce((SELECT sum(m.delta_mm) FROM public.stock_movements m WHERE m.thaan_id=t.id),0) END,
 (SELECT count(*) FROM public.inventory_movements m WHERE m.thaan_id=t.id AND m.inventory_item_id IS NULL)
 FROM public.thaans t LEFT JOIN public.inventory_items i ON i.thaan_id=t.id LEFT JOIN public.fabrics f ON f.id=t.fabric_id LEFT JOIN public.receiving_batches b ON b.id=t.batch_id
 UNION ALL SELECT 'consumable',m.id,i.id,m.name,m.unit,CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL) ELSE m.qty_on_hand END,(SELECT count(*) FROM public.inventory_movements x WHERE x.material_id=m.id AND x.inventory_item_id IS NULL)
 FROM public.materials m LEFT JOIN public.inventory_items i ON i.material_id=m.id
 UNION ALL SELECT 'finished_product',p.id,i.id,pr.name||' / Piece '||p.piece_number::text,'pc',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL) ELSE CASE WHEN p.status='available' THEN 1 ELSE 0 END END,(SELECT count(*) FROM public.inventory_movements x WHERE x.finished_product_id=p.id AND x.inventory_item_id IS NULL)
 FROM public.finished_products p JOIN public.products pr ON pr.id=p.product_id LEFT JOIN public.inventory_items i ON i.finished_product_id=p.id;
END; $$;

CREATE FUNCTION public.inventory_locations() RETURNS TABLE(id uuid,code text,name text,kind text,parent_id uuid,active boolean)
LANGUAGE sql STABLE SET search_path=public AS $$ SELECT id,code,name,kind,parent_id,active FROM public.locations ORDER BY kind,name; $$;
CREATE FUNCTION public.inventory_location_balances() RETURNS TABLE(inventory_item_id uuid,location_id uuid,unit text,quantity numeric)
LANGUAGE sql STABLE SET search_path=public AS $$ SELECT inventory_item_id,location_id,unit,quantity FROM public.v_inventory_location_balances ORDER BY inventory_item_id,location_id; $$;
CREATE FUNCTION public.inventory_movement_history(p_limit integer DEFAULT 200)
RETURNS TABLE(id uuid,inventory_item_id uuid,kind text,quantity numeric,unit text,source_location_id uuid,destination_location_id uuid,reference text,reason text,actor_id uuid,occurred_at timestamptz,customer_tailoring_job_id uuid,production_job_id uuid,order_item_id uuid,stock_transfer_line_id uuid)
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT id,inventory_item_id,kind,quantity,unit,source_location_id,destination_location_id,reference,reason,actor_id,occurred_at,customer_tailoring_job_id,production_job_id,order_item_id,stock_transfer_line_id
 FROM public.inventory_movements ORDER BY occurred_at DESC,id DESC LIMIT greatest(1,least(coalesce(p_limit,200),500)); $$;
CREATE FUNCTION public.material_available_qty(p_material uuid) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry','ecommerce_manager']) AND NOT(public.has_role(auth.uid(),'tailor') AND (
 EXISTS(SELECT 1 FROM public.tailoring_job_lines l JOIN public.tailoring_jobs j ON j.id=l.job_id WHERE l.material_id=p_material AND j.tailor_id=auth.uid()) OR
 EXISTS(SELECT 1 FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id WHERE l.material_id=p_material AND public.owns_tailor_assignment(i.tailor_assignment_id)))) THEN RAISE EXCEPTION 'Active inventory role or assigned material required'; END IF;
 SELECT id INTO v_id FROM public.inventory_items WHERE material_id=p_material;
 IF FOUND THEN RETURN public.inventory_balance(v_id,NULL); END IF;
 RETURN (SELECT qty_on_hand FROM public.materials WHERE id=p_material);
END; $$;
DROP POLICY "read materials" ON public.materials;
CREATE POLICY "read materials" ON public.materials FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR (public.has_role(auth.uid(),'tailor') AND (
 EXISTS(SELECT 1 FROM public.tailoring_job_lines l JOIN public.tailoring_jobs j ON j.id=l.job_id WHERE l.material_id=materials.id AND j.tailor_id=auth.uid()) OR
 EXISTS(SELECT 1 FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id WHERE l.material_id=materials.id AND public.owns_tailor_assignment(i.tailor_assignment_id)))));

REVOKE ALL ON FUNCTION public.guard_location_operations(),public.guard_inventory_movement(),public.guard_legacy_inventory_authority(),public.guard_posted_transfer_history() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.manage_showroom_location(uuid,text,text,boolean),public.reconcile_inventory_item(text,uuid,jsonb,text),public.post_inventory_transfer(uuid,uuid,uuid,jsonb,text),public.record_inventory_correction(uuid,uuid,text,numeric,boolean,text),public.inventory_catalog() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_showroom_location(uuid,text,text,boolean),public.reconcile_inventory_item(text,uuid,jsonb,text),public.post_inventory_transfer(uuid,uuid,uuid,jsonb,text),public.record_inventory_correction(uuid,uuid,text,numeric,boolean,text),public.inventory_catalog() TO authenticated;
REVOKE ALL ON FUNCTION public.inventory_locations(),public.inventory_location_balances(),public.inventory_movement_history(integer),public.material_available_qty(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.inventory_locations(),public.inventory_location_balances(),public.inventory_movement_history(integer),public.material_available_qty(uuid) TO authenticated;
COMMIT;
