BEGIN;
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

CREATE OR REPLACE FUNCTION public.guard_inventory_movement() RETURNS trigger
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
 WHERE l.id=NEW.order_item_id AND ((o.kind IN ('direct_fabric_sale','finished_product_sale') AND o.source_location_id=NEW.source_location_id) OR (o.kind='ecommerce_sale' AND EXISTS(SELECT 1 FROM public.ecommerce_sale_sources s JOIN public.ecommerce_paid_receipts receipt ON receipt.order_id=o.id WHERE s.order_item_id=l.id AND s.source_location_id=NEW.source_location_id AND receipt.recorded_by=NEW.actor_id)))
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
-- Daily operations and monthly sales evidence. No reconstructed payments or costs.
CREATE TABLE public.sale_analysis_dimensions (
 order_item_id uuid PRIMARY KEY REFERENCES public.order_items(id),
 fabric_type text,vendor_id uuid,vendor_name text,product_name text,design_name text,size text,
 salesperson_name text,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.sale_analysis_dimensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_analysis_dimensions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sale_analysis_dimensions TO authenticated;
GRANT ALL ON public.sale_analysis_dimensions TO service_role;
CREATE POLICY owner_sale_dimensions ON public.sale_analysis_dimensions FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER sale_dimensions_immutable BEFORE UPDATE OR DELETE ON public.sale_analysis_dimensions FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

-- Channels are captured once at sale completion, rather than relabelled later.
CREATE TABLE public.sale_analysis_channels (
 order_id uuid PRIMARY KEY REFERENCES public.orders(id),
 channel text NOT NULL CHECK(channel IN('counter','ecommerce')),
 external_reference text UNIQUE,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.sale_analysis_channels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_analysis_channels FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sale_analysis_channels TO authenticated;
GRANT ALL ON public.sale_analysis_channels TO service_role;
CREATE POLICY owner_sale_channels ON public.sale_analysis_channels FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER sale_channel_immutable BEFORE UPDATE OR DELETE ON public.sale_analysis_channels FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE FUNCTION public.capture_sale_analysis_dimensions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status='completed' AND NEW.payment_confirmed_at IS NOT NULL AND NEW.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'completed' OR OLD.payment_confirmed_at IS NULL) THEN
  INSERT INTO public.sale_analysis_channels(order_id,channel) VALUES(NEW.id,CASE WHEN NEW.kind='ecommerce_sale' THEN 'ecommerce' ELSE 'counter' END) ON CONFLICT DO NOTHING;
  INSERT INTO public.sale_analysis_dimensions(order_item_id,fabric_type,vendor_id,vendor_name,product_name,design_name,size,salesperson_name)
  SELECT it.id,coalesce(g.name,f.name),batch.supplier_id,coalesce(rb.provider_name,supplier.name),product.name,coalesce(design.name,job.custom_design),job.size,person.full_name
  FROM public.order_items it LEFT JOIN public.fabric_stock fs ON fs.id=it.fabric_stock_id LEFT JOIN public.fabrics f ON f.id=fs.fabric_id
  LEFT JOIN public.receiving_batches batch ON batch.id=fs.batch_id LEFT JOIN public.suppliers supplier ON supplier.id=batch.supplier_id
  LEFT JOIN public.stock_registration_batches rb ON rb.batch_id=batch.id LEFT JOIN public.stock_registration_variants variant ON variant.thaan_id=it.thaan_id
  LEFT JOIN public.stock_registration_fabric_types g ON g.id=variant.fabric_type_id LEFT JOIN public.finished_products piece ON piece.id=it.finished_product_id
  LEFT JOIN public.products product ON product.id=piece.product_id LEFT JOIN public.designs design ON design.id=piece.design_id
  LEFT JOIN public.production_jobs job ON job.id=piece.production_job_id LEFT JOIN public.profiles person ON person.id=NEW.salesperson_user_id WHERE it.order_id=NEW.id ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER capture_completed_sale_analysis AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.capture_sale_analysis_dimensions();
REVOKE ALL ON FUNCTION public.capture_sale_analysis_dimensions() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.business_sale_facts(p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_location text DEFAULT NULL) RETURNS TABLE(row_key text,event_at timestamptz,data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT it.id::text,o.completed_at,jsonb_build_object(
 'id',it.id,'order_id',o.id,'code',o.code,'completed_at',o.completed_at,'status',o.status,'payment_confirmed_at',o.payment_confirmed_at,'kind',CASE WHEN it.fabric_stock_id IS NOT NULL THEN 'direct_fabric_sale' ELSE 'finished_product_sale' END,'channel',coalesce(channel.channel,'counter'),
 'channel_basis',CASE WHEN channel.order_id IS NULL THEN 'existing_counter_bill_workflow' ELSE 'recorded_at_sale' END,
 'source',loc.name,'source_id',loc.id,'salesperson_id',o.salesperson_user_id,'salesperson',coalesce(dim.salesperson_name,person.full_name),
 'customer_id',o.customer_id,'customer',o.customer_snapshot->>'name',
 'fabric',CASE WHEN it.fabric_stock_id IS NOT NULL THEN coalesce(dim.fabric_type,g.name,f.name) END,
 'vendor_id',CASE WHEN dim.order_item_id IS NOT NULL THEN dim.vendor_id ELSE batch.supplier_id END,'vendor',CASE WHEN dim.order_item_id IS NOT NULL THEN dim.vendor_name ELSE coalesce(rb.provider_name,supplier.name) END,
 'product',CASE WHEN it.finished_product_id IS NOT NULL THEN coalesce(dim.product_name,snap.item_snapshot->>'product',product.name) END,
 'design',coalesce(dim.design_name,snap.item_snapshot->>'design',design.name,job.custom_design),'size',coalesce(dim.size,job.size),
 'barcode',coalesce(snap.item_snapshot->>'barcode',variant.code,t.barcode,fb.code,pb.code),'batch',batch.code,
 'quantity',trunc(it.quantity)::text,'unit',it.unit,'revenue_paise',it.final_customer_price_paise::text,
 'cost_paise',CASE WHEN it.fabric_stock_id IS NOT NULL AND fi.cp_snapshot_paise IS NOT NULL THEN round(it.quantity*fi.cp_snapshot_paise/1000)::text WHEN it.finished_product_id IS NOT NULL THEN fi.production_cost_snapshot_paise::text END,
 'margin_paise',CASE WHEN it.fabric_stock_id IS NOT NULL AND fi.cp_snapshot_paise IS NOT NULL THEN (it.final_customer_price_paise-round(it.quantity*fi.cp_snapshot_paise/1000))::text WHEN it.finished_product_id IS NOT NULL AND fi.production_cost_snapshot_paise IS NOT NULL THEN (it.final_customer_price_paise-fi.production_cost_snapshot_paise)::text END,
 'cost_basis',CASE WHEN it.fabric_stock_id IS NOT NULL THEN 'sale_time_fabric_CP' ELSE 'sale_time_recorded_piece_CP' END,
 'dimension_basis',CASE WHEN dim.order_item_id IS NOT NULL THEN 'sale_time_snapshot' ELSE 'historical_bill_snapshot_or_current_catalogue' END,
 'item_evidence',to_jsonb(it),'financial_evidence',to_jsonb(fi),'finished_sale_evidence',to_jsonb(snap))
 FROM public.orders o JOIN public.order_items it ON it.order_id=o.id LEFT JOIN public.ecommerce_sale_sources actual_source ON actual_source.order_item_id=it.id JOIN public.locations loc ON loc.id=coalesce(actual_source.source_location_id,o.source_location_id)
 LEFT JOIN public.sale_analysis_channels channel ON channel.order_id=o.id LEFT JOIN public.sale_analysis_dimensions dim ON dim.order_item_id=it.id
 LEFT JOIN public.order_item_financials fi ON fi.order_item_id=it.id LEFT JOIN public.finished_product_sale_snapshots snap ON snap.order_item_id=it.id
 LEFT JOIN public.profiles person ON person.id=o.salesperson_user_id LEFT JOIN public.fabric_stock fs ON fs.id=it.fabric_stock_id LEFT JOIN public.fabrics f ON f.id=fs.fabric_id
 LEFT JOIN public.thaans t ON t.id=it.thaan_id LEFT JOIN public.barcodes fb ON fb.id=fs.barcode_id LEFT JOIN public.stock_registration_variants variant ON variant.thaan_id=t.id
 LEFT JOIN public.stock_registration_fabric_types g ON g.id=variant.fabric_type_id LEFT JOIN public.receiving_batches batch ON batch.id=fs.batch_id
 LEFT JOIN public.suppliers supplier ON supplier.id=batch.supplier_id LEFT JOIN public.stock_registration_batches rb ON rb.batch_id=batch.id
 LEFT JOIN public.finished_products piece ON piece.id=it.finished_product_id LEFT JOIN public.barcodes pb ON pb.id=piece.barcode_id
 LEFT JOIN public.products product ON product.id=piece.product_id LEFT JOIN public.designs design ON design.id=piece.design_id LEFT JOIN public.production_jobs job ON job.id=piece.production_job_id
 WHERE o.status='completed' AND o.payment_confirmed_at IS NOT NULL AND o.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale')
 AND (p_from IS NULL OR o.completed_at>=p_from) AND (p_to IS NULL OR o.completed_at<p_to) AND (nullif(p_location,'') IS NULL OR loc.name=p_location OR loc.id::text=p_location);
$$;
REVOKE ALL ON FUNCTION public.business_sale_facts(timestamptz,timestamptz,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.business_sales_summary(p_from timestamptz,p_to timestamptz,p_location text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH facts AS(SELECT data FROM public.business_sale_facts(p_from,p_to,p_location))
 SELECT jsonb_build_object('revenue_paise',coalesce(sum((data->>'revenue_paise')::numeric),0)::text,
 'bills',count(DISTINCT data->>'order_id'),'customers',count(DISTINCT data->>'customer_id'),
 'unidentified_customer_bills',count(DISTINCT data->>'order_id') FILTER(WHERE data->>'customer_id' IS NULL),
 'fabric_mm',trunc(coalesce(sum((data->>'quantity')::numeric) FILTER(WHERE data->>'kind'='direct_fabric_sale'),0))::text,
 'pieces',trunc(coalesce(sum((data->>'quantity')::numeric) FILTER(WHERE data->>'kind'='finished_product_sale'),0))::text,
 'fabric_revenue_paise',coalesce(sum((data->>'revenue_paise')::numeric) FILTER(WHERE data->>'kind'='direct_fabric_sale'),0)::text,
 'product_revenue_paise',coalesce(sum((data->>'revenue_paise')::numeric) FILTER(WHERE data->>'kind'='finished_product_sale'),0)::text,
 'known_margin_paise',coalesce(sum((data->>'margin_paise')::numeric),0)::text,
 'unknown_cost_lines',count(*) FILTER(WHERE data->>'cost_paise' IS NULL),'lines',count(*),
 'counter_paise',coalesce(sum((data->>'revenue_paise')::numeric) FILTER(WHERE data->>'channel'='counter'),0)::text,
 'ecommerce_paise',coalesce(sum((data->>'revenue_paise')::numeric) FILTER(WHERE data->>'channel'='ecommerce'),0)::text) FROM facts;
$$;
REVOKE ALL ON FUNCTION public.business_sales_summary(timestamptz,timestamptz,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.owner_daily_business(p_day date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE start_at timestamptz; end_at timestamptz; result jsonb;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_day IS NULL THEN RAISE EXCEPTION 'Operational day required'; END IF;
 start_at:=p_day::timestamp AT TIME ZONE 'Asia/Kolkata';end_at:=(p_day+1)::timestamp AT TIME ZONE 'Asia/Kolkata';
 result:=public.business_sales_summary(start_at,end_at);
 RETURN result||jsonb_build_object('day',p_day,
 'batches_registered',(SELECT count(*) FROM public.receiving_batches WHERE created_at>=start_at AND created_at<end_at),
 'thaans_registered',(SELECT count(*) FROM public.thaans WHERE created_at>=start_at AND created_at<end_at),
 'received_fabric_mm',(SELECT coalesce(sum(quantity),0)::text FROM public.inventory_movements WHERE kind='INWARD' AND thaan_id IS NOT NULL AND occurred_at>=start_at AND occurred_at<end_at),
 'transfers',(SELECT count(*) FROM public.stock_transfers WHERE status='posted' AND posted_at>=start_at AND posted_at<end_at),
 'production_issued',(SELECT count(*) FROM public.production_jobs WHERE created_at>=start_at AND created_at<end_at),
 'production_issued_mm',(SELECT coalesce(sum(l.quantity),0)::text FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id WHERE i.production_job_id IS NOT NULL AND l.thaan_id IS NOT NULL AND i.issued_at>=start_at AND i.issued_at<end_at),
 'production_finished',(SELECT count(DISTINCT job_id) FROM public.production_status_events WHERE status='completed' AND recorded_at>=start_at AND recorded_at<end_at),
 'finished_pieces_received',(SELECT count(*) FROM public.finished_product_receipt_pieces p JOIN public.finished_product_receipts r ON r.request_id=p.request_id WHERE r.recorded_at>=start_at AND r.recorded_at<end_at),
 'tailoring_jobs',(SELECT count(*) FROM public.customer_tailoring_jobs WHERE created_at>=start_at AND created_at<end_at),
 'tailoring_booked_paise',(SELECT coalesce(sum(final_customer_price_paise),0)::text FROM public.orders WHERE kind='customer_tailoring' AND status='completed' AND created_at>=start_at AND created_at<end_at));
END; $$;
REVOKE ALL ON FUNCTION public.owner_daily_business(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_daily_business(date) TO authenticated;

CREATE FUNCTION public.owner_monthly_business(p_from timestamptz,p_to timestamptz,p_previous_from timestamptz,p_previous_to timestamptz,p_location text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; ranks jsonb; series jsonb;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_previous_from IS NULL OR p_previous_to IS NULL OR p_from>=p_to OR p_previous_from>=p_previous_to OR p_previous_to>p_from THEN RAISE EXCEPTION 'Valid current and preceding periods required'; END IF;
 WITH facts AS(SELECT data FROM public.business_sale_facts(p_from,p_to,p_location)), dimensions AS(
 SELECT dimension,identity,name,context,data FROM facts CROSS JOIN LATERAL(VALUES
 ('fabric_vendor',coalesce(data->>'fabric','not_recorded')||':'||coalesce(data->>'vendor_id',data->>'vendor','not_recorded'),coalesce(data->>'fabric','Fabric not recorded'),coalesce(data->>'vendor','Vendor not recorded')),
 ('vendor',coalesce(data->>'vendor_id',data->>'vendor','not_recorded'),coalesce(data->>'vendor','Vendor not recorded'),NULL),
 ('product',coalesce(data->>'product','not_recorded'),coalesce(data->>'product','Product not recorded'),NULL),
 ('salesperson',coalesce(data->>'salesperson_id','not_recorded'),coalesce(data->>'salesperson','Unassigned / not recorded'),NULL),
 ('channel',data->>'channel',data->>'channel',NULL)) d(dimension,identity,name,context)
 WHERE (dimension NOT IN('fabric_vendor','vendor') OR data->>'kind'='direct_fabric_sale') AND (dimension<>'product' OR data->>'kind'='finished_product_sale')
 ), grouped AS(SELECT dimension,identity,max(name) name,max(context) context,
 sum((data->>'revenue_paise')::numeric)::text revenue_paise,sum((data->>'margin_paise')::numeric)::text known_margin_paise,
 count(*) FILTER(WHERE data->>'cost_paise' IS NULL) unknown_cost_lines,count(*) lines,count(DISTINCT data->>'order_id') bills,
 count(DISTINCT data->>'customer_id') customers,count(DISTINCT data->>'order_id') FILTER(WHERE data->>'customer_id' IS NULL) unidentified_customer_bills,
 trunc(coalesce(sum((data->>'quantity')::numeric) FILTER(WHERE data->>'kind'='direct_fabric_sale'),0))::text fabric_mm,
 trunc(coalesce(sum((data->>'quantity')::numeric) FILTER(WHERE data->>'kind'='finished_product_sale'),0))::text pieces
 FROM dimensions GROUP BY dimension,identity)
 SELECT coalesce(jsonb_agg(to_jsonb(grouped) ORDER BY dimension,(revenue_paise)::numeric DESC,identity),'[]'::jsonb) INTO ranks FROM grouped;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY day),'[]'::jsonb) INTO series FROM(
 SELECT (event_at AT TIME ZONE 'Asia/Kolkata')::date AS day,sum((data->>'revenue_paise')::numeric)::text revenue_paise,count(DISTINCT data->>'order_id') bills FROM public.business_sale_facts(p_from,p_to,p_location) GROUP BY 1)t;
 RETURN jsonb_build_object('current',public.business_sales_summary(p_from,p_to,p_location),'previous',public.business_sales_summary(p_previous_from,p_previous_to,p_location),'rankings',ranks,'daily_sales',series,'from',p_from,'to_exclusive',p_to,'previous_from',p_previous_from,'previous_to_exclusive',p_previous_to,'cost_basis','Captured sale-time CP only; unknown costs excluded from recorded margin','historical_name_basis','Older rows use bill snapshots or current catalogue names; new sales retain name snapshots');
END; $$;
REVOKE ALL ON FUNCTION public.owner_monthly_business(timestamptz,timestamptz,timestamptz,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_monthly_business(timestamptz,timestamptz,timestamptz,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.owner_erp_report(p_dataset text,p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_after text DEFAULT NULL,p_limit integer DEFAULT 100,p_search text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE source_sql text; rows_value jsonb; total_value bigint; last_key text; order_sql text; cursor_operator text; last_aggregate text; snapshot_dataset boolean;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>=p_to) OR length(coalesce(p_after,''))>256 OR length(coalesce(p_search,''))>200 THEN RAISE EXCEPTION 'Valid half-open date range, cursor, search and 1–200 limit required'; END IF;
 CASE p_dataset
 WHEN 'stock' THEN source_sql:=$q$
 SELECT i.id::text||':'||l.id::text row_key,NULL::timestamptz event_at,jsonb_build_object('item_id',i.id,'kind',CASE WHEN i.thaan_id IS NOT NULL THEN 'fabric' WHEN i.material_id IS NOT NULL THEN 'consumable' ELSE 'finished_product' END,'item',coalesce(f.name,m.name,product.name),'batch',batch.code,'barcode',coalesce(fbc.code,pbc.code),'than_id',i.thaan_id,'piece_number',p.piece_number,'location',l.name,'location_id',l.id,'parent_id',l.parent_id,'location_active',l.active,'quantity',b.quantity::text,'unit',i.unit,'piece_status',p.status) data
 FROM public.v_inventory_location_balances b JOIN public.inventory_items i ON i.id=b.inventory_item_id JOIN public.locations l ON l.id=b.location_id LEFT JOIN public.thaans th ON th.id=i.thaan_id LEFT JOIN public.fabric_stock fs ON fs.id=th.fabric_stock_id LEFT JOIN public.fabrics f ON f.id=fs.fabric_id LEFT JOIN public.receiving_batches batch ON batch.id=fs.batch_id LEFT JOIN public.barcodes fbc ON fbc.id=fs.barcode_id LEFT JOIN public.materials m ON m.id=i.material_id LEFT JOIN public.finished_products p ON p.id=i.finished_product_id LEFT JOIN public.products product ON product.id=p.product_id LEFT JOIN public.barcodes pbc ON pbc.id=p.barcode_id
 $q$;
 WHEN 'fabric_stock' THEN source_sql:=$q$
 SELECT s.id::text row_key,s.created_at event_at,jsonb_build_object('id',s.id,'fabric',f.name,'batch',b.code,'barcode',bc.code,'entry_state',s.entry_state,'than_count',(SELECT count(*) FROM public.thaans WHERE fabric_stock_id=s.id),'unreconciled_thans',(SELECT count(*) FROM public.thaans th WHERE th.fabric_stock_id=s.id AND NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=th.id)),'located_quantity_mm',(SELECT coalesce(sum(public.inventory_balance(i.id,NULL)),0)::text FROM public.inventory_items i JOIN public.thaans th ON th.id=i.thaan_id WHERE th.fabric_stock_id=s.id),'cp_paise_per_m',cp.cp_paise_per_m::text,'sp_paise_per_m',sp.sp_paise_per_m::text,'cp_version_id',cp.id,'sp_version_id',sp.id) data
 FROM public.fabric_stock s JOIN public.fabrics f ON f.id=s.fabric_id JOIN public.receiving_batches b ON b.id=s.batch_id JOIN public.barcodes bc ON bc.id=s.barcode_id LEFT JOIN LATERAL(SELECT * FROM public.fabric_stock_costs WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1) cp ON true LEFT JOIN LATERAL(SELECT * FROM public.fabric_stock_prices WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1) sp ON true
 $q$;
 WHEN 'batches' THEN source_sql:=$q$ SELECT b.id::text row_key,NULL::timestamptz event_at,to_jsonb(b)||jsonb_build_object('supplier',s.name,'fabric_stock_count',(SELECT count(*) FROM public.fabric_stock WHERE batch_id=b.id),'than_count',(SELECT count(*) FROM public.thaans WHERE batch_id=b.id)) data FROM public.receiving_batches b LEFT JOIN public.suppliers s ON s.id=b.supplier_id $q$;
 WHEN 'thans' THEN source_sql:=$q$
 SELECT th.id::text row_key,th.created_at event_at,jsonb_build_object('id',th.id,'fabric',f.name,'batch',b.code,'fabric_barcode',bc.code,'legacy_barcode',th.barcode,'status',th.status,'original_mm',th.original_mm::text,'located_quantity_mm',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL)::text END,'reconciled',i.id IS NOT NULL,'fabric_stock_id',th.fabric_stock_id) data FROM public.thaans th LEFT JOIN public.inventory_items i ON i.thaan_id=th.id LEFT JOIN public.fabric_stock fs ON fs.id=th.fabric_stock_id LEFT JOIN public.barcodes bc ON bc.id=fs.barcode_id LEFT JOIN public.fabrics f ON f.id=th.fabric_id LEFT JOIN public.receiving_batches b ON b.id=th.batch_id
 $q$;
 WHEN 'consumables' THEN source_sql:=$q$ SELECT m.id::text row_key,NULL::timestamptz event_at,to_jsonb(m)-'qty_on_hand'||jsonb_build_object('legacy_quantity_snapshot',m.qty_on_hand::text,'located_quantity',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL)::text END,'reconciled',i.id IS NOT NULL) data FROM public.materials m LEFT JOIN public.inventory_items i ON i.material_id=m.id $q$;
 WHEN 'consumable_receipts' THEN source_sql:=$q$ SELECT r.id::text row_key,r.received_at event_at,jsonb_build_object('id',r.id,'material',m.name,'location',l.name,'quantity',r.quantity::text,'unit',r.unit,'cp_paise_per_unit',c.cp_paise_per_unit::text,'actor_id',r.received_by,'received_at',r.received_at,'reason',r.reason) data FROM public.consumable_receipts r JOIN public.materials m ON m.id=r.material_id JOIN public.locations l ON l.id=r.destination_location_id LEFT JOIN public.consumable_receipt_costs c ON c.receipt_id=r.id $q$;
 WHEN 'customer_tailoring' THEN source_sql:=$q$
 SELECT j.id::text row_key,j.created_at event_at,to_jsonb(j)||jsonb_build_object('customer',c.name,'factory',f.name,'section',s.name,'tailor',t.real_name,'fabric_cp_total_paise',CASE WHEN counter_price.job_id IS NOT NULL THEN counter_price.fabric_cp_total_paise::text ELSE price.fabric_cp_total_paise::text END,'tailoring_charge_paise',price.tailoring_charge_paise::text,'final_customer_price_paise',coalesce(counter_price.final_customer_price_paise,price.final_customer_price_paise)::text) data FROM public.customer_tailoring_jobs j JOIN public.customers c ON c.id=j.customer_id JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id LEFT JOIN LATERAL(SELECT * FROM public.customer_tailoring_prices WHERE job_id=j.id ORDER BY revision DESC LIMIT 1) price ON true LEFT JOIN public.counter_tailoring_prices counter_price ON counter_price.job_id=j.id
 $q$;
 WHEN 'configuration' THEN source_sql:=$q$
 SELECT 'factory:'||id::text row_key,created_at event_at,to_jsonb(t)||jsonb_build_object('kind','factory') data FROM public.tailoring_factories t UNION ALL SELECT 'section:'||id::text,created_at,to_jsonb(t)||jsonb_build_object('kind','section') FROM public.tailoring_sections t UNION ALL SELECT 'tailor:'||id::text,created_at,to_jsonb(t)||jsonb_build_object('kind','tailor') FROM public.tailors t UNION ALL SELECT 'assignment:'||id::text,valid_from,to_jsonb(t)||jsonb_build_object('kind','assignment') FROM public.tailor_assignments t UNION ALL SELECT 'charge:'||id::text,NULL::timestamptz,to_jsonb(t)||jsonb_build_object('kind','tailoring_charge') FROM public.tailoring_charges t UNION ALL SELECT 'charge_version:'||id::text,recorded_at,to_jsonb(t)||jsonb_build_object('kind','tailoring_charge_version','amount_paise',amount_paise::text) FROM public.tailoring_charge_versions t UNION ALL SELECT 'design:'||id::text,NULL::timestamptz,to_jsonb(t)||jsonb_build_object('kind','design') FROM public.designs t UNION ALL SELECT 'design_version:'||id::text,recorded_at,to_jsonb(t)||jsonb_build_object('kind','design_charge_version','amount_paise',amount_paise::text) FROM public.design_charge_versions t UNION ALL SELECT 'product:'||id::text,NULL::timestamptz,to_jsonb(t)||jsonb_build_object('kind','product') FROM public.products t
 $q$;
 WHEN 'material_issues','tailor_usage' THEN source_sql:=$q$
 SELECT line.id::text row_key,mi.issued_at event_at,jsonb_build_object('id',line.id,'issue',mi.code,'issue_type',mi.issue_type,'job',coalesce(pj.code,cj.code),'job_kind',CASE WHEN pj.id IS NOT NULL THEN 'owner_production' ELSE 'customer_tailoring' END,'factory',f.name,'section',s.name,'tailor',t.real_name,'assignment_id',a.id,'source',loc.name,'item',coalesce(fabric.name,material.name),'fabric_stock_id',line.fabric_stock_id,'than_id',line.thaan_id,'material_id',line.material_id,'quantity_issued',line.quantity::text,'unit',line.unit,'actual_piece_usage',CASE WHEN pj.id IS NOT NULL THEN (SELECT coalesce(sum(quantity),0)::text FROM public.finished_product_materials WHERE material_issue_line_id=line.id) END,'actual_usage_scope',CASE WHEN pj.id IS NOT NULL THEN 'recorded_finished_piece_allocations' ELSE 'not_recorded_for_customer_tailoring' END,'actor_id',mi.issued_by,'issued_at',mi.issued_at,'reason',mi.reason) data
 FROM public.material_issue_lines line JOIN public.material_issues mi ON mi.id=line.material_issue_id JOIN public.tailor_assignments a ON a.id=mi.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id JOIN public.locations loc ON loc.id=mi.source_location_id LEFT JOIN public.production_jobs pj ON pj.id=mi.production_job_id LEFT JOIN public.customer_tailoring_jobs cj ON cj.id=mi.customer_tailoring_job_id LEFT JOIN public.fabric_stock fs ON fs.id=line.fabric_stock_id LEFT JOIN public.fabrics fabric ON fabric.id=fs.fabric_id LEFT JOIN public.materials material ON material.id=line.material_id
 $q$;
 WHEN 'production_jobs' THEN source_sql:=$q$ SELECT j.id::text row_key,j.created_at event_at,to_jsonb(j)||jsonb_build_object('product',p.name,'design',coalesce(d.name,j.custom_design),'factory',f.name,'section',s.name,'tailor',t.real_name,'received_pieces',(SELECT count(*) FROM public.finished_products WHERE production_job_id=j.id),'latest_cost_version_id',(SELECT id FROM public.production_cost_versions WHERE production_job_id=j.id ORDER BY revision DESC LIMIT 1)) data FROM public.production_jobs j JOIN public.products p ON p.id=j.product_id LEFT JOIN public.designs d ON d.id=j.design_id JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id $q$;
 WHEN 'production_costs' THEN source_sql:=$q$ SELECT v.id::text row_key,v.recorded_at event_at,to_jsonb(v)||jsonb_build_object('job',j.code,'finalized',EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=v.id AND payload ? 'materials'),'total_paise',(SELECT coalesce(sum(amount_paise),0)::text FROM public.production_cost_lines WHERE cost_version_id=v.id),'components',(SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('input',to_jsonb(input)) ORDER BY l.id) FROM public.production_cost_lines l LEFT JOIN public.production_cost_inputs input ON input.cost_line_id=l.id WHERE l.cost_version_id=v.id),'allocations',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.finished_product_id) FROM public.finished_product_cost_allocations a WHERE a.cost_version_id=v.id)) data FROM public.production_cost_versions v JOIN public.production_jobs j ON j.id=v.production_job_id $q$;
 WHEN 'finished_products' THEN source_sql:=$q$ SELECT p.id::text row_key,p.created_at event_at,jsonb_build_object('id',p.id,'barcode',b.code,'product',product.name,'design',coalesce(d.name,j.custom_design),'job',j.code,'piece_number',p.piece_number,'status',p.status,'location',l.name,'location_id',l.id,'quantity',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,p.current_location_id)::text END,'sp_paise',price.sp_paise::text,'production_cost_paise',(SELECT a.amount_paise::text FROM public.finished_product_cost_allocations a JOIN public.production_cost_versions v ON v.id=a.cost_version_id WHERE a.finished_product_id=p.id ORDER BY v.revision DESC LIMIT 1)) data FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id LEFT JOIN public.designs d ON d.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id JOIN public.locations l ON l.id=p.current_location_id LEFT JOIN public.inventory_items i ON i.finished_product_id=p.id LEFT JOIN LATERAL(SELECT * FROM public.finished_product_prices WHERE finished_product_id=p.id ORDER BY revision DESC LIMIT 1) price ON true $q$;
 WHEN 'transfers' THEN source_sql:=$q$ SELECT line.id::text row_key,t.posted_at event_at,to_jsonb(line)||jsonb_build_object('transfer',t.code,'status',t.status,'source',source.name,'destination',destination.name,'reason',t.reason,'actor_id',t.created_by,'posted_at',t.posted_at,'quantity',line.quantity::text) data FROM public.stock_transfer_lines line JOIN public.stock_transfers t ON t.id=line.transfer_id JOIN public.locations source ON source.id=t.source_location_id JOIN public.locations destination ON destination.id=t.destination_location_id $q$;
 WHEN 'movements' THEN source_sql:=$q$ SELECT m.id::text row_key,m.occurred_at event_at,to_jsonb(m)||jsonb_build_object('source',source.name,'destination',destination.name,'actor',p.full_name,'quantity',m.quantity::text) data FROM public.inventory_movements m LEFT JOIN public.locations source ON source.id=m.source_location_id LEFT JOIN public.locations destination ON destination.id=m.destination_location_id LEFT JOIN public.profiles p ON p.id=m.actor_id $q$;
 WHEN 'orders' THEN source_sql:=$q$
 SELECT o.id::text row_key,CASE WHEN o.status='completed' AND o.payment_confirmed_at IS NOT NULL AND o.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale') THEN o.completed_at ELSE o.created_at END event_at,to_jsonb(o)-'sale_request_payload'-'tailoring_request_payload'||jsonb_build_object('source',CASE WHEN (SELECT count(DISTINCT source_location_id) FROM public.ecommerce_sale_sources s JOIN public.order_items i ON i.id=s.order_item_id WHERE i.order_id=o.id)>1 THEN 'Multiple Showroom floors' ELSE l.name END,'source_names',(SELECT jsonb_agg(DISTINCT loc.name) FROM public.ecommerce_sale_sources s JOIN public.order_items i ON i.id=s.order_item_id JOIN public.locations loc ON loc.id=s.source_location_id WHERE i.order_id=o.id),'channel',(SELECT channel FROM public.sale_analysis_channels WHERE order_id=o.id),'final_customer_price_paise',o.final_customer_price_paise::text,'revenue_state',CASE WHEN o.status='completed' AND o.payment_confirmed_at IS NOT NULL THEN 'payment_confirmed' WHEN o.kind='customer_tailoring' THEN 'customer_tailoring_booking' ELSE 'not_payment_confirmed' END,'items',(SELECT jsonb_agg(to_jsonb(it)||jsonb_build_object('quantity',it.quantity::text,'sp_snapshot_paise',it.sp_snapshot_paise::text,'final_customer_price_paise',it.final_customer_price_paise::text,'financial_snapshot',to_jsonb(fi),'finished_sale_snapshot',to_jsonb(snapshot)) ORDER BY it.id) FROM public.order_items it LEFT JOIN public.order_item_financials fi ON fi.order_item_id=it.id LEFT JOIN public.finished_product_sale_snapshots snapshot ON snapshot.order_item_id=it.id WHERE it.order_id=o.id)) data FROM public.orders o JOIN public.locations l ON l.id=o.source_location_id
 $q$;
 WHEN 'production_history' THEN source_sql:=$q$ SELECT 'status:'||e.id::text row_key,e.recorded_at event_at,to_jsonb(e)||jsonb_build_object('kind','status','job',j.code) data FROM public.production_status_events e JOIN public.production_jobs j ON j.id=e.job_id UNION ALL SELECT 'receipt:'||p.finished_product_id::text,r.recorded_at,to_jsonb(r)-'payload'||jsonb_build_object('kind','workshop_receipt','piece_id',p.finished_product_id,'job',j.code) FROM public.finished_product_receipt_pieces p JOIN public.finished_product_receipts r ON r.request_id=p.request_id JOIN public.production_jobs j ON j.id=r.production_job_id $q$;
 WHEN 'reconciliation' THEN source_sql:=$q$ SELECT id::text row_key,created_at event_at,to_jsonb(t) data FROM public.domain_reconciliation t $q$;
 WHEN 'controls' THEN source_sql:=$q$
 SELECT 'legacy:'||id::text row_key,NULL::timestamptz event_at,to_jsonb(t)||jsonb_build_object('control','unresolved_legacy') data FROM public.domain_reconciliation t WHERE resolved_at IS NULL
 UNION ALL SELECT 'than:'||th.id::text,NULL::timestamptz,jsonb_build_object('control','unreconciled_than','id',th.id,'fabric_stock_id',th.fabric_stock_id,'status',th.status) FROM public.thaans th WHERE th.status<>'draft' AND NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=th.id)
 UNION ALL SELECT 'piece:'||p.id::text,NULL::timestamptz,jsonb_build_object('control','finished_stock_mismatch','id',p.id,'status',p.status,'location_id',p.current_location_id) FROM public.finished_products p LEFT JOIN public.inventory_items i ON i.finished_product_id=p.id WHERE i.id IS NULL OR (p.status='available' AND (public.inventory_balance(i.id,NULL)<>1 OR public.inventory_balance(i.id,p.current_location_id)<>1)) OR (p.status<>'available' AND public.inventory_balance(i.id,NULL)<>0)
 UNION ALL SELECT 'price:'||p.id::text,NULL::timestamptz,jsonb_build_object('control','available_piece_without_sp','id',p.id,'job_id',p.production_job_id) FROM public.finished_products p WHERE status='available' AND NOT EXISTS(SELECT 1 FROM public.finished_product_prices WHERE finished_product_id=p.id)
 UNION ALL SELECT 'receipt:'||j.id::text,NULL::timestamptz,jsonb_build_object('control','completed_job_not_received','id',j.id,'code',j.code) FROM public.production_jobs j WHERE status='completed' AND NOT EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE production_job_id=j.id)
 UNION ALL SELECT 'cost:'||r.production_job_id::text,NULL::timestamptz,jsonb_build_object('control','received_job_without_final_cost','id',r.production_job_id) FROM public.finished_product_receipts r WHERE NOT EXISTS(SELECT 1 FROM public.production_cost_versions v JOIN public.production_cost_requests request ON request.result_id=v.id AND request.payload ? 'materials' WHERE v.production_job_id=r.production_job_id)
 UNION ALL SELECT 'negative:'||inventory_item_id::text||':'||location_id::text,NULL::timestamptz,to_jsonb(b)||jsonb_build_object('control','negative_location_balance') FROM public.v_inventory_location_balances b WHERE quantity<0
 $q$;
 WHEN 'access' THEN source_sql:=$q$ SELECT p.id::text row_key,NULL::timestamptz event_at,to_jsonb(p)||jsonb_build_object('roles',(SELECT jsonb_agg(role_key ORDER BY role_key) FROM public.user_roles WHERE user_id=p.id),'permission_overrides',(SELECT jsonb_agg(to_jsonb(o) ORDER BY permission_key) FROM public.user_permission_overrides o WHERE user_id=p.id)) data FROM public.profiles p $q$;
 WHEN 'audit' THEN source_sql:=$q$ SELECT to_char(a.occurred_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISSUS')||':erp:'||a.id::text row_key,a.occurred_at event_at,to_jsonb(a)||jsonb_build_object('source','canonical','actor',p.full_name) data FROM public.erp_audit_records a LEFT JOIN public.profiles p ON p.id=a.actor_id UNION ALL SELECT to_char(created_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISSUS')||':legacy:'||id::text,created_at,to_jsonb(a)||jsonb_build_object('source','legacy','previous_value',NULL,'new_value',detail) FROM public.audit_log a $q$;
 WHEN 'sales_lines' THEN source_sql:=$q$ SELECT row_key,event_at,data FROM public.business_sale_facts($1,$2) $q$;
 WHEN 'legacy_sales' THEN source_sql:=$q$ SELECT s.id::text row_key,s.created_at event_at,to_jsonb(s)||jsonb_build_object('source','legacy_only','items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.sale_items i WHERE i.sale_id=s.id)) data FROM public.sales s $q$;
 WHEN 'legacy_tailoring' THEN source_sql:=$q$ SELECT j.id::text row_key,j.created_at event_at,to_jsonb(j)||jsonb_build_object('source','legacy_only','lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.tailoring_job_lines l WHERE l.job_id=j.id)) data FROM public.tailoring_jobs j $q$;
 WHEN 'legacy_movements' THEN source_sql:=$q$ SELECT m.id::text row_key,m.created_at event_at,to_jsonb(m)||jsonb_build_object('source','legacy_only') data FROM public.stock_movements m $q$;
 ELSE RAISE EXCEPTION 'Unknown Owner report dataset';
 END CASE;
 -- Stock/configuration rows without a meaningful event date are explicitly
 -- current snapshots and remain visible regardless of the transaction window.
 snapshot_dataset:=p_dataset IN('stock','fabric_stock','batches','thans','consumables','configuration','finished_products','access','controls');
 source_sql:='SELECT * FROM ('||source_sql||') report WHERE ('||snapshot_dataset::text||' OR event_at IS NULL OR (($1 IS NULL OR event_at>=$1) AND ($2 IS NULL OR event_at<$2))) AND ($4 IS NULL OR position(lower($4) in lower(data::text))>0)';
 EXECUTE 'SELECT count(*) FROM ('||source_sql||') report' INTO total_value USING p_from,p_to,p_after,nullif(btrim(p_search),'');
 order_sql:=CASE WHEN p_dataset='audit' THEN ' DESC' ELSE ' ASC' END; cursor_operator:=CASE WHEN p_dataset='audit' THEN '<' ELSE '>' END; last_aggregate:=CASE WHEN p_dataset='audit' THEN 'min' ELSE 'max' END;
 EXECUTE 'SELECT coalesce(jsonb_agg(jsonb_build_object(''key'',row_key,''event_at'',event_at,''data'',data) ORDER BY row_key'||order_sql||'),''[]''),'||last_aggregate||'(row_key) FROM (SELECT * FROM ('||source_sql||') filtered WHERE ($3 IS NULL OR row_key'||cursor_operator||'$3) ORDER BY row_key'||order_sql||' LIMIT $5) page' INTO rows_value,last_key USING p_from,p_to,p_after,nullif(btrim(p_search),''),p_limit;
 RETURN jsonb_build_object('dataset',p_dataset,'rows',rows_value,'total_rows',total_value::text,'next_cursor',CASE WHEN jsonb_array_length(rows_value)=p_limit THEN last_key END,'from',p_from,'to_exclusive',p_to,'stock_basis','current_canonical_ledger','date_basis',CASE WHEN snapshot_dataset THEN 'current_snapshot' ELSE 'event_range' END);
END; $$;
CREATE OR REPLACE FUNCTION public.owner_erp_overview(p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>=p_to THEN RAISE EXCEPTION 'Valid half-open date range required'; END IF;
 RETURN jsonb_build_object('stock_basis','current_canonical_ledger','stock',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY location_id,unit),'[]') FROM(SELECT l.id location_id,l.name location,l.kind,l.parent_id,i.unit,sum(b.quantity)::text quantity FROM public.v_inventory_location_balances b JOIN public.inventory_items i ON i.id=b.inventory_item_id JOIN public.locations l ON l.id=b.location_id GROUP BY l.id,i.unit) x),
 'paid_sales',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY kind),'[]') FROM(SELECT data->>'kind' kind,count(DISTINCT data->>'order_id')::text orders,sum((data->>'revenue_paise')::numeric)::text total_paise FROM public.business_sale_facts(p_from,p_to) GROUP BY data->>'kind') x),
 'customer_tailoring_bookings',(SELECT jsonb_build_object('orders',count(*)::text,'booked_customer_price_paise',coalesce(sum(final_customer_price_paise),0)::text) FROM public.orders WHERE kind='customer_tailoring' AND status='completed' AND (p_from IS NULL OR created_at>=p_from) AND (p_to IS NULL OR created_at<p_to)),
 'controls',jsonb_build_object('unresolved_legacy',(SELECT count(*) FROM public.domain_reconciliation WHERE resolved_at IS NULL),'unreconciled_thans',(SELECT count(*) FROM public.thaans th WHERE th.status<>'draft' AND NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=th.id)),'negative_location_balances',(SELECT count(*) FROM public.v_inventory_location_balances WHERE quantity<0),'finished_stock_mismatches',(SELECT count(*) FROM public.finished_products p LEFT JOIN public.inventory_items i ON i.finished_product_id=p.id WHERE i.id IS NULL OR (p.status='available' AND (public.inventory_balance(i.id,NULL)<>1 OR public.inventory_balance(i.id,p.current_location_id)<>1)) OR (p.status<>'available' AND public.inventory_balance(i.id,NULL)<>0)),'available_pieces_without_sp',(SELECT count(*) FROM public.finished_products p WHERE status='available' AND NOT EXISTS(SELECT 1 FROM public.finished_product_prices WHERE finished_product_id=p.id)),'completed_jobs_not_received',(SELECT count(*) FROM public.production_jobs j WHERE status='completed' AND NOT EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE production_job_id=j.id)),'received_jobs_without_final_cost',(SELECT count(*) FROM public.finished_product_receipts r WHERE NOT EXISTS(SELECT 1 FROM public.production_cost_versions v JOIN public.production_cost_requests request ON request.result_id=v.id AND request.payload ? 'materials' WHERE v.production_job_id=r.production_job_id))));
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
