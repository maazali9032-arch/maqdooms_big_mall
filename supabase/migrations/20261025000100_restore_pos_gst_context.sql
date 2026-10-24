BEGIN;

-- Restore the POS context contract after the inclusive garment-GST rewrite.
-- The browser sends the configuration snapshot id and customer GSTIN; supply
-- type is derived here from the registered state codes.
CREATE OR REPLACE FUNCTION public.gst_snapshot_counter_bill(p_bill uuid,p_context jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE config public.gst_configuration_versions; invoice uuid; order_row public.orders%rowtype; item record; rule public.gst_tax_rules; calc jsonb; supply text; customer jsonb; taxable bigint:=0; cgst bigint:=0; sgst bigint:=0; igst bigint:=0; tax bigint:=0; final_amount bigint:=0; entered bigint; rate integer; description text; customer_gstin text; customer_state text;
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

REVOKE ALL ON FUNCTION public.gst_snapshot_counter_bill(uuid,jsonb) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
