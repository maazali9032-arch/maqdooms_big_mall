BEGIN;

CREATE TABLE public.counter_bill_discount_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.counter_bills(order_id),
  revision_no integer NOT NULL CHECK (revision_no > 0),
  discount_bps integer NOT NULL CHECK (discount_bps BETWEEN 0 AND 10000),
  gross_paise bigint NOT NULL CHECK (gross_paise >= 0),
  discount_paise bigint NOT NULL CHECK (discount_paise >= 0),
  final_paise bigint NOT NULL CHECK (final_paise >= 0),
  document jsonb NOT NULL,
  revised_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (bill_id, revision_no)
);
ALTER TABLE public.counter_bill_discount_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.counter_bill_discount_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.counter_bill_discount_revisions TO authenticated;
CREATE POLICY counter_bill_discount_revision_read ON public.counter_bill_discount_revisions FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['owner','counter']));
CREATE TRIGGER counter_bill_discount_revision_immutable BEFORE UPDATE OR DELETE ON public.counter_bill_discount_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE OR REPLACE FUNCTION public.record_counter_bill_discount_revision(p_bill uuid, p_discount_bps integer)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE order_row public.orders%rowtype; invoice jsonb; tax jsonb; gross bigint; final_amount bigint; discount_amount bigint; revision integer; document jsonb; tax_lines jsonb; adjusted_lines jsonb; tax_taxable bigint; tax_cgst bigint; tax_sgst bigint; tax_igst bigint; tax_gst bigint;
BEGIN
  IF p_discount_bps NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Discount must be from 0 to 100 percent'; END IF;
  SELECT * INTO order_row FROM public.orders WHERE id=p_bill AND kind='counter_bill' FOR UPDATE;
  IF order_row.id IS NULL THEN RAISE EXCEPTION 'Counter bill not found'; END IF;
  invoice:=public.gst_invoice_document(p_bill);
  IF invoice IS NULL THEN
    SELECT document->'lines', (document->>'total_paise')::bigint INTO adjusted_lines,gross FROM public.counter_bill_print_records WHERE bill_id=p_bill;
    gross:=coalesce(gross, order_row.final_customer_price_paise);
    final_amount:=round(gross::numeric*(10000-p_discount_bps)/10000)::bigint;
    adjusted_lines:=coalesce((SELECT jsonb_agg(line || jsonb_build_object('amount_paise',round(coalesce((line->>'amount_paise')::numeric,0)*(10000-p_discount_bps)/10000)::bigint::text)) FROM jsonb_array_elements(coalesce(adjusted_lines,'[]'::jsonb)) line),'[]'::jsonb);
    tax:=NULL;
  ELSE
    gross:=(invoice->>'final_paise')::bigint;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',line->>'id','source_item_id',line->>'source_item_id','component',line->>'component','display_group',line->>'display_group','description',line->>'description','classification_code',line->>'classification_code','quantity',line->>'quantity','unit',line->>'unit','entered_rate_paise',line->>'entered_rate_paise',
      'entered_amount_paise',entered::text,'taxable_paise',(calc->>'taxable_paise'),'rate_bps',(line->>'rate_bps')::integer,'cgst_paise',(calc->>'cgst_paise'),'sgst_paise',(calc->>'sgst_paise'),'igst_paise',(calc->>'igst_paise'),'gst_paise',(calc->>'gst_paise'),'final_paise',(calc->>'final_paise')
    )),'[]'::jsonb),
    coalesce(sum((calc->>'taxable_paise')::bigint),0),coalesce(sum((calc->>'cgst_paise')::bigint),0),coalesce(sum((calc->>'sgst_paise')::bigint),0),coalesce(sum((calc->>'igst_paise')::bigint),0),coalesce(sum((calc->>'gst_paise')::bigint),0),coalesce(sum((calc->>'final_paise')::bigint),0)
    INTO tax_lines, tax_taxable, tax_cgst, tax_sgst, tax_igst, tax_gst, final_amount
    FROM jsonb_array_elements(invoice->'lines') line
    CROSS JOIN LATERAL (SELECT round((line->>'entered_amount_paise')::numeric*(10000-p_discount_bps)/10000)::bigint entered) scaled
    CROSS JOIN LATERAL public.gst_calculate_amount(scaled.entered,(line->>'rate_bps')::integer,(invoice->>'price_mode')::text,(invoice->>'supply_type')::text) calc;
    discount_amount:=gross-final_amount;
    tax:=invoice || jsonb_build_object('taxable_paise',tax_taxable::text,'cgst_paise',tax_cgst::text,'sgst_paise',tax_sgst::text,'igst_paise',tax_igst::text,'gst_paise',tax_gst::text,'final_paise',final_amount::text,'gross_paise',gross::text,'discount_paise',discount_amount::text,'discount_bps',p_discount_bps,'lines',tax_lines);
    SELECT coalesce(jsonb_agg(print_line || jsonb_build_object('amount_paise',coalesce(totals.amount,0)::text)),'[]'::jsonb) INTO adjusted_lines
    FROM jsonb_array_elements((SELECT document->'lines' FROM public.counter_bill_print_records WHERE bill_id=p_bill)) print_line
    LEFT JOIN LATERAL (SELECT sum(CASE WHEN invoice->>'price_mode'='exclusive' THEN (item->>'taxable_paise')::bigint ELSE (item->>'final_paise')::bigint END) amount FROM jsonb_array_elements(tax_lines) item WHERE item->>'source_item_id'=print_line->>'id') totals ON true;
  END IF;
  discount_amount:=gross-final_amount;
  SELECT coalesce(max(revision_no),0)+1 INTO revision FROM public.counter_bill_discount_revisions WHERE bill_id=p_bill;
  document:=jsonb_build_object('total_paise',final_amount::text,'gross_paise',gross::text,'discount_paise',discount_amount::text,'discount_bps',p_discount_bps,'lines',adjusted_lines,'tax',tax);
  INSERT INTO public.counter_bill_discount_revisions(bill_id,revision_no,discount_bps,gross_paise,discount_paise,final_paise,document,revised_by)
  VALUES(p_bill,revision,p_discount_bps,gross,discount_amount,final_amount,document,auth.uid());
  UPDATE public.orders SET final_customer_price_paise=final_amount WHERE id=p_bill;
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
  VALUES(auth.uid(),'counter_bill_discount_revision','counter_bills',p_bill,jsonb_build_object('revision_no',revision,'discount_bps',p_discount_bps,'gross_paise',gross,'discount_paise',discount_amount,'final_paise',final_amount),'COUNTER-BILL:'||order_row.code);
  RETURN final_amount;
