-- Owner-approved immediate Workshop floor transfer and transaction-time fabric SP.
-- Additive APIs and permission defaults only; no stock/history/backfill changes.
BEGIN;
INSERT INTO public.permissions(key,label,domain) VALUES
 ('stock.transfer','Transfer Workshop fabric to Showroom floors','inventory'),
 ('stock.print_barcode','Print stock barcode labels','inventory'),
 ('inventory.fill_missing_cp','Fill missing CP on own registered Than','inventory'),
 ('pos.enter_price','Enter fabric sale price per metre','pos') ON CONFLICT(key) DO NOTHING;
INSERT INTO public.role_permissions(role_key,permission_key) VALUES
 ('stock_entry','stock.transfer'),('stock_entry','stock.print_barcode'),
 ('stock_entry','inventory.fill_missing_cp'),('counter','pos.enter_price') ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.post_inventory_transfer(p_request_id uuid,p_source uuid,p_destination uuid,p_items jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_existing public.stock_transfers%rowtype; v_payload jsonb; r jsonb; i public.inventory_items%rowtype; v_line uuid; v_q numeric; v_stock uuid; v_location uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) OR NOT public.has_perm(auth.uid(),'stock.transfer') THEN RAISE EXCEPTION 'Authorized stock transfer required'; END IF;
 IF NOT public.has_role(auth.uid(),'owner') AND (
 NOT EXISTS(SELECT 1 FROM public.locations WHERE id=p_source AND active AND kind='workshop') OR
 NOT EXISTS(SELECT 1 FROM public.locations WHERE id=p_destination AND active AND kind='showroom_sublocation') OR
 jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x LEFT JOIN public.inventory_items authority ON authority.id=(x->>'inventory_item_id')::uuid LEFT JOIN public.thaans t ON t.id=authority.thaan_id WHERE authority.id IS NULL OR authority.unit<>'mm' OR t.status<>'active')) THEN RAISE EXCEPTION 'Workshop fabric to active Showroom floor required'; END IF;
 IF p_request_id IS NULL OR p_source IS NULL OR p_destination IS NULL OR p_source=p_destination OR p_reason IS NULL OR btrim(p_reason)='' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Distinct locations, items, request ID and reason required'; END IF;
 v_payload:=jsonb_build_object('source',p_source,'destination',p_destination,'items',p_items,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,3));
 SELECT * INTO v_existing FROM public.stock_transfers WHERE request_id=p_request_id;
 IF FOUND THEN
  IF v_existing.request_payload IS DISTINCT FROM v_payload OR v_existing.status<>'posted' OR (v_existing.created_by IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'Transfer request ID already used with different data'; END IF;
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
CREATE FUNCTION public.complete_counter_fabric_sale(p_request_id uuid,p_source uuid,p_items jsonb,
 p_customer uuid,p_payment_confirmed boolean,p_reference text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%rowtype; payload jsonb; r jsonb; t public.thaans%rowtype;
 v_order uuid:=gen_random_uuid(); v_item uuid; v_sp bigint;
 v_cp bigint; v_qty numeric; v_amount bigint; v_total bigint:=0; v_customer jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') OR NOT public.has_perm(auth.uid(),'pos.enter_price')
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
END; $$;
CREATE FUNCTION public.owner_set_user_permission(p_user uuid,p_permission text,p_granted boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user) OR NOT EXISTS(SELECT 1 FROM public.permissions WHERE key=p_permission) THEN RAISE EXCEPTION 'Existing user and permission required'; END IF;
 IF p_granted IS NULL THEN DELETE FROM public.user_permission_overrides WHERE user_id=p_user AND permission_key=p_permission;
 ELSE INSERT INTO public.user_permission_overrides(user_id,permission_key,granted) VALUES(p_user,p_permission,p_granted) ON CONFLICT(user_id,permission_key) DO UPDATE SET granted=excluded.granted; END IF;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value) VALUES(auth.uid(),'set_user_permission','profiles',p_user,jsonb_build_object('permission',p_permission,'granted',p_granted));
END; $$;
ALTER FUNCTION public.fill_registered_thaan_cp(uuid,text,bigint) RENAME TO registration_fill_cp_internal;
REVOKE ALL ON FUNCTION public.registration_fill_cp_internal(uuid,text,bigint) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.fill_registered_thaan_cp(p_request uuid,p_barcode text,p_cp bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_perm(auth.uid(),'inventory.fill_missing_cp') THEN RAISE EXCEPTION 'Missing CP entry permission required'; END IF;
 RETURN public.registration_fill_cp_internal(p_request,p_barcode,p_cp);
END; $$;
REVOKE ALL ON FUNCTION public.owner_set_user_permission(uuid,text,boolean),public.complete_counter_fabric_sale(uuid,uuid,jsonb,uuid,boolean,text),public.fill_registered_thaan_cp(uuid,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_set_user_permission(uuid,text,boolean),public.complete_counter_fabric_sale(uuid,uuid,jsonb,uuid,boolean,text),public.fill_registered_thaan_cp(uuid,text,bigint) TO authenticated;
CREATE OR REPLACE FUNCTION public.stock_transfer_history(p_stock uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) OR NOT public.has_perm(auth.uid(),'stock.transfer') THEN RAISE EXCEPTION 'Transfer permission required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.posted_at DESC,x.id DESC) FROM (
 SELECT t.id,t.code,t.status,t.request_id,t.source_location_id,s.name source_name,
 t.destination_location_id,d.name destination_name,t.reason,t.created_by,t.created_at,t.posted_at,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'fabric_stock_id',l.fabric_stock_id,
 'thaan_id',l.thaan_id,'material_id',l.material_id,'finished_product_id',l.finished_product_id,
 'quantity',l.quantity,'unit',l.unit,'barcode',bc.code,'fabric_name',f.name,'batch_code',b.code,
 'movement_id',m.id,'actor_id',m.actor_id,'occurred_at',m.occurred_at) ORDER BY l.id)
 FROM public.stock_transfer_lines l
 LEFT JOIN public.fabric_stock fs ON fs.id=l.fabric_stock_id
 LEFT JOIN public.barcodes bc ON bc.id=fs.barcode_id
 LEFT JOIN public.fabrics f ON f.id=fs.fabric_id
 LEFT JOIN public.receiving_batches b ON b.id=fs.batch_id
 LEFT JOIN public.inventory_movements m ON m.stock_transfer_line_id=l.id
 WHERE l.transfer_id=t.id),'[]'::jsonb) lines
 FROM public.stock_transfers t JOIN public.locations s ON s.id=t.source_location_id
 JOIN public.locations d ON d.id=t.destination_location_id
 WHERE t.status='posted' AND (public.has_role(auth.uid(),'owner') OR t.created_by=auth.uid()) AND (p_stock IS NULL OR EXISTS(
 SELECT 1 FROM public.stock_transfer_lines l WHERE l.transfer_id=t.id AND l.fabric_stock_id=p_stock))
 ORDER BY t.posted_at DESC,t.id DESC LIMIT greatest(1,least(coalesce(p_limit,50),200))) x),'[]'::jsonb);
END; $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
