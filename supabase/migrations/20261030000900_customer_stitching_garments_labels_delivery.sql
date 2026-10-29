-- Customer stitching: garment rows, C labels and delivery (29 Oct 2026).
-- Agreed flow, one J order per stitching job:
--   Started        billing issues the fabric and picks Factory + Master Tailor (status open)
--   Completed      the Master Tailor submits staff + consumables for the J (status completed)
--   Delivery Ready godown reviews final CP and prints one C label per garment (status ready)
--   Delivered      the Counter hands over after the bill balance is zero, or with an Owner
--                  override that needs a reason and is audit-logged (status delivered)
-- One total order SP is agreed at billing; labels split it equally (leftover paise on the
-- last garment). C labels are created once; reprints reuse them. They are never retail stock.
BEGIN;

-- 1. Status: add Completed.
ALTER TABLE public.customer_tailoring_jobs DROP CONSTRAINT customer_tailoring_jobs_status_check;
ALTER TABLE public.customer_tailoring_jobs ADD CONSTRAINT customer_tailoring_jobs_status_check
  CHECK (status = ANY (ARRAY['draft','open','in_progress','completed','ready','delivered','cancelled']));

-- 2. Garment rows under one J. Read and written only through the functions below.
CREATE TABLE public.customer_tailoring_garments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.customer_tailoring_jobs(id),
  line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 50),
  size text NOT NULL CHECK (btrim(size) <> '' AND length(btrim(size)) <= 60),
  notes text CHECK (notes IS NULL OR (btrim(notes) <> '' AND length(notes) <= 300)),
  finished_item_id uuid UNIQUE REFERENCES public.customer_tailoring_finished_items(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (job_id, line_no)
);
ALTER TABLE public.customer_tailoring_garments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_tailoring_garments FROM PUBLIC, anon, authenticated;

-- Existing jobs become one-garment jobs; the two existing C labels stay linked to them.
INSERT INTO public.customer_tailoring_garments(job_id, line_no, size, finished_item_id)
SELECT j.id, 1, coalesce(nullif(btrim(j.size), ''), fi.size, 'Not recorded'), fi.id
FROM public.customer_tailoring_jobs j
LEFT JOIN public.customer_tailoring_finished_items fi ON fi.job_id = j.id;

-- One label per garment now, so a job may own several finished items.
ALTER TABLE public.customer_tailoring_finished_items DROP CONSTRAINT customer_tailoring_finished_items_job_id_key;
CREATE INDEX customer_tailoring_finished_items_job_idx ON public.customer_tailoring_finished_items(job_id);

-- 3. Helpers (internal).
CREATE FUNCTION public.customer_tailoring_receipt_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_role(auth.uid(),'owner')
    OR (public.has_role(auth.uid(),'counter') AND public.has_perm(auth.uid(),'pos.issue_to_tailoring'))
    OR public.has_perm(auth.uid(),'production.receive')
$$;