END; $$;

CREATE OR REPLACE FUNCTION public.complete_counter_bill_gst_discount(p_request uuid,p_items jsonb,p_tailoring jsonb,p_paid boolean,p_advance_paise bigint,p_salesperson uuid,p_name text,p_contact text,p_tax_context jsonb,p_discount_bps integer DEFAULT 0)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE bill uuid; total bigint; config public.gst_configuration_versions;
BEGIN
  IF p_discount_bps NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Discount must be from 0 to 100 percent'; END IF;
  config:=public.gst_active_configuration();
  IF config.id IS NULL THEN
    bill:=public.complete_counter_bill_gst(p_request,p_items,p_tailoring,p_paid,p_advance_paise,p_salesperson,p_name,p_contact,p_tax_context);
    PERFORM public.record_counter_bill_discount_revision(bill,p_discount_bps);
    RETURN bill;
  END IF;
  IF p_paid IS NULL OR jsonb_typeof(p_tailoring) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Valid payment state and tailoring entries required'; END IF;
  IF jsonb_array_length(p_tailoring)=0 AND (NOT p_paid OR p_advance_paise IS NOT NULL) THEN RAISE EXCEPTION 'Unpaid is available only on bills containing Customer Tailoring'; END IF;
  bill:=public.gst_stage_counter_bill_multi(p_request,p_items,p_tailoring,false,p_salesperson,NULL,p_name,p_contact);
  PERFORM public.gst_snapshot_counter_bill(bill,p_tax_context);
  UPDATE public.orders SET status='completed',completed_at=clock_timestamp() WHERE id=bill AND status='draft';
  PERFORM public.capture_counter_print_record(bill);
  total:=public.record_counter_bill_discount_revision(bill,p_discount_bps);
  IF p_advance_paise IS NOT NULL THEN
    IF p_advance_paise<0 OR p_advance_paise>total THEN RAISE EXCEPTION 'Advance cannot exceed discounted GST-inclusive bill total'; END IF;
    IF p_advance_paise>0 THEN PERFORM public.record_counter_bill_payment(p_request,bill,p_advance_paise); END IF;
  ELSIF p_paid THEN PERFORM public.record_counter_bill_payment(p_request,bill,total); END IF;
  RETURN bill;
END; $$;

CREATE OR REPLACE FUNCTION public.owner_revise_counter_bill_discount(p_bill uuid,p_discount_bps integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE created_at timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Only the Owner can revise a completed bill discount'; END IF;
  SELECT completed_at INTO created_at FROM public.orders WHERE id=p_bill AND kind='counter_bill' FOR UPDATE;
  IF created_at IS NULL THEN RAISE EXCEPTION 'Counter bill not found'; END IF;
  IF clock_timestamp()>created_at+interval '1 hour' THEN RAISE EXCEPTION 'The one-hour bill discount correction window has closed'; END IF;
  PERFORM public.record_counter_bill_discount_revision(p_bill,p_discount_bps);
  RETURN p_bill;
END; $$;

CREATE OR REPLACE FUNCTION public.counter_bill(p_code text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Counter billing access required'; END IF;
 SELECT print.document || coalesce(revision.document,'{}'::jsonb) || jsonb_build_object('total_paise',o.final_customer_price_paise::text,'paid_amount_paise',coalesce(payment.collected,0)::text,'balance_paise',(o.final_customer_price_paise-coalesce(payment.collected,0))::text,'paid',coalesce(payment.collected,0)>=o.final_customer_price_paise,'paid_at',payment.last_paid_at,'pos_code',terminal.code,'discount_edit_until',CASE WHEN o.completed_at+interval '1 hour'>clock_timestamp() THEN (o.completed_at+interval '1 hour')::text ELSE NULL END)
 INTO result
 FROM public.counter_bill_print_records print JOIN public.orders o ON o.id=print.bill_id LEFT JOIN public.counter_bill_terminal_records terminal_record ON terminal_record.bill_id=o.id LEFT JOIN public.pos_terminals terminal ON terminal.id=terminal_record.terminal_id
 LEFT JOIN LATERAL(SELECT document FROM public.counter_bill_discount_revisions d WHERE d.bill_id=o.id ORDER BY revision_no DESC LIMIT 1) revision ON true
 LEFT JOIN LATERAL(SELECT sum(amount_paise) collected,max(paid_at) last_paid_at FROM public.counter_bill_payments WHERE bill_id=o.id) payment ON true
 WHERE o.code=btrim(p_code) OR o.id::text=btrim(p_code);
 RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.record_counter_bill_discount_revision(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.owner_revise_counter_bill_discount(uuid,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.complete_counter_bill_gst_discount(uuid,jsonb,jsonb,boolean,bigint,uuid,text,text,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_revise_counter_bill_discount(uuid,integer),public.complete_counter_bill_gst_discount(uuid,jsonb,jsonb,boolean,bigint,uuid,text,text,jsonb,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
