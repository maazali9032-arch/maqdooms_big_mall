BEGIN;

-- Effective-dated, append-only GST configuration. No default row is seeded:
-- the Owner and CA must validate and explicitly activate a version.
CREATE TABLE public.gst_configuration_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT false,
  effective_from timestamptz NOT NULL,
  legal_name text NOT NULL CHECK (btrim(legal_name) <> ''),
  trading_name text NOT NULL CHECK (btrim(trading_name) <> ''),
  address text NOT NULL CHECK (btrim(address) <> ''),
  contact text NOT NULL CHECK (btrim(contact) <> ''),
  gstin text NOT NULL CHECK (gstin = '' OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$'),
  state_code text NOT NULL CHECK (state_code ~ '^[0-9]{2}$'),
  price_mode text NOT NULL CHECK (price_mode IN ('inclusive','exclusive')),
  invoice_display text NOT NULL CHECK (invoice_display IN ('final_first','taxable_first')),
  tailoring_display text NOT NULL CHECK (tailoring_display IN ('separate','combined')),
  purchase_mode text NOT NULL CHECK (purchase_mode IN ('track_itc','include_noncreditable')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT enabled OR gstin <> '')
);
CREATE INDEX gst_configuration_effective_idx ON public.gst_configuration_versions(effective_from DESC, created_at DESC);

CREATE TABLE public.gst_tax_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  configuration_id uuid NOT NULL REFERENCES public.gst_configuration_versions(id),
  category text NOT NULL CHECK (category IN ('purchase','fabric_sale','finished_sale','tailoring')),
  item_ref text,
  label text,
  classification_code text NOT NULL,
  rate_bps integer NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE NULLS NOT DISTINCT(configuration_id, category, item_ref)
);
CREATE INDEX gst_tax_rules_lookup_idx ON public.gst_tax_rules(configuration_id,category,item_ref);