-- The order SP agreed at billing (before any whole-bill discount).
CREATE FUNCTION public.customer_tailoring_order_sp(p_job uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(
    (SELECT final_customer_price_paise FROM public.counter_tailoring_prices WHERE job_id = p_job),
    (SELECT final_customer_price_paise FROM public.customer_tailoring_prices WHERE job_id = p_job ORDER BY revision DESC LIMIT 1))
$$;

-- Equal split; the last garment takes the leftover paise.
CREATE FUNCTION public.customer_tailoring_split(p_total bigint, p_count integer, p_line integer) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_line < p_count THEN p_total / p_count ELSE p_total - (p_total / p_count) * (p_count - 1) END
$$;

CREATE FUNCTION public.customer_tailoring_consumables_cp(p_job uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(sum(l.amount_paise), 0)::bigint
  FROM public.job_material_consumptions c
  JOIN public.job_material_consumption_lines l ON l.consumption_id = c.id
  WHERE c.customer_tailoring_job_id = p_job AND c.reversed_at IS NULL
$$;

CREATE FUNCTION public.customer_tailoring_fabric_cp(p_job uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(
    (SELECT fabric_cp_total_paise FROM public.customer_tailoring_prices WHERE job_id = p_job ORDER BY revision DESC LIMIT 1),
    public.customer_job_fabric_cp(p_job), 0)::bigint
$$;

REVOKE ALL ON FUNCTION public.customer_tailoring_receipt_allowed(), public.customer_tailoring_order_sp(uuid),
  public.customer_tailoring_split(bigint, integer, integer), public.customer_tailoring_consumables_cp(uuid),
  public.customer_tailoring_fabric_cp(uuid) FROM PUBLIC, anon, authenticated;

-- 4. Billing: optional "garments" list per stitching order (size and notes per garment).
CREATE OR REPLACE FUNCTION public.gst_stage_counter_bill_multi(p_request uuid, p_items jsonb, p_tailoring jsonb, p_paid boolean, p_salesperson uuid, p_customer uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text, p_contact text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result uuid:=gen_random_uuid(); saved public.counter_bills%rowtype; payload_value jsonb; customer_id uuid; contact jsonb; row_value jsonb; booked_job uuid; item_id uuid; inv uuid; th public.thaans%rowtype; piece public.finished_products%rowtype; price public.finished_product_prices%rowtype; qty numeric; sp bigint; amount bigint; cp bigint; total numeric:=0; cost_id uuid; reviewed_id uuid; cost_amount bigint; evidence jsonb; group_price bigint; fabric_amount numeric; stitching bigint; priced_cuts jsonb; plain_cuts jsonb; priced_cut jsonb; row_source uuid; header_source uuid; terminal uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') THEN RAISE EXCEPTION 'Counter billing permission required'; END IF;
 IF p_request IS NULL OR p_paid IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_typeof(p_tailoring) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)+jsonb_array_length(p_tailoring) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Request, payment state and 1–100 bill entries required'; END IF;
 
 IF NOT public.has_role(auth.uid(),'owner') THEN SELECT id INTO terminal FROM public.pos_terminals WHERE assigned_user_id=auth.uid() AND active; IF terminal IS NULL THEN RAISE EXCEPTION 'This Counter account has no active POS terminal code. Ask the Owner to assign one in Administration.'; END IF; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'items',p_items,'tailoring',p_tailoring,'paid',p_paid,'salesperson',p_salesperson,'customer',p_customer,'name',nullif(btrim(p_name),''),'contact',nullif(btrim(p_contact),''));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,6));
 SELECT * INTO saved FROM public.counter_bills WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Bill retry requires identical data'; END IF; RETURN saved.order_id; END IF;
 PERFORM public.require_salesperson(p_salesperson);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR coalesce(x->>'kind','') NOT IN('fabric','product') OR nullif(x->>'source_location_id','') IS NULL OR (x->>'kind'='fabric' AND (x-ARRAY['kind','inventory_item_id','quantity','sp_paise_per_m','source_location_id'])<>'{}') OR (x->>'kind'='product' AND (x-ARRAY['kind','piece_id','sp_version_id','source_location_id'])<>'{}')) THEN RAISE EXCEPTION 'Only explicit located fabric cuts or saved-price pieces accepted'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_tailoring) g CROSS JOIN LATERAL jsonb_array_elements(g->'items') x WHERE nullif(x->>'source_location_id','') IS NULL) THEN RAISE EXCEPTION 'Every tailoring fabric requires its recorded Showroom floor'; END IF;
 SELECT source_id INTO header_source FROM (SELECT (x->>'source_location_id')::uuid source_id FROM jsonb_array_elements(p_items) x UNION ALL SELECT (x->>'source_location_id')::uuid FROM jsonb_array_elements(p_tailoring) g CROSS JOIN LATERAL jsonb_array_elements(g->'items') x) sources LIMIT 1;
 IF header_source IS NULL OR EXISTS(SELECT 1 FROM (SELECT (x->>'source_location_id')::uuid id FROM jsonb_array_elements(p_items) x UNION SELECT (x->>'source_location_id')::uuid FROM jsonb_array_elements(p_tailoring) g CROSS JOIN LATERAL jsonb_array_elements(g->'items') x) sources WHERE NOT EXISTS(SELECT 1 FROM public.locations l JOIN public.locations parent ON parent.id=l.parent_id AND parent.active AND parent.kind='showroom' WHERE l.id=sources.id AND l.active AND l.kind='showroom_sublocation')) THEN RAISE EXCEPTION 'Every item requires an active Showroom floor'; END IF;
 IF p_customer IS NOT NULL THEN SELECT id INTO customer_id FROM public.customers WHERE id=p_customer FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Selected customer does not exist'; END IF; ELSE customer_id:=public.find_or_create_customer(p_name,p_contact,NULL,NULL); END IF;
 IF customer_id IS NOT NULL THEN SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO contact FROM public.customers WHERE id=customer_id; ELSE contact:=jsonb_build_object('name',NULL,'phone',NULL); END IF;
 PERFORM 1 FROM public.inventory_items WHERE id IN(SELECT (x->>'inventory_item_id')::uuid FROM jsonb_array_elements(p_items) x WHERE x->>'kind'='fabric' UNION SELECT (x->>'inventory_item_id')::uuid FROM jsonb_array_elements(p_tailoring) g CROSS JOIN LATERAL jsonb_array_elements(g->'items') x) OR finished_product_id IN(SELECT (x->>'piece_id')::uuid FROM jsonb_array_elements(p_items) x WHERE x->>'kind'='product') ORDER BY id FOR UPDATE;
 INSERT INTO public.counter_bills(order_id,request_id,actor_id,payload,pos_terminal_id) VALUES(result,p_request,auth.uid(),payload_value,terminal);
 INSERT INTO public.orders(id,code,kind,customer_id,source_location_id,created_by,salesperson_user_id,reference,sale_request_id,sale_request_payload,customer_snapshot,payment_confirmed_at) VALUES(result,'BILL-'||replace(result::text,'-',''),'counter_bill',customer_id,header_source,auth.uid(),p_salesperson,'Counter bill',p_request,payload_value,contact,CASE WHEN p_paid THEN clock_timestamp() END);
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_tailoring) LOOP
  IF jsonb_typeof(row_value) IS DISTINCT FROM 'object' OR (row_value-ARRAY['items','garment','size','garments','delivery_date','assignment_id','sp_paise','notes','design_id','custom_design'])<>'{}' OR jsonb_typeof(row_value->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(row_value->'items') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Complete tailoring details and priced fabric cuts required'; END IF;
  fabric_amount:=0; priced_cuts:='[]'; plain_cuts:='[]'; stitching:=(row_value->>'sp_paise')::bigint;
  IF (nullif(btrim(row_value->>'size'),'') IS NULL AND NOT row_value ? 'garments') OR stitching IS NULL OR stitching NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Tailored garment size and valid direct SP required'; END IF;
  IF row_value ? 'garments' AND (jsonb_typeof(row_value->'garments') IS DISTINCT FROM 'array' OR jsonb_array_length(row_value->'garments') NOT BETWEEN 1 AND 50 OR EXISTS(SELECT 1 FROM jsonb_array_elements(row_value->'garments') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR (x-ARRAY['size','notes'])<>'{}' OR nullif(btrim(x->>'size'),'') IS NULL OR length(btrim(x->>'size'))>60 OR length(coalesce(x->>'notes',''))>300)) THEN RAISE EXCEPTION 'Enter a size for each garment (1 to 50 garments; size up to 60 and notes up to 300 characters)'; END IF;
  IF row_value ? 'garments' AND stitching < jsonb_array_length(row_value->'garments') THEN RAISE EXCEPTION 'Order SP is too small to split across its garments'; END IF;
  FOR priced_cut IN SELECT value FROM jsonb_array_elements(row_value->'items') LOOP
   IF (priced_cut-ARRAY['inventory_item_id','quantity','source_location_id'])<>'{}' OR (priced_cut->>'quantity')::numeric NOT BETWEEN 1 AND 2147483647 THEN RAISE EXCEPTION 'Explicit located fabric and exact millimetres required'; END IF;
   priced_cuts:=priced_cuts||jsonb_build_array(priced_cut||jsonb_build_object('amount_paise','0')); plain_cuts:=plain_cuts||jsonb_build_array(priced_cut);
  END LOOP;
  group_price:=stitching;
  booked_job:=public.book_invoice_tailoring_multi(gen_random_uuid(),plain_cuts,group_price,customer_id,(row_value->>'assignment_id')::uuid,p_salesperson,row_value->>'garment',row_value->>'notes');
  UPDATE public.customer_tailoring_jobs SET size=coalesce(nullif(btrim(row_value->>'size'),''),btrim(left((SELECT string_agg(btrim(g.x->>'size'),', ' ORDER BY g.n) FROM jsonb_array_elements(row_value->'garments') WITH ORDINALITY g(x,n)),60))) WHERE id=booked_job;
  INSERT INTO public.customer_tailoring_garments(job_id,line_no,size,notes) SELECT booked_job,g.n,btrim(g.x->>'size'),nullif(btrim(g.x->>'notes'),'') FROM jsonb_array_elements(CASE WHEN row_value ? 'garments' THEN row_value->'garments' ELSE jsonb_build_array(jsonb_build_object('size',row_value->>'size')) END) WITH ORDINALITY g(x,n);
  INSERT INTO public.counter_tailoring_details(job_id,bill_id,delivery_date,design_id,custom_design,design_name_snapshot,design_code_snapshot) VALUES(booked_job,result,(row_value->>'delivery_date')::date,(row_value->>'design_id')::uuid,nullif(btrim(row_value->>'custom_design'),''),coalesce((SELECT name FROM public.designs WHERE id=(row_value->>'design_id')::uuid),nullif(btrim(row_value->>'custom_design'),'')),(SELECT code FROM public.designs WHERE id=(row_value->>'design_id')::uuid));
  INSERT INTO public.counter_tailoring_sale_prices(job_id,fabric_lines,fabric_amount_paise,stitching_paise,total_paise,recorded_by) VALUES(booked_job,priced_cuts,fabric_amount::bigint,stitching,group_price,auth.uid());
  INSERT INTO public.order_items(order_id,customer_tailoring_job_id,quantity,unit,final_customer_price_paise) VALUES(result,booked_job,1,'job',group_price) RETURNING id INTO item_id;
  INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise) SELECT item_id,fabric_cp_total_paise FROM public.counter_tailoring_prices WHERE job_id=booked_job;
  total:=total+group_price;
 END LOOP;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY coalesce(value->>'inventory_item_id',value->>'piece_id'),value->>'source_location_id' LOOP
  row_source:=(row_value->>'source_location_id')::uuid;
  IF row_value->>'kind'='fabric' THEN
   qty:=(row_value->>'quantity')::numeric; sp:=(row_value->>'sp_paise_per_m')::bigint; inv:=(row_value->>'inventory_item_id')::uuid;
   IF qty IS NULL OR qty<=0 OR qty<>trunc(qty) OR qty>2147483647 OR sp<0 THEN RAISE EXCEPTION 'Positive exact millimetres and valid fabric price required'; END IF;
   SELECT t.* INTO th FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id JOIN public.fabric_stock s ON s.id=t.fabric_stock_id WHERE i.id=inv AND i.unit='mm' AND t.status='active' AND s.entry_state IN('complete','correcting','legacy_pending');
   IF NOT FOUND OR qty>public.inventory_balance(inv,row_source) THEN RAISE EXCEPTION 'Insufficient active fabric at its recorded Showroom floor'; END IF;
   SELECT cp_paise_per_m INTO cp FROM public.fabric_stock_costs WHERE fabric_stock_id=th.fabric_stock_id ORDER BY revision DESC LIMIT 1; IF cp IS NULL OR cp<=0 THEN RAISE EXCEPTION 'Positive recorded Thaan CP required'; END IF;
   amount:=round(qty*sp/1000);
   INSERT INTO public.order_items(order_id,fabric_stock_id,thaan_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) VALUES(result,th.fabric_stock_id,th.id,qty,'mm',sp,amount) RETURNING id INTO item_id;
   INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise) VALUES(item_id,cp);
   INSERT INTO public.inventory_movements(kind,inventory_item_id,fabric_stock_id,thaan_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference) VALUES('SALE',inv,th.fabric_stock_id,th.id,qty,'mm',row_source,item_id,auth.uid(),'Counter fabric sale','ORDER:'||result::text);
   IF public.inventory_balance(inv,NULL)=0 THEN UPDATE public.thaans SET status='depleted',updated_at=now() WHERE id=th.id; END IF;
  ELSE
   SELECT * INTO piece FROM public.finished_products WHERE id=(row_value->>'piece_id')::uuid AND status='available' AND current_location_id=row_source FOR UPDATE;
   SELECT id INTO inv FROM public.inventory_items WHERE finished_product_id=piece.id AND unit='pc';
   IF piece.id IS NULL OR inv IS NULL OR public.inventory_balance(inv,row_source)<>1 THEN RAISE EXCEPTION 'Available physical piece on its recorded Showroom floor required'; END IF;
   SELECT * INTO price FROM public.finished_product_prices WHERE finished_product_id=piece.id ORDER BY revision DESC LIMIT 1;
   IF price.id IS NULL OR price.id IS DISTINCT FROM (row_value->>'sp_version_id')::uuid THEN RAISE EXCEPTION 'Saved product SP changed; refresh'; END IF;
   IF piece.vendor_receipt_id IS NOT NULL THEN
    SELECT vp.cp_paise INTO cost_amount
    FROM public.vendor_finished_product_receipt_pieces vp
    WHERE vp.finished_product_id=piece.id;
    IF cost_amount IS NULL THEN RAISE EXCEPTION 'Recorded vendor piece CP required'; END IF;
    cost_id:=NULL; reviewed_id:=NULL;
    evidence:=jsonb_build_object('source_kind','vendor_purchase','receipt_id',piece.vendor_receipt_id,'recorded_cp_paise',cost_amount::text);
   ELSE
    SELECT cost_version_id INTO reviewed_id FROM public.finished_product_price_reviews WHERE price_id=price.id;
    SELECT id INTO cost_id FROM public.production_cost_versions WHERE production_job_id=piece.production_job_id ORDER BY revision DESC LIMIT 1;
    SELECT amount_paise INTO cost_amount FROM public.finished_product_cost_allocations WHERE finished_product_id=piece.id AND cost_version_id=cost_id;
    IF reviewed_id IS DISTINCT FROM cost_id OR cost_amount IS NULL OR NOT EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=cost_id AND payload ? 'materials') THEN RAISE EXCEPTION 'Recorded piece CP and reviewed saved SP required'; END IF;
    SELECT jsonb_build_object('quantity_snapshot',v.quantity_snapshot,'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.production_cost_lines l WHERE l.cost_version_id=v.id),'[]')) INTO evidence FROM public.production_cost_versions v WHERE v.id=cost_id;
   END IF;
   amount:=price.sp_paise;
   INSERT INTO public.order_items(order_id,finished_product_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) VALUES(result,piece.id,1,'pc',amount,amount) RETURNING id INTO item_id;
   
   IF piece.vendor_receipt_id IS NOT NULL THEN
    INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise) VALUES(item_id,cost_amount);
   ELSE
    INSERT INTO public.order_item_financials(order_item_id,production_cost_snapshot_paise) VALUES(item_id,cost_amount);
   END IF;
   INSERT INTO public.finished_product_sale_snapshots(order_item_id,price_version_id,cost_version_id,reviewed_cost_version_id,cost_evidence,item_snapshot) VALUES(item_id,price.id,cost_id,reviewed_id,evidence,(SELECT jsonb_build_object('barcode',b.code,'product',product.name,'design',ctx->>'design','size',ctx->>'size','job_code',j.code,'piece_number',piece.piece_number,'source',loc.name,'actor',actor.full_name) FROM public.barcodes b JOIN public.products product ON product.id=piece.product_id LEFT JOIN public.production_jobs j ON j.id=piece.production_job_id JOIN public.locations loc ON loc.id=row_source LEFT JOIN public.profiles actor ON actor.id=auth.uid() CROSS JOIN LATERAL public.production_piece_context(piece.id) ctx WHERE b.id=piece.barcode_id));
   INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference) VALUES(inv,'SALE',piece.id,1,'pc',row_source,item_id,auth.uid(),'Counter finished-product sale','ORDER:'||result::text); UPDATE public.finished_products SET status='sold' WHERE id=piece.id;
  END IF;
  total:=total+amount;
 END LOOP;
 IF total NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Bill exceeds supported exact money range'; END IF;
 UPDATE public.orders SET final_customer_price_paise=total::bigint WHERE id=result;
 
 INSERT INTO public.counter_bill_terminal_records(bill_id,terminal_id) VALUES(result,terminal) ON CONFLICT (bill_id) DO NOTHING;
 IF p_paid THEN INSERT INTO public.counter_bill_payments(bill_id,request_id,amount_paise,actor_id) VALUES(result,p_request,total::bigint,auth.uid()); END IF;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'complete_counter_bill_multi','orders',result,jsonb_build_object('paid',p_paid,'total_paise',total),'BILL:'||p_request::text);
 RETURN result;
