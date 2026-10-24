BEGIN;

-- MBM sells at a GST-inclusive SP. Keep the database authoritative even if an
-- older client submits the previously supported exclusive option.
CREATE OR REPLACE FUNCTION public.owner_save_gst_configuration(p_request uuid,p_configuration jsonb,p_rules jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid; saved public.gst_configuration_requests%rowtype; payload jsonb; previous jsonb; rule jsonb; required_category text; normalized_configuration jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
  IF p_request IS NULL OR jsonb_typeof(p_configuration) IS DISTINCT FROM 'object' OR jsonb_typeof(p_rules) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Configuration request and rules required'; END IF;
  IF (p_configuration-ARRAY['enabled','effective_from','legal_name','trading_name','address','contact','gstin','state_code','price_mode','invoice_display','tailoring_display','purchase_mode'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Unknown GST configuration field'; END IF;
  normalized_configuration:=p_configuration||jsonb_build_object('price_mode','inclusive');
  payload:=jsonb_build_object('configuration',normalized_configuration,'rules',p_rules);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,17));
  SELECT * INTO saved FROM public.gst_configuration_requests WHERE request_id=p_request;
  IF FOUND THEN IF saved.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'GST save retry requires identical data'; END IF; RETURN saved.result_id; END IF;
  IF coalesce((normalized_configuration->>'enabled')::boolean,false) AND coalesce(normalized_configuration->>'gstin','')='' THEN RAISE EXCEPTION 'GSTIN required before activation'; END IF;
  FOREACH required_category IN ARRAY ARRAY['purchase','fabric_sale','finished_sale','tailoring'] LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_rules) r WHERE r->>'category'=required_category AND nullif(btrim(r->>'item_ref'),'') IS NULL) THEN RAISE EXCEPTION 'Default % GST rule required',required_category; END IF;
  END LOOP;
  SELECT to_jsonb(c) INTO previous FROM public.gst_configuration_versions c ORDER BY c.effective_from DESC,c.created_at DESC,c.id DESC LIMIT 1;
  INSERT INTO public.gst_configuration_versions(enabled,effective_from,legal_name,trading_name,address,contact,gstin,state_code,price_mode,invoice_display,tailoring_display,purchase_mode,created_by)
  VALUES(coalesce((normalized_configuration->>'enabled')::boolean,false),(normalized_configuration->>'effective_from')::timestamptz,btrim(normalized_configuration->>'legal_name'),btrim(normalized_configuration->>'trading_name'),btrim(normalized_configuration->>'address'),btrim(normalized_configuration->>'contact'),upper(btrim(coalesce(normalized_configuration->>'gstin',''))),btrim(normalized_configuration->>'state_code'),'inclusive',normalized_configuration->>'invoice_display','combined',normalized_configuration->>'purchase_mode',auth.uid()) RETURNING id INTO result;
  FOR rule IN SELECT value FROM jsonb_array_elements(p_rules) LOOP
    IF jsonb_typeof(rule) IS DISTINCT FROM 'object' OR (rule-ARRAY['category','item_ref','label','classification_code','rate_bps'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Unknown GST rule field'; END IF;
    INSERT INTO public.gst_tax_rules(configuration_id,category,item_ref,label,classification_code,rate_bps)
    VALUES(result,rule->>'category',nullif(btrim(rule->>'item_ref'),''),nullif(btrim(rule->>'label'),''),upper(btrim(rule->>'classification_code')),(rule->>'rate_bps')::integer);
  END LOOP;
  INSERT INTO public.gst_configuration_requests VALUES(p_request,payload,result,auth.uid(),clock_timestamp());
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,old_value,new_value,reference)
  VALUES(auth.uid(),'save_gst_configuration','gst_configuration_versions',result,previous,(SELECT to_jsonb(c) FROM public.gst_configuration_versions c WHERE c.id=result),'GST-CONFIG:'||p_request::text);
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.gst_transaction_configuration()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE config public.gst_configuration_versions; slab public.gst_garment_slab_versions%rowtype;
BEGIN
  IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry','counter','ecommerce_manager']) THEN RAISE EXCEPTION 'GST transaction access required'; END IF;
  IF public.has_role(auth.uid(),'owner') THEN
    SELECT * INTO config FROM public.gst_configuration_versions ORDER BY effective_from DESC,created_at DESC,id DESC LIMIT 1;
  ELSE config:=public.gst_active_configuration(); END IF;
  SELECT * INTO slab FROM public.gst_garment_slab_versions WHERE effective_from<=clock_timestamp() ORDER BY effective_from DESC,recorded_at DESC LIMIT 1;
  IF config.id IS NULL THEN RETURN jsonb_build_object('configuration',NULL,'rules','[]'::jsonb,'garment_slabs',jsonb_build_object('threshold_paise','250000','lower_rate_bps',500,'higher_rate_bps',1800)); END IF;
  RETURN jsonb_build_object(
    'configuration',jsonb_build_object('id',config.id,'enabled',config.enabled,'effective_from',config.effective_from,'legal_name',config.legal_name,'trading_name',config.trading_name,'address',config.address,'contact',config.contact,'gstin',config.gstin,'state_code',config.state_code,'price_mode','inclusive','invoice_display',config.invoice_display,'tailoring_display','combined','purchase_mode',config.purchase_mode),
    'rules',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'category',r.category,'item_ref',r.item_ref,'label',r.label,'classification_code',r.classification_code,'rate_bps',r.rate_bps) ORDER BY r.category,r.item_ref NULLS FIRST) FROM public.gst_tax_rules r WHERE r.configuration_id=config.id),'[]'::jsonb),
    'garment_slabs',CASE WHEN slab.id IS NULL THEN jsonb_build_object('threshold_paise','250000','lower_rate_bps',500,'higher_rate_bps',1800) ELSE jsonb_build_object('threshold_paise',slab.threshold_paise::text,'lower_rate_bps',slab.lower_rate_bps,'higher_rate_bps',slab.higher_rate_bps,'effective_from',slab.effective_from) END
  );
