BEGIN;
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

CREATE OR REPLACE FUNCTION public.validate_domain_links() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_row record; v_parent record; v_unit text; v_used numeric;
BEGIN
  IF TG_TABLE_NAME IN ('job_material_requirements','material_issue_lines','stock_transfer_lines','inventory_movements') THEN
    IF NEW.material_id IS NOT NULL THEN
      SELECT unit INTO v_unit FROM public.materials WHERE id = NEW.material_id;
      IF NEW.unit IS DISTINCT FROM v_unit THEN RAISE EXCEPTION 'Consumable unit must match catalogue'; END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'material_issues' THEN
    IF NEW.customer_tailoring_job_id IS NOT NULL THEN
      SELECT tailor_assignment_id INTO v_row FROM public.customer_tailoring_jobs WHERE id = NEW.customer_tailoring_job_id;
    ELSE
      SELECT tailor_assignment_id INTO v_row FROM public.production_jobs WHERE id = NEW.production_job_id;
    END IF;
    IF NEW.tailor_assignment_id IS DISTINCT FROM v_row.tailor_assignment_id THEN
      RAISE EXCEPTION 'Material Issue must snapshot the job assignment';
    END IF;
  ELSIF TG_TABLE_NAME = 'orders' THEN
    IF NEW.customer_tailoring_job_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.customer_tailoring_jobs
        WHERE id = NEW.customer_tailoring_job_id AND customer_id IS NOT DISTINCT FROM NEW.customer_id) THEN
        RAISE EXCEPTION 'Order customer must match Customer Tailoring Job';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'order_items' THEN
    SELECT * INTO v_parent FROM public.orders WHERE id = NEW.order_id;
    IF (v_parent.kind = 'direct_fabric_sale' AND NEW.thaan_id IS NULL)
      OR (v_parent.kind = 'finished_product_sale' AND NEW.finished_product_id IS NULL)
      OR (v_parent.kind = 'customer_tailoring' AND NEW.customer_tailoring_job_id IS DISTINCT FROM v_parent.customer_tailoring_job_id) THEN
      RAISE EXCEPTION 'Order item type/job must match order';
    END IF;
  ELSIF TG_TABLE_NAME = 'finished_product_materials' THEN
    SELECT l.unit, l.quantity, i.production_job_id INTO v_row FROM public.material_issue_lines l
      JOIN public.material_issues i ON i.id = l.material_issue_id WHERE l.id = NEW.material_issue_line_id FOR UPDATE OF l;
    IF NEW.production_job_id IS DISTINCT FROM v_row.production_job_id OR NEW.unit IS DISTINCT FROM v_row.unit THEN
      RAISE EXCEPTION 'Finished Product material must originate from its Production Job in the same unit';
    END IF;
    SELECT coalesce(sum(quantity),0) INTO v_used FROM public.finished_product_materials
      WHERE material_issue_line_id = NEW.material_issue_line_id AND id <> NEW.id;
    IF v_used + NEW.quantity > v_row.quantity THEN RAISE EXCEPTION 'Piece allocations exceed issued material'; END IF;
  ELSIF TG_TABLE_NAME = 'inventory_movements' THEN
    IF NEW.stock_transfer_line_id IS NOT NULL THEN
      SELECT l.*, t.source_location_id, t.destination_location_id INTO v_row
        FROM public.stock_transfer_lines l JOIN public.stock_transfers t ON t.id = l.transfer_id
        WHERE l.id = NEW.stock_transfer_line_id;
      IF NEW.kind <> 'TRANSFER' OR
        (NEW.thaan_id,NEW.material_id,NEW.finished_product_id,NEW.fabric_stock_id,NEW.quantity,NEW.unit,NEW.source_location_id,NEW.destination_location_id)
        IS DISTINCT FROM
        (v_row.thaan_id,v_row.material_id,v_row.finished_product_id,v_row.fabric_stock_id,v_row.quantity,v_row.unit,v_row.source_location_id,v_row.destination_location_id) THEN
        RAISE EXCEPTION 'Transfer movement must match its transfer line and locations';
      END IF;
    END IF;
    IF NEW.material_issue_line_id IS NOT NULL THEN
      SELECT l.*, i.source_location_id,i.customer_tailoring_job_id,i.production_job_id INTO v_row
        FROM public.material_issue_lines l JOIN public.material_issues i ON i.id = l.material_issue_id
        WHERE l.id = NEW.material_issue_line_id;
      IF NEW.kind <> 'MATERIAL_ISSUE' OR NEW.finished_product_id IS NOT NULL OR
        (NEW.thaan_id,NEW.material_id,NEW.fabric_stock_id,NEW.quantity,NEW.unit,NEW.source_location_id,NEW.customer_tailoring_job_id,NEW.production_job_id)
        IS DISTINCT FROM
        (v_row.thaan_id,v_row.material_id,v_row.fabric_stock_id,v_row.quantity,v_row.unit,v_row.source_location_id,v_row.customer_tailoring_job_id,v_row.production_job_id) THEN
        RAISE EXCEPTION 'Issue movement must match its material line, job and source';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'customer_tailoring_prices' THEN
    IF NOT EXISTS (SELECT 1 FROM public.tailoring_charge_versions
      WHERE id = NEW.charge_version_id AND amount_paise = NEW.tailoring_charge_paise) THEN
      RAISE EXCEPTION 'Tailoring price must snapshot the selected charge amount';
    END IF;
  ELSIF TG_TABLE_NAME = 'production_cost_versions' THEN
    IF NOT EXISTS (SELECT 1 FROM public.production_jobs
      WHERE id = NEW.production_job_id AND quantity = NEW.quantity_snapshot) THEN
      RAISE EXCEPTION 'Cost quantity must snapshot the Production Job';
    END IF;
  ELSIF TG_TABLE_NAME = 'production_cost_lines' THEN
    SELECT v.production_job_id, j.design_id INTO v_parent FROM public.production_cost_versions v
      JOIN public.production_jobs j ON j.id = v.production_job_id WHERE v.id = NEW.cost_version_id;
    IF NEW.design_charge_version_id IS NOT NULL THEN
      IF NEW.category <> 'design_embroidery' OR NOT EXISTS (
        SELECT 1 FROM public.design_charge_versions d
        WHERE d.id = NEW.design_charge_version_id AND d.design_id = v_parent.design_id
      ) THEN RAISE EXCEPTION 'Design cost must reference the Production Job design'; END IF;
    END IF;
    IF NEW.material_issue_line_id IS NOT NULL THEN
      SELECT l.fabric_stock_id,i.production_job_id INTO v_row FROM public.material_issue_lines l
        JOIN public.material_issues i ON i.id = l.material_issue_id WHERE l.id = NEW.material_issue_line_id;
      IF v_row.production_job_id IS DISTINCT FROM v_parent.production_job_id THEN
        RAISE EXCEPTION 'Material cost must originate from the same Production Job';
      END IF;
      IF NEW.fabric_cost_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.fabric_stock_costs c WHERE c.id = NEW.fabric_cost_id AND c.fabric_stock_id = v_row.fabric_stock_id
      ) THEN RAISE EXCEPTION 'Fabric cost must match the issued Fabric + Batch'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.book_invoice_tailoring(p_request uuid,p_source uuid,p_items jsonb,p_final_price bigint,p_customer uuid,p_assignment uuid,p_salesperson uuid,p_garment text,p_notes text DEFAULT NULL) RETURNS uuid
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
 IF p_customer IS NULL THEN contact:=jsonb_build_object('name',NULL,'phone',NULL);
 ELSE SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO contact FROM public.customers WHERE id=p_customer FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer required'; END IF; END IF;
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
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'book_invoice_tailoring','customer_tailoring_jobs',v_job,jsonb_build_object('order_id',v_order,'issue_id',v_issue,'final_customer_price_paise',p_final_price,'salesperson',p_salesperson),'REQUEST:'||p_request::text);
 RETURN v_job;
