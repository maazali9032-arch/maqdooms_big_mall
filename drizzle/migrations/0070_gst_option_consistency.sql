BEGIN;
-- A tailored garment can contain several fabric cuts with different tax rules.
-- Existing single-component snapshots retain ordinal zero and their original values.
ALTER TABLE public.gst_invoice_lines ADD COLUMN source_cut_ordinal integer NOT NULL DEFAULT 0 CHECK(source_cut_ordinal>=0);
ALTER TABLE public.gst_invoice_lines DROP CONSTRAINT gst_invoice_lines_invoice_id_source_item_id_component_key;
ALTER TABLE public.gst_invoice_lines ADD CONSTRAINT gst_invoice_lines_source_cut_key
  UNIQUE(invoice_id,source_item_id,component,source_cut_ordinal);
-- The newest effective version may explicitly disable GST. Do not revive an older enabled version.
CREATE OR REPLACE FUNCTION public.gst_active_configuration(p_at timestamptz DEFAULT clock_timestamp())
RETURNS public.gst_configuration_versions LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result public.gst_configuration_versions;
BEGIN
  SELECT * INTO result FROM public.gst_configuration_versions c WHERE c.effective_from<=p_at
    ORDER BY c.effective_from DESC,c.created_at DESC,c.id DESC LIMIT 1;
  IF NOT coalesce(result.enabled,false) THEN RETURN NULL; END IF;
  RETURN result;
END;
$$;

DO $$
DECLARE original text; revised text;
BEGIN
  original:=pg_get_functiondef('public.create_barcode_batch_with_gst(uuid,text,date,text,jsonb,jsonb)'::regprocedure);
  revised:=replace(original,'p_purchase jsonb)','p_purchase jsonb DEFAULT NULL::jsonb)');
  revised:=replace(revised,'ordinal integer','row_ordinal integer');
  revised:=replace(revised,'ordinal:=0','row_ordinal:=0');
  revised:=replace(revised,'ordinal:=ordinal+1','row_ordinal:=row_ordinal+1');
  revised:=replace(revised,'SELECT id INTO variant_id FROM public.stock_registration_variants WHERE fabric_type_id=group_id AND ordinal=ordinal;',
    'SELECT v.id INTO variant_id FROM public.stock_registration_variants v WHERE v.fabric_type_id=group_id AND v.ordinal=row_ordinal;');
  -- Staff may leave actual invoice fields empty. Estimates remain separate and do not create ITC/cost evidence.
  revised:=replace(revised,'coalesce(actual_gst,tax)','coalesce(actual_gst,0)');
  IF revised=original OR revised LIKE '%AND ordinal=ordinal%' OR revised LIKE '%coalesce(actual_gst,tax)%' THEN
    RAISE EXCEPTION 'Expected purchase GST implementation not found';
  END IF;
  EXECUTE revised;
END; $$;

