-- Trusted server ingress: the future storefront verifies settled payment before calling.
ALTER TABLE public.orders DROP CONSTRAINT orders_kind_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_kind_check CHECK(kind IN('direct_fabric_sale','customer_tailoring','finished_product_sale','ecommerce_sale'));
CREATE TABLE public.ecommerce_paid_receipts (
 request_id uuid PRIMARY KEY, order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) DEFERRABLE INITIALLY DEFERRED,
 external_order text NOT NULL UNIQUE CHECK(btrim(external_order)<>''), payment_reference text NOT NULL UNIQUE CHECK(btrim(payment_reference)<>''),
 paid_at timestamptz NOT NULL, paid_total_paise bigint NOT NULL CHECK(paid_total_paise BETWEEN 1 AND 9007199254740991),
 recorded_by uuid NOT NULL REFERENCES public.profiles(id), payload jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.ecommerce_sale_sources (
 order_item_id uuid PRIMARY KEY REFERENCES public.order_items(id), source_location_id uuid NOT NULL REFERENCES public.locations(id)
);
ALTER TABLE public.ecommerce_paid_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecommerce_sale_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ecommerce_paid_receipts,public.ecommerce_sale_sources FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ecommerce_paid_receipts,public.ecommerce_sale_sources TO authenticated;
GRANT ALL ON public.ecommerce_paid_receipts,public.ecommerce_sale_sources TO service_role;
CREATE POLICY owner_paid_receipts ON public.ecommerce_paid_receipts FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE POLICY owner_paid_sources ON public.ecommerce_sale_sources FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER ecommerce_receipts_immutable BEFORE UPDATE OR DELETE ON public.ecommerce_paid_receipts FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER ecommerce_sources_immutable BEFORE UPDATE OR DELETE ON public.ecommerce_sale_sources FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE FUNCTION public.guard_ecommerce_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.kind='ecommerce_sale' AND NOT EXISTS(SELECT 1 FROM public.ecommerce_paid_receipts WHERE order_id=NEW.id AND request_id=NEW.sale_request_id AND recorded_by=NEW.created_by AND paid_at=NEW.payment_confirmed_at) THEN RAISE EXCEPTION 'Trusted paid receipt required for online sale'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ecommerce_paid_order_guard BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_ecommerce_order();
REVOKE ALL ON FUNCTION public.guard_ecommerce_order() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.submit_paid_ecommerce_order(p_request uuid,p_external_order text,p_payment_reference text,p_paid_at timestamptz,p_paid_total_paise bigint,p_recorded_by uuid,p_items jsonb,p_customer uuid DEFAULT NULL,p_salesperson uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid:=gen_random_uuid(); saved public.ecommerce_paid_receipts%rowtype; payload_value jsonb; r jsonb; source_id uuid;
 customer_value jsonb; th public.thaans%rowtype; piece public.finished_products%rowtype; price public.finished_product_prices%rowtype;
 inv uuid; item_id uuid; qty numeric; sp bigint; cp bigint; amount bigint; total numeric:=0;
 cost_id uuid; reviewed_id uuid; evidence jsonb; cost_amount bigint;
BEGIN
 -- Service-role grant is the authorization boundary. Reject end-user sessions,
 -- even if a trusted server accidentally attaches one to its admin client.
 IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Use an isolated server service client'; END IF;
 IF p_request IS NULL OR nullif(btrim(p_external_order),'') IS NULL OR nullif(btrim(p_payment_reference),'') IS NULL OR length(p_external_order)>200 OR length(p_payment_reference)>200 OR p_paid_at IS NULL OR p_paid_at>clock_timestamp()+interval '5 minutes' OR p_paid_total_paise NOT BETWEEN 1 AND 9007199254740991 OR p_paid_total_paise IS NULL THEN RAISE EXCEPTION 'Verified paid order, reference, timestamp and exact positive total required'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Supply 1 to 100 explicit Showroom items'; END IF;
 payload_value:=jsonb_build_object('external_order',btrim(p_external_order),'payment_reference',btrim(p_payment_reference),'paid_at',p_paid_at,'paid_total_paise',p_paid_total_paise,'recorded_by',p_recorded_by,'items',p_items,'customer',p_customer,'salesperson',p_salesperson);
 -- Serialize request IDs and provider references across webhook retries.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,6));
 PERFORM pg_advisory_xact_lock(hashtextextended(btrim(p_external_order),42));
 PERFORM pg_advisory_xact_lock(hashtextextended(btrim(p_payment_reference),43));
 SELECT * INTO saved FROM public.ecommerce_paid_receipts WHERE request_id=p_request OR external_order=btrim(p_external_order) OR payment_reference=btrim(p_payment_reference);
 IF FOUND THEN
  IF saved.payload IS DISTINCT FROM payload_value OR NOT EXISTS(SELECT 1 FROM public.orders WHERE id=saved.order_id AND status='completed') THEN RAISE EXCEPTION 'Online order or payment reference reused with different data'; END IF;
  RETURN saved.order_id;
 END IF;
 IF EXISTS(SELECT 1 FROM public.orders WHERE sale_request_id=p_request) THEN RAISE EXCEPTION 'Request already used by another sale'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_recorded_by AND active FOR SHARE;
 IF NOT FOUND OR NOT public.has_any_role(p_recorded_by,ARRAY['owner','ecommerce_manager']) THEN RAISE EXCEPTION 'Active configured Owner or E-commerce integration account required'; END IF;
 IF p_salesperson IS NOT NULL THEN
  PERFORM 1 FROM public.profiles WHERE id=p_salesperson AND active FOR SHARE;
  IF NOT FOUND OR NOT public.has_role(p_salesperson,'salesperson') THEN RAISE EXCEPTION 'Active credited Salesperson required'; END IF;
  PERFORM 1 FROM public.user_roles WHERE user_id=p_salesperson AND role_key='salesperson' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Salesperson role required'; END IF;
 END IF;
 IF p_customer IS NULL THEN customer_value:=jsonb_build_object('name','Online self-service customer');
 ELSE SELECT jsonb_build_object('id',id,'name',name,'phone',phone) INTO customer_value FROM public.customers WHERE id=p_customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'Existing customer required'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) WHERE jsonb_typeof(value) IS DISTINCT FROM 'object' OR nullif(value->>'source_id','') IS NULL OR
  (value->>'kind'='fabric' AND (value-ARRAY['kind','source_id','inventory_item_id','quantity_mm','sp_paise_per_m'])<>'{}') OR
  (value->>'kind'='product' AND (value-ARRAY['kind','source_id','piece_id','sp_version_id'])<>'{}') OR coalesce(value->>'kind','') NOT IN('fabric','product')) THEN RAISE EXCEPTION 'Explicit fabric cut or saved-price physical piece required'; END IF;
 IF (SELECT count(DISTINCT (value->>'inventory_item_id',value->>'source_id')) FROM jsonb_array_elements(p_items) WHERE value->>'kind'='fabric')<>(SELECT count(*) FROM jsonb_array_elements(p_items) WHERE value->>'kind'='fabric') OR
  (SELECT count(DISTINCT value->>'piece_id') FROM jsonb_array_elements(p_items) WHERE value->>'kind'='product')<>(SELECT count(*) FROM jsonb_array_elements(p_items) WHERE value->>'kind'='product') THEN RAISE EXCEPTION 'Duplicate cart lines are not accepted'; END IF;
 -- Keep the same parent → item → location → physical piece lock order as POS.
 PERFORM 1 FROM public.fabric_stock WHERE id IN(SELECT t.fabric_stock_id FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id JOIN jsonb_array_elements(p_items) x ON i.id=(x->>'inventory_item_id')::uuid) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.production_jobs WHERE id IN(SELECT p.production_job_id FROM public.finished_products p JOIN jsonb_array_elements(p_items) x ON p.id=(x->>'piece_id')::uuid) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items i WHERE i.id IN(SELECT (value->>'inventory_item_id')::uuid FROM jsonb_array_elements(p_items)) OR i.finished_product_id IN(SELECT (value->>'piece_id')::uuid FROM jsonb_array_elements(p_items)) ORDER BY i.id FOR UPDATE;
 PERFORM 1 FROM public.locations WHERE id IN(SELECT (value->>'source_id')::uuid FROM jsonb_array_elements(p_items)) OR id IN(SELECT parent_id FROM public.locations WHERE id IN(SELECT (value->>'source_id')::uuid FROM jsonb_array_elements(p_items))) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=(x->>'source_id')::uuid AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom')))) THEN RAISE EXCEPTION 'Online sales require active Showroom floors only'; END IF;
 INSERT INTO public.ecommerce_paid_receipts(request_id,order_id,external_order,payment_reference,paid_at,paid_total_paise,recorded_by,payload) VALUES(p_request,result,btrim(p_external_order),btrim(p_payment_reference),p_paid_at,p_paid_total_paise,p_recorded_by,payload_value);
 INSERT INTO public.orders(id,code,kind,customer_id,source_location_id,created_by,salesperson_user_id,reference,sale_request_id,sale_request_payload,customer_snapshot,payment_confirmed_at)
 VALUES(result,'WEB-'||replace(result::text,'-',''),'ecommerce_sale',p_customer,(p_items->0->>'source_id')::uuid,p_recorded_by,p_salesperson,btrim(p_external_order),p_request,payload_value,customer_value,p_paid_at);
 INSERT INTO public.sale_analysis_channels(order_id,channel,external_reference) VALUES(result,'ecommerce',btrim(p_external_order));
 FOR r IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY coalesce(value->>'inventory_item_id',value->>'piece_id'),value->>'source_id' LOOP
  source_id:=(r->>'source_id')::uuid;
  IF r->>'kind'='fabric' THEN
   qty:=(r->>'quantity_mm')::numeric;
   IF qty IS NULL OR qty<=0 OR qty<>trunc(qty) OR qty>2147483647 OR jsonb_typeof(r->'quantity_mm') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Exact positive integer millimetres required'; END IF;
   IF jsonb_typeof(r->'sp_paise_per_m') IS DISTINCT FROM 'number' OR (r->>'sp_paise_per_m')::numeric<>trunc((r->>'sp_paise_per_m')::numeric) OR (r->>'sp_paise_per_m')::numeric NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Exact nonnegative online per-metre price required'; END IF;
   inv:=(r->>'inventory_item_id')::uuid;
   SELECT t.* INTO th FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id JOIN public.fabric_stock s ON s.id=t.fabric_stock_id WHERE i.id=inv AND i.unit='mm' AND t.status='active' AND s.entry_state IN('complete','correcting','legacy_pending');
   IF NOT FOUND THEN RAISE EXCEPTION 'Located active Thaan required'; END IF;
   SELECT cp_paise_per_m INTO cp FROM public.fabric_stock_costs WHERE fabric_stock_id=th.fabric_stock_id ORDER BY revision DESC LIMIT 1;
   IF cp IS NULL OR cp<=0 THEN RAISE EXCEPTION 'Recorded positive Thaan CP required'; END IF;
   sp:=(r->>'sp_paise_per_m')::bigint;amount:=round(qty*sp/1000);
   INSERT INTO public.order_items(order_id,fabric_stock_id,thaan_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) VALUES(result,th.fabric_stock_id,th.id,qty,'mm',sp,amount) RETURNING id INTO item_id;
   INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise) VALUES(item_id,cp);
   INSERT INTO public.ecommerce_sale_sources VALUES(item_id,source_id);
   INSERT INTO public.inventory_movements(kind,inventory_item_id,fabric_stock_id,thaan_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference) VALUES('SALE',inv,th.fabric_stock_id,th.id,qty,'mm',source_id,item_id,p_recorded_by,'Verified paid E-commerce order; server integration','ORDER:'||result::text);
   IF public.inventory_balance(inv,NULL)=0 THEN UPDATE public.thaans SET status='depleted',updated_at=now() WHERE id=th.id; END IF;
  ELSE
   SELECT * INTO piece FROM public.finished_products WHERE id=(r->>'piece_id')::uuid AND status='available' AND current_location_id=source_id FOR UPDATE;
   SELECT id INTO inv FROM public.inventory_items WHERE finished_product_id=piece.id AND unit='pc';
   IF piece.id IS NULL OR inv IS NULL OR public.inventory_balance(inv,source_id)<>1 THEN RAISE EXCEPTION 'Available physical piece on its Showroom floor required'; END IF;
   SELECT * INTO price FROM public.finished_product_prices WHERE finished_product_id=piece.id ORDER BY revision DESC LIMIT 1;
   IF price.id IS NULL OR price.id IS DISTINCT FROM (r->>'sp_version_id')::uuid OR price.sp_paise NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Saved Workshop SP changed or missing; refresh'; END IF;
   SELECT cost_version_id INTO reviewed_id FROM public.finished_product_price_reviews WHERE price_id=price.id;
   SELECT id INTO cost_id FROM public.production_cost_versions WHERE production_job_id=piece.production_job_id ORDER BY revision DESC LIMIT 1;
   SELECT amount_paise INTO cost_amount FROM public.finished_product_cost_allocations WHERE finished_product_id=piece.id AND cost_version_id=cost_id;
   IF reviewed_id IS NULL OR cost_amount IS NULL OR NOT EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=cost_id AND payload ? 'materials') THEN RAISE EXCEPTION 'Reviewed saved price and recorded piece CP required'; END IF;
   SELECT jsonb_build_object('quantity_snapshot',v.quantity_snapshot,'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.production_cost_lines l WHERE l.cost_version_id=v.id),'[]')) INTO evidence FROM public.production_cost_versions v WHERE v.id=cost_id;
   amount:=price.sp_paise;
   INSERT INTO public.order_items(order_id,finished_product_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) VALUES(result,piece.id,1,'pc',amount,amount) RETURNING id INTO item_id;
   INSERT INTO public.order_item_financials(order_item_id,production_cost_snapshot_paise) VALUES(item_id,cost_amount);
   INSERT INTO public.finished_product_sale_snapshots(order_item_id,price_version_id,cost_version_id,reviewed_cost_version_id,cost_evidence,item_snapshot)
   VALUES(item_id,price.id,cost_id,reviewed_id,evidence,(SELECT jsonb_build_object('barcode',b.code,'product',product.name,'design',coalesce(design.name,j.custom_design),'size',j.size,'job_code',j.code,'piece_number',piece.piece_number,'source',loc.name,'recording_basis','service_integration','recorded_by',p_recorded_by) FROM public.barcodes b JOIN public.products product ON product.id=piece.product_id LEFT JOIN public.designs design ON design.id=piece.design_id JOIN public.production_jobs j ON j.id=piece.production_job_id JOIN public.locations loc ON loc.id=source_id WHERE b.id=piece.barcode_id));
   INSERT INTO public.ecommerce_sale_sources VALUES(item_id,source_id);
   INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference) VALUES(inv,'SALE',piece.id,1,'pc',source_id,item_id,p_recorded_by,'Verified paid E-commerce order; server integration','ORDER:'||result::text);
   UPDATE public.finished_products SET status='sold' WHERE id=piece.id;
  END IF;
  total:=total+amount;
  IF total>9007199254740991 THEN RAISE EXCEPTION 'Exact supported paid total exceeded'; END IF;
 END LOOP;
 IF total<>p_paid_total_paise THEN RAISE EXCEPTION 'Verified settled payment must equal all sale lines'; END IF;
 UPDATE public.orders SET status='completed',final_customer_price_paise=total::bigint,completed_at=p_paid_at WHERE id=result;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(p_recorded_by,'submit_paid_ecommerce_order','orders',result,jsonb_build_object('channel','ecommerce','recording_basis','service_integration','external_order',btrim(p_external_order),'payment_reference',btrim(p_payment_reference),'paid_total_paise',p_paid_total_paise,'paid_at',p_paid_at),'WEB:'||p_request::text);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.submit_paid_ecommerce_order(uuid,text,text,timestamptz,bigint,uuid,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_paid_ecommerce_order(uuid,text,text,timestamptz,bigint,uuid,jsonb,uuid,uuid) TO service_role;
