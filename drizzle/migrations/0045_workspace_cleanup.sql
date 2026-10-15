BEGIN;
CREATE OR REPLACE FUNCTION public.post_inventory_transfer(p_request_id uuid,p_source uuid,p_destination uuid,p_items jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_existing public.stock_transfers%rowtype; v_payload jsonb; r jsonb; i public.inventory_items%rowtype; v_line uuid; v_q numeric; v_stock uuid; v_location uuid;
BEGIN
 p_reason:=coalesce(nullif(btrim(p_reason),''),'Stock transfer (no optional note recorded)');
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) OR NOT (public.has_perm(auth.uid(),'stock.transfer') OR public.has_perm(auth.uid(),'stock.transfer_finished')) THEN RAISE EXCEPTION 'Authorized stock transfer required'; END IF;
 IF NOT public.has_role(auth.uid(),'owner') AND (
 NOT EXISTS(SELECT 1 FROM public.locations WHERE id=p_source AND active AND kind='workshop') OR
 NOT EXISTS(SELECT 1 FROM public.locations WHERE id=p_destination AND active AND kind='showroom_sublocation') OR
 jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x LEFT JOIN public.inventory_items authority ON authority.id=(x->>'inventory_item_id')::uuid LEFT JOIN public.thaans t ON t.id=authority.thaan_id WHERE authority.id IS NULL OR NOT ((authority.unit='mm' AND t.status='active' AND public.has_perm(auth.uid(),'stock.transfer')) OR (authority.unit='pc' AND authority.finished_product_id IS NOT NULL AND public.has_perm(auth.uid(),'stock.transfer_finished'))))) THEN RAISE EXCEPTION 'Workshop fabric to active Showroom floor required'; END IF;
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
CREATE OR REPLACE FUNCTION public.transfer_finished_products(p_request uuid,p_source uuid,p_destination uuid,p_pieces jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.finished_product_transfer_requests%rowtype; payload_value jsonb; items jsonb; result uuid;
BEGIN
 p_reason:=coalesce(nullif(btrim(p_reason),''),'Stock transfer (no optional note recorded)');
 IF NOT (public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'stock.transfer_finished'))) THEN RAISE EXCEPTION 'Authorized finished-product transfer staff required'; END IF;
 IF p_request IS NULL OR p_source IS NULL OR p_destination IS NULL OR p_source=p_destination OR nullif(btrim(p_reason),'') IS NULL OR jsonb_typeof(p_pieces) IS DISTINCT FROM 'array' OR jsonb_array_length(p_pieces) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Request, distinct locations, 1–200 explicit pieces and reason required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_pieces) v WHERE jsonb_typeof(v)<>'string') OR (SELECT count(DISTINCT value::uuid) FROM jsonb_array_elements_text(p_pieces))<>jsonb_array_length(p_pieces) THEN RAISE EXCEPTION 'Distinct Finished Product IDs required'; END IF;
 IF NOT public.has_role(auth.uid(),'owner') AND (NOT EXISTS(SELECT 1 FROM public.locations WHERE id=p_source AND active AND kind='workshop') OR NOT EXISTS(SELECT 1 FROM public.locations floor JOIN public.locations parent ON parent.id=floor.parent_id AND parent.active AND parent.kind='showroom' WHERE floor.id=p_destination AND floor.active AND floor.kind='showroom_sublocation')) THEN RAISE EXCEPTION 'Workshop to active Showroom floor required'; END IF;
 SELECT jsonb_build_object('actor',auth.uid(),'source',p_source,'destination',p_destination,'pieces',jsonb_agg(value::uuid ORDER BY value::uuid),'reason',btrim(p_reason)) INTO payload_value FROM jsonb_array_elements_text(p_pieces);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,3));
 SELECT * INTO saved FROM public.finished_product_transfer_requests WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Finished Product transfer request already used with different data'; END IF; RETURN saved.transfer_id; END IF;
 IF EXISTS(SELECT 1 FROM public.stock_transfers WHERE request_id=p_request) THEN RAISE EXCEPTION 'Request already used by another transfer'; END IF;
 -- Same stable item lock order as the existing posting function; balances are
 -- checked under these locks and again by the canonical movement guard.
 PERFORM 1 FROM public.inventory_items WHERE finished_product_id IN(SELECT value::uuid FROM jsonb_array_elements_text(p_pieces)) ORDER BY id FOR UPDATE;
 SELECT jsonb_agg(jsonb_build_object('inventory_item_id',i.id,'quantity',1) ORDER BY i.id) INTO items FROM public.inventory_items i JOIN public.finished_products p ON p.id=i.finished_product_id WHERE p.id IN(SELECT value::uuid FROM jsonb_array_elements_text(p_pieces)) AND p.status='available' AND p.current_location_id=p_source AND i.unit='pc';
 IF coalesce(jsonb_array_length(items),0)<>jsonb_array_length(p_pieces) THEN RAISE EXCEPTION 'Every selected piece must be available at the selected source'; END IF;
 result:=public.post_inventory_transfer(p_request,p_source,p_destination,items,btrim(p_reason));
 INSERT INTO public.finished_product_transfer_requests(request_id,actor_id,transfer_id,payload) VALUES(p_request,auth.uid(),result,payload_value);
 RETURN result;
