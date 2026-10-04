-- Phase 13 only: whole-piece location inventory, checked transfers and movement history.
BEGIN;
CREATE TABLE public.finished_product_transfer_requests(
 request_id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES public.profiles(id),
 transfer_id uuid NOT NULL UNIQUE REFERENCES public.stock_transfers(id),
 payload jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phase13_transfer_actor_time_idx ON public.finished_product_transfer_requests(actor_id,recorded_at);
CREATE INDEX phase13_piece_movement_time_idx ON public.inventory_movements(finished_product_id,occurred_at DESC,id) WHERE finished_product_id IS NOT NULL;
ALTER TABLE public.finished_product_transfer_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finished_product_transfer_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.finished_product_transfer_requests TO authenticated;
GRANT ALL ON public.finished_product_transfer_requests TO service_role;
CREATE POLICY phase13_owner_read ON public.finished_product_transfer_requests FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER phase13_request_immutable BEFORE UPDATE OR DELETE ON public.finished_product_transfer_requests FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

-- Transfers follow adjacent steps of the location hierarchy. Reverse steps support
-- explicit Owner returns; a sublocation change passes through its Showroom.
-- This guard also covers the existing generic transfer RPC, without altering it.
CREATE FUNCTION public.guard_finished_product_transfer_path() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE source public.locations%rowtype; destination public.locations%rowtype; piece public.finished_products%rowtype;
BEGIN
 IF NEW.kind<>'TRANSFER' OR NEW.finished_product_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO source FROM public.locations WHERE id=NEW.source_location_id;
 SELECT * INTO destination FROM public.locations WHERE id=NEW.destination_location_id;
 IF NOT source.active OR NOT destination.active OR NOT (
  (source.kind='workshop' AND destination.kind='showroom') OR
  (source.kind='showroom' AND destination.kind='workshop') OR
  (source.kind='showroom' AND destination.kind='showroom_sublocation' AND destination.parent_id=source.id) OR
  (source.kind='showroom_sublocation' AND destination.kind='showroom' AND source.parent_id=destination.id)
 ) THEN RAISE EXCEPTION 'Finished Product transfer must follow Workshop / Showroom / its Sublocation hierarchy'; END IF;
 SELECT * INTO piece FROM public.finished_products WHERE id=NEW.finished_product_id;
 IF piece.id IS NULL OR piece.status<>'available' OR piece.current_location_id IS DISTINCT FROM NEW.source_location_id OR NEW.quantity<>1 OR NEW.unit<>'pc' THEN RAISE EXCEPTION 'Available whole Finished Product at the selected source required'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER phase13_finished_transfer_path BEFORE INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.guard_finished_product_transfer_path();

CREATE FUNCTION public.transfer_finished_products(p_request uuid,p_source uuid,p_destination uuid,p_pieces jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.finished_product_transfer_requests%rowtype; payload_value jsonb; items jsonb; result uuid;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_request IS NULL OR p_source IS NULL OR p_destination IS NULL OR p_source=p_destination OR nullif(btrim(p_reason),'') IS NULL OR jsonb_typeof(p_pieces) IS DISTINCT FROM 'array' OR jsonb_array_length(p_pieces) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Request, distinct locations, 1–200 explicit pieces and reason required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_pieces) v WHERE jsonb_typeof(v)<>'string') OR (SELECT count(DISTINCT value::uuid) FROM jsonb_array_elements_text(p_pieces))<>jsonb_array_length(p_pieces) THEN RAISE EXCEPTION 'Distinct Finished Product IDs required'; END IF;
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

-- Owner operational inventory only; no CP, SP or internal cost joins. Keyset
-- pagination retains access to every piece as the catalogue grows.
CREATE FUNCTION public.finished_product_inventory(p_after uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Limit must be 1–200'; END IF;
 SELECT coalesce(jsonb_agg(row_value ORDER BY id),'[]') INTO result FROM (
 SELECT p.id,jsonb_build_object('id',p.id,'barcode',b.code,'piece_number',p.piece_number,'product',product.name,'design',design.name,'job_id',j.id,'job_code',j.code,'status',p.status,'location_id',p.current_location_id,'location',location.name,'location_kind',location.kind,'location_active',location.active,'inventory_item_id',i.id,'quantity',coalesce(balance.quantity,0),'available',p.status='available' AND coalesce(balance.quantity,0)=1,'created_at',p.created_at) row_value
 FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id JOIN public.designs design ON design.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id JOIN public.locations location ON location.id=p.current_location_id LEFT JOIN public.inventory_items i ON i.finished_product_id=p.id LEFT JOIN public.v_inventory_location_balances balance ON balance.inventory_item_id=i.id AND balance.location_id=p.current_location_id
 WHERE p_after IS NULL OR p.id>p_after ORDER BY p.id LIMIT p_limit
 ) rows;
 RETURN result;
END; $$;

CREATE FUNCTION public.finished_product_movement_history(p_piece uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Limit must be 1–200'; END IF;
 SELECT coalesce(jsonb_agg(row_value ORDER BY occurred_at DESC,id DESC),'[]') INTO result FROM (
 SELECT m.id,m.occurred_at,jsonb_build_object('id',m.id,'piece_id',p.id,'barcode',b.code,'piece_number',p.piece_number,'product',product.name,'design',design.name,'job_code',j.code,'kind',m.kind,'quantity',m.quantity,'unit',m.unit,'source',source.name,'destination',destination.name,'actor_id',m.actor_id,'actor',actor.full_name,'occurred_at',m.occurred_at,'reason',m.reason,'reference',m.reference,'transfer_id',transfer.id,'transfer_code',transfer.code,'transfer_line_id',m.stock_transfer_line_id,'request_id',transfer.request_id) row_value
 FROM public.inventory_movements m JOIN public.finished_products p ON p.id=m.finished_product_id JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id JOIN public.designs design ON design.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id LEFT JOIN public.locations source ON source.id=m.source_location_id LEFT JOIN public.locations destination ON destination.id=m.destination_location_id LEFT JOIN public.profiles actor ON actor.id=m.actor_id LEFT JOIN public.stock_transfer_lines line ON line.id=m.stock_transfer_line_id LEFT JOIN public.stock_transfers transfer ON transfer.id=line.transfer_id
 WHERE p_piece IS NULL OR p.id=p_piece ORDER BY m.occurred_at DESC,m.id DESC LIMIT p_limit
 ) rows;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.guard_finished_product_transfer_path() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.transfer_finished_products(uuid,uuid,uuid,jsonb,text),public.finished_product_inventory(uuid,integer),public.finished_product_movement_history(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transfer_finished_products(uuid,uuid,uuid,jsonb,text),public.finished_product_inventory(uuid,integer),public.finished_product_movement_history(uuid,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