END; $$;
REVOKE ALL ON FUNCTION public.book_invoice_tailoring(uuid,uuid,jsonb,bigint,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;

CREATE TABLE public.counter_bill_print_records (
 bill_id uuid PRIMARY KEY REFERENCES public.counter_bills(order_id),document jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.counter_bill_print_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.counter_bill_print_records FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.counter_bill_print_records TO authenticated;
GRANT ALL ON public.counter_bill_print_records TO service_role;
CREATE POLICY counter_print_read ON public.counter_bill_print_records FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','counter']));
CREATE TRIGGER counter_print_immutable BEFORE UPDATE OR DELETE ON public.counter_bill_print_records FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE FUNCTION public.capture_counter_print_record(p_bill uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 INSERT INTO public.counter_bill_print_records(bill_id,document)
 SELECT o.id,jsonb_build_object('id',o.id,'code',o.code,'created_at',o.completed_at,'total_paise',o.final_customer_price_paise::text,'customer',o.customer_snapshot,'source',loc.name,'salesperson',person.full_name,
 'lines',(SELECT jsonb_agg(jsonb_build_object('id',it.id,'kind',CASE WHEN it.customer_tailoring_job_id IS NOT NULL THEN 'tailoring' WHEN it.thaan_id IS NOT NULL THEN 'fabric' ELSE 'product' END,
 'barcode',coalesce(v.code,t.barcode,fb.code,pb.code),'name',coalesce(g.name,f.name,product.name,job.garment),'size',context->>'size','design',coalesce(context->>'design',detail.design_name_snapshot),
 'quantity',it.quantity::text,'unit',it.unit,'price_paise',it.sp_snapshot_paise::text,'amount_paise',it.final_customer_price_paise::text,'job_id',job.id,'job_code',job.code,'delivery_date',detail.delivery_date,
 'fabrics',(SELECT jsonb_agg(jsonb_build_object('barcode',coalesce(rv.code,tt.barcode,bc.code),'name',ff.name,'quantity_mm',cut->>'quantity')) FROM public.counter_tailoring_prices quote CROSS JOIN LATERAL jsonb_array_elements(quote.cuts) cut JOIN public.thaans tt ON tt.id=(cut->>'thaan_id')::uuid JOIN public.fabric_stock s ON s.id=tt.fabric_stock_id JOIN public.fabrics ff ON ff.id=tt.fabric_id LEFT JOIN public.stock_registration_variants rv ON rv.thaan_id=tt.id LEFT JOIN public.barcodes bc ON bc.id=s.barcode_id WHERE quote.job_id=job.id)) ORDER BY it.id)
 FROM public.order_items it LEFT JOIN public.thaans t ON t.id=it.thaan_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id LEFT JOIN public.fabric_stock fs ON fs.id=it.fabric_stock_id LEFT JOIN public.barcodes fb ON fb.id=fs.barcode_id LEFT JOIN public.fabrics f ON f.id=t.fabric_id LEFT JOIN public.finished_products piece ON piece.id=it.finished_product_id LEFT JOIN public.products product ON product.id=piece.product_id LEFT JOIN public.barcodes pb ON pb.id=piece.barcode_id LEFT JOIN LATERAL public.production_piece_context(piece.id) context ON piece.id IS NOT NULL LEFT JOIN public.customer_tailoring_jobs job ON job.id=it.customer_tailoring_job_id LEFT JOIN public.counter_tailoring_details detail ON detail.job_id=job.id WHERE it.order_id=o.id))
 FROM public.orders o JOIN public.locations loc ON loc.id=o.source_location_id LEFT JOIN public.profiles person ON person.id=o.salesperson_user_id WHERE o.id=p_bill;
$$;
REVOKE ALL ON FUNCTION public.capture_counter_print_record(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.counter_bill(p_code text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Counter billing access required'; END IF;
 SELECT print.document||jsonb_build_object('paid',payment.bill_id IS NOT NULL,'paid_at',payment.paid_at) INTO result FROM public.counter_bill_print_records print JOIN public.orders o ON o.id=print.bill_id LEFT JOIN public.counter_bill_payments payment ON payment.bill_id=o.id WHERE o.code=btrim(p_code) OR o.id::text=btrim(p_code);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.counter_bill(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.counter_bill(text) TO authenticated;

CREATE FUNCTION public.counter_scan_barcode(p_barcode text,p_source uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE data jsonb;piece public.finished_products%rowtype;variants jsonb;exact jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Counter access required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=p_source AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom'))) THEN RAISE EXCEPTION 'Select an active Showroom floor'; END IF;
 SELECT p.* INTO piece FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id WHERE b.code=btrim(p_barcode);
 IF FOUND THEN
  data:=public.finished_product_sale_scan(btrim(p_barcode));
  RETURN jsonb_build_object('kind','product','id',piece.id,'barcode',p_barcode,'name',data->>'product','design',public.production_piece_context(piece.id)->>'design','size',public.production_piece_context(piece.id)->>'size','sp_paise',data->'sp_paise','sp_version_id',data->>'sp_version_id','available',piece.status='available' AND piece.current_location_id=p_source AND coalesce((SELECT public.inventory_balance(i.id,p_source) FROM public.inventory_items i WHERE i.finished_product_id=piece.id),0)=1);
 END IF;
 variants:=public.pos_reserve_variants(btrim(p_barcode));
 SELECT value INTO exact FROM jsonb_array_elements(variants) WHERE value->>'barcode'=btrim(p_barcode) LIMIT 1;
 IF exact IS NULL THEN SELECT value INTO exact FROM jsonb_array_elements(public.direct_fabric_sale_catalog(btrim(p_barcode))) LIMIT 1;END IF;
 IF exact IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('kind','fabric','barcode',exact->>'barcode','name',exact->>'fabric_name','batch',exact->>'batch_code','cuts',exact->'cuts','variants',variants);
END; $$;
REVOKE ALL ON FUNCTION public.counter_scan_barcode(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.counter_scan_barcode(text,uuid) TO authenticated;

CREATE FUNCTION public.customer_tailoring_work(p_code text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE owner boolean:=public.has_role(auth.uid(),'owner');counter boolean:=public.has_role(auth.uid(),'counter');
BEGIN
 IF NOT owner AND NOT counter AND NOT (public.has_role(auth.uid(),'tailor') AND public.has_perm(auth.uid(),'tailoring.manage_jobs')) THEN RAISE EXCEPTION 'Customer Tailoring access required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',j.id,'code',j.code,'bill_id',d.bill_id,'bill_code',o.code,'garment',j.garment,'status',j.status,'delivery_date',d.delivery_date,'customer',c.name,'contact',c.phone,'factory',f.name,'tailor',t.real_name,'paid',CASE WHEN d.bill_id IS NOT NULL THEN EXISTS(SELECT 1 FROM public.counter_bill_payments WHERE bill_id=d.bill_id) END,
 'total_paise',CASE WHEN owner OR counter THEN price.final_customer_price_paise::text END,
 'cp_paise',CASE WHEN public.can_view_thaan_cp(NULL) AND price.fabric_cp_total_paise IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.material_issue_lines line JOIN public.material_issues issue ON issue.id=line.material_issue_id LEFT JOIN public.customer_issue_fabric_costs cost ON cost.issue_line_id=line.id WHERE issue.customer_tailoring_job_id=j.id AND issue.issue_type='additional' AND line.thaan_id IS NOT NULL AND cost.issue_line_id IS NULL) THEN (price.fabric_cp_total_paise+coalesce((SELECT sum(cost.amount_paise) FROM public.customer_issue_fabric_costs cost JOIN public.material_issue_lines line ON line.id=cost.issue_line_id JOIN public.material_issues issue ON issue.id=line.material_issue_id WHERE issue.customer_tailoring_job_id=j.id AND issue.issue_type='additional'),0))::text END)
 ORDER BY j.created_at DESC,j.id) FROM public.customer_tailoring_jobs j LEFT JOIN public.customers c ON c.id=j.customer_id JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id JOIN public.tailors t ON t.id=a.tailor_id LEFT JOIN public.counter_tailoring_details d ON d.job_id=j.id LEFT JOIN public.orders o ON o.id=d.bill_id LEFT JOIN public.counter_tailoring_prices price ON price.job_id=j.id
 WHERE (owner OR counter OR public.owns_tailor_assignment(j.tailor_assignment_id)) AND (nullif(btrim(p_code),'') IS NULL OR j.code=btrim(p_code) OR j.id::text=btrim(p_code) OR o.code=btrim(p_code) OR o.id::text=btrim(p_code))),'[]');
END; $$;
REVOKE ALL ON FUNCTION public.customer_tailoring_work(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.customer_tailoring_work(text) TO authenticated;

CREATE FUNCTION public.issue_additional_customer_fabric(p_request uuid,p_job uuid,p_source uuid,p_barcode text,p_quantity integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE stock jsonb;inv uuid;result uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.issue_to_tailoring') THEN RAISE EXCEPTION 'Counter fabric issue permission required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=p_source AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom'))) THEN RAISE EXCEPTION 'Active Showroom floor required'; END IF;
 SELECT value INTO stock FROM jsonb_array_elements(public.pos_reserve_variants(p_barcode)) WHERE value->>'barcode'=btrim(p_barcode) LIMIT 1;
  IF (SELECT count(*) FROM jsonb_array_elements(stock->'cuts') cut WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(cut->'locations') loc WHERE loc->>'id'=p_source::text AND (loc->>'quantity_mm')::numeric>0))<>1 THEN RAISE EXCEPTION 'Scan a unique physical Thaan barcode'; END IF;
  SELECT (cut->>'inventory_item_id')::uuid INTO inv FROM jsonb_array_elements(stock->'cuts') cut WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(cut->'locations') loc WHERE loc->>'id'=p_source::text AND (loc->>'quantity_mm')::numeric>0) LIMIT 1;
 IF inv IS NULL OR p_quantity IS NULL OR p_quantity<=0 THEN RAISE EXCEPTION 'Available scanned Thaan and positive metres required'; END IF;
 result:=public.post_material_issue(p_request,'customer_tailoring',p_job,p_source,'additional',jsonb_build_array(jsonb_build_object('inventory_item_id',inv,'quantity',p_quantity)),'Additional customer fabric; original customer total unchanged');
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.issue_additional_customer_fabric(uuid,uuid,uuid,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_additional_customer_fabric(uuid,uuid,uuid,text,integer) TO authenticated;

CREATE FUNCTION public.tailoring_work_catalog() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') AND NOT(public.has_role(auth.uid(),'counter') AND public.has_perm(auth.uid(),'pos.issue_to_tailoring')) AND NOT(public.has_role(auth.uid(),'production') AND public.has_perm(auth.uid(),'production.view')) THEN RAISE EXCEPTION 'Tailoring or production work access required'; END IF;
 RETURN jsonb_build_object('products',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name) ORDER BY name,id) FROM public.products WHERE active),'[]'), 'designs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name) ORDER BY code,id) FROM public.designs WHERE active),'[]'));
END; $$;
REVOKE ALL ON FUNCTION public.tailoring_work_catalog() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tailoring_work_catalog() TO authenticated;

-- The Owner-approved margin follows all recorded fabric issued to this job.
-- Missing old issue-time costs stay unknown; today's catalogue CP is never substituted.
CREATE FUNCTION public.customer_job_fabric_cp(p_job uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN original.cp IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id LEFT JOIN public.customer_issue_fabric_costs c ON c.issue_line_id=l.id WHERE i.customer_tailoring_job_id=p_job AND i.issue_type='additional' AND l.thaan_id IS NOT NULL AND c.issue_line_id IS NULL)
 THEN original.cp+coalesce((SELECT sum(c.amount_paise)::bigint FROM public.customer_issue_fabric_costs c JOIN public.material_issue_lines l ON l.id=c.issue_line_id JOIN public.material_issues i ON i.id=l.material_issue_id WHERE i.customer_tailoring_job_id=p_job AND i.issue_type='additional'),0) END
 FROM(SELECT coalesce((SELECT fabric_cp_total_paise FROM public.counter_tailoring_prices WHERE job_id=p_job),(SELECT q.fabric_cp_total_paise FROM public.customer_tailoring_jobs j JOIN public.customer_tailoring_quotes q ON q.id=j.quote_id WHERE j.id=p_job)) cp) original;
$$;
REVOKE ALL ON FUNCTION public.customer_job_fabric_cp(uuid) FROM PUBLIC,anon,authenticated;

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
 WHERE l.id=NEW.order_item_id AND ((o.kind IN ('direct_fabric_sale','finished_product_sale','counter_bill') AND (o.kind<>'counter_bill' OR EXISTS(SELECT 1 FROM public.counter_bills cb WHERE cb.order_id=o.id AND cb.actor_id=NEW.actor_id)) AND o.source_location_id=NEW.source_location_id) OR (o.kind='ecommerce_sale' AND EXISTS(SELECT 1 FROM public.ecommerce_sale_sources s JOIN public.ecommerce_paid_receipts receipt ON receipt.order_id=o.id WHERE s.order_item_id=l.id AND s.source_location_id=NEW.source_location_id AND receipt.recorded_by=NEW.actor_id)))
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
CREATE OR REPLACE FUNCTION public.capture_sale_analysis_dimensions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status='completed' AND (NEW.payment_confirmed_at IS NOT NULL OR NEW.kind='counter_bill') AND NEW.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale','counter_bill') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'completed' OR OLD.payment_confirmed_at IS NULL) THEN
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
CREATE OR REPLACE FUNCTION public.business_sale_facts(p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_location text DEFAULT NULL) RETURNS TABLE(row_key text,event_at timestamptz,data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT it.id::text,CASE WHEN o.kind='counter_bill' THEN payment.paid_at ELSE o.completed_at END,jsonb_build_object(
 'id',it.id,'order_id',o.id,'code',o.code,'completed_at',o.completed_at,'status',o.status,'payment_confirmed_at',coalesce(payment.paid_at,o.payment_confirmed_at),'kind',CASE WHEN it.fabric_stock_id IS NOT NULL THEN 'direct_fabric_sale' WHEN it.customer_tailoring_job_id IS NOT NULL THEN 'customer_tailoring' ELSE 'finished_product_sale' END,'payment_basis',CASE WHEN o.kind='counter_bill' THEN 'immutable_counter_receipt' ELSE 'completed_paid_sale' END,'channel',coalesce(channel.channel,'counter'),
 'channel_basis',CASE WHEN channel.order_id IS NULL THEN 'existing_counter_bill_workflow' ELSE 'recorded_at_sale' END,
 'source',loc.name,'source_id',loc.id,'salesperson_id',o.salesperson_user_id,'salesperson',coalesce(dim.salesperson_name,person.full_name),
 'customer_id',o.customer_id,'customer',o.customer_snapshot->>'name',
 'fabric',CASE WHEN it.fabric_stock_id IS NOT NULL THEN coalesce(dim.fabric_type,g.name,f.name) END,
 'vendor_id',CASE WHEN dim.order_item_id IS NOT NULL THEN dim.vendor_id ELSE batch.supplier_id END,'vendor',CASE WHEN dim.order_item_id IS NOT NULL THEN dim.vendor_name ELSE coalesce(rb.provider_name,supplier.name) END,
 'product',CASE WHEN it.finished_product_id IS NOT NULL THEN coalesce(dim.product_name,snap.item_snapshot->>'product',product.name) END,
 'design',coalesce(dim.design_name,snap.item_snapshot->>'design',design.name,job.custom_design),'size',coalesce(dim.size,job.size),
 'barcode',coalesce(snap.item_snapshot->>'barcode',variant.code,t.barcode,fb.code,pb.code),'batch',batch.code,
 'quantity',trunc(it.quantity)::text,'unit',it.unit,'revenue_paise',it.final_customer_price_paise::text,
 'cost_paise',CASE WHEN it.fabric_stock_id IS NOT NULL AND fi.cp_snapshot_paise IS NOT NULL THEN round(it.quantity*fi.cp_snapshot_paise/1000)::text WHEN it.finished_product_id IS NOT NULL THEN fi.production_cost_snapshot_paise::text WHEN it.customer_tailoring_job_id IS NOT NULL THEN public.customer_job_fabric_cp(it.customer_tailoring_job_id)::text END,
 'margin_paise',CASE WHEN it.fabric_stock_id IS NOT NULL AND fi.cp_snapshot_paise IS NOT NULL THEN (it.final_customer_price_paise-round(it.quantity*fi.cp_snapshot_paise/1000))::text WHEN it.finished_product_id IS NOT NULL AND fi.production_cost_snapshot_paise IS NOT NULL THEN (it.final_customer_price_paise-fi.production_cost_snapshot_paise)::text WHEN it.customer_tailoring_job_id IS NOT NULL AND public.customer_job_fabric_cp(it.customer_tailoring_job_id) IS NOT NULL THEN (it.final_customer_price_paise-public.customer_job_fabric_cp(it.customer_tailoring_job_id))::text END,
 'cost_basis',CASE WHEN it.fabric_stock_id IS NOT NULL THEN 'sale_time_fabric_CP' WHEN it.customer_tailoring_job_id IS NOT NULL THEN 'current_recorded_job_fabric_CP_including_additional_issues' ELSE 'sale_time_recorded_piece_CP' END,
 'dimension_basis',CASE WHEN dim.order_item_id IS NOT NULL THEN 'sale_time_snapshot' ELSE 'historical_bill_snapshot_or_current_catalogue' END,
 'item_evidence',to_jsonb(it),'financial_evidence',to_jsonb(fi),'finished_sale_evidence',to_jsonb(snap))
 FROM public.orders o JOIN public.order_items it ON it.order_id=o.id LEFT JOIN public.counter_bill_payments payment ON payment.bill_id=o.id LEFT JOIN public.ecommerce_sale_sources actual_source ON actual_source.order_item_id=it.id JOIN public.locations loc ON loc.id=coalesce(actual_source.source_location_id,o.source_location_id)
 LEFT JOIN public.sale_analysis_channels channel ON channel.order_id=o.id LEFT JOIN public.sale_analysis_dimensions dim ON dim.order_item_id=it.id
 LEFT JOIN public.order_item_financials fi ON fi.order_item_id=it.id LEFT JOIN public.finished_product_sale_snapshots snap ON snap.order_item_id=it.id
 LEFT JOIN public.profiles person ON person.id=o.salesperson_user_id LEFT JOIN public.fabric_stock fs ON fs.id=it.fabric_stock_id LEFT JOIN public.fabrics f ON f.id=fs.fabric_id
 LEFT JOIN public.thaans t ON t.id=it.thaan_id LEFT JOIN public.barcodes fb ON fb.id=fs.barcode_id LEFT JOIN public.stock_registration_variants variant ON variant.thaan_id=t.id
 LEFT JOIN public.stock_registration_fabric_types g ON g.id=variant.fabric_type_id LEFT JOIN public.receiving_batches batch ON batch.id=fs.batch_id
 LEFT JOIN public.suppliers supplier ON supplier.id=batch.supplier_id LEFT JOIN public.stock_registration_batches rb ON rb.batch_id=batch.id
 LEFT JOIN public.finished_products piece ON piece.id=it.finished_product_id LEFT JOIN public.barcodes pb ON pb.id=piece.barcode_id
 LEFT JOIN public.products product ON product.id=piece.product_id LEFT JOIN public.designs design ON design.id=piece.design_id LEFT JOIN public.production_jobs job ON job.id=piece.production_job_id
 WHERE o.status='completed' AND ((o.kind='counter_bill' AND payment.bill_id IS NOT NULL) OR (o.kind<>'counter_bill' AND o.payment_confirmed_at IS NOT NULL)) AND o.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale','counter_bill')
 AND (p_from IS NULL OR o.completed_at>=p_from) AND (p_to IS NULL OR o.completed_at<p_to) AND (nullif(p_location,'') IS NULL OR loc.name=p_location OR loc.id::text=p_location);
$$;
CREATE OR REPLACE FUNCTION public.business_sales_summary(p_from timestamptz,p_to timestamptz,p_location text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH facts AS(SELECT data FROM public.business_sale_facts(p_from,p_to,p_location))
 SELECT jsonb_build_object('revenue_paise',coalesce(sum((data->>'revenue_paise')::numeric),0)::text,
 'bills',count(DISTINCT data->>'order_id'),'customers',count(DISTINCT data->>'customer_id'),
 'unidentified_customer_bills',count(DISTINCT data->>'order_id') FILTER(WHERE data->>'customer_id' IS NULL),
 'fabric_mm',trunc(coalesce(sum((data->>'quantity')::numeric) FILTER(WHERE data->>'kind'='direct_fabric_sale'),0))::text,
 'pieces',trunc(coalesce(sum((data->>'quantity')::numeric) FILTER(WHERE data->>'kind'='finished_product_sale'),0))::text,
 'fabric_revenue_paise',coalesce(sum((data->>'revenue_paise')::numeric) FILTER(WHERE data->>'kind'='direct_fabric_sale'),0)::text,
 'product_revenue_paise',coalesce(sum((data->>'revenue_paise')::numeric) FILTER(WHERE data->>'kind'='finished_product_sale'),0)::text,
 'tailoring_revenue_paise',coalesce(sum((data->>'revenue_paise')::numeric) FILTER(WHERE data->>'kind'='customer_tailoring'),0)::text,
 'known_margin_paise',coalesce(sum((data->>'margin_paise')::numeric),0)::text,
 'unknown_cost_lines',count(*) FILTER(WHERE data->>'cost_paise' IS NULL),'lines',count(*),
 'counter_paise',coalesce(sum((data->>'revenue_paise')::numeric) FILTER(WHERE data->>'channel'='counter'),0)::text,
 'ecommerce_paise',coalesce(sum((data->>'revenue_paise')::numeric) FILTER(WHERE data->>'channel'='ecommerce'),0)::text) FROM facts;
$$;
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
 SELECT j.id::text row_key,j.created_at event_at,to_jsonb(j)||jsonb_build_object('customer',c.name,'factory',f.name,'section',s.name,'tailor',t.real_name,'fabric_cp_total_paise',CASE WHEN counter_price.job_id IS NOT NULL THEN counter_price.fabric_cp_total_paise::text ELSE price.fabric_cp_total_paise::text END,'tailoring_charge_paise',price.tailoring_charge_paise::text,'final_customer_price_paise',coalesce(counter_price.final_customer_price_paise,price.final_customer_price_paise)::text) data FROM public.customer_tailoring_jobs j LEFT JOIN public.customers c ON c.id=j.customer_id JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id LEFT JOIN LATERAL(SELECT * FROM public.customer_tailoring_prices WHERE job_id=j.id ORDER BY revision DESC LIMIT 1) price ON true LEFT JOIN public.counter_tailoring_prices counter_price ON counter_price.job_id=j.id
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
 SELECT o.id::text row_key,CASE WHEN o.status='completed' AND coalesce(payment.paid_at,o.payment_confirmed_at) IS NOT NULL AND o.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale','counter_bill') THEN coalesce(payment.paid_at,o.completed_at) ELSE o.created_at END event_at,to_jsonb(o)-'sale_request_payload'-'tailoring_request_payload'||jsonb_build_object('source',CASE WHEN (SELECT count(DISTINCT source_location_id) FROM public.ecommerce_sale_sources s JOIN public.order_items i ON i.id=s.order_item_id WHERE i.order_id=o.id)>1 THEN 'Multiple Showroom floors' ELSE l.name END,'source_names',(SELECT jsonb_agg(DISTINCT loc.name) FROM public.ecommerce_sale_sources s JOIN public.order_items i ON i.id=s.order_item_id JOIN public.locations loc ON loc.id=s.source_location_id WHERE i.order_id=o.id),'payment_confirmed_at',coalesce(payment.paid_at,o.payment_confirmed_at),'completed_at',CASE WHEN payment.bill_id IS NOT NULL THEN payment.paid_at ELSE o.completed_at END,'channel',(SELECT channel FROM public.sale_analysis_channels WHERE order_id=o.id),'final_customer_price_paise',o.final_customer_price_paise::text,'revenue_state',CASE WHEN o.status='completed' AND coalesce(payment.paid_at,o.payment_confirmed_at) IS NOT NULL THEN 'payment_confirmed' WHEN o.kind='customer_tailoring' THEN 'customer_tailoring_booking' ELSE 'not_payment_confirmed' END,'items',(SELECT jsonb_agg(to_jsonb(it)||jsonb_build_object('quantity',it.quantity::text,'sp_snapshot_paise',it.sp_snapshot_paise::text,'final_customer_price_paise',it.final_customer_price_paise::text,'financial_snapshot',to_jsonb(fi),'finished_sale_snapshot',to_jsonb(snapshot)) ORDER BY it.id) FROM public.order_items it LEFT JOIN public.order_item_financials fi ON fi.order_item_id=it.id LEFT JOIN public.finished_product_sale_snapshots snapshot ON snapshot.order_item_id=it.id WHERE it.order_id=o.id)) data FROM public.orders o LEFT JOIN public.counter_bill_payments payment ON payment.bill_id=o.id JOIN public.locations l ON l.id=o.source_location_id
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
NOTIFY pgrst,'reload schema';
COMMIT;
