-- Prospective combined bills. Existing orders and audit are not rewritten.
ALTER TABLE public.orders DROP CONSTRAINT orders_kind_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_kind_check CHECK(kind IN('direct_fabric_sale','customer_tailoring','finished_product_sale','ecommerce_sale','counter_bill'));
ALTER TABLE public.customer_tailoring_jobs ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE public.orders DROP CONSTRAINT orders_check1;
CREATE TABLE public.counter_bills (
 order_id uuid PRIMARY KEY REFERENCES public.orders(id) DEFERRABLE INITIALLY DEFERRED,
 request_id uuid NOT NULL UNIQUE,actor_id uuid NOT NULL REFERENCES public.profiles(id),payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.counter_bill_payments (
 bill_id uuid PRIMARY KEY REFERENCES public.counter_bills(order_id),request_id uuid NOT NULL UNIQUE,
 amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 0 AND 9007199254740991),paid_at timestamptz NOT NULL DEFAULT clock_timestamp(),actor_id uuid NOT NULL REFERENCES public.profiles(id)
);
CREATE TABLE public.counter_tailoring_details (
 job_id uuid PRIMARY KEY REFERENCES public.customer_tailoring_jobs(id),bill_id uuid NOT NULL REFERENCES public.counter_bills(order_id),delivery_date date NOT NULL,
 design_id uuid REFERENCES public.designs(id),custom_design text,design_name_snapshot text,design_code_snapshot text,
 CHECK(design_id IS NULL OR custom_design IS NULL)
);
CREATE TABLE public.customer_issue_fabric_costs (
 issue_line_id uuid PRIMARY KEY REFERENCES public.material_issue_lines(id),fabric_cost_id uuid NOT NULL REFERENCES public.fabric_stock_costs(id),cp_paise_per_m bigint NOT NULL CHECK(cp_paise_per_m>0),amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 0 AND 9007199254740991),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.counter_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counter_bill_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counter_tailoring_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_issue_fabric_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.counter_bills,public.counter_bill_payments,public.counter_tailoring_details,public.customer_issue_fabric_costs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.counter_bills,public.counter_bill_payments,public.counter_tailoring_details,public.customer_issue_fabric_costs TO authenticated;
GRANT ALL ON public.counter_bills,public.counter_bill_payments,public.counter_tailoring_details,public.customer_issue_fabric_costs TO service_role;
CREATE POLICY counter_bills_read ON public.counter_bills FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','counter']));
CREATE POLICY counter_payments_read ON public.counter_bill_payments FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','counter']));
CREATE POLICY counter_tailoring_details_read ON public.counter_tailoring_details FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR (public.has_role(auth.uid(),'tailor') AND EXISTS(SELECT 1 FROM public.customer_tailoring_jobs j WHERE j.id=job_id AND public.owns_tailor_assignment(j.tailor_assignment_id))));
CREATE POLICY customer_issue_cost_read ON public.customer_issue_fabric_costs FOR SELECT TO authenticated USING(public.can_view_thaan_cp(NULL));
CREATE TRIGGER counter_bill_immutable BEFORE UPDATE OR DELETE ON public.counter_bills FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER counter_payment_immutable BEFORE UPDATE OR DELETE ON public.counter_bill_payments FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER counter_tailoring_details_immutable BEFORE UPDATE OR DELETE ON public.counter_tailoring_details FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER customer_issue_cost_immutable BEFORE UPDATE OR DELETE ON public.customer_issue_fabric_costs FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE FUNCTION public.capture_customer_issue_cost() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cost public.fabric_stock_costs%rowtype;amount numeric;
BEGIN
 IF NEW.thaan_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.material_issues WHERE id=NEW.material_issue_id AND customer_tailoring_job_id IS NOT NULL) THEN
  PERFORM 1 FROM public.fabric_stock WHERE id=NEW.fabric_stock_id FOR UPDATE;
  SELECT * INTO cost FROM public.fabric_stock_costs WHERE fabric_stock_id=NEW.fabric_stock_id ORDER BY revision DESC LIMIT 1;
  IF cost.id IS NULL OR cost.cp_paise_per_m<=0 THEN RAISE EXCEPTION 'Positive recorded Thaan CP required'; END IF;
  amount:=round(NEW.quantity*cost.cp_paise_per_m/1000);
  IF amount NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Issued fabric CP exceeds supported range'; END IF;
  INSERT INTO public.customer_issue_fabric_costs(issue_line_id,fabric_cost_id,cp_paise_per_m,amount_paise) VALUES(NEW.id,cost.id,cost.cp_paise_per_m,amount);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER capture_customer_fabric_issue AFTER INSERT ON public.material_issue_lines FOR EACH ROW EXECUTE FUNCTION public.capture_customer_issue_cost();
