-- Owner-approved Salesperson attribution and Counter-entered tailoring final total.
BEGIN;
INSERT INTO public.roles(key,label,description) VALUES('salesperson','Salesperson','Views own attributed bills and customer tailoring work') ON CONFLICT(key) DO NOTHING;
INSERT INTO public.permissions(key,label,domain) VALUES('salesperson.view_work','View own Salesperson work','salesperson'),('pos.assign_salesperson','Select credited Salesperson for billing','pos'),('pos.enter_tailoring_total','Enter final Customer Tailoring total','pos') ON CONFLICT(key) DO NOTHING;
INSERT INTO public.role_permissions(role_key,permission_key) VALUES('salesperson','salesperson.view_work'),('counter','pos.assign_salesperson'),('counter','pos.enter_tailoring_total') ON CONFLICT DO NOTHING;
ALTER TABLE public.orders ADD COLUMN salesperson_user_id uuid REFERENCES public.profiles(id);
ALTER TABLE public.customer_tailoring_jobs ADD COLUMN salesperson_user_id uuid REFERENCES public.profiles(id);
CREATE INDEX salesperson_orders_idx ON public.orders(salesperson_user_id,created_at DESC,id);
CREATE INDEX salesperson_jobs_idx ON public.customer_tailoring_jobs(salesperson_user_id,created_at DESC,id);
CREATE TABLE public.counter_tailoring_prices (
 job_id uuid PRIMARY KEY REFERENCES public.customer_tailoring_jobs(id),
 id uuid GENERATED ALWAYS AS(job_id) STORED,
 final_customer_price_paise bigint NOT NULL CHECK(final_customer_price_paise BETWEEN 0 AND 9007199254740991),
 fabric_cp_total_paise bigint CHECK(fabric_cp_total_paise BETWEEN 0 AND 9007199254740991),
 cuts jsonb NOT NULL CHECK(jsonb_typeof(cuts)='array'),
 recorded_by uuid NOT NULL REFERENCES public.profiles(id), recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.counter_tailoring_prices ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.counter_tailoring_prices TO authenticated;
GRANT ALL ON public.counter_tailoring_prices TO service_role;
CREATE POLICY owner_counter_tailoring_prices ON public.counter_tailoring_prices FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER counter_tailoring_price_immutable BEFORE UPDATE OR DELETE ON public.counter_tailoring_prices FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER counter_tailoring_price_audit AFTER INSERT OR UPDATE OR DELETE ON public.counter_tailoring_prices FOR EACH ROW EXECUTE FUNCTION public.capture_owner_domain_audit();
CREATE FUNCTION public.require_salesperson(p_user uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.assign_salesperson') THEN RAISE EXCEPTION 'Salesperson selection permission required'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_user AND active FOR SHARE;
 IF NOT FOUND OR NOT public.has_role(p_user,'salesperson') THEN RAISE EXCEPTION 'Select an active Salesperson ID'; END IF;
 PERFORM 1 FROM public.user_roles WHERE user_id=p_user AND role_key='salesperson' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Salesperson role required'; END IF;
END; $$;
CREATE FUNCTION public.guard_salesperson_attribution() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.salesperson_user_id IS DISTINCT FROM OLD.salesperson_user_id THEN RAISE EXCEPTION 'Historical Salesperson attribution is permanent'; END IF;
 IF TG_OP='INSERT' AND auth.uid() IS NOT NULL THEN
  PERFORM public.require_salesperson(NEW.salesperson_user_id);
  IF TG_TABLE_NAME='orders' THEN IF NEW.customer_tailoring_job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customer_tailoring_jobs WHERE id=NEW.customer_tailoring_job_id AND salesperson_user_id=NEW.salesperson_user_id) THEN RAISE EXCEPTION 'Bill and tailoring Salesperson must match'; END IF; END IF;
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER salesperson_order_guard BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_salesperson_attribution();
CREATE TRIGGER salesperson_job_guard BEFORE INSERT OR UPDATE ON public.customer_tailoring_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_salesperson_attribution();
CREATE FUNCTION public.salesperson_options() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.assign_salesperson') THEN RAISE EXCEPTION 'Salesperson selection permission required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) ORDER BY p.full_name,p.id) FROM public.profiles p WHERE p.active AND public.has_role(p.id,'salesperson')),'[]'::jsonb);
END; $$;
CREATE FUNCTION public.complete_counter_fabric_sale(p_request_id uuid,p_source uuid,p_items jsonb,
 p_customer uuid,p_payment_confirmed boolean,p_reference text,p_salesperson uuid) RETURNS uuid
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
 payload:=jsonb_build_object('salesperson',p_salesperson,'source',p_source,'items',p_items,'customer',p_customer,'reference',nullif(btrim(p_reference),''),'payment_confirmed',true);
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
 INSERT INTO public.orders(id,code,kind,customer_id,source_location_id,created_by,salesperson_user_id,reference,sale_request_id,sale_request_payload,customer_snapshot,payment_confirmed_at)
 VALUES(v_order,'SALE-'||replace(v_order::text,'-',''),'direct_fabric_sale',p_customer,p_source,auth.uid(),p_salesperson,nullif(btrim(p_reference),''),p_request_id,payload,v_customer,now());
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
CREATE FUNCTION public.complete_finished_product_sale(p_request uuid,p_source uuid,p_items jsonb,p_customer uuid,p_payment_confirmed boolean,p_reference text,p_salesperson uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.orders%rowtype; payload_value jsonb; customer_value jsonb; result uuid:=gen_random_uuid(); row_value jsonb; piece public.finished_products%rowtype; price public.finished_product_prices%rowtype; inv uuid; line_id uuid; total numeric:=0; cost_id uuid; reviewed_id uuid; cost_amount bigint; evidence jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') THEN RAISE EXCEPTION 'Authorized Owner or Counter required'; END IF;
 IF p_request IS NULL OR p_source IS NULL OR p_payment_confirmed IS DISTINCT FROM true OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Request, source, 1–50 pieces and confirmed received payment required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) WHERE jsonb_typeof(value)<>'object' OR (value-ARRAY['piece_id','sp_version_id'])<>'{}'::jsonb) THEN RAISE EXCEPTION 'Only explicit piece ID and expected SP version are accepted'; END IF;
 IF (SELECT count(DISTINCT value->>'piece_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Distinct explicit physical pieces required'; END IF;
 payload_value:=jsonb_build_object('salesperson',p_salesperson,'actor',auth.uid(),'source',p_source,'items',p_items,'customer',p_customer,'payment_confirmed',true,'reference',nullif(btrim(p_reference),''));
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
 INSERT INTO public.orders(id,code,kind,customer_id,source_location_id,created_by,salesperson_user_id,reference,sale_request_id,sale_request_payload,customer_snapshot,payment_confirmed_at)
 VALUES(result,'PRODUCT-SALE-'||replace(result::text,'-',''),'finished_product_sale',p_customer,p_source,auth.uid(),p_salesperson,nullif(btrim(p_reference),''),p_request,payload_value,customer_value,now());
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
CREATE FUNCTION public.book_counter_tailoring(p_request uuid,p_source uuid,p_items jsonb,p_final_price bigint,p_customer uuid,p_assignment uuid,p_salesperson uuid,p_garment text,p_notes text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.customer_tailoring_jobs%rowtype; payload jsonb; r jsonb; th public.thaans%rowtype; cp bigint; cost_id uuid; qty numeric; amount numeric; total numeric:=0; known boolean:=true; cuts jsonb:='[]'; v_job uuid:=gen_random_uuid(); v_order uuid:=gen_random_uuid(); v_issue uuid; v_line uuid; v_item uuid; contact jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.issue_to_tailoring') OR NOT public.has_perm(auth.uid(),'pos.assign_salesperson') OR NOT public.has_perm(auth.uid(),'pos.enter_tailoring_total') THEN RAISE EXCEPTION 'Authorized Counter tailoring booking required'; END IF;
 IF p_request IS NULL OR p_source IS NULL OR nullif(btrim(p_garment),'') IS NULL OR p_final_price IS NULL OR p_final_price NOT BETWEEN 0 AND 9007199254740991 OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Request, source, cuts, garment and exact final total required'; END IF;
 IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 OR (SELECT count(DISTINCT value->>'inventory_item_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'One to fifty distinct cuts required'; END IF;
 payload:=jsonb_build_object('source',p_source,'items',p_items,'final_price',p_final_price,'customer',p_customer,'assignment',p_assignment,'salesperson',p_salesperson,'garment',btrim(p_garment),'notes',nullif(btrim(p_notes),''));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,7));
 SELECT * INTO j FROM public.customer_tailoring_jobs WHERE request_id=p_request;
 IF FOUND THEN
  IF j.request_payload IS DISTINCT FROM payload OR (j.created_by IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'Request reused with different data or actor'; END IF;
  RETURN j.id;
 END IF;
 PERFORM public.require_salesperson(p_salesperson);
 SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO contact FROM public.customers WHERE id=p_customer FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer required'; END IF;
 PERFORM 1 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections s ON s.id=a.section_id WHERE a.id=p_assignment AND a.valid_until IS NULL AND a.valid_from<=now() AND t.active AND f.active AND (s.id IS NULL OR s.active) AND (t.profile_id IS NULL OR public.has_role(t.profile_id,'tailor')) FOR UPDATE OF a,t,f;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Factory / Section / Tailor required'; END IF;
 PERFORM 1 FROM public.tailoring_sections WHERE id=(SELECT section_id FROM public.tailor_assignments WHERE id=p_assignment) FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.tailoring_sections WHERE id=(SELECT section_id FROM public.tailor_assignments WHERE id=p_assignment) AND NOT active) THEN RAISE EXCEPTION 'Active Section required'; END IF;
 PERFORM 1 FROM public.fabric_stock s WHERE s.id IN(SELECT t.fabric_stock_id FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id JOIN jsonb_array_elements(p_items) x ON i.id=(x->>'inventory_item_id')::uuid) ORDER BY s.id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items i JOIN jsonb_array_elements(p_items) x ON i.id=(x->>'inventory_item_id')::uuid ORDER BY i.id FOR UPDATE OF i;
 PERFORM 1 FROM public.locations WHERE id=p_source AND active AND kind IN('workshop','showroom','showroom_sublocation') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active stock location required'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'inventory_item_id' LOOP
  qty:=(r->>'quantity')::numeric;
  IF qty IS NULL OR qty<=0 OR qty<>trunc(qty) OR qty>2147483647 THEN RAISE EXCEPTION 'Positive exact millimetres required'; END IF;
  SELECT t.* INTO th FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id JOIN public.fabric_stock s ON s.id=t.fabric_stock_id WHERE i.id=(r->>'inventory_item_id')::uuid AND i.unit='mm' AND t.status='active' AND s.entry_state IN('complete','correcting','legacy_pending');
  IF NOT FOUND OR qty>public.inventory_balance((r->>'inventory_item_id')::uuid,p_source) THEN RAISE EXCEPTION 'Insufficient active fabric at source'; END IF;
  SELECT id,cp_paise_per_m INTO cost_id,cp FROM public.fabric_stock_costs WHERE fabric_stock_id=th.fabric_stock_id ORDER BY revision DESC LIMIT 1;
  amount:=CASE WHEN cp IS NOT NULL THEN round(qty*cp/1000) END;
  IF amount>9007199254740991 OR total+coalesce(amount,0)>9007199254740991 THEN RAISE EXCEPTION 'Internal cost exceeds supported range'; END IF;
  total:=total+coalesce(amount,0); IF cp IS NULL THEN known:=false; END IF;
  cuts:=cuts||jsonb_build_array(jsonb_build_object('inventory_item_id',r->>'inventory_item_id','fabric_stock_id',th.fabric_stock_id,'thaan_id',th.id,'quantity',qty,'cost_version_id',cost_id,'cp_paise_per_m',cp,'cp_amount_paise',amount));
 END LOOP;
 INSERT INTO public.customer_tailoring_jobs(id,code,customer_id,garment,tailor_assignment_id,status,notes,created_by,request_id,request_payload,salesperson_user_id) VALUES(v_job,'CT-'||replace(v_job::text,'-',''),p_customer,btrim(p_garment),p_assignment,'open',nullif(btrim(p_notes),''),auth.uid(),p_request,payload,p_salesperson);
 INSERT INTO public.counter_tailoring_prices(job_id,final_customer_price_paise,fabric_cp_total_paise,cuts,recorded_by) VALUES(v_job,p_final_price,CASE WHEN known THEN total END,cuts,auth.uid());
 INSERT INTO public.job_material_requirements(customer_tailoring_job_id,fabric_stock_id,quantity,unit) SELECT v_job,(x->>'fabric_stock_id')::uuid,sum((x->>'quantity')::numeric),'mm' FROM jsonb_array_elements(cuts) x GROUP BY x->>'fabric_stock_id';
 INSERT INTO public.material_issues(code,customer_tailoring_job_id,tailor_assignment_id,source_location_id,issue_type,reason,issued_by) VALUES('MI-'||replace(v_job::text,'-',''),v_job,p_assignment,p_source,'required','Required material for Customer Tailoring',auth.uid()) RETURNING id INTO v_issue;
 FOR r IN SELECT value FROM jsonb_array_elements(cuts) ORDER BY value->>'inventory_item_id' LOOP
  INSERT INTO public.material_issue_lines(material_issue_id,fabric_stock_id,thaan_id,quantity,unit) VALUES(v_issue,(r->>'fabric_stock_id')::uuid,(r->>'thaan_id')::uuid,(r->>'quantity')::numeric,'mm') RETURNING id INTO v_line;
  INSERT INTO public.inventory_movements(kind,fabric_stock_id,thaan_id,inventory_item_id,quantity,unit,source_location_id,material_issue_line_id,customer_tailoring_job_id,reason,reference,actor_id) VALUES('MATERIAL_ISSUE',(r->>'fabric_stock_id')::uuid,(r->>'thaan_id')::uuid,(r->>'inventory_item_id')::uuid,(r->>'quantity')::numeric,'mm',p_source,v_line,v_job,'Required material for Customer Tailoring','JOB:'||v_job::text,auth.uid());
  IF public.inventory_balance((r->>'inventory_item_id')::uuid,NULL)=0 THEN UPDATE public.thaans SET status='depleted',updated_at=now() WHERE id=(r->>'thaan_id')::uuid; END IF;
 END LOOP;
 INSERT INTO public.orders(id,code,kind,customer_id,customer_tailoring_job_id,source_location_id,status,final_customer_price_paise,created_by,customer_snapshot,completed_at,tailoring_request_id,reference,salesperson_user_id) VALUES(v_order,'CT-ORDER-'||replace(v_job::text,'-',''),'customer_tailoring',p_customer,v_job,p_source,'draft',p_final_price,auth.uid(),contact,now(),p_request,'JOB:'||v_job::text,p_salesperson);
 INSERT INTO public.order_items(order_id,customer_tailoring_job_id,quantity,unit,final_customer_price_paise) VALUES(v_order,v_job,1,'job',p_final_price) RETURNING id INTO v_item;
 INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise) VALUES(v_item,CASE WHEN known THEN total END);
 UPDATE public.orders SET status='completed' WHERE id=v_order;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'book_counter_tailoring','customer_tailoring_jobs',v_job,jsonb_build_object('order_id',v_order,'issue_id',v_issue,'final_customer_price_paise',p_final_price,'salesperson',p_salesperson),'REQUEST:'||p_request::text);
 RETURN v_job;
END; $$;
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
    SELECT sum((x->>'quantity')::numeric) FROM public.customer_tailoring_jobs j JOIN LATERAL(SELECT cuts FROM public.customer_tailoring_quotes WHERE id=j.quote_id UNION ALL SELECT cuts FROM public.counter_tailoring_prices WHERE job_id=j.id) q ON true
    CROSS JOIN jsonb_array_elements(q.cuts) x WHERE j.id=NEW.customer_tailoring_job_id AND (x->>'fabric_stock_id')::uuid=NEW.fabric_stock_id)
   THEN RAISE EXCEPTION 'Required quantity must match the booked quote exactly once'; END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.customer_tailoring_history(p_job uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','tailor']) THEN RAISE EXCEPTION 'Active tailoring role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id) FROM(
 SELECT j.salesperson_user_id,j.id,j.code,j.garment,j.status,j.notes,j.created_by,j.created_at,a.id assignment_id,
 f.name factory_name,s.name section_name,t.code tailor_code,t.real_name tailor_name,
 o.id order_id,o.code order_code,o.customer_snapshot,o.source_location_id,l.name source_name,
 CASE WHEN public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN o.final_customer_price_paise END final_customer_price_paise,
 (SELECT jsonb_agg(jsonb_build_object('fabric_stock_id',req.fabric_stock_id,'quantity_mm',req.quantity)) FROM public.job_material_requirements req WHERE req.customer_tailoring_job_id=j.id) requirements,
 (SELECT jsonb_agg(jsonb_build_object('issue_id',mi.id,'issue_code',mi.code,'issued_by',mi.issued_by,'issued_at',mi.issued_at,
 'fabric_name',fab.name,'batch_code',b.code,'barcode',bc.code,'thaan_id',ml.thaan_id,'quantity_mm',ml.quantity,'movement_id',m.id))
 FROM public.material_issues mi JOIN public.material_issue_lines ml ON ml.material_issue_id=mi.id
 JOIN public.fabric_stock fs ON fs.id=ml.fabric_stock_id JOIN public.fabrics fab ON fab.id=fs.fabric_id
 JOIN public.receiving_batches b ON b.id=fs.batch_id JOIN public.barcodes bc ON bc.id=fs.barcode_id
 LEFT JOIN public.inventory_movements m ON m.material_issue_line_id=ml.id WHERE mi.customer_tailoring_job_id=j.id) issues
 FROM public.customer_tailoring_jobs j JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id
 JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections s ON s.id=a.section_id
 JOIN public.tailors t ON t.id=a.tailor_id JOIN public.orders o ON o.customer_tailoring_job_id=j.id AND o.tailoring_request_id IS NOT NULL
 JOIN public.locations l ON l.id=o.source_location_id WHERE j.request_id IS NOT NULL AND (p_job IS NULL OR j.id=p_job)
 AND (public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR public.owns_tailor_assignment(a.id))
 ORDER BY j.created_at DESC,j.id LIMIT greatest(1,least(coalesce(p_limit,50),200))) x),'[]'::jsonb);
