-- Phase 6 only. Additive schema; no historical data or migration rewritten.
BEGIN;
ALTER TABLE public.orders ADD COLUMN sale_request_id uuid UNIQUE,
 ADD COLUMN sale_request_payload jsonb, ADD COLUMN customer_snapshot jsonb,
 ADD COLUMN completed_at timestamptz, ADD COLUMN payment_confirmed_at timestamptz;
CREATE INDEX phase6_sale_history_idx ON public.orders(created_at DESC,id) WHERE sale_request_id IS NOT NULL;
CREATE INDEX phase6_sale_movement_idx ON public.inventory_movements(order_item_id) WHERE kind='SALE';

CREATE POLICY phase6_counter_orders ON public.orders FOR SELECT TO authenticated
 USING(public.has_role(auth.uid(),'counter') AND kind='direct_fabric_sale' AND status='completed');
CREATE POLICY phase6_counter_order_items ON public.order_items FOR SELECT TO authenticated
 USING(public.has_role(auth.uid(),'counter') AND EXISTS(SELECT 1 FROM public.orders o
 WHERE o.id=order_id AND o.kind='direct_fabric_sale' AND o.status='completed'));

CREATE FUNCTION public.direct_fabric_sale_catalog(p_barcode text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Owner or Counter required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(x || jsonb_build_object(
 'sp_version_id',(SELECT id FROM public.fabric_stock_prices WHERE fabric_stock_id=(x->>'id')::uuid ORDER BY revision DESC LIMIT 1),
 'cuts',coalesce((SELECT jsonb_agg(jsonb_build_object('inventory_item_id',i.id,'thaan_id',t.id,
 'locations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'quantity_mm',public.inventory_balance(i.id,l.id)))
 FROM public.locations l WHERE l.active AND public.inventory_balance(i.id,l.id)>0),'[]'::jsonb)) ORDER BY t.id)
 FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id
 WHERE t.fabric_stock_id=(x->>'id')::uuid AND t.status='active'),'[]'::jsonb)))
 FROM jsonb_array_elements(public.fabric_stock_catalog(p_barcode)) x WHERE x->>'entry_state' IN ('complete','correcting','legacy_pending')),'[]'::jsonb);
END; $$;

-- Completed Phase 6 documents cannot be edited, extended or deleted.
CREATE FUNCTION public.guard_phase6_order_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order uuid; o public.orders%rowtype;
BEGIN
 IF TG_TABLE_NAME='orders' THEN
  IF OLD.sale_request_id IS NOT NULL AND OLD.status='completed' THEN RAISE EXCEPTION 'Completed sale history is permanent'; END IF;
 ELSE
  v_order:=CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  SELECT * INTO o FROM public.orders WHERE id=v_order;
  IF o.sale_request_id IS NOT NULL AND o.status='completed' THEN RAISE EXCEPTION 'Completed sale items are permanent'; END IF;
  IF TG_OP='UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id AND EXISTS(
   SELECT 1 FROM public.orders WHERE id=OLD.order_id AND sale_request_id IS NOT NULL AND status='completed')
  THEN RAISE EXCEPTION 'Completed sale items are permanent'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER phase6_order_history BEFORE UPDATE OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_phase6_order_history();
CREATE TRIGGER phase6_item_history BEFORE INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.guard_phase6_order_history();

CREATE FUNCTION public.guard_phase6_sale_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.kind='SALE' AND EXISTS(SELECT 1 FROM public.order_items it JOIN public.orders o ON o.id=it.order_id
 WHERE it.id=NEW.order_item_id AND o.sale_request_id IS NOT NULL) THEN
  -- Same authority lock as the ledger prevents a concurrent duplicate posting.
  PERFORM 1 FROM public.inventory_items WHERE id=NEW.inventory_item_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.inventory_movements WHERE kind='SALE' AND order_item_id=NEW.order_item_id)
   OR EXISTS(SELECT 1 FROM public.order_items it JOIN public.orders o ON o.id=it.order_id
   WHERE it.id=NEW.order_item_id AND o.status<>'draft') THEN RAISE EXCEPTION 'Sale item already posted or closed'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER phase6_sale_once BEFORE INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.guard_phase6_sale_movement();