END; $$;
-- Read the current ledger; historical data and old movement views stay intact.
CREATE FUNCTION public.stock_activity(p_limit integer DEFAULT 100,p_after timestamptz DEFAULT NULL,p_after_id uuid DEFAULT NULL,p_search text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) THEN RAISE EXCEPTION 'Stock workflow role required'; END IF;
 IF (p_after IS NULL)<>(p_after_id IS NULL) OR p_limit NOT BETWEEN 1 AND 200 OR p_limit IS NULL THEN RAISE EXCEPTION 'Valid stock history cursor and limit required'; END IF;
 SELECT coalesce(jsonb_agg(row_value ORDER BY occurred_at DESC,id DESC),'[]') INTO result FROM(
 SELECT m.id,m.occurred_at,jsonb_build_object('id',m.id,'occurred_at',m.occurred_at,'kind',m.kind,'quantity',m.quantity::text,'unit',m.unit,
 'barcode',coalesce(v.code,t.barcode,b.code,pb.code),'item',coalesce(f.name,product.name,material.name),
 'source',source.name,'destination',destination.name,'reference',m.reference,'note',m.reason,'actor_id',m.actor_id,'actor',actor.full_name) row_value
 FROM public.inventory_movements m LEFT JOIN public.thaans t ON t.id=m.thaan_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id
 LEFT JOIN public.fabric_stock fs ON fs.id=m.fabric_stock_id LEFT JOIN public.barcodes b ON b.id=fs.barcode_id LEFT JOIN public.fabrics f ON f.id=t.fabric_id
 LEFT JOIN public.finished_products p ON p.id=m.finished_product_id LEFT JOIN public.products product ON product.id=p.product_id LEFT JOIN public.barcodes pb ON pb.id=p.barcode_id
 LEFT JOIN public.materials material ON material.id=m.material_id LEFT JOIN public.locations source ON source.id=m.source_location_id LEFT JOIN public.locations destination ON destination.id=m.destination_location_id LEFT JOIN public.profiles actor ON actor.id=m.actor_id
 WHERE (p_after IS NULL OR (m.occurred_at,m.id)<(p_after,p_after_id)) AND (nullif(btrim(p_search),'') IS NULL OR concat_ws(' ',v.code,t.barcode,b.code,pb.code,f.name,product.name,material.name,m.reference,source.name,destination.name) ILIKE '%'||btrim(p_search)||'%')
 ORDER BY m.occurred_at DESC,m.id DESC LIMIT p_limit) rows;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.stock_activity(integer,timestamptz,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stock_activity(integer,timestamptz,uuid,text) TO authenticated;

CREATE FUNCTION public.fabric_inventory_archive() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) THEN RAISE EXCEPTION 'Stock workflow role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'barcode',coalesce(v.code,t.barcode,bc.code),'batch',batch.code,'fabric',coalesce(g.name,f.name),'name',f.name,'colour',f.colour,'recorded_mm',t.original_mm,'status',t.status,'cp_paise_per_m',CASE WHEN public.can_view_thaan_cp(NULL) THEN (SELECT cp_paise_per_m FROM public.fabric_stock_costs WHERE fabric_stock_id=fs.id ORDER BY revision DESC LIMIT 1) END) ORDER BY batch.created_at DESC,batch.id,g.name,v.ordinal,t.id)
 FROM public.thaans t LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id
 LEFT JOIN public.fabric_stock fs ON fs.id=t.fabric_stock_id LEFT JOIN public.receiving_batches batch ON batch.id=coalesce(fs.batch_id,t.batch_id) LEFT JOIN public.barcodes bc ON bc.id=fs.barcode_id LEFT JOIN public.fabrics f ON f.id=t.fabric_id
 WHERE t.status IN('depleted','archived')),'[]');
END; $$;
REVOKE ALL ON FUNCTION public.fabric_inventory_archive() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fabric_inventory_archive() TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