CREATE TABLE public.gst_configuration_requests (
  request_id uuid PRIMARY KEY,
  payload jsonb NOT NULL,
  result_id uuid NOT NULL REFERENCES public.gst_configuration_versions(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.gst_invoice_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  configuration_id uuid NOT NULL REFERENCES public.gst_configuration_versions(id),
  invoice_number text NOT NULL,
  invoice_type text NOT NULL DEFAULT 'tax_invoice' CHECK (invoice_type IN ('tax_invoice','bill_of_supply','credit_note','debit_note')),
  supply_type text NOT NULL CHECK (supply_type IN ('intra_state','inter_state')),
  price_mode text NOT NULL CHECK (price_mode IN ('inclusive','exclusive')),
  invoice_display text NOT NULL CHECK (invoice_display IN ('final_first','taxable_first')),
  tailoring_display text NOT NULL CHECK (tailoring_display IN ('separate','combined')),
  business_snapshot jsonb NOT NULL,
  customer_snapshot jsonb NOT NULL,
  payment_method text,
  finalized boolean NOT NULL DEFAULT false,
  taxable_paise bigint NOT NULL CHECK (taxable_paise >= 0),
  cgst_paise bigint NOT NULL CHECK (cgst_paise >= 0),
  sgst_paise bigint NOT NULL CHECK (sgst_paise >= 0),
  igst_paise bigint NOT NULL CHECK (igst_paise >= 0),
  gst_paise bigint NOT NULL CHECK (gst_paise = cgst_paise + sgst_paise + igst_paise),
  discount_paise bigint NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  other_charge_paise bigint NOT NULL DEFAULT 0 CHECK (other_charge_paise >= 0),
  final_paise bigint NOT NULL CHECK (final_paise >= 0),
  recorded_by uuid NOT NULL REFERENCES public.profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX gst_invoice_date_idx ON public.gst_invoice_snapshots(recorded_at,configuration_id);

CREATE TABLE public.gst_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.gst_invoice_snapshots(id),
  source_item_id uuid NOT NULL REFERENCES public.order_items(id),
  component text NOT NULL CHECK (component IN ('fabric_sale','finished_sale','tailoring')),
  display_group text,
  description text NOT NULL,
  classification_code text NOT NULL,
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  entered_rate_paise bigint,
  entered_amount_paise bigint NOT NULL CHECK (entered_amount_paise >= 0),
  taxable_paise bigint NOT NULL CHECK (taxable_paise >= 0),
  rate_bps integer NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  cgst_paise bigint NOT NULL CHECK (cgst_paise >= 0),
  sgst_paise bigint NOT NULL CHECK (sgst_paise >= 0),
  igst_paise bigint NOT NULL CHECK (igst_paise >= 0),
  gst_paise bigint NOT NULL CHECK (gst_paise = cgst_paise + sgst_paise + igst_paise),
  final_paise bigint NOT NULL CHECK (final_paise >= 0),
  UNIQUE(invoice_id, source_item_id, component)
);
CREATE INDEX gst_invoice_lines_class_idx ON public.gst_invoice_lines(classification_code,rate_bps);

CREATE TABLE public.gst_purchase_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL UNIQUE REFERENCES public.receiving_batches(id),
  configuration_id uuid NOT NULL REFERENCES public.gst_configuration_versions(id),
  supplier_name text NOT NULL,
  supplier_gstin text,
  supplier_invoice_number text,
  supplier_invoice_date date,
  supply_type text NOT NULL CHECK (supply_type IN ('intra_state','inter_state')),
  purchase_mode text NOT NULL CHECK (purchase_mode IN ('track_itc','include_noncreditable')),
  itc_status text NOT NULL CHECK (itc_status IN ('eligible','ineligible','reversed','pending')),
  calculated_taxable_paise bigint NOT NULL CHECK (calculated_taxable_paise >= 0),
  calculated_gst_paise bigint NOT NULL CHECK (calculated_gst_paise >= 0),
  calculated_supplier_paise bigint NOT NULL CHECK (calculated_supplier_paise >= 0),
  actual_taxable_paise bigint CHECK (actual_taxable_paise >= 0),
  actual_gst_paise bigint CHECK (actual_gst_paise >= 0),
  actual_supplier_paise bigint CHECK (actual_supplier_paise >= 0),
  difference_paise bigint,
  eligible_itc_paise bigint NOT NULL DEFAULT 0 CHECK (eligible_itc_paise >= 0),
  ineligible_itc_paise bigint NOT NULL DEFAULT 0 CHECK (ineligible_itc_paise >= 0),
  reversed_itc_paise bigint NOT NULL DEFAULT 0 CHECK (reversed_itc_paise >= 0),
  inventory_cost_adjustment_paise bigint NOT NULL DEFAULT 0 CHECK (inventory_cost_adjustment_paise >= 0),
  finalized boolean NOT NULL DEFAULT false,
  recorded_by uuid NOT NULL REFERENCES public.profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX gst_purchase_date_idx ON public.gst_purchase_documents(recorded_at,configuration_id);

CREATE TABLE public.gst_purchase_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.gst_purchase_documents(id),
  variant_id uuid NOT NULL REFERENCES public.stock_registration_variants(id),
  description text NOT NULL,
  classification_code text NOT NULL,
  length_mm integer NOT NULL CHECK (length_mm > 0),
  base_cp_paise_per_m bigint NOT NULL CHECK (base_cp_paise_per_m >= 0),
  taxable_paise bigint NOT NULL CHECK (taxable_paise >= 0),
  rate_bps integer NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  cgst_paise bigint NOT NULL CHECK (cgst_paise >= 0),
  sgst_paise bigint NOT NULL CHECK (sgst_paise >= 0),
  igst_paise bigint NOT NULL CHECK (igst_paise >= 0),
  gst_paise bigint NOT NULL CHECK (gst_paise = cgst_paise + sgst_paise + igst_paise),
  supplier_paise bigint NOT NULL CHECK (supplier_paise >= 0),
  UNIQUE(purchase_id,variant_id)
);

CREATE TABLE public.gst_tax_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('output_increase','output_decrease','itc_reversal','itc_reclaim')),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  effective_date date NOT NULL,
  reference text NOT NULL CHECK (btrim(reference) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  recorded_by uuid NOT NULL REFERENCES public.profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'gst_configuration_versions','gst_tax_rules','gst_configuration_requests',
    'gst_invoice_lines',
    'gst_purchase_lines','gst_tax_adjustments'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',table_name);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',table_name);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',table_name);
    EXECUTE format('CREATE POLICY gst_owner_read ON public.%I FOR SELECT TO authenticated USING(public.has_role(auth.uid(),''owner''))',table_name);
    EXECUTE format('CREATE TRIGGER gst_history_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite()',table_name);
  END LOOP;