END; $function$;

-- 5. Master Tailor submission marks the customer order Completed.
CREATE OR REPLACE FUNCTION public.submit_job_material_consumption(p_request uuid, p_job_kind text, p_job uuid, p_staff_assignment uuid, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE master public.tailors%rowtype; job_assignment uuid; staff public.tailor_staff_assignments%rowtype; payload jsonb; result uuid; row_value jsonb; u public.material_units%rowtype; qty numeric; amount bigint;
BEGIN
 IF NOT public.has_perm(auth.uid(),'materials.record_consumption') THEN RAISE EXCEPTION 'Material consumption permission required'; END IF;
 SELECT * INTO master FROM public.tailors WHERE profile_id=auth.uid() AND active; IF master.id IS NULL THEN RAISE EXCEPTION 'Master Tailor login required'; END IF;
 IF p_job_kind='production' THEN SELECT tailor_assignment_id INTO job_assignment FROM public.production_jobs WHERE id=p_job AND status IN('issued','in_progress','completed');
 ELSIF p_job_kind='customer_tailoring' THEN SELECT tailor_assignment_id INTO job_assignment FROM public.customer_tailoring_jobs WHERE id=p_job AND status IN('open','in_progress','completed'); ELSE RAISE EXCEPTION 'Production or customer-tailoring job required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tailor_assignments a WHERE a.id=job_assignment AND a.tailor_id=master.id) THEN RAISE EXCEPTION 'Job belongs to another Master Tailor'; END IF;
 SELECT * INTO staff FROM public.tailor_staff_assignments WHERE id=p_staff_assignment AND tailor_id=master.id AND valid_until IS NULL; IF staff.id IS NULL THEN RAISE EXCEPTION 'Active Tailor Staff under this Master Tailor required'; END IF;
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 OR (SELECT count(DISTINCT upper(value->>'barcode')) FROM jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) THEN RAISE EXCEPTION 'One to 100 distinct material-unit scans required'; END IF;
 payload:=jsonb_build_object('actor',auth.uid(),'job_kind',p_job_kind,'job',p_job,'staff_assignment',p_staff_assignment,'lines',p_lines);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,73));
 IF EXISTS(SELECT 1 FROM public.job_material_consumptions WHERE request_id=p_request) THEN RETURN (SELECT id FROM public.job_material_consumptions WHERE request_id=p_request AND request_payload=payload); END IF;
 INSERT INTO public.job_material_consumptions(request_id,request_payload,customer_tailoring_job_id,production_job_id,tailor_assignment_id,tailor_staff_assignment_id,submitted_by) VALUES(p_request,payload,CASE WHEN p_job_kind='customer_tailoring' THEN p_job END,CASE WHEN p_job_kind='production' THEN p_job END,job_assignment,p_staff_assignment,auth.uid()) RETURNING id INTO result;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  SELECT * INTO u FROM public.material_units WHERE barcode=upper(btrim(row_value->>'barcode')) FOR UPDATE; qty:=(row_value->>'quantity')::numeric;
  IF u.id IS NULL OR u.assigned_tailor_id<>master.id OR u.assigned_factory_id<>staff.factory_id THEN RAISE EXCEPTION 'Every M unit must be assigned to this Master Tailor and factory'; END IF;
  IF qty<=0 OR qty<>round(qty,3) OR qty>u.remaining_quantity THEN RAISE EXCEPTION 'Consumption must be positive and cannot exceed the unit balance'; END IF;
  amount:=round(qty*u.cp_per_quantity_paise);
  INSERT INTO public.job_material_consumption_lines(consumption_id,material_unit_id,quantity,unit,cp_per_quantity_paise,amount_paise) VALUES(result,u.id,qty,u.unit,u.cp_per_quantity_paise,amount);
  UPDATE public.material_units SET remaining_quantity=remaining_quantity-qty,exhausted_at=CASE WHEN remaining_quantity-qty=0 THEN clock_timestamp() END WHERE id=u.id;
 END LOOP;
 IF p_job_kind='customer_tailoring' THEN UPDATE public.customer_tailoring_jobs SET status='completed' WHERE id=p_job AND status IN('open','in_progress'); END IF;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'submit_job_material_consumption','job_material_consumptions',result,payload,'MATERIAL-CONSUME:'||p_request); RETURN result;
