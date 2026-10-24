-- Supplier invoices are required for every purchased-stock workflow. Purchase
-- costs arrive GST-inclusive; transport/other charges are allocated into landed CP.
ALTER TABLE public.gst_purchase_documents ALTER COLUMN batch_id DROP NOT NULL;
ALTER TABLE public.gst_purchase_documents
  ADD COLUMN vendor_receipt_id uuid REFERENCES public.vendor_finished_product_receipts(id),
  ADD COLUMN material_batch_id uuid REFERENCES public.material_batches(id),
  ADD COLUMN transport_paise bigint NOT NULL DEFAULT 0 CHECK(transport_paise >= 0),
  ADD CONSTRAINT gst_purchase_one_stock_source CHECK(num_nonnulls(batch_id,vendor_receipt_id,material_batch_id)=1);
CREATE UNIQUE INDEX gst_purchase_vendor_receipt_key ON public.gst_purchase_documents(vendor_receipt_id) WHERE vendor_receipt_id IS NOT NULL;
CREATE UNIQUE INDEX gst_purchase_material_batch_key ON public.gst_purchase_documents(material_batch_id) WHERE material_batch_id IS NOT NULL;

CREATE FUNCTION public.record_required_stock_purchase(
  p_batch uuid, p_vendor_receipt uuid, p_material_batch uuid,
  p_supplier text, p_purchase jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE config public.gst_configuration_versions; document_id uuid; gstin text; supply text; itc text;
 taxable bigint; gst bigint; total bigint; transport bigint; eligible bigint:=0; ineligible bigint:=0; reversed bigint:=0;
BEGIN
 IF num_nonnulls(p_batch,p_vendor_receipt,p_material_batch)<>1 THEN RAISE EXCEPTION 'Exactly one stock purchase source is required'; END IF;
 config:=public.gst_active_configuration(); IF config.id IS NULL THEN RAISE EXCEPTION 'Active GST configuration required'; END IF;
 IF jsonb_typeof(p_purchase) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Supplier GST and invoice details required'; END IF;
 gstin:=upper(btrim(coalesce(p_purchase->>'supplier_gstin','')));
 IF gstin !~ '^[0-9]{2}[A-Z0-9]{13}$' THEN RAISE EXCEPTION 'Valid supplier GSTIN required'; END IF;
 IF nullif(btrim(p_purchase->>'invoice_number'),'') IS NULL OR nullif(p_purchase->>'invoice_date','') IS NULL THEN RAISE EXCEPTION 'Supplier invoice number and date required'; END IF;
 taxable:=(p_purchase->>'actual_taxable_paise')::bigint; gst:=(p_purchase->>'actual_gst_paise')::bigint;
 total:=(p_purchase->>'actual_supplier_paise')::bigint; transport:=coalesce((p_purchase->>'transport_paise')::bigint,0);
 IF least(taxable,gst,total,transport)<0 OR total<>taxable+gst THEN RAISE EXCEPTION 'Invoice total must equal taxable amount plus GST'; END IF;
 itc:=coalesce(nullif(p_purchase->>'itc_status',''),'pending');
 IF itc NOT IN('eligible','ineligible','reversed','pending') THEN RAISE EXCEPTION 'Valid ITC status required'; END IF;
 IF itc='eligible' THEN eligible:=gst; ELSIF itc='ineligible' THEN ineligible:=gst; ELSIF itc='reversed' THEN reversed:=gst; END IF;
 supply:=CASE WHEN left(gstin,2)<>config.state_code THEN 'inter_state' ELSE 'intra_state' END;
 INSERT INTO public.gst_purchase_documents(batch_id,vendor_receipt_id,material_batch_id,configuration_id,supplier_name,supplier_gstin,supplier_invoice_number,supplier_invoice_date,supply_type,purchase_mode,itc_status,calculated_taxable_paise,calculated_gst_paise,calculated_supplier_paise,actual_taxable_paise,actual_gst_paise,actual_supplier_paise,difference_paise,eligible_itc_paise,ineligible_itc_paise,reversed_itc_paise,inventory_cost_adjustment_paise,transport_paise,finalized,recorded_by)
 VALUES(p_batch,p_vendor_receipt,p_material_batch,config.id,btrim(p_supplier),gstin,btrim(p_purchase->>'invoice_number'),(p_purchase->>'invoice_date')::date,supply,config.purchase_mode,itc,taxable,gst,total,taxable,gst,total,0,eligible,ineligible,reversed,CASE WHEN config.purchase_mode='include_noncreditable' THEN ineligible+reversed ELSE 0 END,transport,true,auth.uid())
 ON CONFLICT DO NOTHING RETURNING id INTO document_id;
 IF document_id IS NULL THEN SELECT id INTO document_id FROM public.gst_purchase_documents WHERE batch_id=p_batch OR vendor_receipt_id=p_vendor_receipt OR material_batch_id=p_material_batch; END IF;
 RETURN document_id;
END; $$;

CREATE FUNCTION public.create_barcode_batch_with_purchase_v2(p_request uuid,p_provider text,p_arrival_date date,p_remarks text,p_fabrics jsonb,p_purchase jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid;
BEGIN
 result:=public.create_barcode_batch_with_details(p_request,p_provider,p_arrival_date,NULL,p_fabrics);
 PERFORM public.record_required_stock_purchase(result,NULL,NULL,p_provider,p_purchase);
 RETURN result;
END; $$;

CREATE FUNCTION public.receive_vendor_finished_products_with_purchase(p_request uuid,p_supplier text,p_arrival_date date,p_remarks text,p_items jsonb,p_purchase jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; receipt uuid;
BEGIN
 result:=public.receive_vendor_finished_products(p_request,p_supplier,p_arrival_date,NULL,p_items);
 receipt:=(result->>'receipt_id')::uuid;
 PERFORM public.record_required_stock_purchase(NULL,receipt,NULL,p_supplier,p_purchase);
 RETURN result;
END; $$;

CREATE FUNCTION public.receive_material_unit_batch_with_purchase(p_request uuid,p_supplier text,p_reference text,p_shared_expense_paise bigint,p_lines jsonb,p_purchase jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid; unit_count integer; base_share bigint; remainder bigint;
BEGIN
 result:=public.receive_material_unit_batch(p_request,p_supplier,p_reference,p_shared_expense_paise,p_lines);
 SELECT count(*) INTO unit_count FROM public.material_units WHERE batch_id=result;
 IF unit_count<=0 THEN RAISE EXCEPTION 'Material batch has no physical units'; END IF;
 base_share:=p_shared_expense_paise/unit_count; remainder:=p_shared_expense_paise%unit_count;
 WITH ranked AS (
   SELECT id,row_number() OVER(ORDER BY material_id,ordinal,id) AS position FROM public.material_units WHERE batch_id=result
 )
 UPDATE public.material_units u SET
   allocated_expense_paise=base_share+CASE WHEN r.position<=remainder THEN 1 ELSE 0 END,
   landed_cost_paise=u.net_purchase_paise+u.nonrecoverable_gst_paise+u.direct_cost_paise+base_share+CASE WHEN r.position<=remainder THEN 1 ELSE 0 END,
   cp_per_quantity_paise=(u.net_purchase_paise+u.nonrecoverable_gst_paise+u.direct_cost_paise+base_share+CASE WHEN r.position<=remainder THEN 1 ELSE 0 END)::numeric/u.initial_quantity
 FROM ranked r WHERE u.id=r.id;
 PERFORM public.record_required_stock_purchase(NULL,NULL,result,p_supplier,p_purchase);
 RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.record_required_stock_purchase(uuid,uuid,uuid,text,jsonb),public.create_barcode_batch_with_purchase_v2(uuid,text,date,text,jsonb,jsonb),public.receive_vendor_finished_products_with_purchase(uuid,text,date,text,jsonb,jsonb),public.receive_material_unit_batch_with_purchase(uuid,text,text,bigint,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_barcode_batch_with_purchase_v2(uuid,text,date,text,jsonb,jsonb),public.receive_vendor_finished_products_with_purchase(uuid,text,date,text,jsonb,jsonb),public.receive_material_unit_batch_with_purchase(uuid,text,text,bigint,jsonb,jsonb) TO authenticated;