END; $$;
CREATE OR REPLACE FUNCTION public.owner_customer_tailoring_costs(p_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF EXISTS(SELECT 1 FROM public.counter_tailoring_prices WHERE job_id=p_job) THEN RETURN(SELECT jsonb_build_object('pricing_mode','counter_total','fabric_cp_total_paise',fabric_cp_total_paise,'tailoring_charge_paise',NULL,'final_customer_price_paise',final_customer_price_paise,'cuts',cuts,'charge_version_id',NULL) FROM public.counter_tailoring_prices WHERE job_id=p_job); END IF;
 RETURN(SELECT jsonb_build_object('fabric_cp_total_paise',q.fabric_cp_total_paise,'tailoring_charge_paise',q.tailoring_charge_paise,
 'final_customer_price_paise',q.final_customer_price_paise,'cuts',q.cuts,'charge_version_id',q.charge_version_id)
 FROM public.customer_tailoring_jobs j JOIN public.customer_tailoring_quotes q ON q.id=j.quote_id WHERE j.id=p_job);
END; $$;
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
 WHEN 'production_jobs' THEN source_sql:=$q$ SELECT j.id::text row_key,j.created_at event_at,to_jsonb(j)||jsonb_build_object('product',p.name,'design',d.name,'factory',f.name,'section',s.name,'tailor',t.real_name,'received_pieces',(SELECT count(*) FROM public.finished_products WHERE production_job_id=j.id),'latest_cost_version_id',(SELECT id FROM public.production_cost_versions WHERE production_job_id=j.id ORDER BY revision DESC LIMIT 1)) data FROM public.production_jobs j JOIN public.products p ON p.id=j.product_id JOIN public.designs d ON d.id=j.design_id JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id $q$;
 WHEN 'production_costs' THEN source_sql:=$q$ SELECT v.id::text row_key,v.recorded_at event_at,to_jsonb(v)||jsonb_build_object('job',j.code,'finalized',EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=v.id AND payload ? 'materials'),'total_paise',(SELECT coalesce(sum(amount_paise),0)::text FROM public.production_cost_lines WHERE cost_version_id=v.id),'components',(SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('input',to_jsonb(input)) ORDER BY l.id) FROM public.production_cost_lines l LEFT JOIN public.production_cost_inputs input ON input.cost_line_id=l.id WHERE l.cost_version_id=v.id),'allocations',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.finished_product_id) FROM public.finished_product_cost_allocations a WHERE a.cost_version_id=v.id)) data FROM public.production_cost_versions v JOIN public.production_jobs j ON j.id=v.production_job_id $q$;
 WHEN 'finished_products' THEN source_sql:=$q$ SELECT p.id::text row_key,p.created_at event_at,jsonb_build_object('id',p.id,'barcode',b.code,'product',product.name,'design',d.name,'job',j.code,'piece_number',p.piece_number,'status',p.status,'location',l.name,'location_id',l.id,'quantity',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,p.current_location_id)::text END,'sp_paise',price.sp_paise::text,'production_cost_paise',(SELECT a.amount_paise::text FROM public.finished_product_cost_allocations a JOIN public.production_cost_versions v ON v.id=a.cost_version_id WHERE a.finished_product_id=p.id ORDER BY v.revision DESC LIMIT 1)) data FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id JOIN public.designs d ON d.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id JOIN public.locations l ON l.id=p.current_location_id LEFT JOIN public.inventory_items i ON i.finished_product_id=p.id LEFT JOIN LATERAL(SELECT * FROM public.finished_product_prices WHERE finished_product_id=p.id ORDER BY revision DESC LIMIT 1) price ON true $q$;
 WHEN 'transfers' THEN source_sql:=$q$ SELECT line.id::text row_key,t.posted_at event_at,to_jsonb(line)||jsonb_build_object('transfer',t.code,'status',t.status,'source',source.name,'destination',destination.name,'reason',t.reason,'actor_id',t.created_by,'posted_at',t.posted_at,'quantity',line.quantity::text) data FROM public.stock_transfer_lines line JOIN public.stock_transfers t ON t.id=line.transfer_id JOIN public.locations source ON source.id=t.source_location_id JOIN public.locations destination ON destination.id=t.destination_location_id $q$;
 WHEN 'movements' THEN source_sql:=$q$ SELECT m.id::text row_key,m.occurred_at event_at,to_jsonb(m)||jsonb_build_object('source',source.name,'destination',destination.name,'actor',p.full_name,'quantity',m.quantity::text) data FROM public.inventory_movements m LEFT JOIN public.locations source ON source.id=m.source_location_id LEFT JOIN public.locations destination ON destination.id=m.destination_location_id LEFT JOIN public.profiles p ON p.id=m.actor_id $q$;
 WHEN 'orders' THEN source_sql:=$q$
 SELECT o.id::text row_key,o.created_at event_at,to_jsonb(o)-'sale_request_payload'-'tailoring_request_payload'||jsonb_build_object('source',l.name,'final_customer_price_paise',o.final_customer_price_paise::text,'revenue_state',CASE WHEN o.status='completed' AND o.payment_confirmed_at IS NOT NULL THEN 'payment_confirmed' WHEN o.kind='customer_tailoring' THEN 'customer_tailoring_booking' ELSE 'not_payment_confirmed' END,'items',(SELECT jsonb_agg(to_jsonb(it)||jsonb_build_object('quantity',it.quantity::text,'sp_snapshot_paise',it.sp_snapshot_paise::text,'final_customer_price_paise',it.final_customer_price_paise::text,'financial_snapshot',to_jsonb(fi),'finished_sale_snapshot',to_jsonb(snapshot)) ORDER BY it.id) FROM public.order_items it LEFT JOIN public.order_item_financials fi ON fi.order_item_id=it.id LEFT JOIN public.finished_product_sale_snapshots snapshot ON snapshot.order_item_id=it.id WHERE it.order_id=o.id)) data FROM public.orders o JOIN public.locations l ON l.id=o.source_location_id
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
CREATE FUNCTION public.salesperson_work(p_salesperson uuid DEFAULT NULL,p_after timestamptz DEFAULT NULL,p_after_id uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE owner boolean:=public.has_role(auth.uid(),'owner');
BEGIN
 IF NOT owner AND (NOT public.has_role(auth.uid(),'salesperson') OR NOT public.has_perm(auth.uid(),'salesperson.view_work')) THEN RAISE EXCEPTION 'Salesperson work permission required'; END IF;
 IF NOT owner AND p_salesperson IS NOT NULL AND p_salesperson<>auth.uid() THEN RAISE EXCEPTION 'Only own Salesperson work is available'; END IF;
 IF (p_after IS NULL)<>(p_after_id IS NULL) THEN RAISE EXCEPTION 'Complete history cursor required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id DESC) FROM(
 SELECT o.id,o.code,o.kind,o.created_at,o.created_by,o.source_location_id,l.name source_name,o.salesperson_user_id,p.full_name salesperson_name,o.customer_snapshot,o.final_customer_price_paise::text final_customer_price_paise,
 j.id job_id,j.code job_code,j.garment,j.status job_status,f.name factory_name,s.name section_name,t.code tailor_code,t.real_name tailor_name,
 CASE WHEN j.id IS NOT NULL THEN (SELECT sum(quantity)::text FROM public.job_material_requirements WHERE customer_tailoring_job_id=j.id AND fabric_stock_id IS NOT NULL) ELSE (SELECT sum(quantity)::text FROM public.order_items WHERE order_id=o.id AND fabric_stock_id IS NOT NULL) END fabric_mm,
 coalesce((SELECT jsonb_agg(jsonb_build_object('barcode',bc.code,'fabric',fab.name,'batch',b.code,'quantity_mm',ml.quantity::text) ORDER BY ml.id) FROM public.material_issues mi JOIN public.material_issue_lines ml ON ml.material_issue_id=mi.id JOIN public.fabric_stock fs ON fs.id=ml.fabric_stock_id JOIN public.fabrics fab ON fab.id=fs.fabric_id JOIN public.receiving_batches b ON b.id=fs.batch_id JOIN public.barcodes bc ON bc.id=fs.barcode_id WHERE mi.customer_tailoring_job_id=j.id),
 (SELECT jsonb_agg(jsonb_build_object('barcode',bc.code,'fabric',fab.name,'batch',b.code,'quantity_mm',it.quantity::text) ORDER BY it.id) FROM public.order_items it JOIN public.fabric_stock fs ON fs.id=it.fabric_stock_id JOIN public.fabrics fab ON fab.id=fs.fabric_id JOIN public.receiving_batches b ON b.id=fs.batch_id JOIN public.barcodes bc ON bc.id=fs.barcode_id WHERE it.order_id=o.id),'[]'::jsonb) fabrics
 FROM public.orders o JOIN public.profiles p ON p.id=o.salesperson_user_id JOIN public.locations l ON l.id=o.source_location_id LEFT JOIN public.customer_tailoring_jobs j ON j.id=o.customer_tailoring_job_id LEFT JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id LEFT JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections s ON s.id=a.section_id LEFT JOIN public.tailors t ON t.id=a.tailor_id
 WHERE o.status='completed' AND (owner OR o.salesperson_user_id=auth.uid()) AND (p_salesperson IS NULL OR o.salesperson_user_id=p_salesperson) AND (p_after IS NULL OR (o.created_at,o.id)<(p_after,p_after_id)) ORDER BY o.created_at DESC,o.id DESC LIMIT greatest(1,least(coalesce(p_limit,50),200))) x),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.require_salesperson(uuid),public.guard_salesperson_attribution() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.salesperson_options(),public.salesperson_work(uuid,timestamptz,uuid,integer),public.book_counter_tailoring(uuid,uuid,jsonb,bigint,uuid,uuid,uuid,text,text),public.complete_counter_fabric_sale(uuid,uuid,jsonb,uuid,boolean,text,uuid),public.complete_finished_product_sale(uuid,uuid,jsonb,uuid,boolean,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.salesperson_options(),public.salesperson_work(uuid,timestamptz,uuid,integer),public.book_counter_tailoring(uuid,uuid,jsonb,bigint,uuid,uuid,uuid,text,text),public.complete_counter_fabric_sale(uuid,uuid,jsonb,uuid,boolean,text,uuid),public.complete_finished_product_sale(uuid,uuid,jsonb,uuid,boolean,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