END $$;

CREATE FUNCTION public.reject_finalized_gst_document_rewrite()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.finalized OR NOT NEW.finalized THEN
    RAISE EXCEPTION 'GST document history is append-only';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER gst_invoice_snapshot_finalize BEFORE UPDATE OR DELETE ON public.gst_invoice_snapshots FOR EACH ROW EXECUTE FUNCTION public.reject_finalized_gst_document_rewrite();
CREATE TRIGGER gst_purchase_document_finalize BEFORE UPDATE OR DELETE ON public.gst_purchase_documents FOR EACH ROW EXECUTE FUNCTION public.reject_finalized_gst_document_rewrite();

ALTER TABLE public.gst_invoice_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gst_purchase_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gst_invoice_snapshots,public.gst_purchase_documents FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.gst_invoice_snapshots,public.gst_purchase_documents TO authenticated;
GRANT ALL ON public.gst_invoice_snapshots,public.gst_purchase_documents TO service_role;
CREATE POLICY gst_owner_read ON public.gst_invoice_snapshots FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE POLICY gst_owner_read ON public.gst_purchase_documents FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));

CREATE FUNCTION public.gst_active_configuration(p_at timestamptz DEFAULT clock_timestamp())
RETURNS public.gst_configuration_versions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT c FROM public.gst_configuration_versions c
  WHERE c.enabled AND c.effective_from <= p_at
  ORDER BY c.effective_from DESC,c.created_at DESC,c.id DESC LIMIT 1;
$$;

CREATE FUNCTION public.gst_rule_for(p_configuration uuid,p_category text,p_item_ref text DEFAULT NULL)
RETURNS public.gst_tax_rules
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT r FROM public.gst_tax_rules r
  WHERE r.configuration_id=p_configuration AND r.category=p_category
    AND (r.item_ref=p_item_ref OR r.item_ref IS NULL)
  ORDER BY (r.item_ref IS NOT NULL) DESC,r.id LIMIT 1;
$$;

CREATE FUNCTION public.gst_calculate_amount(p_entered bigint,p_rate_bps integer,p_mode text,p_supply_type text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE taxable bigint; tax bigint; final_amount bigint; cgst bigint:=0; sgst bigint:=0; igst bigint:=0;
BEGIN
  IF p_entered IS NULL OR p_entered<0 OR p_rate_bps NOT BETWEEN 0 AND 10000 OR p_mode NOT IN('inclusive','exclusive') OR p_supply_type NOT IN('intra_state','inter_state') THEN
    RAISE EXCEPTION 'Valid amount, GST rate, price mode and supply type required';
  END IF;
  IF p_mode='inclusive' THEN
    taxable:=round(p_entered::numeric*10000/(10000+p_rate_bps))::bigint;
    tax:=p_entered-taxable; final_amount:=p_entered;
  ELSE
    taxable:=p_entered;
    tax:=round(taxable::numeric*p_rate_bps/10000)::bigint;
    final_amount:=taxable+tax;
  END IF;
  IF p_supply_type='inter_state' THEN igst:=tax;
  ELSE cgst:=round(tax::numeric/2)::bigint; sgst:=tax-cgst; END IF;
  RETURN jsonb_build_object('entered_paise',p_entered::text,'taxable_paise',taxable::text,'gst_paise',tax::text,'cgst_paise',cgst::text,'sgst_paise',sgst::text,'igst_paise',igst::text,'final_paise',final_amount::text,'rate_bps',p_rate_bps,'mode',p_mode,'supply_type',p_supply_type);
END; $$;

CREATE FUNCTION public.gst_transaction_configuration()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE config public.gst_configuration_versions;
BEGIN
  IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry','counter','ecommerce_manager']) THEN RAISE EXCEPTION 'GST transaction access required'; END IF;
  IF public.has_role(auth.uid(),'owner') THEN
    SELECT * INTO config FROM public.gst_configuration_versions ORDER BY effective_from DESC,created_at DESC,id DESC LIMIT 1;
  ELSE config:=public.gst_active_configuration(); END IF;
  IF config.id IS NULL THEN RETURN jsonb_build_object('configuration',NULL,'rules','[]'::jsonb); END IF;
  RETURN jsonb_build_object(
    'configuration',jsonb_build_object('id',config.id,'enabled',config.enabled,'effective_from',config.effective_from,'legal_name',config.legal_name,'trading_name',config.trading_name,'address',config.address,'contact',config.contact,'gstin',config.gstin,'state_code',config.state_code,'price_mode',config.price_mode,'invoice_display',config.invoice_display,'tailoring_display',config.tailoring_display,'purchase_mode',config.purchase_mode),
    'rules',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'category',r.category,'item_ref',r.item_ref,'label',r.label,'classification_code',r.classification_code,'rate_bps',r.rate_bps) ORDER BY r.category,r.item_ref NULLS FIRST) FROM public.gst_tax_rules r WHERE r.configuration_id=config.id),'[]'::jsonb)
  );
