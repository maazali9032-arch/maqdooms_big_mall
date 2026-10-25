BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS birth_date date
  CHECK (birth_date IS NULL OR (birth_date >= DATE '1900-01-01' AND birth_date <= CURRENT_DATE));

ALTER TABLE public.customer_tailoring_jobs
  ADD COLUMN IF NOT EXISTS size text
  CHECK (size IS NULL OR (btrim(size) <> '' AND length(btrim(size)) <= 60));

-- The physical cuts continue to drive inventory and CP. Customer pricing for a
-- stitched garment is now one direct inclusive SP, independent of fabric sale
-- rate and a separate stitching charge.
DO $$
DECLARE procedure_name regprocedure; original text; updated text;
BEGIN
  FOREACH procedure_name IN ARRAY ARRAY[
    'public.complete_counter_bill_multi(uuid,jsonb,jsonb,boolean,uuid,uuid,text,text)'::regprocedure,
    'public.gst_stage_counter_bill_multi(uuid,jsonb,jsonb,boolean,uuid,uuid,text,text)'::regprocedure
  ] LOOP
    original:=pg_get_functiondef(procedure_name);
    updated:=replace(
      original,
      $old$(row_value-ARRAY['items','garment','delivery_date','assignment_id','stitching_paise','notes','design_id','custom_design'])<>'{}'$old$,
      $new$(row_value-ARRAY['items','garment','size','delivery_date','assignment_id','sp_paise','notes','design_id','custom_design'])<>'{}'$new$
    );
    updated:=replace(
      updated,
      $old$fabric_amount:=0; priced_cuts:='[]'; plain_cuts:='[]'; stitching:=(row_value->>'stitching_paise')::bigint;$old$,
      $new$fabric_amount:=0; priced_cuts:='[]'; plain_cuts:='[]'; stitching:=(row_value->>'sp_paise')::bigint;
  IF nullif(btrim(row_value->>'size'),'') IS NULL OR stitching IS NULL OR stitching NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Tailored garment size and valid direct SP required'; END IF;$new$
    );
    updated:=replace(
      updated,
      $old$IF (priced_cut-ARRAY['inventory_item_id','quantity','sp_paise_per_m','source_location_id'])<>'{}' OR (priced_cut->>'quantity')::numeric NOT BETWEEN 1 AND 2147483647 OR (priced_cut->>'sp_paise_per_m')::numeric NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Explicit located fabric, exact millimetres and per-metre price required'; END IF;
   amount:=round((priced_cut->>'quantity')::numeric*(priced_cut->>'sp_paise_per_m')::numeric/1000); fabric_amount:=fabric_amount+amount; priced_cuts:=priced_cuts||jsonb_build_array(priced_cut||jsonb_build_object('amount_paise',amount)); plain_cuts:=plain_cuts||jsonb_build_array(priced_cut-'sp_paise_per_m');$old$,
      $new$IF (priced_cut-ARRAY['inventory_item_id','quantity','source_location_id'])<>'{}' OR (priced_cut->>'quantity')::numeric NOT BETWEEN 1 AND 2147483647 THEN RAISE EXCEPTION 'Explicit located fabric and exact millimetres required'; END IF;
   priced_cuts:=priced_cuts||jsonb_build_array(priced_cut||jsonb_build_object('amount_paise','0')); plain_cuts:=plain_cuts||jsonb_build_array(priced_cut);$new$
    );
    updated:=replace(updated,'group_price:=(fabric_amount+stitching)::bigint;','group_price:=stitching;');
    updated:=replace(
      updated,
      $old$booked_job:=public.book_invoice_tailoring_multi(gen_random_uuid(),plain_cuts,group_price,customer_id,(row_value->>'assignment_id')::uuid,p_salesperson,row_value->>'garment',row_value->>'notes');$old$,
      $new$booked_job:=public.book_invoice_tailoring_multi(gen_random_uuid(),plain_cuts,group_price,customer_id,(row_value->>'assignment_id')::uuid,p_salesperson,row_value->>'garment',row_value->>'notes');
  UPDATE public.customer_tailoring_jobs SET size=nullif(btrim(row_value->>'size'),'') WHERE id=booked_job;$new$
    );
    IF updated=original
      OR updated NOT LIKE '%row_value->>''sp_paise''%'
      OR updated NOT LIKE '%SET size=nullif(btrim(row_value->>''size''),'''')%'
    THEN RAISE EXCEPTION 'Direct tailoring SP integration failed for %',procedure_name; END IF;
    EXECUTE updated;
  END LOOP;
END $$;

DO $$
DECLARE original text; updated text;
BEGIN
  original:=pg_get_functiondef('public.capture_counter_print_record(uuid)'::regprocedure);
  updated:=replace(original,'''size'', context ->> ''size''','''size'', COALESCE(context ->> ''size'', job.size)');
  IF updated=original THEN
    updated:=replace(original,'''size'',context->>''size''','''size'',coalesce(context->>''size'',job.size)');
  END IF;
  IF updated=original THEN RAISE EXCEPTION 'Counter receipt tailoring-size integration point missing'; END IF;
  EXECUTE updated;

  original:=pg_get_functiondef('public.tailor_work_order(text)'::regprocedure);
  updated:=replace(original,'''garment'', job.garment','''garment'', job.garment, ''size'', job.size');
  IF updated=original THEN updated:=replace(original,'''garment'',job.garment','''garment'',job.garment,''size'',job.size'); END IF;
  IF updated=original THEN RAISE EXCEPTION 'Tailor work-order size integration point missing'; END IF;
  EXECUTE updated;
END $$;

CREATE OR REPLACE FUNCTION public.record_counter_bill_fixed_discount_revision(p_bill uuid,p_discount_paise bigint)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  order_row public.orders%rowtype; invoice jsonb; tax jsonb; gross bigint; final_amount bigint;
  revision integer; document_value jsonb; tax_lines jsonb:='[]'::jsonb; adjusted_lines jsonb:='[]'::jsonb;
  tax_taxable bigint:=0; tax_cgst bigint:=0; tax_sgst bigint:=0; tax_igst bigint:=0; tax_gst bigint:=0;
  line jsonb; calc jsonb; entered bigint; allocated bigint:=0; line_count integer; line_index integer;
  rate integer; computed_bps integer;
BEGIN
  SELECT * INTO order_row FROM public.orders WHERE id=p_bill AND kind='counter_bill' FOR UPDATE;
  IF order_row.id IS NULL THEN RAISE EXCEPTION 'Counter bill not found'; END IF;
  invoice:=public.gst_invoice_document(p_bill);
  IF invoice IS NULL THEN
    SELECT receipt.document->'lines',(receipt.document->>'total_paise')::bigint
      INTO adjusted_lines,gross FROM public.counter_bill_print_records receipt WHERE receipt.bill_id=p_bill;
  ELSE gross:=(invoice->>'final_paise')::bigint;
  END IF;
  gross:=coalesce(gross,order_row.final_customer_price_paise);
  IF p_discount_paise IS NULL OR p_discount_paise<0 OR p_discount_paise>gross THEN
    RAISE EXCEPTION 'Discount amount cannot exceed the bill total';
  END IF;
  final_amount:=gross-p_discount_paise;
  computed_bps:=CASE WHEN gross=0 THEN 0 ELSE round(p_discount_paise::numeric*10000/gross)::integer END;

  IF invoice IS NULL THEN
    line_count:=jsonb_array_length(coalesce(adjusted_lines,'[]'::jsonb));
    tax_lines:='[]'::jsonb; allocated:=0; line_index:=0;
    FOR line IN SELECT value FROM jsonb_array_elements(coalesce(adjusted_lines,'[]'::jsonb)) LOOP
      line_index:=line_index+1;
      entered:=CASE WHEN line_index=line_count THEN final_amount-allocated WHEN gross=0 THEN 0
        ELSE round(coalesce((line->>'amount_paise')::numeric,0)*final_amount/gross)::bigint END;
      entered:=least(entered,final_amount-allocated); allocated:=allocated+entered;
      tax_lines:=tax_lines||jsonb_build_array(line||jsonb_build_object('amount_paise',entered::text));
    END LOOP;
    adjusted_lines:=tax_lines; tax:=NULL;
  ELSE
    line_count:=jsonb_array_length(invoice->'lines'); allocated:=0; line_index:=0;
    FOR line IN SELECT value FROM jsonb_array_elements(invoice->'lines') LOOP
      line_index:=line_index+1;
      entered:=CASE WHEN line_index=line_count THEN final_amount-allocated WHEN gross=0 THEN 0
        ELSE round((line->>'entered_amount_paise')::numeric*final_amount/gross)::bigint END;
      entered:=least(entered,final_amount-allocated); allocated:=allocated+entered;
      rate:=CASE WHEN line->>'component'='finished_sale'
        THEN public.gst_discounted_garment_rate(round(entered/greatest((line->>'quantity')::numeric,1))::bigint)
        ELSE (line->>'rate_bps')::integer END;
      calc:=public.gst_calculate_amount(entered,rate,'inclusive',(invoice->>'supply_type')::text);
      tax_lines:=tax_lines||jsonb_build_array(line||jsonb_build_object(
        'entered_amount_paise',entered::text,'rate_bps',rate,
        'taxable_paise',calc->>'taxable_paise','cgst_paise',calc->>'cgst_paise',
        'sgst_paise',calc->>'sgst_paise','igst_paise',calc->>'igst_paise',
        'gst_paise',calc->>'gst_paise','final_paise',calc->>'final_paise'));
      tax_taxable:=tax_taxable+(calc->>'taxable_paise')::bigint;
      tax_cgst:=tax_cgst+(calc->>'cgst_paise')::bigint; tax_sgst:=tax_sgst+(calc->>'sgst_paise')::bigint;
      tax_igst:=tax_igst+(calc->>'igst_paise')::bigint; tax_gst:=tax_gst+(calc->>'gst_paise')::bigint;
    END LOOP;
    tax:=invoice||jsonb_build_object(
      'price_mode','inclusive','taxable_paise',tax_taxable::text,'cgst_paise',tax_cgst::text,
      'sgst_paise',tax_sgst::text,'igst_paise',tax_igst::text,'gst_paise',tax_gst::text,
      'final_paise',final_amount::text,'gross_paise',gross::text,'discount_paise',p_discount_paise::text,
      'discount_bps',computed_bps,'discount_mode','amount','lines',tax_lines);
    SELECT coalesce(jsonb_agg(print_line||jsonb_build_object('amount_paise',coalesce(totals.amount,0)::text)),'[]'::jsonb)
      INTO adjusted_lines
    FROM jsonb_array_elements((SELECT receipt.document->'lines' FROM public.counter_bill_print_records receipt WHERE receipt.bill_id=p_bill)) print_line
    LEFT JOIN LATERAL (
      SELECT sum((item->>'final_paise')::bigint) amount FROM jsonb_array_elements(tax_lines) item
      WHERE item->>'source_item_id'=print_line->>'id'
    ) totals ON true;
  END IF;

  SELECT coalesce(max(revision_no),0)+1 INTO revision FROM public.counter_bill_discount_revisions WHERE bill_id=p_bill;
  document_value:=jsonb_build_object(
    'total_paise',final_amount::text,'gross_paise',gross::text,'discount_paise',p_discount_paise::text,
    'discount_bps',computed_bps,'discount_mode','amount','lines',adjusted_lines,'tax',tax);
  INSERT INTO public.counter_bill_discount_revisions(
    bill_id,revision_no,discount_bps,gross_paise,discount_paise,final_paise,document,revised_by)
  VALUES(p_bill,revision,computed_bps,gross,p_discount_paise,final_amount,document_value,auth.uid());
  UPDATE public.orders SET final_customer_price_paise=final_amount WHERE id=p_bill;
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
  VALUES(auth.uid(),'counter_bill_fixed_discount_revision','counter_bills',p_bill,
    jsonb_build_object('revision_no',revision,'discount_mode','amount','discount_paise',p_discount_paise,'final_paise',final_amount),
    'COUNTER-BILL:'||order_row.code);
  RETURN final_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_counter_bill_gst_discount_value(
  p_request uuid,p_items jsonb,p_tailoring jsonb,p_paid boolean,p_advance_paise bigint,
  p_salesperson uuid,p_name text,p_contact text,p_birth_date date,p_tax_context jsonb,
  p_discount_mode text,p_discount_value bigint)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE bill uuid; total bigint; config public.gst_configuration_versions; customer_key uuid;
BEGIN
  IF p_discount_mode NOT IN('percent','amount') OR p_discount_value IS NULL OR p_discount_value<0
    OR (p_discount_mode='percent' AND p_discount_value>10000)
  THEN RAISE EXCEPTION 'Choose a valid percentage or rupee discount'; END IF;
  config:=public.gst_active_configuration();
  bill:=public.gst_stage_counter_bill_multi(p_request,p_items,p_tailoring,false,p_salesperson,NULL,p_name,p_contact);
  SELECT orders.customer_id INTO customer_key FROM public.orders orders WHERE orders.id=bill;
  IF p_birth_date IS NOT NULL AND customer_key IS NOT NULL THEN
    UPDATE public.customers SET birth_date=p_birth_date WHERE id=customer_key;
    UPDATE public.orders SET customer_snapshot=coalesce(customer_snapshot,'{}'::jsonb)||jsonb_build_object('birth_date',p_birth_date::text) WHERE id=bill;
  END IF;
  IF config.id IS NOT NULL THEN PERFORM public.gst_snapshot_counter_bill(bill,p_tax_context); END IF;
  IF EXISTS(SELECT 1 FROM public.orders WHERE id=bill AND status='draft') THEN
    UPDATE public.orders SET status='completed',completed_at=clock_timestamp() WHERE id=bill;
    PERFORM public.capture_counter_print_record(bill);
  END IF;
  IF p_discount_mode='amount' THEN
    total:=public.record_counter_bill_fixed_discount_revision(bill,p_discount_value);
  ELSE total:=public.record_counter_bill_discount_revision(bill,p_discount_value::integer);
  END IF;
  IF p_advance_paise IS NOT NULL THEN
    IF p_advance_paise<0 OR p_advance_paise>total THEN RAISE EXCEPTION 'Advance cannot exceed discounted GST-inclusive bill total'; END IF;
    IF p_advance_paise>0 THEN PERFORM public.record_counter_bill_payment(p_request,bill,p_advance_paise); END IF;
  ELSIF p_paid THEN PERFORM public.record_counter_bill_payment(p_request,bill,total); END IF;
  RETURN bill;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_revise_counter_bill_discount_value(
  p_bill uuid,p_discount_mode text,p_discount_value bigint)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE completed timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Only the Owner can revise a completed bill discount'; END IF;
  IF p_discount_mode NOT IN('percent','amount') OR p_discount_value IS NULL OR p_discount_value<0
    OR (p_discount_mode='percent' AND p_discount_value>10000)
  THEN RAISE EXCEPTION 'Choose a valid percentage or rupee discount'; END IF;
  SELECT completed_at INTO completed FROM public.orders WHERE id=p_bill AND kind='counter_bill' FOR UPDATE;
  IF completed IS NULL THEN RAISE EXCEPTION 'Counter bill not found'; END IF;
  IF clock_timestamp()>completed+interval '1 hour' THEN RAISE EXCEPTION 'The one-hour bill discount correction window has closed'; END IF;
  IF p_discount_mode='amount' THEN PERFORM public.record_counter_bill_fixed_discount_revision(p_bill,p_discount_value);
  ELSE PERFORM public.record_counter_bill_discount_revision(p_bill,p_discount_value::integer); END IF;
  RETURN p_bill;
END;
$$;

REVOKE ALL ON FUNCTION public.record_counter_bill_fixed_discount_revision(uuid,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_counter_bill_gst_discount_value(uuid,jsonb,jsonb,boolean,bigint,uuid,text,text,date,jsonb,text,bigint) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.owner_revise_counter_bill_discount_value(uuid,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_counter_bill_gst_discount_value(uuid,jsonb,jsonb,boolean,bigint,uuid,text,text,date,jsonb,text,bigint),public.owner_revise_counter_bill_discount_value(uuid,text,bigint) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