END; $function$;

-- 6. Godown view of one order: garments, split SP, cost and labels.
CREATE FUNCTION public.customer_tailoring_labels(p_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.customer_tailoring_jobs%rowtype; total bigint; n integer; saved public.customer_tailoring_completion_costs%rowtype;
BEGIN
  IF NOT public.customer_tailoring_receipt_allowed() THEN RAISE EXCEPTION 'Customer stitching receipt permission required'; END IF;
  SELECT * INTO j FROM public.customer_tailoring_jobs WHERE id = p_job;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Customer stitching order not found'; END IF;
  total := public.customer_tailoring_order_sp(j.id);
  SELECT greatest(count(*), 1) INTO n FROM public.customer_tailoring_garments WHERE job_id = j.id;
  SELECT * INTO saved FROM public.customer_tailoring_completion_costs WHERE job_id = j.id;
  RETURN jsonb_build_object(
    'id', j.id, 'code', j.code, 'scan_code', j.scan_code, 'garment', j.garment, 'status', j.status,
    'customer', (SELECT name FROM public.customers WHERE id = j.customer_id),
    'bill_code', (SELECT coalesce(o.scan_code, o.code) FROM public.counter_tailoring_details d JOIN public.orders o ON o.id = d.bill_id WHERE d.job_id = j.id),
    'design', (SELECT coalesce(design_name_snapshot, custom_design) FROM public.counter_tailoring_details WHERE job_id = j.id),
    'delivery_date', (SELECT delivery_date FROM public.counter_tailoring_details WHERE job_id = j.id),
    'factory', (SELECT f.name FROM public.tailor_assignments a JOIN public.tailoring_factories f ON f.id = a.factory_id WHERE a.id = j.tailor_assignment_id),
    'tailor', (SELECT t.real_name FROM public.tailor_assignments a JOIN public.tailors t ON t.id = a.tailor_id WHERE a.id = j.tailor_assignment_id),
    'work_recorded', EXISTS(SELECT 1 FROM public.job_workflow_events WHERE customer_tailoring_job_id = j.id AND stage = 'work_recorded'),
    'labels_created', EXISTS(SELECT 1 FROM public.customer_tailoring_finished_items WHERE job_id = j.id),
    'total_sp_paise', total::text,
    'fabric_cp_paise', public.customer_tailoring_fabric_cp(j.id)::text,
    'consumables_cp_paise', public.customer_tailoring_consumables_cp(j.id)::text,
    'stitching_cp_paise', saved.stitching_cp_paise::text,
    'garments', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'line_no', g.line_no, 'size', g.size, 'notes', g.notes, 'barcode', b.code,
        'sp_paise', coalesce(fi.sp_paise, CASE WHEN total > 0 THEN public.customer_tailoring_split(total, n, g.line_no) END)::text
      ) ORDER BY g.line_no)
      FROM public.customer_tailoring_garments g
      LEFT JOIN public.customer_tailoring_finished_items fi ON fi.id = g.finished_item_id
      LEFT JOIN public.barcodes b ON b.id = fi.barcode_id
      WHERE g.job_id = j.id),
      jsonb_build_array(jsonb_build_object('line_no', 1, 'size', coalesce(j.size, 'Not recorded'), 'sp_paise', total::text))));
