-- Daily operations and monthly sales evidence. No reconstructed payments or costs.
CREATE TABLE public.sale_analysis_dimensions (
 order_item_id uuid PRIMARY KEY REFERENCES public.order_items(id),
 fabric_type text,vendor_id uuid,vendor_name text,product_name text,design_name text,size text,
 salesperson_name text,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.sale_analysis_dimensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_analysis_dimensions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sale_analysis_dimensions TO authenticated;
GRANT ALL ON public.sale_analysis_dimensions TO service_role;
CREATE POLICY owner_sale_dimensions ON public.sale_analysis_dimensions FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER sale_dimensions_immutable BEFORE UPDATE OR DELETE ON public.sale_analysis_dimensions FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

-- Channels are captured once at sale completion, rather than relabelled later.
CREATE TABLE public.sale_analysis_channels (
 order_id uuid PRIMARY KEY REFERENCES public.orders(id),
 channel text NOT NULL CHECK(channel IN('counter','ecommerce')),
 external_reference text UNIQUE,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.sale_analysis_channels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_analysis_channels FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sale_analysis_channels TO authenticated;
GRANT ALL ON public.sale_analysis_channels TO service_role;
CREATE POLICY owner_sale_channels ON public.sale_analysis_channels FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER sale_channel_immutable BEFORE UPDATE OR DELETE ON public.sale_analysis_channels FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE FUNCTION public.capture_sale_analysis_dimensions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status='completed' AND NEW.payment_confirmed_at IS NOT NULL AND NEW.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'completed' OR OLD.payment_confirmed_at IS NULL) THEN
  INSERT INTO public.sale_analysis_channels(order_id,channel) VALUES(NEW.id,CASE WHEN NEW.kind='ecommerce_sale' THEN 'ecommerce' ELSE 'counter' END) ON CONFLICT DO NOTHING;
  INSERT INTO public.sale_analysis_dimensions(order_item_id,fabric_type,vendor_id,vendor_name,product_name,design_name,size,salesperson_name)
  SELECT it.id,coalesce(g.name,f.name),batch.supplier_id,coalesce(rb.provider_name,supplier.name),product.name,coalesce(design.name,job.custom_design),job.size,person.full_name
  FROM public.order_items it LEFT JOIN public.fabric_stock fs ON fs.id=it.fabric_stock_id LEFT JOIN public.fabrics f ON f.id=fs.fabric_id
  LEFT JOIN public.receiving_batches batch ON batch.id=fs.batch_id LEFT JOIN public.suppliers supplier ON supplier.id=batch.supplier_id
  LEFT JOIN public.stock_registration_batches rb ON rb.batch_id=batch.id LEFT JOIN public.stock_registration_variants variant ON variant.thaan_id=it.thaan_id
  LEFT JOIN public.stock_registration_fabric_types g ON g.id=variant.fabric_type_id LEFT JOIN public.finished_products piece ON piece.id=it.finished_product_id
  LEFT JOIN public.products product ON product.id=piece.product_id LEFT JOIN public.designs design ON design.id=piece.design_id
  LEFT JOIN public.production_jobs job ON job.id=piece.production_job_id LEFT JOIN public.profiles person ON person.id=NEW.salesperson_user_id WHERE it.order_id=NEW.id ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER capture_completed_sale_analysis AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.capture_sale_analysis_dimensions();
REVOKE ALL ON FUNCTION public.capture_sale_analysis_dimensions() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.business_sale_facts(p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_location text DEFAULT NULL) RETURNS TABLE(row_key text,event_at timestamptz,data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT it.id::text,o.completed_at,jsonb_build_object(
 'id',it.id,'order_id',o.id,'code',o.code,'completed_at',o.completed_at,'status',o.status,'payment_confirmed_at',o.payment_confirmed_at,'kind',CASE WHEN it.fabric_stock_id IS NOT NULL THEN 'direct_fabric_sale' ELSE 'finished_product_sale' END,'channel',coalesce(channel.channel,'counter'),
 'channel_basis',CASE WHEN channel.order_id IS NULL THEN 'existing_counter_bill_workflow' ELSE 'recorded_at_sale' END,
 'source',loc.name,'source_id',loc.id,'salesperson_id',o.salesperson_user_id,'salesperson',coalesce(dim.salesperson_name,person.full_name),
 'customer_id',o.customer_id,'customer',o.customer_snapshot->>'name',
 'fabric',CASE WHEN it.fabric_stock_id IS NOT NULL THEN coalesce(dim.fabric_type,g.name,f.name) END,
 'vendor_id',CASE WHEN dim.order_item_id IS NOT NULL THEN dim.vendor_id ELSE batch.supplier_id END,'vendor',CASE WHEN dim.order_item_id IS NOT NULL THEN dim.vendor_name ELSE coalesce(rb.provider_name,supplier.name) END,
 'product',CASE WHEN it.finished_product_id IS NOT NULL THEN coalesce(dim.product_name,snap.item_snapshot->>'product',product.name) END,
 'design',coalesce(dim.design_name,snap.item_snapshot->>'design',design.name,job.custom_design),'size',coalesce(dim.size,job.size),
 'barcode',coalesce(snap.item_snapshot->>'barcode',variant.code,t.barcode,fb.code,pb.code),'batch',batch.code,
 'quantity',trunc(it.quantity)::text,'unit',it.unit,'revenue_paise',it.final_customer_price_paise::text,
 'cost_paise',CASE WHEN it.fabric_stock_id IS NOT NULL AND fi.cp_snapshot_paise IS NOT NULL THEN round(it.quantity*fi.cp_snapshot_paise/1000)::text WHEN it.finished_product_id IS NOT NULL THEN fi.production_cost_snapshot_paise::text END,
 'margin_paise',CASE WHEN it.fabric_stock_id IS NOT NULL AND fi.cp_snapshot_paise IS NOT NULL THEN (it.final_customer_price_paise-round(it.quantity*fi.cp_snapshot_paise/1000))::text WHEN it.finished_product_id IS NOT NULL AND fi.production_cost_snapshot_paise IS NOT NULL THEN (it.final_customer_price_paise-fi.production_cost_snapshot_paise)::text END,
 'cost_basis',CASE WHEN it.fabric_stock_id IS NOT NULL THEN 'sale_time_fabric_CP' ELSE 'sale_time_recorded_piece_CP' END,
 'dimension_basis',CASE WHEN dim.order_item_id IS NOT NULL THEN 'sale_time_snapshot' ELSE 'historical_bill_snapshot_or_current_catalogue' END,
 'item_evidence',to_jsonb(it),'financial_evidence',to_jsonb(fi),'finished_sale_evidence',to_jsonb(snap))
 FROM public.orders o JOIN public.order_items it ON it.order_id=o.id LEFT JOIN public.ecommerce_sale_sources actual_source ON actual_source.order_item_id=it.id JOIN public.locations loc ON loc.id=coalesce(actual_source.source_location_id,o.source_location_id)
 LEFT JOIN public.sale_analysis_channels channel ON channel.order_id=o.id LEFT JOIN public.sale_analysis_dimensions dim ON dim.order_item_id=it.id
 LEFT JOIN public.order_item_financials fi ON fi.order_item_id=it.id LEFT JOIN public.finished_product_sale_snapshots snap ON snap.order_item_id=it.id
 LEFT JOIN public.profiles person ON person.id=o.salesperson_user_id LEFT JOIN public.fabric_stock fs ON fs.id=it.fabric_stock_id LEFT JOIN public.fabrics f ON f.id=fs.fabric_id
 LEFT JOIN public.thaans t ON t.id=it.thaan_id LEFT JOIN public.barcodes fb ON fb.id=fs.barcode_id LEFT JOIN public.stock_registration_variants variant ON variant.thaan_id=t.id
 LEFT JOIN public.stock_registration_fabric_types g ON g.id=variant.fabric_type_id LEFT JOIN public.receiving_batches batch ON batch.id=fs.batch_id
 LEFT JOIN public.suppliers supplier ON supplier.id=batch.supplier_id LEFT JOIN public.stock_registration_batches rb ON rb.batch_id=batch.id
 LEFT JOIN public.finished_products piece ON piece.id=it.finished_product_id LEFT JOIN public.barcodes pb ON pb.id=piece.barcode_id
 LEFT JOIN public.products product ON product.id=piece.product_id LEFT JOIN public.designs design ON design.id=piece.design_id LEFT JOIN public.production_jobs job ON job.id=piece.production_job_id
 WHERE o.status='completed' AND o.payment_confirmed_at IS NOT NULL AND o.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale')
 AND (p_from IS NULL OR o.completed_at>=p_from) AND (p_to IS NULL OR o.completed_at<p_to) AND (nullif(p_location,'') IS NULL OR loc.name=p_location OR loc.id::text=p_location);
$$;
REVOKE ALL ON FUNCTION public.business_sale_facts(timestamptz,timestamptz,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.business_sales_summary(p_from timestamptz,p_to timestamptz,p_location text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH facts AS(SELECT data FROM public.business_sale_facts(p_from,p_to,p_location))
 SELECT jsonb_build_object('revenue_paise',coalesce(sum((data->>'revenue_paise')::numeric),0)::text,
 'bills',count(DISTINCT data->>'order_id'),'customers',count(DISTINCT data->>'customer_id'),
 'unidentified_customer_bills',count(DISTINCT data->>'order_id') FILTER(WHERE data->>'customer_id' IS NULL),
 'fabric_mm',trunc(coalesce(sum((data->>'quantity')::numeric) FILTER(WHERE data->>'kind'='direct_fabric_sale'),0))::text,
 'pieces',trunc(coalesce(sum((data->>'quantity')::numeric) FILTER(WHERE data->>'kind'='finished_product_sale'),0))::text,
 'fabric_revenue_paise',coalesce(sum((data->>'revenue_paise')::numeric) FILTER(WHERE data->>'kind'='direct_fabric_sale'),0)::text,
 'product_revenue_paise',coalesce(sum((data->>'revenue_paise')::numeric) FILTER(WHERE data->>'kind'='finished_product_sale'),0)::text,
 'known_margin_paise',coalesce(sum((data->>'margin_paise')::numeric),0)::text,
 'unknown_cost_lines',count(*) FILTER(WHERE data->>'cost_paise' IS NULL),'lines',count(*),
 'counter_paise',coalesce(sum((data->>'revenue_paise')::numeric) FILTER(WHERE data->>'channel'='counter'),0)::text,
 'ecommerce_paise',coalesce(sum((data->>'revenue_paise')::numeric) FILTER(WHERE data->>'channel'='ecommerce'),0)::text) FROM facts;
$$;
REVOKE ALL ON FUNCTION public.business_sales_summary(timestamptz,timestamptz,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.owner_daily_business(p_day date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE start_at timestamptz; end_at timestamptz; result jsonb;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_day IS NULL THEN RAISE EXCEPTION 'Operational day required'; END IF;
 start_at:=p_day::timestamp AT TIME ZONE 'Asia/Kolkata';end_at:=(p_day+1)::timestamp AT TIME ZONE 'Asia/Kolkata';
 result:=public.business_sales_summary(start_at,end_at);
 RETURN result||jsonb_build_object('day',p_day,
 'batches_registered',(SELECT count(*) FROM public.receiving_batches WHERE created_at>=start_at AND created_at<end_at),
 'thaans_registered',(SELECT count(*) FROM public.thaans WHERE created_at>=start_at AND created_at<end_at),
 'received_fabric_mm',(SELECT coalesce(sum(quantity),0)::text FROM public.inventory_movements WHERE kind='INWARD' AND thaan_id IS NOT NULL AND occurred_at>=start_at AND occurred_at<end_at),
 'transfers',(SELECT count(*) FROM public.stock_transfers WHERE status='posted' AND posted_at>=start_at AND posted_at<end_at),
 'production_issued',(SELECT count(*) FROM public.production_jobs WHERE created_at>=start_at AND created_at<end_at),
 'production_issued_mm',(SELECT coalesce(sum(l.quantity),0)::text FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id WHERE i.production_job_id IS NOT NULL AND l.thaan_id IS NOT NULL AND i.issued_at>=start_at AND i.issued_at<end_at),
 'production_finished',(SELECT count(DISTINCT job_id) FROM public.production_status_events WHERE status='completed' AND recorded_at>=start_at AND recorded_at<end_at),
 'finished_pieces_received',(SELECT count(*) FROM public.finished_product_receipt_pieces p JOIN public.finished_product_receipts r ON r.request_id=p.request_id WHERE r.recorded_at>=start_at AND r.recorded_at<end_at),
 'tailoring_jobs',(SELECT count(*) FROM public.customer_tailoring_jobs WHERE created_at>=start_at AND created_at<end_at),
 'tailoring_booked_paise',(SELECT coalesce(sum(final_customer_price_paise),0)::text FROM public.orders WHERE kind='customer_tailoring' AND status='completed' AND created_at>=start_at AND created_at<end_at));
END; $$;
REVOKE ALL ON FUNCTION public.owner_daily_business(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_daily_business(date) TO authenticated;

CREATE FUNCTION public.owner_monthly_business(p_from timestamptz,p_to timestamptz,p_previous_from timestamptz,p_previous_to timestamptz,p_location text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; ranks jsonb; series jsonb;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_previous_from IS NULL OR p_previous_to IS NULL OR p_from>=p_to OR p_previous_from>=p_previous_to OR p_previous_to>p_from THEN RAISE EXCEPTION 'Valid current and preceding periods required'; END IF;
 WITH facts AS(SELECT data FROM public.business_sale_facts(p_from,p_to,p_location)), dimensions AS(
 SELECT dimension,identity,name,context,data FROM facts CROSS JOIN LATERAL(VALUES
 ('fabric_vendor',coalesce(data->>'fabric','not_recorded')||':'||coalesce(data->>'vendor_id',data->>'vendor','not_recorded'),coalesce(data->>'fabric','Fabric not recorded'),coalesce(data->>'vendor','Vendor not recorded')),
 ('vendor',coalesce(data->>'vendor_id',data->>'vendor','not_recorded'),coalesce(data->>'vendor','Vendor not recorded'),NULL),
 ('product',coalesce(data->>'product','not_recorded'),coalesce(data->>'product','Product not recorded'),NULL),
 ('salesperson',coalesce(data->>'salesperson_id','not_recorded'),coalesce(data->>'salesperson','Unassigned / not recorded'),NULL),
 ('channel',data->>'channel',data->>'channel',NULL)) d(dimension,identity,name,context)
 WHERE (dimension NOT IN('fabric_vendor','vendor') OR data->>'kind'='direct_fabric_sale') AND (dimension<>'product' OR data->>'kind'='finished_product_sale')
 ), grouped AS(SELECT dimension,identity,max(name) name,max(context) context,
 sum((data->>'revenue_paise')::numeric)::text revenue_paise,sum((data->>'margin_paise')::numeric)::text known_margin_paise,
 count(*) FILTER(WHERE data->>'cost_paise' IS NULL) unknown_cost_lines,count(*) lines,count(DISTINCT data->>'order_id') bills,
 count(DISTINCT data->>'customer_id') customers,count(DISTINCT data->>'order_id') FILTER(WHERE data->>'customer_id' IS NULL) unidentified_customer_bills,
 trunc(coalesce(sum((data->>'quantity')::numeric) FILTER(WHERE data->>'kind'='direct_fabric_sale'),0))::text fabric_mm,
 trunc(coalesce(sum((data->>'quantity')::numeric) FILTER(WHERE data->>'kind'='finished_product_sale'),0))::text pieces
 FROM dimensions GROUP BY dimension,identity)
 SELECT coalesce(jsonb_agg(to_jsonb(grouped) ORDER BY dimension,(revenue_paise)::numeric DESC,identity),'[]'::jsonb) INTO ranks FROM grouped;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY day),'[]'::jsonb) INTO series FROM(
 SELECT (event_at AT TIME ZONE 'Asia/Kolkata')::date AS day,sum((data->>'revenue_paise')::numeric)::text revenue_paise,count(DISTINCT data->>'order_id') bills FROM public.business_sale_facts(p_from,p_to,p_location) GROUP BY 1)t;
 RETURN jsonb_build_object('current',public.business_sales_summary(p_from,p_to,p_location),'previous',public.business_sales_summary(p_previous_from,p_previous_to,p_location),'rankings',ranks,'daily_sales',series,'from',p_from,'to_exclusive',p_to,'previous_from',p_previous_from,'previous_to_exclusive',p_previous_to,'cost_basis','Captured sale-time CP only; unknown costs excluded from recorded margin','historical_name_basis','Older rows use bill snapshots or current catalogue names; new sales retain name snapshots');
END; $$;
REVOKE ALL ON FUNCTION public.owner_monthly_business(timestamptz,timestamptz,timestamptz,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_monthly_business(timestamptz,timestamptz,timestamptz,timestamptz,text) TO authenticated;
