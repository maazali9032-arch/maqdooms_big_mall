-- Customer stitching corrections (29 Oct 2026), on top of 20261030000900.
-- 1. GST per garment: a stitching order gets one GST line per garment (order price split
--    equally; source_cut_ordinal = garment number). The garment slab (≤ ₹2,500 → 5%, above → 18%)
--    is applied to each garment, and the bill discount is applied to each garment line, so the
--    rate follows each garment's discounted price.
-- 2. C-label prices are the garments' final discounted prices; together they equal the
--    stitching order's share of the final bill. The discount cannot change after labels exist.
-- 3. A Master Tailor may submit a job with no material used (Tailor Staff still required).
-- Started is unchanged: billing creates the job as "open" in the same transaction that issues
-- the fabric and records the Factory + Master Tailor; scanning by the Master Tailor changes nothing.
BEGIN;

-- 1. GST snapshot: one line per garment for stitching orders that have garment rows.
CREATE OR REPLACE FUNCTION public.gst_snapshot_counter_bill(p_bill uuid, p_context jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE config public.gst_configuration_versions; invoice uuid; order_row public.orders%rowtype; item record; rule public.gst_tax_rules; calc jsonb; supply text; customer jsonb; taxable bigint:=0; cgst bigint:=0; sgst bigint:=0; igst bigint:=0; tax bigint:=0; final_amount bigint:=0; entered bigint; rate integer; garment record; garment_count integer; description text; customer_gstin text; customer_state text;
BEGIN
  config:=public.gst_active_configuration();
  SELECT * INTO order_row FROM public.orders WHERE id=p_bill AND kind='counter_bill' FOR UPDATE;
  IF order_row.id IS NULL THEN RAISE EXCEPTION 'Completed Counter bill required'; END IF;
  IF config.id IS NULL THEN RETURN order_row.final_customer_price_paise; END IF;
  IF jsonb_typeof(p_context) IS DISTINCT FROM 'object' OR (p_context-ARRAY['customer_gstin','payment_method','configuration_id'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Valid GST sale context required'; END IF;
  IF p_context->>'configuration_id' IS DISTINCT FROM config.id::text THEN RAISE EXCEPTION 'GST configuration changed. Refresh the bill before completing it'; END IF;
  customer_gstin:=nullif(upper(btrim(p_context->>'customer_gstin')),'');
  IF customer_gstin IS NULL THEN
    supply:='intra_state'; customer_state:=NULL;
  ELSE
    IF customer_gstin !~ '^[0-9]{2}[A-Z0-9]{13}$' THEN RAISE EXCEPTION 'A valid customer GSTIN is required for a GST business invoice'; END IF;
    customer_state:=left(customer_gstin,2);
    supply:=CASE WHEN customer_state=config.state_code THEN 'intra_state' ELSE 'inter_state' END;
  END IF;
  SELECT id INTO invoice FROM public.gst_invoice_snapshots WHERE order_id=p_bill;
  IF invoice IS NOT NULL THEN RETURN (SELECT final_paise FROM public.gst_invoice_snapshots WHERE id=invoice); END IF;
  customer:=coalesce(order_row.customer_snapshot,'{}'::jsonb)||jsonb_build_object('gstin',customer_gstin,'state_code',customer_state);
  INSERT INTO public.gst_invoice_snapshots(order_id,configuration_id,invoice_number,supply_type,price_mode,invoice_display,tailoring_display,business_snapshot,customer_snapshot,payment_method,taxable_paise,cgst_paise,sgst_paise,igst_paise,gst_paise,final_paise,recorded_by)
  VALUES(p_bill,config.id,order_row.code,supply,'inclusive',config.invoice_display,'combined',jsonb_build_object('legal_name',config.legal_name,'trading_name',config.trading_name,'address',config.address,'contact',config.contact,'gstin',config.gstin,'state_code',config.state_code),customer,nullif(btrim(p_context->>'payment_method'),''),0,0,0,0,0,0,auth.uid()) RETURNING id INTO invoice;
  FOR item IN
    SELECT it.*,coalesce(g.name,f.name,product.name,job.garment,'Item') item_name,
      CASE WHEN it.fabric_stock_id IS NOT NULL THEN 'FABRIC:'||upper(coalesce(g.name,f.name,'')) WHEN it.finished_product_id IS NOT NULL THEN 'PRODUCT:'||upper(coalesce(product.name,'')) ELSE 'PRODUCT:'||upper(coalesce(job.garment,'')) END ref,
      quote.fabric_amount_paise,quote.stitching_paise
    FROM public.order_items it
    LEFT JOIN public.thaans th ON th.id=it.thaan_id LEFT JOIN public.fabrics f ON f.id=th.fabric_id
    LEFT JOIN public.stock_registration_variants v ON v.thaan_id=th.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id
    LEFT JOIN public.finished_products piece ON piece.id=it.finished_product_id LEFT JOIN public.products product ON product.id=piece.product_id
    LEFT JOIN public.customer_tailoring_jobs job ON job.id=it.customer_tailoring_job_id
    LEFT JOIN public.counter_tailoring_sale_prices quote ON quote.job_id=it.customer_tailoring_job_id
    WHERE it.order_id=p_bill ORDER BY it.id
  LOOP
    IF item.customer_tailoring_job_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.customer_tailoring_garments WHERE job_id=item.customer_tailoring_job_id) THEN
      -- Stitching order: split the order price equally across its garments, then tax each garment on its own slab.
      rule:=public.gst_rule_for(config.id,'finished_sale',item.ref);
      IF rule.id IS NULL THEN RAISE EXCEPTION 'GST rule required for %',item.item_name; END IF;
      SELECT count(*) INTO garment_count FROM public.customer_tailoring_garments WHERE job_id=item.customer_tailoring_job_id;
      FOR garment IN SELECT line_no,size FROM public.customer_tailoring_garments WHERE job_id=item.customer_tailoring_job_id ORDER BY line_no LOOP
        entered:=public.customer_tailoring_split(coalesce(item.fabric_amount_paise,0)+coalesce(item.stitching_paise,0),garment_count,garment.line_no);
        rate:=public.gst_discounted_garment_rate(entered);
        calc:=public.gst_calculate_amount(entered,rate,'inclusive',supply);
        INSERT INTO public.gst_invoice_lines(invoice_id,source_item_id,component,display_group,description,classification_code,quantity,unit,entered_rate_paise,entered_amount_paise,taxable_paise,rate_bps,cgst_paise,sgst_paise,igst_paise,gst_paise,final_paise,source_cut_ordinal)
        VALUES(invoice,item.id,'finished_sale',item.id::text,left(item.item_name||' · garment '||garment.line_no||' · size '||garment.size,200),rule.classification_code,1,'pc',NULL,entered,(calc->>'taxable_paise')::bigint,rate,(calc->>'cgst_paise')::bigint,(calc->>'sgst_paise')::bigint,(calc->>'igst_paise')::bigint,(calc->>'gst_paise')::bigint,(calc->>'final_paise')::bigint,garment.line_no);
        taxable:=taxable+(calc->>'taxable_paise')::bigint; cgst:=cgst+(calc->>'cgst_paise')::bigint; sgst:=sgst+(calc->>'sgst_paise')::bigint; igst:=igst+(calc->>'igst_paise')::bigint; tax:=tax+(calc->>'gst_paise')::bigint; final_amount:=final_amount+(calc->>'final_paise')::bigint;
      END LOOP;
      CONTINUE;
    ELSIF item.customer_tailoring_job_id IS NOT NULL THEN
      entered:=coalesce(item.fabric_amount_paise,0)+coalesce(item.stitching_paise,0);
      rule:=public.gst_rule_for(config.id,'finished_sale',item.ref);
      description:=item.item_name;
      rate:=public.gst_discounted_garment_rate(entered);
    ELSIF item.fabric_stock_id IS NOT NULL THEN
      entered:=item.final_customer_price_paise; rule:=public.gst_rule_for(config.id,'fabric_sale',item.ref); description:=item.item_name; rate:=rule.rate_bps;
    ELSE
      entered:=item.final_customer_price_paise; rule:=public.gst_rule_for(config.id,'finished_sale',item.ref); description:=item.item_name; rate:=public.gst_discounted_garment_rate(round(entered/greatest(item.quantity,1))::bigint);
    END IF;
    IF rule.id IS NULL THEN RAISE EXCEPTION 'GST rule required for %',description; END IF;
    calc:=public.gst_calculate_amount(entered,rate,'inclusive',supply);
    INSERT INTO public.gst_invoice_lines(invoice_id,source_item_id,component,display_group,description,classification_code,quantity,unit,entered_rate_paise,entered_amount_paise,taxable_paise,rate_bps,cgst_paise,sgst_paise,igst_paise,gst_paise,final_paise)
    VALUES(invoice,item.id,CASE WHEN item.fabric_stock_id IS NOT NULL AND item.customer_tailoring_job_id IS NULL THEN 'fabric_sale' ELSE 'finished_sale' END,CASE WHEN item.customer_tailoring_job_id IS NOT NULL THEN item.id::text ELSE NULL END,description,rule.classification_code,CASE WHEN item.customer_tailoring_job_id IS NOT NULL THEN 1 ELSE item.quantity END,CASE WHEN item.customer_tailoring_job_id IS NOT NULL THEN 'job' ELSE item.unit END,item.sp_snapshot_paise,entered,(calc->>'taxable_paise')::bigint,rate,(calc->>'cgst_paise')::bigint,(calc->>'sgst_paise')::bigint,(calc->>'igst_paise')::bigint,(calc->>'gst_paise')::bigint,(calc->>'final_paise')::bigint);
    taxable:=taxable+(calc->>'taxable_paise')::bigint; cgst:=cgst+(calc->>'cgst_paise')::bigint; sgst:=sgst+(calc->>'sgst_paise')::bigint; igst:=igst+(calc->>'igst_paise')::bigint; tax:=tax+(calc->>'gst_paise')::bigint; final_amount:=final_amount+(calc->>'final_paise')::bigint;
  END LOOP;
  UPDATE public.gst_invoice_snapshots SET taxable_paise=taxable,cgst_paise=cgst,sgst_paise=sgst,igst_paise=igst,gst_paise=tax,final_paise=final_amount,finalized=true WHERE id=invoice;
  UPDATE public.orders SET final_customer_price_paise=final_amount WHERE id=p_bill;
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'capture_gst_invoice','gst_invoice_snapshots',invoice,jsonb_build_object('order_id',p_bill,'taxable_paise',taxable,'gst_paise',tax,'final_paise',final_amount),'GST-INVOICE:'||order_row.code);
  RETURN final_amount;
END; $function$;

-- 2. Discount revisions are refused once garment labels exist for the bill.
CREATE OR REPLACE FUNCTION public.record_counter_bill_discount_revision(p_bill uuid, p_discount_bps integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE order_row public.orders%rowtype; invoice jsonb; tax jsonb; gross bigint; final_amount bigint; discount_amount bigint; revision integer; document jsonb; tax_lines jsonb; adjusted_lines jsonb; tax_taxable bigint; tax_cgst bigint; tax_sgst bigint; tax_igst bigint; tax_gst bigint;
BEGIN
  IF p_discount_bps NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Discount must be from 0 to 100 percent'; END IF;
  SELECT * INTO order_row FROM public.orders WHERE id=p_bill AND kind='counter_bill' FOR UPDATE;
  IF order_row.id IS NULL THEN RAISE EXCEPTION 'Counter bill not found'; END IF;
  IF EXISTS(SELECT 1 FROM public.order_items it JOIN public.customer_tailoring_finished_items fi ON fi.job_id=it.customer_tailoring_job_id WHERE it.order_id=p_bill) THEN
    RAISE EXCEPTION 'Garment labels are already printed for this bill, so its discount can no longer change';
  END IF;
  invoice:=public.gst_invoice_document(p_bill);
  IF invoice IS NULL THEN
    SELECT receipt.document->'lines',(receipt.document->>'total_paise')::bigint INTO adjusted_lines,gross FROM public.counter_bill_print_records receipt WHERE receipt.bill_id=p_bill;
    gross:=coalesce(gross,order_row.final_customer_price_paise);
    final_amount:=round(gross::numeric*(10000-p_discount_bps)/10000)::bigint;
    adjusted_lines:=coalesce((SELECT jsonb_agg(line||jsonb_build_object('amount_paise',round(coalesce((line->>'amount_paise')::numeric,0)*(10000-p_discount_bps)/10000)::bigint::text)) FROM jsonb_array_elements(coalesce(adjusted_lines,'[]'::jsonb)) line),'[]'::jsonb);
    tax:=NULL;
  ELSE
    gross:=(invoice->>'final_paise')::bigint;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',line->>'id','source_item_id',line->>'source_item_id','component',line->>'component','display_group',line->>'display_group','description',line->>'description','classification_code',line->>'classification_code','quantity',line->>'quantity','unit',line->>'unit','entered_rate_paise',line->>'entered_rate_paise',
      'entered_amount_paise',entered::text,'taxable_paise',(calc->>'taxable_paise'),'rate_bps',rate,'cgst_paise',(calc->>'cgst_paise'),'sgst_paise',(calc->>'sgst_paise'),'igst_paise',(calc->>'igst_paise'),'gst_paise',(calc->>'gst_paise'),'final_paise',(calc->>'final_paise')
    )),'[]'::jsonb),coalesce(sum((calc->>'taxable_paise')::bigint),0),coalesce(sum((calc->>'cgst_paise')::bigint),0),coalesce(sum((calc->>'sgst_paise')::bigint),0),coalesce(sum((calc->>'igst_paise')::bigint),0),coalesce(sum((calc->>'gst_paise')::bigint),0),coalesce(sum((calc->>'final_paise')::bigint),0)
    INTO tax_lines,tax_taxable,tax_cgst,tax_sgst,tax_igst,tax_gst,final_amount
    FROM jsonb_array_elements(invoice->'lines') line
    CROSS JOIN LATERAL (SELECT round((line->>'entered_amount_paise')::numeric*(10000-p_discount_bps)/10000)::bigint entered) scaled
    CROSS JOIN LATERAL (SELECT CASE WHEN line->>'component'='finished_sale' THEN public.gst_discounted_garment_rate(round(scaled.entered/greatest((line->>'quantity')::numeric,1))::bigint) ELSE (line->>'rate_bps')::integer END rate) selected
    CROSS JOIN LATERAL public.gst_calculate_amount(scaled.entered,selected.rate,'inclusive',(invoice->>'supply_type')::text) calc;
    discount_amount:=gross-final_amount;
    tax:=invoice||jsonb_build_object('price_mode','inclusive','taxable_paise',tax_taxable::text,'cgst_paise',tax_cgst::text,'sgst_paise',tax_sgst::text,'igst_paise',tax_igst::text,'gst_paise',tax_gst::text,'final_paise',final_amount::text,'gross_paise',gross::text,'discount_paise',discount_amount::text,'discount_bps',p_discount_bps,'lines',tax_lines);
    SELECT coalesce(jsonb_agg(print_line||jsonb_build_object('amount_paise',coalesce(totals.amount,0)::text)),'[]'::jsonb) INTO adjusted_lines
    FROM jsonb_array_elements((SELECT receipt.document->'lines' FROM public.counter_bill_print_records receipt WHERE receipt.bill_id=p_bill)) print_line
    LEFT JOIN LATERAL (SELECT sum((item->>'final_paise')::bigint) amount FROM jsonb_array_elements(tax_lines) item WHERE item->>'source_item_id'=print_line->>'id') totals ON true;
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
END; $function$;

