BEGIN;

-- An exchange is a controlled swap of one previously sold shop-finished piece
-- for another piece at the same recorded selling price. Fabric and tailoring
-- lines are deliberately outside this workflow.
ALTER TABLE public.orders DROP CONSTRAINT orders_kind_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_kind_check CHECK(kind IN('direct_fabric_sale','customer_tailoring','finished_product_sale','ecommerce_sale','counter_bill','counter_exchange'));

CREATE TABLE public.finished_product_exchanges (
  exchange_bill_id uuid PRIMARY KEY REFERENCES public.orders(id),
  original_bill_id uuid NOT NULL REFERENCES public.orders(id),
  returned_finished_product_id uuid NOT NULL UNIQUE REFERENCES public.finished_products(id),
  replacement_finished_product_id uuid NOT NULL REFERENCES public.finished_products(id),
  returned_order_item_id uuid NOT NULL REFERENCES public.order_items(id),
  replacement_order_item_id uuid NOT NULL REFERENCES public.order_items(id),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(returned_finished_product_id <> replacement_finished_product_id)
);
ALTER TABLE public.finished_product_exchanges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finished_product_exchanges FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finished_product_exchanges TO authenticated;
GRANT ALL ON public.finished_product_exchanges TO service_role;
CREATE POLICY finished_product_exchanges_read ON public.finished_product_exchanges
  FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(), ARRAY['owner','counter']));
