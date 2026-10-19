-- GST operational-input audit: derive supply treatment from registered and counterparty GSTIN state codes.
-- This is deliberately forward-only. It does not rewrite historical GST snapshots or purchase documents.

CREATE OR REPLACE FUNCTION public.gst_snapshot_counter_bill(p_bill uuid,p_context jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE config public.gst_configuration_versions; invoice uuid; order_row public.orders%rowtype; item record; rule public.gst_tax_rules; calc jsonb; supply text; customer jsonb; taxable bigint:=0; cgst bigint:=0; sgst bigint:=0; igst bigint:=0; tax bigint:=0; final_amount bigint:=0; entered bigint; fabric_amount bigint; stitching_amount bigint; description text; customer_gstin text; customer_state text;
BEGIN
  config:=public.gst_active_configuration();
  SELECT * INTO order_row FROM public.orders WHERE id=p_bill AND kind='counter_bill' FOR UPDATE;
  IF order_row.id IS NULL THEN RAISE EXCEPTION 'Completed Counter bill required'; END IF;
  IF config.id IS NULL THEN RETURN order_row.final_customer_price_paise; END IF;
  IF jsonb_typeof(p_context) IS DISTINCT FROM 'object' OR (p_context-ARRAY['customer_gstin','payment_method'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Valid GST sale context required'; END IF;
  customer_gstin:=nullif(upper(btrim(p_context->>'customer_gstin')),'');
  IF customer_gstin IS NULL THEN
    supply:='intra_state'; customer_state:=null;
  ELSE
    IF customer_gstin !~ '^[0-9]{2}[A-Z0-9]{13}$' THEN RAISE EXCEPTION 'A valid customer GSTIN is required for a GST business invoice'; END IF;
    customer_state:=left(customer_gstin,2);
    supply:=CASE WHEN customer_state=config.state_code THEN 'intra_state' ELSE 'inter_state' END;
  END IF;
  SELECT id INTO invoice FROM public.gst_invoice_snapshots WHERE order_id=p_bill;
  IF invoice IS NOT NULL THEN RETURN (SELECT final_paise FROM public.gst_invoice_snapshots WHERE id=invoice); END IF;
  customer:=coalesce(order_row.customer_snapshot,'{}'::jsonb)||jsonb_build_object('gstin',customer_gstin,'state_code',customer_state);
  INSERT INTO public.gst_invoice_snapshots(order_id,configuration_id,invoice_number,supply_type,price_mode,invoice_display,tailoring_display,business_snapshot,customer_snapshot,payment_method,taxable_paise,cgst_paise,sgst_paise,igst_paise,gst_paise,final_paise,recorded_by)
  VALUES(p_bill,config.id,order_row.code,supply,config.price_mode,config.invoice_display,config.tailoring_display,jsonb_build_object('legal_name',config.legal_name,'trading_name',config.trading_name,'address',config.address,'contact',config.contact,'gstin',config.gstin,'state_code',config.state_code),customer,nullif(btrim(p_context->>'payment_method'),''),0,0,0,0,0,0,auth.uid()) RETURNING id INTO invoice;
  FOR item IN
    SELECT it.*,coalesce(g.name,f.name,product.name,job.garment,'Item') item_name,
      CASE WHEN it.fabric_stock_id IS NOT NULL THEN 'FABRIC:'||upper(coalesce(g.name,f.name,'')) WHEN it.finished_product_id IS NOT NULL THEN 'PRODUCT:'||upper(coalesce(product.name,'')) ELSE 'SERVICE:'||upper(coalesce(job.garment,'')) END ref,
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
      fabric_amount:=coalesce(item.fabric_amount_paise,0); stitching_amount:=coalesce(item.stitching_paise,0);
      IF fabric_amount>0 THEN
        rule:=public.gst_rule_for(config.id,'fabric_sale','FABRIC:'||upper(item.item_name)); IF rule.id IS NULL THEN RAISE EXCEPTION 'Fabric GST rule required'; END IF;
        calc:=public.gst_calculate_amount(fabric_amount,rule.rate_bps,config.price_mode,supply);
        INSERT INTO public.gst_invoice_lines(invoice_id,source_item_id,component,display_group,description,classification_code,quantity,unit,entered_amount_paise,taxable_paise,rate_bps,cgst_paise,sgst_paise,igst_paise,gst_paise,final_paise)
        VALUES(invoice,item.id,'fabric_sale',item.id::text,item.item_name||' fabric',rule.classification_code,1,'job',fabric_amount,(calc->>'taxable_paise')::bigint,rule.rate_bps,(calc->>'cgst_paise')::bigint,(calc->>'sgst_paise')::bigint,(calc->>'igst_paise')::bigint,(calc->>'gst_paise')::bigint,(calc->>'final_paise')::bigint);
        taxable:=taxable+(calc->>'taxable_paise')::bigint; cgst:=cgst+(calc->>'cgst_paise')::bigint; sgst:=sgst+(calc->>'sgst_paise')::bigint; igst:=igst+(calc->>'igst_paise')::bigint; tax:=tax+(calc->>'gst_paise')::bigint; final_amount:=final_amount+(calc->>'final_paise')::bigint;
      END IF;
      IF stitching_amount>0 THEN
        rule:=public.gst_rule_for(config.id,'tailoring',item.ref); IF rule.id IS NULL THEN RAISE EXCEPTION 'Tailoring GST rule required'; END IF;
        calc:=public.gst_calculate_amount(stitching_amount,rule.rate_bps,config.price_mode,supply);
        INSERT INTO public.gst_invoice_lines(invoice_id,source_item_id,component,display_group,description,classification_code,quantity,unit,entered_amount_paise,taxable_paise,rate_bps,cgst_paise,sgst_paise,igst_paise,gst_paise,final_paise)
        VALUES(invoice,item.id,'tailoring',item.id::text,item.item_name||' stitching',rule.classification_code,1,'service',stitching_amount,(calc->>'taxable_paise')::bigint,rule.rate_bps,(calc->>'cgst_paise')::bigint,(calc->>'sgst_paise')::bigint,(calc->>'igst_paise')::bigint,(calc->>'gst_paise')::bigint,(calc->>'final_paise')::bigint);
        taxable:=taxable+(calc->>'taxable_paise')::bigint; cgst:=cgst+(calc->>'cgst_paise')::bigint; sgst:=sgst+(calc->>'sgst_paise')::bigint; igst:=igst+(calc->>'igst_paise')::bigint; tax:=tax+(calc->>'gst_paise')::bigint; final_amount:=final_amount+(calc->>'final_paise')::bigint;
      END IF;
    ELSE
      IF item.fabric_stock_id IS NOT NULL THEN rule:=public.gst_rule_for(config.id,'fabric_sale',item.ref); description:=item.item_name; ELSE rule:=public.gst_rule_for(config.id,'finished_sale',item.ref); description:=item.item_name; END IF;
      IF rule.id IS NULL THEN RAISE EXCEPTION 'GST rule required for %',description; END IF;
      entered:=item.final_customer_price_paise; calc:=public.gst_calculate_amount(entered,rule.rate_bps,config.price_mode,supply);
      INSERT INTO public.gst_invoice_lines(invoice_id,source_item_id,component,description,classification_code,quantity,unit,entered_rate_paise,entered_amount_paise,taxable_paise,rate_bps,cgst_paise,sgst_paise,igst_paise,gst_paise,final_paise)
      VALUES(invoice,item.id,CASE WHEN item.fabric_stock_id IS NOT NULL THEN 'fabric_sale' ELSE 'finished_sale' END,description,rule.classification_code,item.quantity,item.unit,item.sp_snapshot_paise,entered,(calc->>'taxable_paise')::bigint,rule.rate_bps,(calc->>'cgst_paise')::bigint,(calc->>'sgst_paise')::bigint,(calc->>'igst_paise')::bigint,(calc->>'gst_paise')::bigint,(calc->>'final_paise')::bigint);
      taxable:=taxable+(calc->>'taxable_paise')::bigint; cgst:=cgst+(calc->>'cgst_paise')::bigint; sgst:=sgst+(calc->>'sgst_paise')::bigint; igst:=igst+(calc->>'igst_paise')::bigint; tax:=tax+(calc->>'gst_paise')::bigint; final_amount:=final_amount+(calc->>'final_paise')::bigint;
    END IF;
  END LOOP;
  UPDATE public.gst_invoice_snapshots SET taxable_paise=taxable,cgst_paise=cgst,sgst_paise=sgst,igst_paise=igst,gst_paise=tax,final_paise=final_amount,finalized=true WHERE id=invoice;
  UPDATE public.orders SET final_customer_price_paise=final_amount WHERE id=p_bill;
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'capture_gst_invoice','gst_invoice_snapshots',invoice,jsonb_build_object('order_id',p_bill,'taxable_paise',taxable,'gst_paise',tax,'final_paise',final_amount),'GST-INVOICE:'||order_row.code);
  RETURN final_amount;
END; $$;

CREATE OR REPLACE FUNCTION public.create_barcode_batch_with_gst(p_request uuid,p_provider text,p_arrival_date date,p_remarks text,p_fabrics jsonb,p_purchase jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE batch uuid; config public.gst_configuration_versions; purchase_id uuid; supply text; itc text; group_row jsonb; detail jsonb; group_id uuid; variant_id uuid; position integer:=0; ordinal integer; rule public.gst_tax_rules; calc jsonb; base bigint; taxable bigint:=0; tax bigint:=0; supplier_total bigint:=0; cgst bigint; sgst bigint; igst bigint; actual_taxable bigint; actual_gst bigint; actual_supplier bigint; eligible bigint:=0; ineligible bigint:=0; reversed bigint:=0; cost_adjustment bigint:=0; supplier_gstin text;
BEGIN
  batch:=public.create_barcode_batch_with_details(p_request,p_provider,p_arrival_date,p_remarks,p_fabrics);
  config:=public.gst_active_configuration(); IF config.id IS NULL THEN RETURN batch; END IF;
  IF EXISTS(SELECT 1 FROM public.gst_purchase_documents WHERE batch_id=batch) THEN RETURN batch; END IF;
  IF p_purchase IS NULL OR p_purchase='{}'::jsonb THEN RETURN batch; END IF;
  IF jsonb_typeof(p_purchase) IS DISTINCT FROM 'object' OR (p_purchase-ARRAY['supplier_gstin','invoice_number','invoice_date','itc_status','actual_taxable_paise','actual_gst_paise','actual_supplier_paise'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Valid purchase GST details required'; END IF;
  supplier_gstin:=nullif(upper(btrim(p_purchase->>'supplier_gstin')),'');
  IF supplier_gstin IS NOT NULL AND supplier_gstin !~ '^[0-9]{2}[A-Z0-9]{13}$' THEN RAISE EXCEPTION 'Enter a valid supplier GSTIN or leave it blank'; END IF;
  supply:=CASE WHEN supplier_gstin IS NOT NULL AND left(supplier_gstin,2)<>config.state_code THEN 'inter_state' ELSE 'intra_state' END;
  itc:=coalesce(nullif(p_purchase->>'itc_status',''),'pending');
  IF itc NOT IN('eligible','ineligible','reversed','pending') THEN RAISE EXCEPTION 'Valid ITC status required'; END IF;
  INSERT INTO public.gst_purchase_documents(batch_id,configuration_id,supplier_name,supplier_gstin,supplier_invoice_number,supplier_invoice_date,supply_type,purchase_mode,itc_status,calculated_taxable_paise,calculated_gst_paise,calculated_supplier_paise,recorded_by)
  VALUES(batch,config.id,btrim(p_provider),supplier_gstin,nullif(btrim(p_purchase->>'invoice_number'),''),nullif(p_purchase->>'invoice_date','')::date,supply,config.purchase_mode,itc,0,0,0,auth.uid()) RETURNING id INTO purchase_id;
  FOR group_row IN SELECT value FROM jsonb_array_elements(p_fabrics) LOOP
    position:=position+1; SELECT id INTO group_id FROM public.stock_registration_fabric_types WHERE batch_id=batch AND label_position=position;
    ordinal:=0;
    FOR detail IN SELECT value FROM jsonb_array_elements(coalesce(group_row->'rows','[]'::jsonb)) LOOP
      ordinal:=ordinal+1;
      IF detail->>'length_mm' IS NOT NULL AND detail->>'cp_paise_per_m' IS NOT NULL THEN
        SELECT id INTO variant_id FROM public.stock_registration_variants WHERE fabric_type_id=group_id AND ordinal=ordinal;
        rule:=public.gst_rule_for(config.id,'purchase','FABRIC:'||upper(group_row->>'name')); IF rule.id IS NULL THEN RAISE EXCEPTION 'Purchase GST rule required'; END IF;
        base:=round((detail->>'length_mm')::numeric*(detail->>'cp_paise_per_m')::numeric/1000)::bigint;
        calc:=public.gst_calculate_amount(base,rule.rate_bps,'exclusive',supply);
        cgst:=(calc->>'cgst_paise')::bigint; sgst:=(calc->>'sgst_paise')::bigint; igst:=(calc->>'igst_paise')::bigint;
        INSERT INTO public.gst_purchase_lines(purchase_id,variant_id,description,classification_code,length_mm,base_cp_paise_per_m,taxable_paise,rate_bps,cgst_paise,sgst_paise,igst_paise,gst_paise,supplier_paise)
        VALUES(purchase_id,variant_id,group_row->>'name',rule.classification_code,(detail->>'length_mm')::integer,(detail->>'cp_paise_per_m')::bigint,base,rule.rate_bps,cgst,sgst,igst,(calc->>'gst_paise')::bigint,(calc->>'final_paise')::bigint);
        taxable:=taxable+base; tax:=tax+(calc->>'gst_paise')::bigint; supplier_total:=supplier_total+(calc->>'final_paise')::bigint;
      END IF;
    END LOOP;
  END LOOP;
  actual_taxable:=nullif(p_purchase->>'actual_taxable_paise','')::bigint; actual_gst:=nullif(p_purchase->>'actual_gst_paise','')::bigint; actual_supplier:=nullif(p_purchase->>'actual_supplier_paise','')::bigint;
  IF itc='eligible' THEN eligible:=coalesce(actual_gst,tax); ELSIF itc='ineligible' THEN ineligible:=coalesce(actual_gst,tax); ELSIF itc='reversed' THEN reversed:=coalesce(actual_gst,tax); END IF;
  IF config.purchase_mode='include_noncreditable' THEN cost_adjustment:=ineligible+reversed; END IF;
  UPDATE public.gst_purchase_documents SET calculated_taxable_paise=taxable,calculated_gst_paise=tax,calculated_supplier_paise=supplier_total,actual_taxable_paise=actual_taxable,actual_gst_paise=actual_gst,actual_supplier_paise=actual_supplier,difference_paise=CASE WHEN actual_supplier IS NULL THEN NULL ELSE actual_supplier-supplier_total END,eligible_itc_paise=eligible,ineligible_itc_paise=ineligible,reversed_itc_paise=reversed,inventory_cost_adjustment_paise=cost_adjustment,finalized=true WHERE id=purchase_id;
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'capture_purchase_gst','gst_purchase_documents',purchase_id,jsonb_build_object('batch_id',batch,'taxable_paise',taxable,'gst_paise',tax,'supplier_paise',supplier_total,'itc_status',itc),'GST-PURCHASE:'||batch::text);
  RETURN batch;
END; $$;
