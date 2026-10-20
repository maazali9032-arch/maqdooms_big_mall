BEGIN;
-- GST must finish pricing before payment is captured. Keep the public retail
-- unpaid prohibition; expose its staging exception only to the private GST path.
DO $$
DECLARE original text; staged text;
BEGIN
  original:=pg_get_functiondef('public.complete_counter_bill_multi(uuid,jsonb,jsonb,boolean,uuid,uuid,text,text)'::regprocedure);
  staged:=replace(original,'FUNCTION public.complete_counter_bill_multi(', 'FUNCTION public.gst_stage_counter_bill_multi(');
  staged:=replace(staged,$guard$IF NOT p_paid AND jsonb_array_length(p_tailoring)=0 THEN RAISE EXCEPTION 'Unpaid is available only on bills containing Customer Tailoring'; END IF;$guard$,'');
  staged:=replace(staged,$finalize$UPDATE public.orders SET status='completed',final_customer_price_paise=total::bigint,completed_at=clock_timestamp() WHERE id=result;$finalize$,
    'UPDATE public.orders SET final_customer_price_paise=total::bigint WHERE id=result;');
  staged:=replace(staged,'PERFORM public.capture_counter_print_record(result);','');
  IF staged=original OR staged LIKE '%Unpaid is available only on bills containing Customer Tailoring%' THEN
    RAISE EXCEPTION 'Expected Counter bill staging guard not found';
  END IF;
  IF staged LIKE '%SET status=''completed''%' OR staged LIKE '%capture_counter_print_record(result)%' THEN
    RAISE EXCEPTION 'GST staging must not finalize or print before tax is calculated';
  END IF;
  EXECUTE staged;
END; $$;
REVOKE ALL ON FUNCTION public.gst_stage_counter_bill_multi(uuid,jsonb,jsonb,boolean,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.complete_counter_bill_gst(p_request uuid,p_items jsonb,p_tailoring jsonb,p_paid boolean,p_advance_paise bigint,p_salesperson uuid,p_name text,p_contact text,p_tax_context jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE bill uuid; total bigint; config public.gst_configuration_versions;
BEGIN
  config:=public.gst_active_configuration();
  IF config.id IS NULL THEN
    IF p_advance_paise IS NULL THEN RETURN public.complete_counter_bill_multi(p_request,p_items,p_tailoring,p_paid,p_salesperson,NULL,p_name,p_contact); END IF;
    RETURN public.complete_counter_bill_multi_with_advance(p_request,p_items,p_tailoring,p_advance_paise,p_salesperson,p_name,p_contact);
  END IF;
  IF p_paid IS NULL OR jsonb_typeof(p_tailoring) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Valid payment state and tailoring entries required'; END IF;
  IF jsonb_array_length(p_tailoring)=0 AND (NOT p_paid OR p_advance_paise IS NOT NULL) THEN
    RAISE EXCEPTION 'Unpaid is available only on bills containing Customer Tailoring';
  END IF;
  bill:=public.gst_stage_counter_bill_multi(p_request,p_items,p_tailoring,false,p_salesperson,NULL,p_name,p_contact);
  total:=public.gst_snapshot_counter_bill(bill,p_tax_context);
  -- Completed-sale history remains immutable. Finalize once, after tax, and
  -- capture the receipt with its correct GST-inclusive amount and timestamp.
  IF EXISTS(SELECT 1 FROM public.orders WHERE id=bill AND status='draft') THEN
    UPDATE public.orders SET status='completed',completed_at=clock_timestamp() WHERE id=bill;
    PERFORM public.capture_counter_print_record(bill);
  END IF;
  IF p_advance_paise IS NOT NULL THEN
    IF p_advance_paise<0 OR p_advance_paise>total THEN RAISE EXCEPTION 'Advance cannot exceed GST-inclusive bill total'; END IF;
    IF p_advance_paise>0 THEN PERFORM public.record_counter_bill_payment(p_request,bill,p_advance_paise); END IF;
  ELSIF p_paid THEN PERFORM public.record_counter_bill_payment(p_request,bill,total); END IF;
  RETURN bill;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