CREATE TRIGGER finished_product_exchanges_immutable BEFORE UPDATE OR DELETE ON public.finished_product_exchanges
  FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE FUNCTION public.complete_finished_product_exchange(
  p_request uuid,
  p_original_bill uuid,
  p_return_barcode text,
  p_replacement_barcode text,
  p_salesperson uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  original public.orders%rowtype;
  returned_piece public.finished_products%rowtype;
  replacement_piece public.finished_products%rowtype;
  returned_item public.order_items%rowtype;
  replacement_price public.finished_product_prices%rowtype;
  return_inventory uuid;
  replacement_inventory uuid;
  return_location uuid;
  exchange_id uuid := gen_random_uuid();
  replacement_item_id uuid;
  exchange_code text;
  request_payload jsonb;
  salesperson_name text;
  replacement_name text;
  returned_code text;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') THEN
    RAISE EXCEPTION 'Finished-product exchange permission required';
  END IF;
  IF p_request IS NULL OR p_original_bill IS NULL OR p_salesperson IS NULL
     OR nullif(btrim(p_return_barcode),'') IS NULL OR nullif(btrim(p_replacement_barcode),'') IS NULL THEN
    RAISE EXCEPTION 'Original bill, both physical product barcodes and Salesperson are required';
  END IF;
  IF btrim(p_return_barcode)=btrim(p_replacement_barcode) THEN
    RAISE EXCEPTION 'The returned and replacement pieces must be different physical barcodes';
  END IF;

  request_payload := jsonb_build_object('original_bill',p_original_bill,'return_barcode',btrim(p_return_barcode),'replacement_barcode',btrim(p_replacement_barcode),'salesperson',p_salesperson);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text, 6));
  SELECT o.* INTO original FROM public.orders o WHERE o.id=p_original_bill FOR UPDATE;
  IF NOT FOUND OR original.kind NOT IN ('counter_bill','finished_product_sale') OR original.status <> 'completed' THEN
    RAISE EXCEPTION 'Scan a completed customer bill containing a shop-finished product';
  END IF;
  IF original.kind='counter_bill' AND NOT EXISTS(
    SELECT 1 FROM public.counter_bill_payments p WHERE p.bill_id=original.id
    GROUP BY p.bill_id HAVING sum(p.amount_paise) >= original.final_customer_price_paise
  ) THEN RAISE EXCEPTION 'Only a fully paid original bill can be exchanged'; END IF;
  IF original.kind='finished_product_sale' AND original.payment_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Only a paid original sale can be exchanged';
  END IF;
  IF EXISTS(SELECT 1 FROM public.finished_product_exchanges WHERE returned_finished_product_id IN (
    SELECT p.id FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id WHERE b.code=btrim(p_return_barcode)
  )) THEN RAISE EXCEPTION 'This physical finished piece has already been exchanged'; END IF;

  SELECT p.* INTO returned_piece
  FROM public.order_items it
  JOIN public.finished_products p ON p.id=it.finished_product_id
  JOIN public.barcodes b ON b.id=p.barcode_id
  WHERE it.order_id=original.id AND b.code=btrim(p_return_barcode) AND it.unit='pc'
  FOR UPDATE OF p;
  IF NOT FOUND OR returned_piece.status <> 'sold' THEN
    RAISE EXCEPTION 'Scan the exact sold shop-finished piece from the original bill';
  END IF;
  SELECT it.* INTO returned_item FROM public.order_items it
  WHERE it.order_id=original.id AND it.finished_product_id=returned_piece.id
  FOR UPDATE;
  SELECT coalesce(m.source_location_id, original.source_location_id) INTO return_location
  FROM public.inventory_movements m WHERE m.order_item_id=returned_item.id AND m.kind='SALE'
  ORDER BY m.occurred_at DESC LIMIT 1;
  IF return_location IS NULL OR NOT public.is_showroom_location(return_location) THEN
    RAISE EXCEPTION 'The original Showroom floor is no longer available for this return';
  END IF;

  SELECT p.* INTO replacement_piece
  FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id
  WHERE b.code=btrim(p_replacement_barcode)
  FOR UPDATE OF p;
  IF NOT FOUND OR replacement_piece.status <> 'available' OR NOT public.is_showroom_location(replacement_piece.current_location_id) THEN
    RAISE EXCEPTION 'Replacement must be an available shop-finished piece on an active Showroom floor';
  END IF;
  SELECT * INTO replacement_price FROM public.finished_product_prices
  WHERE finished_product_id=replacement_piece.id ORDER BY revision DESC LIMIT 1;
  IF replacement_price.id IS NULL OR replacement_price.sp_paise <> returned_item.final_customer_price_paise THEN
    RAISE EXCEPTION 'Direct exchange requires a replacement with the same selling price as the returned piece';
  END IF;

  SELECT id INTO return_inventory FROM public.inventory_items WHERE finished_product_id=returned_piece.id AND unit='pc' FOR UPDATE;
  SELECT id INTO replacement_inventory FROM public.inventory_items WHERE finished_product_id=replacement_piece.id AND unit='pc' FOR UPDATE;
  IF return_inventory IS NULL OR replacement_inventory IS NULL OR public.inventory_balance(replacement_inventory,replacement_piece.current_location_id)<>1 THEN
    RAISE EXCEPTION 'The replacement piece is no longer available; scan it again';
  END IF;
  PERFORM 1 FROM public.locations WHERE id IN(return_location,replacement_piece.current_location_id) AND active FOR UPDATE;
  IF (SELECT count(*) FROM public.locations WHERE id IN(return_location,replacement_piece.current_location_id) AND active)<>2 THEN
    RAISE EXCEPTION 'Both Showroom floors must be active';
  END IF;
  SELECT full_name INTO salesperson_name FROM public.profiles WHERE id=p_salesperson;
  IF salesperson_name IS NULL THEN RAISE EXCEPTION 'Valid Salesperson required'; END IF;

  INSERT INTO public.orders(id,code,kind,customer_id,source_location_id,status,final_customer_price_paise,reference,created_by,salesperson_user_id,sale_request_id,sale_request_payload,customer_snapshot,completed_at,payment_confirmed_at)
  VALUES(exchange_id,'EXCHANGE-'||replace(exchange_id::text,'-',''),'counter_exchange',original.customer_id,replacement_piece.current_location_id,'completed',0,'Exchange for '||coalesce(original.scan_code,original.code),auth.uid(),p_salesperson,p_request,request_payload,original.customer_snapshot,clock_timestamp(),clock_timestamp());
  SELECT scan_code INTO exchange_code FROM public.orders WHERE id=exchange_id;

  INSERT INTO public.order_items(order_id,finished_product_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise)
  VALUES(exchange_id,replacement_piece.id,1,'pc',replacement_price.sp_paise,0) RETURNING id INTO replacement_item_id;
  INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,destination_location_id,actor_id,reason,reference)
  VALUES(return_inventory,'RETURN',returned_piece.id,1,'pc',return_location,auth.uid(),'Counter finished-product exchange return','BILL:'||exchange_id::text);
  INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference)
  VALUES(replacement_inventory,'SALE',replacement_piece.id,1,'pc',replacement_piece.current_location_id,replacement_item_id,auth.uid(),'Counter finished-product exchange replacement','BILL:'||exchange_id::text);
  UPDATE public.finished_products SET status='available',current_location_id=return_location WHERE id=returned_piece.id;
  UPDATE public.finished_products SET status='sold' WHERE id=replacement_piece.id;
  INSERT INTO public.finished_product_exchanges(exchange_bill_id,original_bill_id,returned_finished_product_id,replacement_finished_product_id,returned_order_item_id,replacement_order_item_id,created_by)
  VALUES(exchange_id,original.id,returned_piece.id,replacement_piece.id,returned_item.id,replacement_item_id,auth.uid());
  INSERT INTO public.counter_bills(order_id,request_id,actor_id,payload) VALUES(exchange_id,p_request,auth.uid(),request_payload);
  INSERT INTO public.counter_bill_payments(bill_id,request_id,amount_paise,actor_id) VALUES(exchange_id,p_request,0,auth.uid());
  SELECT b.code, product.name INTO returned_code, replacement_name FROM public.barcodes b JOIN public.finished_products p ON p.barcode_id=b.id JOIN public.products product ON product.id=p.product_id WHERE p.id=replacement_piece.id;
  INSERT INTO public.counter_bill_print_records(bill_id,document) VALUES(exchange_id,jsonb_build_object(
    'id',exchange_id,'code',exchange_code,'scan_code',exchange_code,'created_at',clock_timestamp(),'total_paise','0','source',(SELECT name FROM public.locations WHERE id=replacement_piece.current_location_id),'salesperson',salesperson_name,'customer',original.customer_snapshot,
    'lines',jsonb_build_array(jsonb_build_object('id',replacement_item_id,'kind','product','barcode',returned_code,'name',replacement_name,'size',public.production_piece_context(replacement_piece.id)->>'size','design',public.production_piece_context(replacement_piece.id)->>'design','quantity','1','unit','pc','price_paise',replacement_price.sp_paise::text,'amount_paise','0','job_id',null,'job_code',null,'delivery_date',null,'fabrics',null)),
    'exchange',jsonb_build_object('original_bill_code',coalesce(original.scan_code,original.code),'returned_barcode',btrim(p_return_barcode),'replacement_barcode',btrim(p_replacement_barcode),'selling_price_paise',replacement_price.sp_paise::text)
  ));
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
  VALUES(auth.uid(),'complete_finished_product_exchange','orders',exchange_id,request_payload,'EXCHANGE:'||coalesce(exchange_code,exchange_id::text));
  RETURN coalesce(exchange_code,exchange_id::text);
END; $$;

REVOKE ALL ON FUNCTION public.complete_finished_product_exchange(uuid,uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_finished_product_exchange(uuid,uuid,text,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
