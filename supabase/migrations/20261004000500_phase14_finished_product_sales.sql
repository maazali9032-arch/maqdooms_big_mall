-- Phase 14 only: Counter scan/counts, atomic whole-piece sales and immutable history.
BEGIN;
CREATE TABLE public.finished_product_sale_snapshots(
 order_item_id uuid PRIMARY KEY REFERENCES public.order_items(id),
 price_version_id uuid NOT NULL REFERENCES public.finished_product_prices(id),
 cost_version_id uuid NOT NULL REFERENCES public.production_cost_versions(id),
 reviewed_cost_version_id uuid NOT NULL REFERENCES public.production_cost_versions(id),
 cost_evidence jsonb NOT NULL,
 item_snapshot jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phase14_sale_cost_idx ON public.finished_product_sale_snapshots(cost_version_id);
ALTER TABLE public.finished_product_sale_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finished_product_sale_snapshots FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.finished_product_sale_snapshots TO authenticated;
GRANT ALL ON public.finished_product_sale_snapshots TO service_role;
CREATE POLICY phase14_owner_read ON public.finished_product_sale_snapshots FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER phase14_snapshot_immutable BEFORE UPDATE OR DELETE ON public.finished_product_sale_snapshots FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
-- Exactly one debit for a given sale line is also enforced by Phase 6's posting
-- guard. This unique index applies only to new Finished Product order lines.
CREATE UNIQUE INDEX phase14_piece_sale_line_idx ON public.inventory_movements(order_item_id) WHERE kind='SALE' AND finished_product_id IS NOT NULL;

CREATE FUNCTION public.finished_product_sale_scan(p_barcode text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
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
 result:=result||jsonb_build_object('sp_version_id',price_id,'location_active',(SELECT active FROM public.locations WHERE id=piece.current_location_id),'identical_scope','production_job','identical_available',(SELECT coalesce(sum((value->>'quantity')::integer),0) FROM jsonb_array_elements(counts)),'locations',counts);
 IF public.has_role(auth.uid(),'owner') THEN
  result:=result||jsonb_build_object('production_cost',public.owner_production_costs(piece.production_job_id));
 END IF;
 RETURN result;
END; $$;

CREATE FUNCTION public.complete_finished_product_sale(p_request uuid,p_source uuid,p_items jsonb,p_customer uuid,p_payment_confirmed boolean,p_reference text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.orders%rowtype; payload_value jsonb; customer_value jsonb; result uuid:=gen_random_uuid(); row_value jsonb; piece public.finished_products%rowtype; price public.finished_product_prices%rowtype; inv uuid; line_id uuid; total numeric:=0; cost_id uuid; reviewed_id uuid; cost_amount bigint; evidence jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') THEN RAISE EXCEPTION 'Authorized Owner or Counter required'; END IF;
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
  IF price.id IS NULL OR price.id IS DISTINCT FROM (row_value->>'sp_version_id')::uuid OR price.sp_paise NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Current Owner SP changed or missing; refresh and review'; END IF;
  SELECT cost_version_id INTO reviewed_id FROM public.finished_product_price_reviews WHERE price_id=price.id;
  SELECT id INTO cost_id FROM public.production_cost_versions WHERE production_job_id=piece.production_job_id ORDER BY revision DESC LIMIT 1;
  SELECT amount_paise INTO cost_amount FROM public.finished_product_cost_allocations WHERE finished_product_id=piece.id AND cost_version_id=cost_id;
  IF reviewed_id IS NULL OR cost_amount IS NULL OR NOT EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=cost_id AND payload ? 'materials') THEN RAISE EXCEPTION 'Owner-reviewed price and finalized production cost required'; END IF;
  SELECT jsonb_build_object('quantity_snapshot',v.quantity_snapshot,'total_paise',(SELECT coalesce(sum(amount_paise),0) FROM public.production_cost_lines WHERE cost_version_id=v.id),'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.production_cost_lines l WHERE l.cost_version_id=v.id),'[]')) INTO evidence FROM public.production_cost_versions v WHERE v.id=cost_id;
  total:=total+price.sp_paise;
  IF total>9007199254740991 THEN RAISE EXCEPTION 'Total exceeds supported exact money range'; END IF;
  INSERT INTO public.order_items(order_id,finished_product_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) VALUES(result,piece.id,1,'pc',price.sp_paise,price.sp_paise) RETURNING id INTO line_id;
  INSERT INTO public.order_item_financials(order_item_id,production_cost_snapshot_paise) VALUES(line_id,cost_amount);
  INSERT INTO public.finished_product_sale_snapshots(order_item_id,price_version_id,cost_version_id,reviewed_cost_version_id,cost_evidence,item_snapshot) VALUES(line_id,price.id,cost_id,reviewed_id,evidence,(SELECT jsonb_build_object('barcode',b.code,'product',product.name,'design',design.name,'job_code',j.code,'piece_number',piece.piece_number,'source',loc.name,'actor',actor.full_name) FROM public.barcodes b JOIN public.products product ON product.id=piece.product_id JOIN public.designs design ON design.id=piece.design_id JOIN public.production_jobs j ON j.id=piece.production_job_id JOIN public.locations loc ON loc.id=p_source LEFT JOIN public.profiles actor ON actor.id=auth.uid() WHERE b.id=piece.barcode_id));
  INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference) VALUES(inv,'SALE',piece.id,1,'pc',p_source,line_id,auth.uid(),'Finished Product Sale','ORDER:'||result::text);
  UPDATE public.finished_products SET status='sold' WHERE id=piece.id;
 END LOOP;
 UPDATE public.orders SET status='completed',final_customer_price_paise=total::bigint,completed_at=now() WHERE id=result;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'complete_finished_product_sale','orders',result,jsonb_build_object('source',p_source,'total_paise',total,'items',p_items),'PRODUCT-SALE:'||p_request::text);
 RETURN result;
END; $$;

CREATE FUNCTION public.finished_product_order_history(p_order uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE owner boolean:=public.has_role(auth.uid(),'owner');
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Owner or Counter required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Limit must be 1–200'; END IF;
 RETURN coalesce((SELECT jsonb_agg(row_value ORDER BY created_at DESC,id) FROM (
 SELECT o.id,o.created_at,jsonb_build_object('id',o.id,'code',o.code,'customer_snapshot',o.customer_snapshot,'source_location_id',o.source_location_id,'source',coalesce((SELECT s.item_snapshot->>'source' FROM public.finished_product_sale_snapshots s JOIN public.order_items it ON it.id=s.order_item_id WHERE it.order_id=o.id LIMIT 1),loc.name),'final_customer_price_paise',o.final_customer_price_paise,'reference',o.reference,'created_by',o.created_by,'actor',coalesce((SELECT s.item_snapshot->>'actor' FROM public.finished_product_sale_snapshots s JOIN public.order_items it ON it.id=s.order_item_id WHERE it.order_id=o.id LIMIT 1),actor.full_name),'created_at',o.created_at,'completed_at',o.completed_at,'payment_confirmed_at',o.payment_confirmed_at,'additional_charges_paise',0,
 'items',(SELECT jsonb_agg(jsonb_build_object('id',it.id,'piece_id',p.id,'barcode',coalesce(snapshot.item_snapshot->>'barcode',b.code),'piece_number',p.piece_number,'product',coalesce(snapshot.item_snapshot->>'product',product.name),'design',coalesce(snapshot.item_snapshot->>'design',design.name),'job_code',coalesce(snapshot.item_snapshot->>'job_code',j.code),'quantity',it.quantity,'unit',it.unit,'sp_paise',it.sp_snapshot_paise,'final_customer_price_paise',it.final_customer_price_paise,'movement_id',m.id)
 ||CASE WHEN owner THEN jsonb_build_object('production_cost_paise',financial.production_cost_snapshot_paise,'price_version_id',snapshot.price_version_id,'cost_version_id',snapshot.cost_version_id,'reviewed_cost_version_id',snapshot.reviewed_cost_version_id,'cost_evidence',snapshot.cost_evidence) ELSE '{}'::jsonb END ORDER BY it.id)
 FROM public.order_items it JOIN public.finished_products p ON p.id=it.finished_product_id JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id JOIN public.designs design ON design.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id LEFT JOIN public.inventory_movements m ON m.order_item_id=it.id AND m.kind='SALE' LEFT JOIN public.order_item_financials financial ON financial.order_item_id=it.id LEFT JOIN public.finished_product_sale_snapshots snapshot ON snapshot.order_item_id=it.id WHERE it.order_id=o.id)) row_value
 FROM public.orders o JOIN public.locations loc ON loc.id=o.source_location_id LEFT JOIN public.profiles actor ON actor.id=o.created_by
 WHERE o.kind='finished_product_sale' AND o.status='completed' AND o.sale_request_id IS NOT NULL AND (p_order IS NULL OR o.id=p_order) ORDER BY o.created_at DESC,o.id DESC LIMIT p_limit
 ) x),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.finished_product_sale_scan(text),public.complete_finished_product_sale(uuid,uuid,jsonb,uuid,boolean,text),public.finished_product_order_history(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finished_product_sale_scan(text),public.complete_finished_product_sale(uuid,uuid,jsonb,uuid,boolean,text),public.finished_product_order_history(uuid,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