REVOKE ALL ON FUNCTION public.capture_customer_issue_cost() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.complete_counter_bill(p_request uuid,p_source uuid,p_items jsonb,p_tailoring jsonb,p_paid boolean,p_salesperson uuid,p_customer uuid DEFAULT NULL,p_name text DEFAULT NULL,p_contact text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid:=gen_random_uuid();saved public.counter_bills%rowtype;payload_value jsonb;customer_id uuid;contact jsonb;row_value jsonb;booked_job uuid;item_id uuid;inv uuid;th public.thaans%rowtype;piece public.finished_products%rowtype;price public.finished_product_prices%rowtype;qty numeric;sp bigint;amount bigint;cp bigint;total numeric:=0;cost_id uuid;reviewed_id uuid;cost_amount bigint;evidence jsonb;group_price bigint;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') THEN RAISE EXCEPTION 'Counter billing permission required'; END IF;
 IF p_request IS NULL OR p_source IS NULL OR p_paid IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_typeof(p_tailoring) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)+jsonb_array_length(p_tailoring) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Request, floor, payment state and 1–100 bill entries required'; END IF;
 IF NOT p_paid AND jsonb_array_length(p_tailoring)=0 THEN RAISE EXCEPTION 'Unpaid is available only on bills containing Customer Tailoring'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'source',p_source,'items',p_items,'tailoring',p_tailoring,'paid',p_paid,'salesperson',p_salesperson,'customer',p_customer,'name',nullif(btrim(p_name),''),'contact',nullif(btrim(p_contact),''));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,6));
 SELECT * INTO saved FROM public.counter_bills WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Bill retry requires identical data'; END IF;RETURN saved.order_id; END IF;
 IF EXISTS(SELECT 1 FROM public.orders WHERE sale_request_id=p_request) THEN RAISE EXCEPTION 'Request already used by another bill'; END IF;
 PERFORM public.require_salesperson(p_salesperson);
 IF NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=p_source AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom'))) THEN RAISE EXCEPTION 'Active Showroom floor required'; END IF;
 IF p_customer IS NOT NULL THEN SELECT id INTO customer_id FROM public.customers WHERE id=p_customer FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Selected customer does not exist'; END IF;
 ELSE customer_id:=public.find_or_create_customer(p_name,p_contact,NULL,NULL);END IF;
 IF customer_id IS NOT NULL THEN SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO contact FROM public.customers WHERE id=customer_id;
 ELSE contact:=jsonb_build_object('name',NULL,'phone',NULL);END IF;
 -- Lock every stock parent/item once across direct-sale and tailoring cuts.
 PERFORM 1 FROM public.fabric_stock WHERE id IN(SELECT t.fabric_stock_id FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id WHERE i.id IN(SELECT (value->>'inventory_item_id')::uuid FROM jsonb_array_elements(p_items) UNION ALL SELECT (cut->>'inventory_item_id')::uuid FROM jsonb_array_elements(p_tailoring) g CROSS JOIN LATERAL jsonb_array_elements(g->'items') cut)) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.production_jobs WHERE id IN(SELECT fp.production_job_id FROM public.finished_products fp JOIN jsonb_array_elements(p_items) x ON fp.id=(x->>'piece_id')::uuid) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items WHERE id IN(SELECT (value->>'inventory_item_id')::uuid FROM jsonb_array_elements(p_items) UNION ALL SELECT (cut->>'inventory_item_id')::uuid FROM jsonb_array_elements(p_tailoring) g CROSS JOIN LATERAL jsonb_array_elements(g->'items') cut) OR finished_product_id IN(SELECT (value->>'piece_id')::uuid FROM jsonb_array_elements(p_items)) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.locations WHERE id=p_source AND active FOR UPDATE;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) WHERE jsonb_typeof(value) IS DISTINCT FROM 'object' OR coalesce(value->>'kind','') NOT IN('fabric','product') OR (value->>'kind'='fabric' AND (value-ARRAY['kind','inventory_item_id','quantity','sp_paise_per_m'])<>'{}') OR (value->>'kind'='product' AND (value-ARRAY['kind','piece_id','sp_version_id'])<>'{}')) THEN RAISE EXCEPTION 'Only explicit fabric cuts or saved-price pieces accepted'; END IF;
 IF (SELECT count(DISTINCT value->>'inventory_item_id') FROM jsonb_array_elements(p_items) WHERE value->>'kind'='fabric')<>(SELECT count(*) FROM jsonb_array_elements(p_items) WHERE value->>'kind'='fabric') OR (SELECT count(DISTINCT value->>'piece_id') FROM jsonb_array_elements(p_items) WHERE value->>'kind'='product')<>(SELECT count(*) FROM jsonb_array_elements(p_items) WHERE value->>'kind'='product') THEN RAISE EXCEPTION 'Combine duplicate retail cuts; each piece may appear once'; END IF;
 INSERT INTO public.counter_bills(order_id,request_id,actor_id,payload) VALUES(result,p_request,auth.uid(),payload_value);
 INSERT INTO public.orders(id,code,kind,customer_id,source_location_id,created_by,salesperson_user_id,reference,sale_request_id,sale_request_payload,customer_snapshot,payment_confirmed_at)
 VALUES(result,'BILL-'||replace(result::text,'-',''),'counter_bill',customer_id,p_source,auth.uid(),p_salesperson,'Counter bill',p_request,payload_value,contact,CASE WHEN p_paid THEN clock_timestamp() END);
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_tailoring) LOOP
  IF jsonb_typeof(row_value) IS DISTINCT FROM 'object' OR (row_value-ARRAY['items','garment','delivery_date','assignment_id','total_paise','notes','design_id','custom_design'])<>'{}' OR nullif(row_value->>'delivery_date','') IS NULL OR jsonb_typeof(row_value->'total_paise') IS DISTINCT FROM 'number' OR (row_value->>'total_paise')::numeric<>trunc((row_value->>'total_paise')::numeric) THEN RAISE EXCEPTION 'Tailoring garment, delivery date, assignment, fabric cuts and exact whole-job total required'; END IF;
  IF nullif(row_value->>'design_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.designs WHERE id=(row_value->>'design_id')::uuid AND active) THEN RAISE EXCEPTION 'Active customer design required'; END IF;
  IF nullif(row_value->>'design_id','') IS NOT NULL AND nullif(btrim(row_value->>'custom_design'),'') IS NOT NULL THEN RAISE EXCEPTION 'Choose predefined or custom customer design'; END IF;
  IF row_value ? 'custom_design' AND (nullif(btrim(row_value->>'custom_design'),'') IS NULL OR length(btrim(row_value->>'custom_design'))>120) THEN RAISE EXCEPTION 'Enter a custom design up to 120 characters'; END IF;
  group_price:=(row_value->>'total_paise')::bigint;
  booked_job:=public.book_invoice_tailoring(gen_random_uuid(),p_source,row_value->'items',group_price,customer_id,(row_value->>'assignment_id')::uuid,p_salesperson,row_value->>'garment',row_value->>'notes');
  INSERT INTO public.counter_tailoring_details(job_id,bill_id,delivery_date,design_id,custom_design,design_name_snapshot,design_code_snapshot)
  VALUES(booked_job,result,(row_value->>'delivery_date')::date,(row_value->>'design_id')::uuid,nullif(btrim(row_value->>'custom_design'),''),coalesce((SELECT name FROM public.designs WHERE id=(row_value->>'design_id')::uuid),nullif(btrim(row_value->>'custom_design'),'')),(SELECT code FROM public.designs WHERE id=(row_value->>'design_id')::uuid));
  INSERT INTO public.order_items(order_id,customer_tailoring_job_id,quantity,unit,final_customer_price_paise) VALUES(result,booked_job,1,'job',group_price) RETURNING id INTO item_id;
  INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise) SELECT item_id,fabric_cp_total_paise FROM public.counter_tailoring_prices WHERE job_id=booked_job;
  total:=total+group_price;
 END LOOP;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY coalesce(value->>'inventory_item_id',value->>'piece_id') LOOP
  IF row_value->>'kind'='fabric' THEN
   IF NOT public.has_perm(auth.uid(),'pos.enter_price') THEN RAISE EXCEPTION 'Fabric sale pricing permission required'; END IF;
   qty:=(row_value->>'quantity')::numeric;
   IF qty IS NULL OR qty<=0 OR qty<>trunc(qty) OR qty>2147483647 OR jsonb_typeof(row_value->'quantity') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Positive exact millimetres required'; END IF;
   IF jsonb_typeof(row_value->'sp_paise_per_m') IS DISTINCT FROM 'number' OR (row_value->>'sp_paise_per_m')::numeric<>trunc((row_value->>'sp_paise_per_m')::numeric) OR (row_value->>'sp_paise_per_m')::numeric NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Exact nonnegative per-metre selling price required'; END IF;
   inv:=(row_value->>'inventory_item_id')::uuid;
   SELECT t.* INTO th FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id JOIN public.fabric_stock s ON s.id=t.fabric_stock_id WHERE i.id=inv AND i.unit='mm' AND t.status='active' AND s.entry_state IN('complete','correcting','legacy_pending');
   IF NOT FOUND THEN RAISE EXCEPTION 'Located active Thaan required'; END IF;
   SELECT cp_paise_per_m INTO cp FROM public.fabric_stock_costs WHERE fabric_stock_id=th.fabric_stock_id ORDER BY revision DESC LIMIT 1;
   IF cp IS NULL OR cp<=0 THEN RAISE EXCEPTION 'Positive recorded Thaan CP required'; END IF;
   sp:=(row_value->>'sp_paise_per_m')::bigint;amount:=round(qty*sp/1000);
   INSERT INTO public.order_items(order_id,fabric_stock_id,thaan_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) VALUES(result,th.fabric_stock_id,th.id,qty,'mm',sp,amount) RETURNING id INTO item_id;
   INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise) VALUES(item_id,cp);
   INSERT INTO public.inventory_movements(kind,inventory_item_id,fabric_stock_id,thaan_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference) VALUES('SALE',inv,th.fabric_stock_id,th.id,qty,'mm',p_source,item_id,auth.uid(),'Counter fabric sale','ORDER:'||result::text);
   IF public.inventory_balance(inv,NULL)=0 THEN UPDATE public.thaans SET status='depleted',updated_at=now() WHERE id=th.id; END IF;
  ELSE
   SELECT * INTO piece FROM public.finished_products WHERE id=(row_value->>'piece_id')::uuid AND status='available' AND current_location_id=p_source FOR UPDATE;
   SELECT id INTO inv FROM public.inventory_items WHERE finished_product_id=piece.id AND unit='pc';
   IF piece.id IS NULL OR inv IS NULL OR public.inventory_balance(inv,p_source)<>1 THEN RAISE EXCEPTION 'Available physical piece on selected floor required'; END IF;
   SELECT * INTO price FROM public.finished_product_prices WHERE finished_product_id=piece.id ORDER BY revision DESC LIMIT 1;
   IF price.id IS NULL OR price.id IS DISTINCT FROM (row_value->>'sp_version_id')::uuid THEN RAISE EXCEPTION 'Saved product SP changed; refresh'; END IF;
   SELECT cost_version_id INTO reviewed_id FROM public.finished_product_price_reviews WHERE price_id=price.id;
   SELECT id INTO cost_id FROM public.production_cost_versions WHERE production_job_id=piece.production_job_id ORDER BY revision DESC LIMIT 1;
   SELECT amount_paise INTO cost_amount FROM public.finished_product_cost_allocations WHERE finished_product_id=piece.id AND cost_version_id=cost_id;
   IF reviewed_id IS DISTINCT FROM cost_id OR cost_amount IS NULL OR NOT EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=cost_id AND payload ? 'materials') THEN RAISE EXCEPTION 'Recorded piece CP and reviewed saved SP required'; END IF;
   SELECT jsonb_build_object('quantity_snapshot',v.quantity_snapshot,'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.production_cost_lines l WHERE l.cost_version_id=v.id),'[]')) INTO evidence FROM public.production_cost_versions v WHERE v.id=cost_id;
   amount:=price.sp_paise;
   INSERT INTO public.order_items(order_id,finished_product_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) VALUES(result,piece.id,1,'pc',amount,amount) RETURNING id INTO item_id;
   INSERT INTO public.order_item_financials(order_item_id,production_cost_snapshot_paise) VALUES(item_id,cost_amount);
   INSERT INTO public.finished_product_sale_snapshots(order_item_id,price_version_id,cost_version_id,reviewed_cost_version_id,cost_evidence,item_snapshot)
   VALUES(item_id,price.id,cost_id,reviewed_id,evidence,(SELECT jsonb_build_object('barcode',b.code,'product',product.name,'design',ctx->>'design','size',ctx->>'size','job_code',j.code,'piece_number',piece.piece_number,'source',loc.name,'actor',actor.full_name) FROM public.barcodes b JOIN public.products product ON product.id=piece.product_id JOIN public.production_jobs j ON j.id=piece.production_job_id JOIN public.locations loc ON loc.id=p_source LEFT JOIN public.profiles actor ON actor.id=auth.uid() CROSS JOIN LATERAL public.production_piece_context(piece.id) ctx WHERE b.id=piece.barcode_id));
   INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference) VALUES(inv,'SALE',piece.id,1,'pc',p_source,item_id,auth.uid(),'Counter finished-product sale','ORDER:'||result::text);
   UPDATE public.finished_products SET status='sold' WHERE id=piece.id;
  END IF;
  total:=total+amount;
 END LOOP;
 IF total NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Bill exceeds supported exact money range'; END IF;
 UPDATE public.orders SET status='completed',final_customer_price_paise=total::bigint,completed_at=clock_timestamp() WHERE id=result;
 PERFORM public.capture_counter_print_record(result);
 IF p_paid THEN INSERT INTO public.counter_bill_payments(bill_id,request_id,amount_paise,actor_id) VALUES(result,p_request,total::bigint,auth.uid());END IF;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'complete_counter_bill','orders',result,jsonb_build_object('paid',p_paid,'total_paise',total,'source',p_source),'BILL:'||p_request::text);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.complete_counter_bill(uuid,uuid,jsonb,jsonb,boolean,uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_counter_bill(uuid,uuid,jsonb,jsonb,boolean,uuid,uuid,text,text) TO authenticated;

CREATE FUNCTION public.mark_counter_bill_paid(p_request uuid,p_bill uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%rowtype;saved public.counter_bill_payments%rowtype;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') THEN RAISE EXCEPTION 'Counter payment permission required'; END IF;
 IF p_request IS NULL OR p_bill IS NULL THEN RAISE EXCEPTION 'Payment request and bill required'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_bill AND kind='counter_bill' AND status='completed' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Completed counter bill required'; END IF;
 SELECT * INTO saved FROM public.counter_bill_payments WHERE bill_id=p_bill OR request_id=p_request;
 IF FOUND THEN IF saved.bill_id<>p_bill THEN RAISE EXCEPTION 'Payment request used for another bill'; END IF;RETURN p_bill;END IF;
 INSERT INTO public.counter_bill_payments(bill_id,request_id,amount_paise,actor_id) VALUES(p_bill,p_request,o.final_customer_price_paise,auth.uid());
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'counter_bill_paid','orders',p_bill,jsonb_build_object('amount_paise',o.final_customer_price_paise),'PAYMENT:'||p_request::text);
 RETURN p_bill;
END; $$;
REVOKE ALL ON FUNCTION public.mark_counter_bill_paid(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mark_counter_bill_paid(uuid,uuid) TO authenticated;