END; $$;

CREATE OR REPLACE FUNCTION public.gst_snapshot_counter_bill(p_bill uuid,p_context jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE config public.gst_configuration_versions; invoice uuid; order_row public.orders%rowtype; item record; rule public.gst_tax_rules; calc jsonb; supply text; customer jsonb; taxable bigint:=0; cgst bigint:=0; sgst bigint:=0; igst bigint:=0; tax bigint:=0; final_amount bigint:=0; entered bigint; rate integer; description text;
BEGIN
  config:=public.gst_active_configuration();
  SELECT * INTO order_row FROM public.orders WHERE id=p_bill AND kind='counter_bill' FOR UPDATE;
  IF order_row.id IS NULL THEN RAISE EXCEPTION 'Completed Counter bill required'; END IF;
  IF config.id IS NULL THEN RETURN order_row.final_customer_price_paise; END IF;
  IF jsonb_typeof(p_context) IS DISTINCT FROM 'object' OR (p_context-ARRAY['supply_type','customer_gstin','customer_state_code','payment_method'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Valid GST sale context required'; END IF;
  supply:=p_context->>'supply_type'; IF supply NOT IN('intra_state','inter_state') THEN RAISE EXCEPTION 'Choose intra-state or inter-state supply'; END IF;
  SELECT id INTO invoice FROM public.gst_invoice_snapshots WHERE order_id=p_bill;
  IF invoice IS NOT NULL THEN RETURN (SELECT final_paise FROM public.gst_invoice_snapshots WHERE id=invoice); END IF;
  customer:=coalesce(order_row.customer_snapshot,'{}'::jsonb)||jsonb_build_object('gstin',nullif(upper(btrim(p_context->>'customer_gstin')),''),'state_code',nullif(btrim(p_context->>'customer_state_code'),''));
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
    IF item.customer_tailoring_job_id IS NOT NULL THEN
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
END; $$;

CREATE OR REPLACE FUNCTION public.record_counter_bill_discount_revision(p_bill uuid,p_discount_bps integer)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE order_row public.orders%rowtype; invoice jsonb; tax jsonb; gross bigint; final_amount bigint; discount_amount bigint; revision integer; document jsonb; tax_lines jsonb; adjusted_lines jsonb; tax_taxable bigint; tax_cgst bigint; tax_sgst bigint; tax_igst bigint; tax_gst bigint;
BEGIN
  IF p_discount_bps NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Discount must be from 0 to 100 percent'; END IF;
  SELECT * INTO order_row FROM public.orders WHERE id=p_bill AND kind='counter_bill' FOR UPDATE;
  IF order_row.id IS NULL THEN RAISE EXCEPTION 'Counter bill not found'; END IF;
  invoice:=public.gst_invoice_document(p_bill);
  IF invoice IS NULL THEN
    SELECT document->'lines',(document->>'total_paise')::bigint INTO adjusted_lines,gross FROM public.counter_bill_print_records WHERE bill_id=p_bill;
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
    FROM jsonb_array_elements((SELECT document->'lines' FROM public.counter_bill_print_records WHERE bill_id=p_bill)) print_line
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
END; $$;

REVOKE ALL ON FUNCTION public.owner_save_gst_configuration(uuid,jsonb,jsonb),public.gst_transaction_configuration(),public.gst_snapshot_counter_bill(uuid,jsonb),public.record_counter_bill_discount_revision(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_save_gst_configuration(uuid,jsonb,jsonb),public.gst_transaction_configuration() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