END $$;

-- 7. Godown: save stitching CP, create one C label per garment (first time only), mark Delivery Ready.
CREATE FUNCTION public.generate_customer_tailoring_labels(p_request uuid, p_job uuid, p_stitching_cp_paise bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.customer_tailoring_jobs%rowtype; total bigint; n integer; workshop uuid; g record; barcode uuid; item uuid; fabric_cp bigint; consumables_cp bigint;
BEGIN
  IF NOT public.customer_tailoring_receipt_allowed() THEN RAISE EXCEPTION 'Customer stitching receipt permission required'; END IF;
  IF p_request IS NULL OR p_job IS NULL THEN RAISE EXCEPTION 'Request and order required'; END IF;
  SELECT * INTO j FROM public.customer_tailoring_jobs WHERE id = p_job FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Customer stitching order not found'; END IF;
  -- Reprint: labels already exist, so return the same codes.
  IF EXISTS(SELECT 1 FROM public.customer_tailoring_finished_items WHERE job_id = j.id) THEN
    RETURN public.customer_tailoring_labels(j.id);
  END IF;
  IF j.status IN ('open', 'in_progress') THEN RAISE EXCEPTION 'The Master Tailor has not submitted this order yet (still Started)'; END IF;
  IF j.status <> 'completed' THEN RAISE EXCEPTION 'Only a Completed order can be made Delivery Ready'; END IF;
  IF p_stitching_cp_paise IS NULL OR p_stitching_cp_paise NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Enter the stitching CP (0 or more)'; END IF;
  total := public.customer_tailoring_order_sp(j.id);
  IF NOT EXISTS(SELECT 1 FROM public.customer_tailoring_garments WHERE job_id = j.id) THEN
    INSERT INTO public.customer_tailoring_garments(job_id, line_no, size) VALUES (j.id, 1, coalesce(nullif(btrim(j.size), ''), 'Not recorded'));
  END IF;
  SELECT count(*) INTO n FROM public.customer_tailoring_garments WHERE job_id = j.id;
  IF total IS NULL OR total < n THEN RAISE EXCEPTION 'The order SP recorded at billing is too small to split across % garments', n; END IF;
  SELECT id INTO workshop FROM public.locations WHERE active AND kind = 'workshop' FOR UPDATE;
  IF workshop IS NULL THEN RAISE EXCEPTION 'Active Workshop required'; END IF;
  fabric_cp := public.customer_tailoring_fabric_cp(j.id);
  consumables_cp := public.customer_tailoring_consumables_cp(j.id);
  INSERT INTO public.customer_tailoring_completion_costs(job_id, fabric_cp_paise, consumables_cp_paise, stitching_cp_paise, recorded_by)
  VALUES (j.id, fabric_cp, consumables_cp, p_stitching_cp_paise, auth.uid())
  ON CONFLICT (job_id) DO UPDATE SET fabric_cp_paise = excluded.fabric_cp_paise, consumables_cp_paise = excluded.consumables_cp_paise,
    stitching_cp_paise = excluded.stitching_cp_paise, recorded_by = excluded.recorded_by, recorded_at = clock_timestamp();
  FOR g IN SELECT * FROM public.customer_tailoring_garments WHERE job_id = j.id ORDER BY line_no LOOP
    barcode := public.new_typed_finished_barcode('C');
    INSERT INTO public.customer_tailoring_finished_items(job_id, barcode_id, request_id, name, size, sp_paise, workshop_location_id, created_by)
    VALUES (j.id, barcode, gen_random_uuid(), left(btrim(j.garment), 120), g.size, public.customer_tailoring_split(total, n, g.line_no), workshop, auth.uid())
    RETURNING id INTO item;
    UPDATE public.customer_tailoring_garments SET finished_item_id = item WHERE id = g.id;
  END LOOP;
  UPDATE public.customer_tailoring_jobs SET status = 'ready' WHERE id = j.id;
  INSERT INTO public.erp_audit_records(actor_id, action, entity_table, entity_id, new_value, reference)
  VALUES (auth.uid(), 'generate_customer_tailoring_labels', 'customer_tailoring_jobs', j.id,
    jsonb_build_object('garments', n, 'order_sp_paise', total, 'fabric_cp_paise', fabric_cp,
      'consumables_cp_paise', consumables_cp, 'stitching_cp_paise', p_stitching_cp_paise),
    'CUSTOMER-LABELS:' || p_request::text);
  RETURN public.customer_tailoring_labels(j.id);
END $$;

-- The old one-label receipt is replaced by generate_customer_tailoring_labels.
CREATE OR REPLACE FUNCTION public.receive_customer_tailoring_finished_item(p_request uuid, p_job uuid, p_name text, p_size text, p_sp_paise bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'This screen is out of date. Reload the page and use Generate labels.';
END $$;

-- 8. Counter delivery: only a Delivery Ready order; balance must be zero unless the Owner overrides with a reason.
CREATE FUNCTION public.deliver_customer_tailoring(p_request uuid, p_job uuid, p_override_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.customer_tailoring_jobs%rowtype; bill uuid; total bigint; collected bigint; balance bigint; reason text := nullif(btrim(p_override_reason), '');
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(), 'pos.sell') THEN RAISE EXCEPTION 'Counter delivery permission required'; END IF;
  IF p_request IS NULL OR p_job IS NULL THEN RAISE EXCEPTION 'Request and order required'; END IF;
  SELECT * INTO j FROM public.customer_tailoring_jobs WHERE id = p_job FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Customer stitching order not found'; END IF;
  IF j.status = 'delivered' THEN RETURN jsonb_build_object('id', j.id, 'status', j.status); END IF;
  IF j.status <> 'ready' THEN RAISE EXCEPTION 'This order is not Delivery Ready yet'; END IF;
  SELECT d.bill_id INTO bill FROM public.counter_tailoring_details d WHERE d.job_id = j.id;
  IF bill IS NOT NULL THEN
    SELECT final_customer_price_paise INTO total FROM public.orders WHERE id = bill FOR UPDATE;
    SELECT coalesce(sum(amount_paise), 0) INTO collected FROM public.counter_bill_payments WHERE bill_id = bill;
    balance := greatest(total - collected, 0);
  END IF;
  IF bill IS NULL OR balance > 0 THEN
    IF NOT public.has_role(auth.uid(), 'owner') THEN
      RAISE EXCEPTION 'Collect the balance of ₹% before delivery. Only the Owner can deliver with money still due', to_char(coalesce(balance, 0) / 100.0, 'FM99999999990.00');
    END IF;
    IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 200 THEN RAISE EXCEPTION 'Enter a short reason (3 to 200 characters) for delivering with money due'; END IF;
  ELSE
    reason := NULL;
  END IF;
  UPDATE public.customer_tailoring_jobs SET status = 'delivered' WHERE id = j.id;
  INSERT INTO public.erp_audit_records(actor_id, action, entity_table, entity_id, previous_value, new_value, reference)
  VALUES (auth.uid(), CASE WHEN reason IS NULL THEN 'deliver_customer_tailoring' ELSE 'deliver_customer_tailoring_unpaid_override' END,
    'customer_tailoring_jobs', j.id, jsonb_build_object('status', j.status),
    jsonb_build_object('status', 'delivered', 'bill_id', bill, 'balance_due_paise', balance, 'override_reason', reason),
    'CUSTOMER-DELIVERY:' || p_request::text);
  RETURN jsonb_build_object('id', j.id, 'status', 'delivered', 'balance_due_paise', balance::text, 'override', reason IS NOT NULL);
END $$;

-- 9. Manual status changes: only the Owner, and only to cancel. Other stages follow the workflow.
CREATE OR REPLACE FUNCTION public.set_customer_tailoring_status(p_job uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.customer_tailoring_jobs%rowtype;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN RAISE EXCEPTION 'Only the Owner can cancel a customer stitching order'; END IF;
  IF p_status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'Stages follow the workflow: Started at billing, Completed by the Master Tailor, Delivery Ready at the godown, Delivered at the Counter';
  END IF;
  SELECT * INTO j FROM public.customer_tailoring_jobs WHERE id = p_job AND request_id IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booked Customer Tailoring Job required'; END IF;
  IF j.status = 'cancelled' THEN RETURN; END IF;
  IF j.status = 'delivered' THEN RAISE EXCEPTION 'A delivered order cannot be cancelled'; END IF;
  UPDATE public.customer_tailoring_jobs SET status = 'cancelled' WHERE id = j.id;
  INSERT INTO public.erp_audit_records(actor_id, action, entity_table, entity_id, previous_value, new_value)
  VALUES (auth.uid(), 'set_customer_tailoring_status', 'customer_tailoring_jobs', j.id, jsonb_build_object('status', j.status), jsonb_build_object('status', 'cancelled'));
END $$;

-- 10. Order lookup: include garments and labels, and accept a C label scan.
CREATE OR REPLACE FUNCTION public.customer_tailoring_work(p_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE owner boolean:=public.has_role(auth.uid(),'owner');counter boolean:=public.has_role(auth.uid(),'counter');
BEGIN
 IF NOT owner AND NOT counter AND NOT (public.has_role(auth.uid(),'tailor') AND public.has_perm(auth.uid(),'tailoring.manage_jobs')) THEN RAISE EXCEPTION 'Customer Tailoring access required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',j.id,'code',j.code,'scan_code',j.scan_code,'bill_id',d.bill_id,'bill_code',o.code,'bill_scan_code',o.scan_code,'garment',j.garment,'status',j.status,'created_at',j.created_at,'created_by',j.created_by,'creator',person.full_name,'delivery_date',d.delivery_date,'design',d.design_name_snapshot,'customer',c.name,'contact',c.phone,'factory',f.name,'tailor',t.real_name,'notes',j.notes,'size',j.size,'garments',coalesce((SELECT jsonb_agg(jsonb_build_object('line_no',g.line_no,'size',g.size,'notes',g.notes,'barcode',b.code,'sp_paise',fi.sp_paise::text) ORDER BY g.line_no) FROM public.customer_tailoring_garments g LEFT JOIN public.customer_tailoring_finished_items fi ON fi.id=g.finished_item_id LEFT JOIN public.barcodes b ON b.id=fi.barcode_id WHERE g.job_id=j.id),'[]'),'source',loc.name,
 'paid',CASE WHEN d.bill_id IS NOT NULL THEN EXISTS(SELECT 1 FROM public.counter_bill_payments WHERE bill_id=d.bill_id) END,
 'total_paise',CASE WHEN owner OR counter THEN coalesce(price.final_customer_price_paise,old_price.final_customer_price_paise)::text END,
 'cp_paise',CASE WHEN owner THEN public.customer_job_fabric_cp(j.id)::text END,
 'fabrics',coalesce((SELECT jsonb_agg(jsonb_build_object('barcode',coalesce(v.code,th.barcode,b.code),'name',fab.name,'quantity_mm',line.quantity::text,'source',source.name,'issue_type',issue.issue_type,'issued_at',issue.issued_at,'issued_by',actor.full_name,'issue',issue.code) ORDER BY issue.issued_at,line.id) FROM public.material_issue_lines line JOIN public.material_issues issue ON issue.id=line.material_issue_id JOIN public.thaans th ON th.id=line.thaan_id JOIN public.fabrics fab ON fab.id=th.fabric_id JOIN public.fabric_stock stock ON stock.id=th.fabric_stock_id LEFT JOIN public.barcodes b ON b.id=stock.barcode_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=th.id JOIN public.locations source ON source.id=issue.source_location_id LEFT JOIN public.profiles actor ON actor.id=issue.issued_by WHERE issue.customer_tailoring_job_id=j.id),'[]'))
 ORDER BY j.created_at DESC,j.id) FROM public.customer_tailoring_jobs j LEFT JOIN public.customers c ON c.id=j.customer_id JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id JOIN public.tailors t ON t.id=a.tailor_id LEFT JOIN LATERAL(SELECT source_location_id FROM public.material_issues WHERE customer_tailoring_job_id=j.id ORDER BY issued_at,id LIMIT 1) initial_source ON true LEFT JOIN public.locations loc ON loc.id=initial_source.source_location_id LEFT JOIN public.profiles person ON person.id=j.created_by LEFT JOIN public.counter_tailoring_details d ON d.job_id=j.id LEFT JOIN public.orders o ON o.id=d.bill_id LEFT JOIN public.counter_tailoring_prices price ON price.job_id=j.id LEFT JOIN LATERAL(SELECT * FROM public.customer_tailoring_prices WHERE job_id=j.id ORDER BY revision DESC LIMIT 1) old_price ON true
 WHERE (owner OR counter OR public.owns_tailor_assignment(j.tailor_assignment_id)) AND (nullif(public.resolve_document_scan_code(btrim(p_code)),'') IS NULL OR j.code=public.resolve_document_scan_code(btrim(p_code)) OR j.id::text=public.resolve_document_scan_code(btrim(p_code)) OR o.code=public.resolve_document_scan_code(btrim(p_code)) OR o.id::text=public.resolve_document_scan_code(btrim(p_code)) OR j.id IN(SELECT fi.job_id FROM public.customer_tailoring_finished_items fi JOIN public.barcodes b ON b.id=fi.barcode_id WHERE b.code=btrim(p_code)))),'[]');
END; $function$;

REVOKE ALL ON FUNCTION public.customer_tailoring_labels(uuid), public.generate_customer_tailoring_labels(uuid, uuid, bigint),
  public.deliver_customer_tailoring(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_tailoring_labels(uuid), public.generate_customer_tailoring_labels(uuid, uuid, bigint),
  public.deliver_customer_tailoring(uuid, uuid, text) TO authenticated;

COMMIT;
