BEGIN;

-- Supplier information belongs to the supplier record, so subsequent receipts
-- can prefill it rather than requiring the stock-entry user to type it again.
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS gstin text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS address text;

CREATE OR REPLACE FUNCTION public.owner_save_gst_configuration(p_request uuid,p_configuration jsonb,p_rules jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid; saved public.gst_configuration_requests%rowtype; payload jsonb; previous jsonb; rule jsonb; required_category text; normalized_configuration jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
  IF p_request IS NULL OR jsonb_typeof(p_configuration) IS DISTINCT FROM 'object' OR jsonb_typeof(p_rules) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Configuration request and rules required'; END IF;
  IF (p_configuration-ARRAY['enabled','effective_from','legal_name','trading_name','address','contact','gstin','state_code','price_mode','invoice_display','tailoring_display','purchase_mode'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Unknown GST configuration field'; END IF;
  normalized_configuration:=p_configuration||jsonb_build_object('price_mode','inclusive','invoice_display','final_first','tailoring_display','combined','purchase_mode','track_itc');
  -- The only editable sales-rate decision is the separate garment slab. All
  -- default classifications and base rates are deliberately fixed here.
  p_rules:=jsonb_build_array(
    jsonb_build_object('category','purchase','item_ref',null,'label',null,'classification_code','5208','rate_bps',500),
    jsonb_build_object('category','fabric_sale','item_ref',null,'label',null,'classification_code','5208','rate_bps',500),
    jsonb_build_object('category','finished_sale','item_ref',null,'label',null,'classification_code','6203','rate_bps',500),
    jsonb_build_object('category','tailoring','item_ref',null,'label',null,'classification_code','9988','rate_bps',500)
  );
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
  VALUES(coalesce((normalized_configuration->>'enabled')::boolean,false),(normalized_configuration->>'effective_from')::timestamptz,btrim(normalized_configuration->>'legal_name'),btrim(normalized_configuration->>'trading_name'),btrim(normalized_configuration->>'address'),btrim(normalized_configuration->>'contact'),upper(btrim(coalesce(normalized_configuration->>'gstin',''))),btrim(normalized_configuration->>'state_code'),'inclusive','final_first','combined','track_itc',auth.uid()) RETURNING id INTO result;
  FOR rule IN SELECT value FROM jsonb_array_elements(p_rules) LOOP
    INSERT INTO public.gst_tax_rules(configuration_id,category,item_ref,label,classification_code,rate_bps)
    VALUES(result,rule->>'category',nullif(btrim(rule->>'item_ref'),''),nullif(btrim(rule->>'label'),''),upper(btrim(rule->>'classification_code')),(rule->>'rate_bps')::integer);
  END LOOP;
  INSERT INTO public.gst_configuration_requests VALUES(p_request,payload,result,auth.uid(),clock_timestamp());
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference)
  VALUES(auth.uid(),'save_gst_configuration','gst_configuration_versions',result,previous,(SELECT to_jsonb(c) FROM public.gst_configuration_versions c WHERE c.id=result),'GST-CONFIG:'||p_request::text);
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.record_required_stock_purchase(
  p_batch uuid, p_vendor_receipt uuid, p_material_batch uuid,
  p_supplier text, p_purchase jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE config public.gst_configuration_versions; document_id uuid; gstin text; supply text; itc text;
 taxable bigint; gst bigint; total bigint; transport bigint; eligible bigint:=0; ineligible bigint:=0; reversed bigint:=0;
 supplier_id uuid; supplier_phone text; supplier_email text; supplier_address text;
BEGIN
 IF num_nonnulls(p_batch,p_vendor_receipt,p_material_batch)<>1 THEN RAISE EXCEPTION 'Exactly one stock purchase source is required'; END IF;
 IF nullif(btrim(p_supplier),'') IS NULL THEN RAISE EXCEPTION 'Supplier required'; END IF;
 config:=public.gst_active_configuration(); IF config.id IS NULL THEN RAISE EXCEPTION 'Active GST configuration required'; END IF;
 IF jsonb_typeof(p_purchase) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Supplier GST and invoice details required'; END IF;
 gstin:=upper(btrim(coalesce(p_purchase->>'supplier_gstin','')));
 IF gstin !~ '^[0-9]{2}[A-Z0-9]{13}$' THEN RAISE EXCEPTION 'Valid supplier GSTIN required'; END IF;
 IF nullif(btrim(p_purchase->>'invoice_number'),'') IS NULL OR nullif(p_purchase->>'invoice_date','') IS NULL THEN RAISE EXCEPTION 'Supplier invoice number and date required'; END IF;
 supplier_phone:=nullif(btrim(p_purchase->>'supplier_phone'),''); supplier_email:=nullif(lower(btrim(p_purchase->>'supplier_email')),''); supplier_address:=nullif(btrim(p_purchase->>'supplier_address'),'');
 SELECT id INTO supplier_id FROM public.suppliers WHERE lower(name)=lower(btrim(p_supplier)) ORDER BY id LIMIT 1 FOR UPDATE;
 IF supplier_id IS NULL THEN
   INSERT INTO public.suppliers(name,gstin,phone,email,address) VALUES(btrim(p_supplier),gstin,supplier_phone,supplier_email,supplier_address) RETURNING id INTO supplier_id;
 ELSE
   UPDATE public.suppliers SET gstin=gstin,phone=coalesce(supplier_phone,phone),email=coalesce(supplier_email,email),address=coalesce(supplier_address,address) WHERE id=supplier_id;
 END IF;
 taxable:=(p_purchase->>'actual_taxable_paise')::bigint; gst:=(p_purchase->>'actual_gst_paise')::bigint;
 total:=(p_purchase->>'actual_supplier_paise')::bigint; transport:=coalesce((p_purchase->>'transport_paise')::bigint,0);
 IF least(taxable,gst,total,transport)<0 OR total<>taxable+gst THEN RAISE EXCEPTION 'Invoice total must equal taxable amount plus GST'; END IF;
 itc:=coalesce(nullif(p_purchase->>'itc_status',''),'pending');
 IF itc NOT IN('eligible','ineligible','reversed','pending') THEN RAISE EXCEPTION 'Valid ITC status required'; END IF;
 IF itc='eligible' THEN eligible:=gst; ELSIF itc='ineligible' THEN ineligible:=gst; ELSIF itc='reversed' THEN reversed:=gst; END IF;
 supply:=CASE WHEN left(gstin,2)<>config.state_code THEN 'inter_state' ELSE 'intra_state' END;
 INSERT INTO public.gst_purchase_documents(batch_id,vendor_receipt_id,material_batch_id,configuration_id,supplier_name,supplier_gstin,supplier_invoice_number,supplier_invoice_date,supply_type,purchase_mode,itc_status,calculated_taxable_paise,calculated_gst_paise,calculated_supplier_paise,actual_taxable_paise,actual_gst_paise,actual_supplier_paise,difference_paise,eligible_itc_paise,ineligible_itc_paise,reversed_itc_paise,inventory_cost_adjustment_paise,transport_paise,finalized,recorded_by)
 VALUES(p_batch,p_vendor_receipt,p_material_batch,config.id,btrim(p_supplier),gstin,btrim(p_purchase->>'invoice_number'),(p_purchase->>'invoice_date')::date,supply,'track_itc',itc,taxable,gst,total,taxable,gst,total,0,eligible,ineligible,reversed,0,transport,true,auth.uid())
 ON CONFLICT DO NOTHING RETURNING id INTO document_id;
 IF document_id IS NULL THEN SELECT id INTO document_id FROM public.gst_purchase_documents WHERE batch_id=p_batch OR vendor_receipt_id=p_vendor_receipt OR material_batch_id=p_material_batch; END IF;
 RETURN document_id;
END; $$;

REVOKE ALL ON FUNCTION public.owner_save_gst_configuration(uuid,jsonb,jsonb),public.record_required_stock_purchase(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_save_gst_configuration(uuid,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