-- Retain all Phase 4 identity safeguards; permit only Counter depletion after
-- a canonical sale has reduced global stock to zero. No additional Than edits.
CREATE OR REPLACE FUNCTION public.guard_phase4_fabric_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='fabric_stock' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Fabric Stock identity is permanent'; END IF;
  IF EXISTS(SELECT 1 FROM public.fabric_entry_requests WHERE fabric_stock_id=OLD.id)
  AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'Stock entry ownership is permanent'; END IF;
 ELSE
  IF TG_OP='INSERT' AND auth.uid() IS NOT NULL AND NEW.barcode IS NOT NULL THEN
   RAISE EXCEPTION 'New stock uses one Fabric + Batch barcode, not per-Than labels'; END IF;
  IF EXISTS(SELECT 1 FROM public.fabric_entry_requests WHERE fabric_stock_id=coalesce(NEW.fabric_stock_id,OLD.fabric_stock_id)) THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Internal Than history is permanent'; END IF;
   IF NEW.barcode IS NOT NULL OR NEW.price_paise IS NOT NULL THEN RAISE EXCEPTION 'Use one Fabric Barcode and Owner Fabric Stock SP'; END IF;
   IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'owner') AND NOT EXISTS(
    SELECT 1 FROM public.fabric_stock WHERE id=NEW.fabric_stock_id AND created_by=auth.uid() AND entry_state='draft') THEN
    IF NOT (TG_OP='UPDATE' AND public.has_role(auth.uid(),'counter') AND OLD.status='active' AND NEW.status='depleted'
     AND (to_jsonb(NEW)-'status'-'updated_at')=(to_jsonb(OLD)-'status'-'updated_at')
     AND EXISTS(SELECT 1 FROM public.inventory_items i WHERE i.thaan_id=NEW.id AND public.inventory_balance(i.id,NULL)=0))
    THEN RAISE EXCEPTION 'Owned open Fabric Stock draft required for internal Than edits'; END IF;
   END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;

CREATE FUNCTION public.complete_direct_fabric_sale(p_request_id uuid,p_source uuid,p_items jsonb,
 p_customer uuid,p_payment_confirmed boolean,p_reference text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%rowtype; payload jsonb; r jsonb; t public.thaans%rowtype;
 v_order uuid:=gen_random_uuid(); v_item uuid; v_sp public.fabric_stock_prices%rowtype;
 v_cp bigint; v_qty numeric; v_amount bigint; v_total bigint:=0; v_customer jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell')
 THEN RAISE EXCEPTION 'Authorized Owner or Counter required'; END IF;
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
END; $$;

CREATE FUNCTION public.direct_fabric_order_history(p_order uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Owner or Counter required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id) FROM(
 SELECT o.id,o.code,o.customer_snapshot,o.source_location_id,l.name source_name,o.final_customer_price_paise,
 o.reference,o.created_by,o.created_at,o.completed_at,o.payment_confirmed_at,
 (SELECT jsonb_agg(jsonb_build_object('id',it.id,'fabric_stock_id',it.fabric_stock_id,'thaan_id',it.thaan_id,
 'fabric_name',f.name,'batch_code',b.code,'barcode',bc.code,'quantity_mm',it.quantity,
 'sp_paise_per_m',it.sp_snapshot_paise,'final_customer_price_paise',it.final_customer_price_paise,
 'movement_id',m.id) ORDER BY it.id) FROM public.order_items it
 JOIN public.fabric_stock s ON s.id=it.fabric_stock_id JOIN public.fabrics f ON f.id=s.fabric_id
 JOIN public.receiving_batches b ON b.id=s.batch_id JOIN public.barcodes bc ON bc.id=s.barcode_id
 LEFT JOIN public.inventory_movements m ON m.order_item_id=it.id AND m.kind='SALE' WHERE it.order_id=o.id) items
 FROM public.orders o JOIN public.locations l ON l.id=o.source_location_id
 WHERE o.kind='direct_fabric_sale' AND o.status='completed' AND o.sale_request_id IS NOT NULL AND (p_order IS NULL OR o.id=p_order)
 ORDER BY o.created_at DESC,o.id LIMIT greatest(1,least(coalesce(p_limit,50),200))) x),'[]'::jsonb);
END; $$;
CREATE FUNCTION public.owner_direct_fabric_order_costs(p_order uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required for CP history'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('order_item_id',it.id,'cp_paise_per_m',fi.cp_snapshot_paise))
 FROM public.order_items it JOIN public.order_item_financials fi ON fi.order_item_id=it.id
 JOIN public.orders o ON o.id=it.order_id WHERE o.id=p_order AND o.sale_request_id IS NOT NULL AND o.status='completed'),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.guard_phase6_order_history(),public.guard_phase6_sale_movement() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.direct_fabric_sale_catalog(text),public.complete_direct_fabric_sale(uuid,uuid,jsonb,uuid,boolean,text),
 public.direct_fabric_order_history(uuid,integer),public.owner_direct_fabric_order_costs(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.direct_fabric_sale_catalog(text),public.complete_direct_fabric_sale(uuid,uuid,jsonb,uuid,boolean,text),
 public.direct_fabric_order_history(uuid,integer),public.owner_direct_fabric_order_costs(uuid) TO authenticated;
COMMIT;
