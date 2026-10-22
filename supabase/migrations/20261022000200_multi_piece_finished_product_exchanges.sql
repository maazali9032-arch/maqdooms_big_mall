BEGIN;

CREATE TABLE public.finished_product_exchange_batches (
  exchange_bill_id uuid PRIMARY KEY REFERENCES public.orders(id),
  original_bill_id uuid NOT NULL REFERENCES public.orders(id),
  return_credit_paise bigint NOT NULL CHECK(return_credit_paise >= 0),
  replacement_value_paise bigint NOT NULL CHECK(replacement_value_paise >= 0),
  net_difference_paise bigint NOT NULL,
  payment_method text NOT NULL CHECK(payment_method IN('cash','card','upi','bank_transfer','mixed')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.finished_product_exchange_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_bill_id uuid NOT NULL REFERENCES public.finished_product_exchange_batches(exchange_bill_id),
  direction text NOT NULL CHECK(direction IN('return','replacement')),
  finished_product_id uuid NOT NULL REFERENCES public.finished_products(id),
  original_order_item_id uuid REFERENCES public.order_items(id),
  exchange_order_item_id uuid REFERENCES public.order_items(id),
  value_paise bigint NOT NULL CHECK(value_paise >= 0),
  UNIQUE(exchange_bill_id, direction, finished_product_id),
  CHECK((direction='return') = (original_order_item_id IS NOT NULL)),
  CHECK((direction='replacement') = (exchange_order_item_id IS NOT NULL))
);
CREATE UNIQUE INDEX finished_product_exchange_return_once ON public.finished_product_exchange_lines(finished_product_id) WHERE direction='return';
CREATE TABLE public.finished_product_exchange_settlements (
  exchange_bill_id uuid PRIMARY KEY REFERENCES public.finished_product_exchange_batches(exchange_bill_id),
  direction text NOT NULL CHECK(direction IN('collect','refund')),
  amount_paise bigint NOT NULL CHECK(amount_paise > 0),
  payment_method text NOT NULL CHECK(payment_method IN('cash','card','upi','bank_transfer','mixed')),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.finished_product_exchange_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finished_product_exchange_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finished_product_exchange_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finished_product_exchange_batches,public.finished_product_exchange_lines,public.finished_product_exchange_settlements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.finished_product_exchange_batches,public.finished_product_exchange_lines,public.finished_product_exchange_settlements TO authenticated;
GRANT ALL ON public.finished_product_exchange_batches,public.finished_product_exchange_lines,public.finished_product_exchange_settlements TO service_role;
CREATE POLICY finished_product_exchange_batches_read ON public.finished_product_exchange_batches FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','counter']));
CREATE POLICY finished_product_exchange_lines_read ON public.finished_product_exchange_lines FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','counter']));
CREATE POLICY finished_product_exchange_settlements_read ON public.finished_product_exchange_settlements FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','counter']));
CREATE TRIGGER finished_product_exchange_batches_immutable BEFORE UPDATE OR DELETE ON public.finished_product_exchange_batches FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER finished_product_exchange_lines_immutable BEFORE UPDATE OR DELETE ON public.finished_product_exchange_lines FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER finished_product_exchange_settlements_immutable BEFORE UPDATE OR DELETE ON public.finished_product_exchange_settlements FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE FUNCTION public.complete_finished_product_exchange(
  p_request uuid,
  p_original_bill uuid,
  p_returns jsonb,
  p_replacements jsonb,
  p_salesperson uuid,
  p_payment_method text DEFAULT 'cash'
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  original public.orders%rowtype;
  returned_piece public.finished_products%rowtype;
  replacement_piece public.finished_products%rowtype;
  returned_item public.order_items%rowtype;
  replacement_price public.finished_product_prices%rowtype;
  returned_inventory uuid;
  replacement_inventory uuid;
  return_location uuid;
  exchange_id uuid := gen_random_uuid();
  replacement_item_id uuid;
  exchange_code text;
  request_payload jsonb;
  salesperson_name text;
  return_code text;
  replacement_code text;
  replacement_name text;
  return_credit bigint := 0;
  replacement_value bigint := 0;
  net_difference bigint := 0;
  header_location uuid;
  item text;
  return_lines jsonb := '[]'::jsonb;
  replacement_lines jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') THEN RAISE EXCEPTION 'Finished-product exchange permission required'; END IF;
  IF p_request IS NULL OR p_original_bill IS NULL OR p_salesperson IS NULL
     OR jsonb_typeof(p_returns) <> 'array' OR jsonb_typeof(p_replacements) <> 'array'
     OR jsonb_array_length(p_returns) NOT BETWEEN 1 AND 50 OR jsonb_array_length(p_replacements) NOT BETWEEN 1 AND 50
     OR p_payment_method NOT IN('cash','card','upi','bank_transfer','mixed') THEN
    RAISE EXCEPTION 'Original bill, 1–50 returned pieces, 1–50 replacements, Salesperson and payment method are required';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_returns) x WHERE btrim(x.value)='')
     OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_replacements) x WHERE btrim(x.value)='')
     OR (SELECT count(DISTINCT btrim(value)) FROM jsonb_array_elements_text(p_returns))<>jsonb_array_length(p_returns)
     OR (SELECT count(DISTINCT btrim(value)) FROM jsonb_array_elements_text(p_replacements))<>jsonb_array_length(p_replacements)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_returns) r JOIN jsonb_array_elements_text(p_replacements) s ON btrim(r.value)=btrim(s.value)) THEN
    RAISE EXCEPTION 'Each returned and replacement barcode must be distinct';
  END IF;
  request_payload:=jsonb_build_object('original_bill',p_original_bill,'returns',p_returns,'replacements',p_replacements,'salesperson',p_salesperson,'payment_method',p_payment_method);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,6));
  SELECT * INTO original FROM public.orders WHERE id=p_original_bill FOR UPDATE;
  IF NOT FOUND OR original.kind NOT IN('counter_bill','finished_product_sale') OR original.status<>'completed' THEN RAISE EXCEPTION 'Scan a completed customer bill containing shop-finished products'; END IF;
  IF original.kind='counter_bill' AND NOT EXISTS(SELECT 1 FROM public.counter_bill_payments p WHERE p.bill_id=original.id GROUP BY p.bill_id HAVING sum(p.amount_paise)>=original.final_customer_price_paise) THEN RAISE EXCEPTION 'Only a fully paid original bill can be exchanged'; END IF;
  IF original.kind='finished_product_sale' AND original.payment_confirmed_at IS NULL THEN RAISE EXCEPTION 'Only a paid original sale can be exchanged'; END IF;
  SELECT full_name INTO salesperson_name FROM public.profiles WHERE id=p_salesperson;
  IF salesperson_name IS NULL THEN RAISE EXCEPTION 'Valid Salesperson required'; END IF;
  SELECT p.current_location_id INTO header_location FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id
  WHERE b.code=(SELECT btrim(value) FROM jsonb_array_elements_text(p_replacements) LIMIT 1);
  IF header_location IS NULL THEN RAISE EXCEPTION 'Scan an available replacement shop-finished piece'; END IF;
  INSERT INTO public.orders(id,code,kind,customer_id,source_location_id,status,final_customer_price_paise,reference,created_by,salesperson_user_id,sale_request_id,sale_request_payload,customer_snapshot)
  VALUES(exchange_id,'EXCHANGE-'||replace(exchange_id::text,'-',''),'counter_exchange',original.customer_id,header_location,'draft',0,'Exchange for '||coalesce(original.scan_code,original.code),auth.uid(),p_salesperson,p_request,request_payload,original.customer_snapshot);
  SELECT scan_code INTO exchange_code FROM public.orders WHERE id=exchange_id;

  -- Return each exact sold piece from the scanned bill to the original Showroom floor.
  FOR item IN SELECT btrim(value) FROM jsonb_array_elements_text(p_returns) ORDER BY btrim(value) LOOP
    SELECT p.* INTO returned_piece FROM public.order_items it JOIN public.finished_products p ON p.id=it.finished_product_id JOIN public.barcodes b ON b.id=p.barcode_id WHERE it.order_id=original.id AND b.code=item AND it.unit='pc' FOR UPDATE OF p;
    IF NOT FOUND OR returned_piece.status<>'sold' THEN RAISE EXCEPTION 'Returned barcode % is not a sold shop-finished piece from the original bill',item; END IF;
    IF EXISTS(SELECT 1 FROM public.finished_product_exchanges WHERE returned_finished_product_id=returned_piece.id) OR EXISTS(SELECT 1 FROM public.finished_product_exchange_lines WHERE finished_product_id=returned_piece.id AND direction='return') THEN RAISE EXCEPTION 'Returned barcode % has already been exchanged',item; END IF;
    SELECT * INTO returned_item FROM public.order_items WHERE order_id=original.id AND finished_product_id=returned_piece.id FOR UPDATE;
    SELECT coalesce(m.source_location_id,original.source_location_id) INTO return_location FROM public.inventory_movements m WHERE m.order_item_id=returned_item.id AND m.kind='SALE' ORDER BY m.occurred_at DESC LIMIT 1;
    IF return_location IS NULL OR NOT public.is_showroom_location(return_location) THEN RAISE EXCEPTION 'The original Showroom floor for % is no longer active',item; END IF;
    SELECT id INTO returned_inventory FROM public.inventory_items WHERE finished_product_id=returned_piece.id AND unit='pc' FOR UPDATE;
    IF returned_inventory IS NULL THEN RAISE EXCEPTION 'Returned barcode % has no physical stock record',item; END IF;
    return_credit:=return_credit+returned_item.final_customer_price_paise;
    INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,destination_location_id,actor_id,reason,reference) VALUES(returned_inventory,'RETURN',returned_piece.id,1,'pc',return_location,auth.uid(),'Counter finished-product exchange return','BILL:'||exchange_id::text);
    UPDATE public.finished_products SET status='available',current_location_id=return_location WHERE id=returned_piece.id;
    return_lines:=return_lines||jsonb_build_array(jsonb_build_object('piece_id',returned_piece.id,'order_item_id',returned_item.id,'barcode',item,'name',(SELECT product.name FROM public.products product WHERE product.id=returned_piece.product_id),'value_paise',returned_item.final_customer_price_paise::text));
  END LOOP;

  -- Sell each replacement from its recorded active Showroom floor.
  FOR item IN SELECT btrim(value) FROM jsonb_array_elements_text(p_replacements) ORDER BY btrim(value) LOOP
    SELECT p.* INTO replacement_piece FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id WHERE b.code=item FOR UPDATE OF p;
    IF NOT FOUND OR replacement_piece.status<>'available' OR NOT public.is_showroom_location(replacement_piece.current_location_id) THEN RAISE EXCEPTION 'Replacement barcode % must be an available shop-finished Showroom piece',item; END IF;
    SELECT id INTO replacement_inventory FROM public.inventory_items WHERE finished_product_id=replacement_piece.id AND unit='pc' FOR UPDATE;
    IF replacement_inventory IS NULL OR public.inventory_balance(replacement_inventory,replacement_piece.current_location_id)<>1 THEN RAISE EXCEPTION 'Replacement barcode % is no longer available',item; END IF;
    SELECT * INTO replacement_price FROM public.finished_product_prices WHERE finished_product_id=replacement_piece.id ORDER BY revision DESC LIMIT 1;
    IF replacement_price.id IS NULL OR replacement_price.sp_paise<=0 THEN RAISE EXCEPTION 'Replacement barcode % needs a saved positive SP',item; END IF;
    IF header_location IS NULL THEN header_location:=replacement_piece.current_location_id; END IF;
    replacement_value:=replacement_value+replacement_price.sp_paise;
    INSERT INTO public.order_items(order_id,finished_product_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) VALUES(exchange_id,replacement_piece.id,1,'pc',replacement_price.sp_paise,0) RETURNING id INTO replacement_item_id;
    INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference) VALUES(replacement_inventory,'SALE',replacement_piece.id,1,'pc',replacement_piece.current_location_id,replacement_item_id,auth.uid(),'Counter finished-product exchange replacement','BILL:'||exchange_id::text);
    UPDATE public.finished_products SET status='sold' WHERE id=replacement_piece.id;
    SELECT product.name INTO replacement_name FROM public.products product WHERE product.id=replacement_piece.product_id;
    replacement_lines:=replacement_lines||jsonb_build_array(jsonb_build_object('piece_id',replacement_piece.id,'id',replacement_item_id,'barcode',item,'name',replacement_name,'size',public.production_piece_context(replacement_piece.id)->>'size','design',public.production_piece_context(replacement_piece.id)->>'design','value_paise',replacement_price.sp_paise::text));
  END LOOP;
  net_difference:=replacement_value-return_credit;
  UPDATE public.orders SET status='completed',final_customer_price_paise=greatest(net_difference,0),completed_at=clock_timestamp(),payment_confirmed_at=clock_timestamp() WHERE id=exchange_id;
  INSERT INTO public.finished_product_exchange_batches(exchange_bill_id,original_bill_id,return_credit_paise,replacement_value_paise,net_difference_paise,payment_method,created_by) VALUES(exchange_id,original.id,return_credit,replacement_value,net_difference,p_payment_method,auth.uid());
  INSERT INTO public.finished_product_exchange_lines(exchange_bill_id,direction,finished_product_id,original_order_item_id,value_paise)
  SELECT exchange_id,'return',(x->>'piece_id')::uuid,(x->>'order_item_id')::uuid,(x->>'value_paise')::bigint FROM jsonb_array_elements(return_lines) x;
  INSERT INTO public.finished_product_exchange_lines(exchange_bill_id,direction,finished_product_id,exchange_order_item_id,value_paise)
  SELECT exchange_id,'replacement',(x->>'piece_id')::uuid,(x->>'id')::uuid,(x->>'value_paise')::bigint FROM jsonb_array_elements(replacement_lines) x;
  INSERT INTO public.counter_bills(order_id,request_id,actor_id,payload) VALUES(exchange_id,p_request,auth.uid(),request_payload);
  IF net_difference>0 THEN
    INSERT INTO public.counter_bill_payments(bill_id,request_id,amount_paise,actor_id) VALUES(exchange_id,p_request,net_difference,auth.uid());
    INSERT INTO public.finished_product_exchange_settlements(exchange_bill_id,direction,amount_paise,payment_method,actor_id) VALUES(exchange_id,'collect',net_difference,p_payment_method,auth.uid());
  ELSIF net_difference<0 THEN
    INSERT INTO public.counter_bill_payments(bill_id,request_id,amount_paise,actor_id) VALUES(exchange_id,p_request,0,auth.uid());
    INSERT INTO public.finished_product_exchange_settlements(exchange_bill_id,direction,amount_paise,payment_method,actor_id) VALUES(exchange_id,'refund',abs(net_difference),p_payment_method,auth.uid());
  ELSE
    INSERT INTO public.counter_bill_payments(bill_id,request_id,amount_paise,actor_id) VALUES(exchange_id,p_request,0,auth.uid());
  END IF;
  INSERT INTO public.counter_bill_print_records(bill_id,document) VALUES(exchange_id,jsonb_build_object('id',exchange_id,'code',exchange_code,'scan_code',exchange_code,'created_at',clock_timestamp(),'total_paise',greatest(net_difference,0)::text,'source',(SELECT name FROM public.locations WHERE id=header_location),'salesperson',salesperson_name,'customer',original.customer_snapshot,'lines',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x->>'id','kind','product','barcode',x->>'barcode','name',x->>'name','size',x->>'size','design',x->>'design','quantity','1','unit','pc','price_paise',x->>'value_paise','amount_paise','0','job_id',null,'job_code',null,'delivery_date',null,'fabrics',null)) FROM jsonb_array_elements(replacement_lines) x),'[]'::jsonb),'exchange',jsonb_build_object('original_bill_code',coalesce(original.scan_code,original.code),'returns',return_lines,'replacements',replacement_lines,'return_credit_paise',return_credit::text,'replacement_value_paise',replacement_value::text,'net_difference_paise',net_difference::text,'payment_method',p_payment_method)));
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'complete_multi_piece_finished_product_exchange','orders',exchange_id,request_payload,'EXCHANGE:'||coalesce(exchange_code,exchange_id::text));
  RETURN coalesce(exchange_code,exchange_id::text);
END; $$;

REVOKE ALL ON FUNCTION public.complete_finished_product_exchange(uuid,uuid,jsonb,jsonb,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_finished_product_exchange(uuid,uuid,jsonb,jsonb,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