END; $$;

CREATE FUNCTION public.owner_save_gst_configuration(p_request uuid,p_configuration jsonb,p_rules jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid; saved public.gst_configuration_requests%rowtype; payload jsonb; previous jsonb; rule jsonb; required_category text;
BEGIN
  IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
  IF p_request IS NULL OR jsonb_typeof(p_configuration) IS DISTINCT FROM 'object' OR jsonb_typeof(p_rules) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Configuration request and rules required'; END IF;
  IF (p_configuration-ARRAY['enabled','effective_from','legal_name','trading_name','address','contact','gstin','state_code','price_mode','invoice_display','tailoring_display','purchase_mode'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Unknown GST configuration field'; END IF;
  payload:=jsonb_build_object('configuration',p_configuration,'rules',p_rules);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,17));
  SELECT * INTO saved FROM public.gst_configuration_requests WHERE request_id=p_request;
  IF FOUND THEN IF saved.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'GST save retry requires identical data'; END IF; RETURN saved.result_id; END IF;
  IF coalesce((p_configuration->>'enabled')::boolean,false) AND coalesce(p_configuration->>'gstin','')='' THEN RAISE EXCEPTION 'GSTIN required before activation'; END IF;
  FOREACH required_category IN ARRAY ARRAY['purchase','fabric_sale','finished_sale','tailoring'] LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_rules) r WHERE r->>'category'=required_category AND nullif(btrim(r->>'item_ref'),'') IS NULL) THEN RAISE EXCEPTION 'Default % GST rule required',required_category; END IF;
  END LOOP;
  SELECT to_jsonb(c) INTO previous FROM public.gst_configuration_versions c ORDER BY c.effective_from DESC,c.created_at DESC,c.id DESC LIMIT 1;
  INSERT INTO public.gst_configuration_versions(enabled,effective_from,legal_name,trading_name,address,contact,gstin,state_code,price_mode,invoice_display,tailoring_display,purchase_mode,created_by)
  VALUES(coalesce((p_configuration->>'enabled')::boolean,false),(p_configuration->>'effective_from')::timestamptz,btrim(p_configuration->>'legal_name'),btrim(p_configuration->>'trading_name'),btrim(p_configuration->>'address'),btrim(p_configuration->>'contact'),upper(btrim(coalesce(p_configuration->>'gstin',''))),btrim(p_configuration->>'state_code'),p_configuration->>'price_mode',p_configuration->>'invoice_display',p_configuration->>'tailoring_display',p_configuration->>'purchase_mode',auth.uid()) RETURNING id INTO result;
  FOR rule IN SELECT value FROM jsonb_array_elements(p_rules) LOOP
    IF jsonb_typeof(rule) IS DISTINCT FROM 'object' OR (rule-ARRAY['category','item_ref','label','classification_code','rate_bps'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Unknown GST rule field'; END IF;
    INSERT INTO public.gst_tax_rules(configuration_id,category,item_ref,label,classification_code,rate_bps)
    VALUES(result,rule->>'category',nullif(btrim(rule->>'item_ref'),''),nullif(btrim(rule->>'label'),''),upper(btrim(rule->>'classification_code')),(rule->>'rate_bps')::integer);
  END LOOP;
  INSERT INTO public.gst_configuration_requests VALUES(p_request,payload,result,auth.uid(),clock_timestamp());
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference)
  VALUES(auth.uid(),'save_gst_configuration','gst_configuration_versions',result,previous,(SELECT to_jsonb(c) FROM public.gst_configuration_versions c WHERE c.id=result),'GST-CONFIG:'||p_request::text);
  RETURN result;
END; $$;

CREATE FUNCTION public.gst_snapshot_counter_bill(p_bill uuid,p_context jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE config public.gst_configuration_versions; invoice uuid; order_row public.orders%rowtype; item record; rule public.gst_tax_rules; calc jsonb; supply text; customer jsonb; taxable bigint:=0; cgst bigint:=0; sgst bigint:=0; igst bigint:=0; tax bigint:=0; final_amount bigint:=0; entered bigint; fabric_amount bigint; stitching_amount bigint; description text; item_ref text;
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

CREATE FUNCTION public.complete_counter_bill_gst(p_request uuid,p_items jsonb,p_tailoring jsonb,p_paid boolean,p_advance_paise bigint,p_salesperson uuid,p_name text,p_contact text,p_tax_context jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE bill uuid; total bigint; config public.gst_configuration_versions;
BEGIN
  config:=public.gst_active_configuration();
  IF config.id IS NULL THEN
    IF p_advance_paise IS NULL THEN RETURN public.complete_counter_bill_multi(p_request,p_items,p_tailoring,p_paid,p_salesperson,NULL,p_name,p_contact); END IF;
    RETURN public.complete_counter_bill_multi_with_advance(p_request,p_items,p_tailoring,p_advance_paise,p_salesperson,p_name,p_contact);
  END IF;
  bill:=public.complete_counter_bill_multi(p_request,p_items,p_tailoring,false,p_salesperson,NULL,p_name,p_contact);
  total:=public.gst_snapshot_counter_bill(bill,p_tax_context);
  IF p_advance_paise IS NOT NULL THEN
    IF p_advance_paise<0 OR p_advance_paise>total THEN RAISE EXCEPTION 'Advance cannot exceed GST-inclusive bill total'; END IF;
    IF p_advance_paise>0 THEN PERFORM public.record_counter_bill_payment(p_request,bill,p_advance_paise); END IF;
  ELSIF p_paid THEN PERFORM public.record_counter_bill_payment(p_request,bill,total); END IF;
  RETURN bill;
END; $$;

CREATE FUNCTION public.create_barcode_batch_with_gst(p_request uuid,p_provider text,p_arrival_date date,p_remarks text,p_fabrics jsonb,p_purchase jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE batch uuid; config public.gst_configuration_versions; purchase_id uuid; supply text; itc text; group_row jsonb; detail jsonb; group_id uuid; variant_id uuid; position integer:=0; ordinal integer; rule public.gst_tax_rules; calc jsonb; base bigint; taxable bigint:=0; tax bigint:=0; supplier_total bigint:=0; cgst bigint; sgst bigint; igst bigint; actual_taxable bigint; actual_gst bigint; actual_supplier bigint; eligible bigint:=0; ineligible bigint:=0; reversed bigint:=0; cost_adjustment bigint:=0;
BEGIN
  batch:=public.create_barcode_batch_with_details(p_request,p_provider,p_arrival_date,p_remarks,p_fabrics);
  config:=public.gst_active_configuration(); IF config.id IS NULL THEN RETURN batch; END IF;
  IF EXISTS(SELECT 1 FROM public.gst_purchase_documents WHERE batch_id=batch) THEN RETURN batch; END IF;
  IF jsonb_typeof(p_purchase) IS DISTINCT FROM 'object' OR (p_purchase-ARRAY['supplier_gstin','invoice_number','invoice_date','supply_type','itc_status','actual_taxable_paise','actual_gst_paise','actual_supplier_paise'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Valid purchase GST details required'; END IF;
  supply:=p_purchase->>'supply_type'; itc:=coalesce(nullif(p_purchase->>'itc_status',''),'pending');
  IF supply NOT IN('intra_state','inter_state') OR itc NOT IN('eligible','ineligible','reversed','pending') THEN RAISE EXCEPTION 'Valid purchase supply and ITC status required'; END IF;
  INSERT INTO public.gst_purchase_documents(batch_id,configuration_id,supplier_name,supplier_gstin,supplier_invoice_number,supplier_invoice_date,supply_type,purchase_mode,itc_status,calculated_taxable_paise,calculated_gst_paise,calculated_supplier_paise,recorded_by)
  VALUES(batch,config.id,btrim(p_provider),nullif(upper(btrim(p_purchase->>'supplier_gstin')),''),nullif(btrim(p_purchase->>'invoice_number'),''),nullif(p_purchase->>'invoice_date','')::date,supply,config.purchase_mode,itc,0,0,0,auth.uid()) RETURNING id INTO purchase_id;
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

CREATE FUNCTION public.owner_record_gst_adjustment(p_request uuid,p_kind text,p_amount_paise bigint,p_effective_date date,p_reference text,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
  IF p_kind NOT IN('output_increase','output_decrease','itc_reversal','itc_reclaim') OR p_amount_paise IS NULL OR p_amount_paise<=0 OR p_effective_date IS NULL OR nullif(btrim(p_reference),'') IS NULL OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Complete GST adjustment details required'; END IF;
  SELECT entity_id INTO result FROM public.erp_audit_records WHERE reference='GST-ADJUSTMENT:'||p_request::text AND action='record_gst_adjustment'; IF result IS NOT NULL THEN RETURN result; END IF;
  INSERT INTO public.gst_tax_adjustments(kind,amount_paise,effective_date,reference,reason,recorded_by) VALUES(p_kind,p_amount_paise,p_effective_date,btrim(p_reference),btrim(p_reason),auth.uid()) RETURNING id INTO result;
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'record_gst_adjustment','gst_tax_adjustments',result,jsonb_build_object('kind',p_kind,'amount_paise',p_amount_paise,'effective_date',p_effective_date,'business_reference',p_reference,'reason',p_reason),'GST-ADJUSTMENT:'||p_request::text);
  RETURN result;
END; $$;

CREATE FUNCTION public.owner_gst_report(p_from date,p_through date,p_category text DEFAULT NULL,p_location uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE start_at timestamptz; end_at timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
  IF p_from IS NULL OR p_through IS NULL OR p_through<p_from THEN RAISE EXCEPTION 'Valid GST report dates required'; END IF;
  start_at:=p_from::timestamp AT TIME ZONE 'Asia/Kolkata'; end_at:=(p_through+1)::timestamp AT TIME ZONE 'Asia/Kolkata';
  RETURN jsonb_build_object(
    'from',p_from,'through',p_through,'estimated_only',true,
    'summary',jsonb_build_object(
      'sales_taxable_paise',coalesce((SELECT sum(s.taxable_paise) FROM public.gst_invoice_snapshots s JOIN public.orders o ON o.id=s.order_id WHERE s.recorded_at>=start_at AND s.recorded_at<end_at AND (p_location IS NULL OR o.source_location_id=p_location)),0)::text,
      'output_gst_paise',coalesce((SELECT sum(s.gst_paise) FROM public.gst_invoice_snapshots s JOIN public.orders o ON o.id=s.order_id WHERE s.recorded_at>=start_at AND s.recorded_at<end_at AND (p_location IS NULL OR o.source_location_id=p_location)),0)::text,
      'cgst_paise',coalesce((SELECT sum(s.cgst_paise) FROM public.gst_invoice_snapshots s JOIN public.orders o ON o.id=s.order_id WHERE s.recorded_at>=start_at AND s.recorded_at<end_at AND (p_location IS NULL OR o.source_location_id=p_location)),0)::text,
      'sgst_paise',coalesce((SELECT sum(s.sgst_paise) FROM public.gst_invoice_snapshots s JOIN public.orders o ON o.id=s.order_id WHERE s.recorded_at>=start_at AND s.recorded_at<end_at AND (p_location IS NULL OR o.source_location_id=p_location)),0)::text,
      'igst_paise',coalesce((SELECT sum(s.igst_paise) FROM public.gst_invoice_snapshots s JOIN public.orders o ON o.id=s.order_id WHERE s.recorded_at>=start_at AND s.recorded_at<end_at AND (p_location IS NULL OR o.source_location_id=p_location)),0)::text,
      'purchase_taxable_paise',coalesce((SELECT sum(coalesce(p.actual_taxable_paise,p.calculated_taxable_paise)) FROM public.gst_purchase_documents p WHERE p.recorded_at>=start_at AND p.recorded_at<end_at),0)::text,
      'purchase_gst_paise',coalesce((SELECT sum(coalesce(p.actual_gst_paise,p.calculated_gst_paise)) FROM public.gst_purchase_documents p WHERE p.recorded_at>=start_at AND p.recorded_at<end_at),0)::text,
      'eligible_itc_paise',coalesce((SELECT sum(p.eligible_itc_paise) FROM public.gst_purchase_documents p WHERE p.recorded_at>=start_at AND p.recorded_at<end_at),0)::text,
      'ineligible_itc_paise',coalesce((SELECT sum(p.ineligible_itc_paise) FROM public.gst_purchase_documents p WHERE p.recorded_at>=start_at AND p.recorded_at<end_at),0)::text,
      'reversed_itc_paise',coalesce((SELECT sum(p.reversed_itc_paise) FROM public.gst_purchase_documents p WHERE p.recorded_at>=start_at AND p.recorded_at<end_at),0)::text,
      'adjustments_paise',coalesce((SELECT sum(CASE WHEN a.kind IN('output_increase','itc_reversal') THEN a.amount_paise ELSE -a.amount_paise END) FROM public.gst_tax_adjustments a WHERE a.effective_date BETWEEN p_from AND p_through),0)::text,
      'estimated_net_liability_paise',(coalesce((SELECT sum(s.gst_paise) FROM public.gst_invoice_snapshots s JOIN public.orders o ON o.id=s.order_id WHERE s.recorded_at>=start_at AND s.recorded_at<end_at AND (p_location IS NULL OR o.source_location_id=p_location)),0)-coalesce((SELECT sum(p.eligible_itc_paise) FROM public.gst_purchase_documents p WHERE p.recorded_at>=start_at AND p.recorded_at<end_at),0)+coalesce((SELECT sum(CASE WHEN a.kind IN('output_increase','itc_reversal') THEN a.amount_paise ELSE -a.amount_paise END) FROM public.gst_tax_adjustments a WHERE a.effective_date BETWEEN p_from AND p_through),0))::text
    ),
    'by_rate',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY category,rate_bps) FROM(SELECT component category,classification_code,rate_bps,sum(taxable_paise)::text taxable_paise,sum(gst_paise)::text gst_paise,count(DISTINCT invoice_id)::text documents FROM public.gst_invoice_lines l JOIN public.gst_invoice_snapshots s ON s.id=l.invoice_id WHERE s.recorded_at>=start_at AND s.recorded_at<end_at AND (p_category IS NULL OR l.component=p_category) GROUP BY component,classification_code,rate_bps UNION ALL SELECT 'purchase',classification_code,rate_bps,sum(taxable_paise)::text,sum(gst_paise)::text,count(DISTINCT purchase_id)::text FROM public.gst_purchase_lines l JOIN public.gst_purchase_documents p ON p.id=l.purchase_id WHERE p.recorded_at>=start_at AND p.recorded_at<end_at AND (p_category IS NULL OR p_category='purchase') GROUP BY classification_code,rate_bps)x),'[]'::jsonb),
    'invoices',coalesce((SELECT jsonb_agg(jsonb_build_object('invoice_number',s.invoice_number,'recorded_at',s.recorded_at,'customer',s.customer_snapshot,'supply_type',s.supply_type,'taxable_paise',s.taxable_paise::text,'gst_paise',s.gst_paise::text,'final_paise',s.final_paise::text,'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.gst_invoice_lines l WHERE l.invoice_id=s.id)) ORDER BY s.recorded_at DESC) FROM public.gst_invoice_snapshots s JOIN public.orders o ON o.id=s.order_id WHERE s.recorded_at>=start_at AND s.recorded_at<end_at AND (p_location IS NULL OR o.source_location_id=p_location)),'[]'::jsonb),
    'purchases',coalesce((SELECT jsonb_agg(jsonb_build_object('batch_id',p.batch_id,'supplier',p.supplier_name,'invoice_number',p.supplier_invoice_number,'recorded_at',p.recorded_at,'itc_status',p.itc_status,'calculated_taxable_paise',p.calculated_taxable_paise::text,'calculated_gst_paise',p.calculated_gst_paise::text,'actual_taxable_paise',p.actual_taxable_paise::text,'actual_gst_paise',p.actual_gst_paise::text,'difference_paise',p.difference_paise::text) ORDER BY p.recorded_at DESC) FROM public.gst_purchase_documents p WHERE p.recorded_at>=start_at AND p.recorded_at<end_at),'[]'::jsonb),
    'adjustments',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.effective_date DESC,a.recorded_at DESC) FROM public.gst_tax_adjustments a WHERE a.effective_date BETWEEN p_from AND p_through),'[]'::jsonb)
  );
END; $$;

CREATE FUNCTION public.gst_invoice_document(p_order uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
    'invoice_number',s.invoice_number,'invoice_type',s.invoice_type,'supply_type',s.supply_type,'price_mode',s.price_mode,'invoice_display',s.invoice_display,'tailoring_display',s.tailoring_display,'business',s.business_snapshot,'customer',s.customer_snapshot,'payment_method',s.payment_method,
    'taxable_paise',s.taxable_paise::text,'cgst_paise',s.cgst_paise::text,'sgst_paise',s.sgst_paise::text,'igst_paise',s.igst_paise::text,'gst_paise',s.gst_paise::text,'discount_paise',s.discount_paise::text,'other_charge_paise',s.other_charge_paise::text,'final_paise',s.final_paise::text,
    'lines',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'source_item_id',l.source_item_id,'component',l.component,'display_group',l.display_group,'description',l.description,'classification_code',l.classification_code,'quantity',l.quantity::text,'unit',l.unit,'entered_rate_paise',l.entered_rate_paise::text,'entered_amount_paise',l.entered_amount_paise::text,'taxable_paise',l.taxable_paise::text,'rate_bps',l.rate_bps,'cgst_paise',l.cgst_paise::text,'sgst_paise',l.sgst_paise::text,'igst_paise',l.igst_paise::text,'gst_paise',l.gst_paise::text,'final_paise',l.final_paise::text) ORDER BY l.id) FROM public.gst_invoice_lines l WHERE l.invoice_id=s.id),'[]'::jsonb)
  ) END FROM public.gst_invoice_snapshots s WHERE s.order_id=p_order;
$$;

CREATE OR REPLACE FUNCTION public.counter_bill(p_code text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Counter billing access required'; END IF;
 SELECT print.document || jsonb_build_object('total_paise',o.final_customer_price_paise::text,'paid_amount_paise',coalesce(payment.collected,0)::text,'balance_paise',(o.final_customer_price_paise-coalesce(payment.collected,0))::text,'paid',coalesce(payment.collected,0)>=o.final_customer_price_paise,'paid_at',payment.last_paid_at,'pos_code',terminal.code,'tax',public.gst_invoice_document(o.id))
 INTO result
 FROM public.counter_bill_print_records print JOIN public.orders o ON o.id=print.bill_id LEFT JOIN public.counter_bill_terminal_records terminal_record ON terminal_record.bill_id=o.id LEFT JOIN public.pos_terminals terminal ON terminal.id=terminal_record.terminal_id
 LEFT JOIN LATERAL(SELECT sum(amount_paise) collected,max(paid_at) last_paid_at FROM public.counter_bill_payments WHERE bill_id=o.id) payment ON true
 WHERE o.code=btrim(p_code) OR o.id::text=btrim(p_code);
 RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.gst_active_configuration(timestamptz),public.gst_rule_for(uuid,text,text),public.gst_transaction_configuration(),public.owner_save_gst_configuration(uuid,jsonb,jsonb),public.gst_snapshot_counter_bill(uuid,jsonb),public.complete_counter_bill_gst(uuid,jsonb,jsonb,boolean,bigint,uuid,text,text,jsonb),public.create_barcode_batch_with_gst(uuid,text,date,text,jsonb,jsonb),public.owner_record_gst_adjustment(uuid,text,bigint,date,text,text),public.owner_gst_report(date,date,text,uuid),public.gst_invoice_document(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.gst_calculate_amount(bigint,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gst_transaction_configuration(),public.owner_save_gst_configuration(uuid,jsonb,jsonb),public.complete_counter_bill_gst(uuid,jsonb,jsonb,boolean,bigint,uuid,text,text,jsonb),public.create_barcode_batch_with_gst(uuid,text,date,text,jsonb,jsonb),public.owner_record_gst_adjustment(uuid,text,bigint,date,text,text),public.owner_gst_report(date,date,text,uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