CREATE OR REPLACE FUNCTION public.record_counter_bill_fixed_discount_revision(p_bill uuid, p_discount_paise bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  order_row public.orders%rowtype; invoice jsonb; tax jsonb; gross bigint; final_amount bigint;
  revision integer; document_value jsonb; tax_lines jsonb:='[]'::jsonb; adjusted_lines jsonb:='[]'::jsonb;
  tax_taxable bigint:=0; tax_cgst bigint:=0; tax_sgst bigint:=0; tax_igst bigint:=0; tax_gst bigint:=0;
  line jsonb; calc jsonb; entered bigint; allocated bigint:=0; line_count integer; line_index integer;
  rate integer; computed_bps integer;
BEGIN
  SELECT * INTO order_row FROM public.orders WHERE id=p_bill AND kind='counter_bill' FOR UPDATE;
  IF order_row.id IS NULL THEN RAISE EXCEPTION 'Counter bill not found'; END IF;
  IF EXISTS(SELECT 1 FROM public.order_items it JOIN public.customer_tailoring_finished_items fi ON fi.job_id=it.customer_tailoring_job_id WHERE it.order_id=p_bill) THEN
    RAISE EXCEPTION 'Garment labels are already printed for this bill, so its discount can no longer change';
  END IF;
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
$function$;

-- Final price of each garment: its own discounted GST line, or (without GST lines per garment)
-- the order's share of the discounted bill split equally (leftover paise on the last garment).
CREATE FUNCTION public.customer_tailoring_garment_prices(p_job uuid)
RETURNS TABLE(line_no integer, sp_paise bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE bill uuid; item uuid; doc jsonb; share bigint; n integer;
BEGIN
  SELECT d.bill_id INTO bill FROM public.counter_tailoring_details d WHERE d.job_id = p_job;
  SELECT greatest(count(*), 1) INTO n FROM public.customer_tailoring_garments g WHERE g.job_id = p_job;
  IF bill IS NOT NULL THEN
    SELECT it.id INTO item FROM public.order_items it WHERE it.order_id = bill AND it.customer_tailoring_job_id = p_job;
    SELECT r.document INTO doc FROM public.counter_bill_discount_revisions r WHERE r.bill_id = bill ORDER BY r.revision_no DESC LIMIT 1;
    IF EXISTS(SELECT 1 FROM public.gst_invoice_lines l JOIN public.gst_invoice_snapshots s ON s.id = l.invoice_id
              WHERE s.order_id = bill AND l.source_item_id = item AND l.source_cut_ordinal > 0) THEN
      RETURN QUERY
        SELECT l.source_cut_ordinal,
          coalesce((SELECT (x->>'final_paise')::bigint FROM jsonb_array_elements(coalesce(doc->'tax'->'lines', '[]'::jsonb)) x WHERE x->>'id' = l.id::text), l.final_paise)
        FROM public.gst_invoice_lines l JOIN public.gst_invoice_snapshots s ON s.id = l.invoice_id
        WHERE s.order_id = bill AND l.source_item_id = item AND l.source_cut_ordinal > 0
        ORDER BY l.source_cut_ordinal;
      RETURN;
    END IF;
    share := coalesce(
      (SELECT (x->>'amount_paise')::bigint FROM jsonb_array_elements(coalesce(doc->'lines', '[]'::jsonb)) x WHERE x->>'id' = item::text),
      (SELECT it.final_customer_price_paise FROM public.order_items it WHERE it.id = item));
  ELSE
    share := public.customer_tailoring_order_sp(p_job);
  END IF;
  IF share IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT g.line_no, public.customer_tailoring_split(share, n, g.line_no)
    FROM public.customer_tailoring_garments g WHERE g.job_id = p_job ORDER BY g.line_no;
END $$;
REVOKE ALL ON FUNCTION public.customer_tailoring_garment_prices(uuid) FROM PUBLIC, anon, authenticated;

-- 3. Godown view: label prices are the final discounted garment prices.
CREATE OR REPLACE FUNCTION public.customer_tailoring_labels(p_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.customer_tailoring_jobs%rowtype; saved public.customer_tailoring_completion_costs%rowtype; garments jsonb; total bigint;
BEGIN
  IF NOT public.customer_tailoring_receipt_allowed() THEN RAISE EXCEPTION 'Customer stitching receipt permission required'; END IF;
  SELECT * INTO j FROM public.customer_tailoring_jobs WHERE id = p_job;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Customer stitching order not found'; END IF;
  SELECT * INTO saved FROM public.customer_tailoring_completion_costs WHERE job_id = j.id;
  SELECT jsonb_agg(jsonb_build_object(
      'line_no', g.line_no, 'size', g.size, 'notes', g.notes, 'barcode', b.code,
      'sp_paise', coalesce(fi.sp_paise, price.sp_paise)::text) ORDER BY g.line_no),
    sum(coalesce(fi.sp_paise, price.sp_paise))
  INTO garments, total
  FROM public.customer_tailoring_garments g
  LEFT JOIN public.customer_tailoring_finished_items fi ON fi.id = g.finished_item_id
  LEFT JOIN public.barcodes b ON b.id = fi.barcode_id
  LEFT JOIN public.customer_tailoring_garment_prices(j.id) price ON price.line_no = g.line_no
  WHERE g.job_id = j.id;
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
    'quoted_sp_paise', public.customer_tailoring_order_sp(j.id)::text,
    'total_sp_paise', total::text,
    'fabric_cp_paise', public.customer_tailoring_fabric_cp(j.id)::text,
    'consumables_cp_paise', public.customer_tailoring_consumables_cp(j.id)::text,
    'stitching_cp_paise', saved.stitching_cp_paise::text,
    'garments', coalesce(garments, '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.generate_customer_tailoring_labels(p_request uuid, p_job uuid, p_stitching_cp_paise bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.customer_tailoring_jobs%rowtype; n integer; workshop uuid; g record; barcode uuid; item uuid; fabric_cp bigint; consumables_cp bigint; total bigint;
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
  -- Lock the bill so its discount cannot change while labels are being created.
  PERFORM 1 FROM public.orders o JOIN public.counter_tailoring_details d ON d.bill_id = o.id WHERE d.job_id = j.id FOR UPDATE OF o;
  IF NOT EXISTS(SELECT 1 FROM public.customer_tailoring_garments WHERE job_id = j.id) THEN
    INSERT INTO public.customer_tailoring_garments(job_id, line_no, size) VALUES (j.id, 1, coalesce(nullif(btrim(j.size), ''), 'Not recorded'));
  END IF;
  SELECT count(*) INTO n FROM public.customer_tailoring_garments WHERE job_id = j.id;
  IF (SELECT count(*) FROM public.customer_tailoring_garment_prices(j.id) p WHERE p.sp_paise >= 1) <> n THEN
    RAISE EXCEPTION 'This order has no positive final price for every garment, so labels cannot be created';
  END IF;
  SELECT id INTO workshop FROM public.locations WHERE active AND kind = 'workshop' FOR UPDATE;
  IF workshop IS NULL THEN RAISE EXCEPTION 'Active Workshop required'; END IF;
  fabric_cp := public.customer_tailoring_fabric_cp(j.id);
  consumables_cp := public.customer_tailoring_consumables_cp(j.id);
  INSERT INTO public.customer_tailoring_completion_costs(job_id, fabric_cp_paise, consumables_cp_paise, stitching_cp_paise, recorded_by)
  VALUES (j.id, fabric_cp, consumables_cp, p_stitching_cp_paise, auth.uid())
  ON CONFLICT (job_id) DO UPDATE SET fabric_cp_paise = excluded.fabric_cp_paise, consumables_cp_paise = excluded.consumables_cp_paise,
    stitching_cp_paise = excluded.stitching_cp_paise, recorded_by = excluded.recorded_by, recorded_at = clock_timestamp();
  total := 0;
  FOR g IN
    SELECT garment.id, garment.size, price.sp_paise
    FROM public.customer_tailoring_garments garment
    JOIN public.customer_tailoring_garment_prices(j.id) price ON price.line_no = garment.line_no
    WHERE garment.job_id = j.id ORDER BY garment.line_no
  LOOP
    barcode := public.new_typed_finished_barcode('C');
    INSERT INTO public.customer_tailoring_finished_items(job_id, barcode_id, request_id, name, size, sp_paise, workshop_location_id, created_by)
    VALUES (j.id, barcode, gen_random_uuid(), left(btrim(j.garment), 120), g.size, g.sp_paise, workshop, auth.uid())
    RETURNING id INTO item;
    UPDATE public.customer_tailoring_garments SET finished_item_id = item WHERE id = g.id;
    total := total + g.sp_paise;
  END LOOP;
  UPDATE public.customer_tailoring_jobs SET status = 'ready' WHERE id = j.id;
  INSERT INTO public.erp_audit_records(actor_id, action, entity_table, entity_id, new_value, reference)
  VALUES (auth.uid(), 'generate_customer_tailoring_labels', 'customer_tailoring_jobs', j.id,
    jsonb_build_object('garments', n, 'labels_total_paise', total, 'quoted_sp_paise', public.customer_tailoring_order_sp(j.id),
      'fabric_cp_paise', fabric_cp, 'consumables_cp_paise', consumables_cp, 'stitching_cp_paise', p_stitching_cp_paise),
    'CUSTOMER-LABELS:' || p_request::text);
  RETURN public.customer_tailoring_labels(j.id);
END $$;

-- 4. Master Tailor: material lines are optional (0 to 100); Tailor Staff stays required.
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
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 0 AND 100 OR (SELECT count(DISTINCT upper(value->>'barcode')) FROM jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) THEN RAISE EXCEPTION 'Up to 100 distinct material-unit scans allowed (none if nothing was used)'; END IF;
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

COMMIT;