DO $$
DECLARE original text; revised text; old_block text; new_block text;
BEGIN
  original:=pg_get_functiondef('public.gst_snapshot_counter_bill(uuid,jsonb)'::regprocedure);
  revised:=replace(original,'description text; customer_gstin text;', 'description text; cut record; customer_gstin text;');
  old_block:=$old$      IF fabric_amount>0 THEN
        rule:=public.gst_rule_for(config.id,'fabric_sale','FABRIC:'||upper(item.item_name)); IF rule.id IS NULL THEN RAISE EXCEPTION 'Fabric GST rule required'; END IF;
        calc:=public.gst_calculate_amount(fabric_amount,rule.rate_bps,config.price_mode,supply);
        INSERT INTO public.gst_invoice_lines(invoice_id,source_item_id,component,display_group,description,classification_code,quantity,unit,entered_amount_paise,taxable_paise,rate_bps,cgst_paise,sgst_paise,igst_paise,gst_paise,final_paise)
        VALUES(invoice,item.id,'fabric_sale',item.id::text,item.item_name||' fabric',rule.classification_code,1,'job',fabric_amount,(calc->>'taxable_paise')::bigint,rule.rate_bps,(calc->>'cgst_paise')::bigint,(calc->>'sgst_paise')::bigint,(calc->>'igst_paise')::bigint,(calc->>'gst_paise')::bigint,(calc->>'final_paise')::bigint);
        taxable:=taxable+(calc->>'taxable_paise')::bigint; cgst:=cgst+(calc->>'cgst_paise')::bigint; sgst:=sgst+(calc->>'sgst_paise')::bigint; igst:=igst+(calc->>'igst_paise')::bigint; tax:=tax+(calc->>'gst_paise')::bigint; final_amount:=final_amount+(calc->>'final_paise')::bigint;
      END IF;$old$;
  new_block:=$new$      IF fabric_amount>0 THEN
        FOR cut IN
          SELECT line.value,line.ordinality,coalesce(group_row.name,fabric.name) fabric_name
          FROM public.counter_tailoring_sale_prices price
          CROSS JOIN LATERAL jsonb_array_elements(price.fabric_lines) WITH ORDINALITY line
          JOIN public.inventory_items inventory ON inventory.id=(line.value->>'inventory_item_id')::uuid
          JOIN public.thaans thaan ON thaan.id=inventory.thaan_id
          JOIN public.fabrics fabric ON fabric.id=thaan.fabric_id
          LEFT JOIN public.stock_registration_variants variant ON variant.thaan_id=thaan.id
          LEFT JOIN public.stock_registration_fabric_types group_row ON group_row.id=variant.fabric_type_id
          WHERE price.job_id=item.customer_tailoring_job_id
        LOOP
          rule:=public.gst_rule_for(config.id,'fabric_sale','FABRIC:'||upper(cut.fabric_name));
          IF rule.id IS NULL THEN RAISE EXCEPTION 'Fabric GST rule required'; END IF;
          entered:=(cut.value->>'amount_paise')::bigint;
          calc:=public.gst_calculate_amount(entered,rule.rate_bps,config.price_mode,supply);
          INSERT INTO public.gst_invoice_lines(invoice_id,source_item_id,component,source_cut_ordinal,display_group,description,classification_code,quantity,unit,entered_rate_paise,entered_amount_paise,taxable_paise,rate_bps,cgst_paise,sgst_paise,igst_paise,gst_paise,final_paise)
          VALUES(invoice,item.id,'fabric_sale',cut.ordinality,item.id::text,cut.fabric_name||' fabric',rule.classification_code,(cut.value->>'quantity')::numeric,'mm',(cut.value->>'sp_paise_per_m')::bigint,entered,(calc->>'taxable_paise')::bigint,rule.rate_bps,(calc->>'cgst_paise')::bigint,(calc->>'sgst_paise')::bigint,(calc->>'igst_paise')::bigint,(calc->>'gst_paise')::bigint,(calc->>'final_paise')::bigint);
          taxable:=taxable+(calc->>'taxable_paise')::bigint; cgst:=cgst+(calc->>'cgst_paise')::bigint; sgst:=sgst+(calc->>'sgst_paise')::bigint; igst:=igst+(calc->>'igst_paise')::bigint; tax:=tax+(calc->>'gst_paise')::bigint; final_amount:=final_amount+(calc->>'final_paise')::bigint;
        END LOOP;
      END IF;$new$;
  IF position(old_block IN revised)=0 THEN RAISE EXCEPTION 'Expected tailoring fabric tax block not found'; END IF;
  revised:=replace(revised,old_block,new_block);
  revised:=replace(revised,'ARRAY[''customer_gstin'',''payment_method'']','ARRAY[''customer_gstin'',''payment_method'',''configuration_id'']');
  revised:=replace(revised,'customer:=coalesce(order_row.customer_snapshot',
    'IF p_context ? ''configuration_id'' AND p_context->>''configuration_id'' IS DISTINCT FROM config.id::text THEN RAISE EXCEPTION ''GST configuration changed. Refresh the bill before completing it''; END IF;'||chr(10)||'  customer:=coalesce(order_row.customer_snapshot');
  EXECUTE revised;
END; $$;

DO $$
DECLARE original text; revised text;
BEGIN
  original:=pg_get_functiondef('public.complete_counter_bill_gst(uuid,jsonb,jsonb,boolean,bigint,uuid,text,text,jsonb)'::regprocedure);
  revised:=replace(original,'IF config.id IS NULL THEN',
    'IF config.id IS NULL THEN IF p_tax_context->>''configuration_id'' IS NOT NULL THEN RAISE EXCEPTION ''GST configuration changed. Refresh the bill before completing it''; END IF;');
  IF revised=original THEN RAISE EXCEPTION 'Expected GST completion configuration gate not found'; END IF;
  EXECUTE revised;
END; $$;

-- Report the immutable purchase mode and resulting non-creditable adjustment, rather than today's setting.
DO $$
DECLARE original text; revised text;
BEGIN
  original:=pg_get_functiondef('public.owner_gst_report(date,date,text,uuid)'::regprocedure);
  -- Invoice headers and lines both contain totals. Aggregate explicitly from the lines.
  original:=replace(original,'SELECT component category,classification_code,rate_bps,sum(taxable_paise)::text taxable_paise,sum(gst_paise)::text gst_paise',
    'SELECT l.component category,l.classification_code,l.rate_bps,sum(l.taxable_paise)::text taxable_paise,sum(l.gst_paise)::text gst_paise');
  revised:=replace(original,'''adjustments_paise'',coalesce(',
    '''inventory_cost_adjustment_paise'',coalesce((SELECT sum(p.inventory_cost_adjustment_paise) FROM public.gst_purchase_documents p WHERE p.recorded_at>=start_at AND p.recorded_at<end_at),0)::text,'||chr(10)||'      ''adjustments_paise'',coalesce(');
  revised:=replace(revised,'''itc_status'',p.itc_status,''calculated_taxable_paise''',
    '''itc_status'',p.itc_status,''purchase_mode'',p.purchase_mode,''inventory_cost_adjustment_paise'',p.inventory_cost_adjustment_paise::text,''calculated_taxable_paise''');
  IF revised=original THEN RAISE EXCEPTION 'Expected GST report fields not found'; END IF;
  EXECUTE revised;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
