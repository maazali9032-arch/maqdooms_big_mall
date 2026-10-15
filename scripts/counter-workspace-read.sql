CREATE TABLE public.counter_bill_print_records (
 bill_id uuid PRIMARY KEY REFERENCES public.counter_bills(order_id),document jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.counter_bill_print_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.counter_bill_print_records FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.counter_bill_print_records TO authenticated;
GRANT ALL ON public.counter_bill_print_records TO service_role;
CREATE POLICY counter_print_read ON public.counter_bill_print_records FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','counter']));
CREATE TRIGGER counter_print_immutable BEFORE UPDATE OR DELETE ON public.counter_bill_print_records FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE FUNCTION public.capture_counter_print_record(p_bill uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 INSERT INTO public.counter_bill_print_records(bill_id,document)
 SELECT o.id,jsonb_build_object('id',o.id,'code',o.code,'created_at',o.completed_at,'total_paise',o.final_customer_price_paise::text,'customer',o.customer_snapshot,'source',loc.name,'salesperson',person.full_name,
 'lines',(SELECT jsonb_agg(jsonb_build_object('id',it.id,'kind',CASE WHEN it.customer_tailoring_job_id IS NOT NULL THEN 'tailoring' WHEN it.thaan_id IS NOT NULL THEN 'fabric' ELSE 'product' END,
 'barcode',coalesce(v.code,t.barcode,fb.code,pb.code),'name',coalesce(g.name,f.name,product.name,job.garment),'size',context->>'size','design',coalesce(context->>'design',detail.design_name_snapshot),
 'quantity',it.quantity::text,'unit',it.unit,'price_paise',it.sp_snapshot_paise::text,'amount_paise',it.final_customer_price_paise::text,'job_id',job.id,'job_code',job.code,'delivery_date',detail.delivery_date,
 'fabrics',(SELECT jsonb_agg(jsonb_build_object('barcode',coalesce(rv.code,tt.barcode,bc.code),'name',ff.name,'quantity_mm',cut->>'quantity')) FROM public.counter_tailoring_prices quote CROSS JOIN LATERAL jsonb_array_elements(quote.cuts) cut JOIN public.thaans tt ON tt.id=(cut->>'thaan_id')::uuid JOIN public.fabric_stock s ON s.id=tt.fabric_stock_id JOIN public.fabrics ff ON ff.id=tt.fabric_id LEFT JOIN public.stock_registration_variants rv ON rv.thaan_id=tt.id LEFT JOIN public.barcodes bc ON bc.id=s.barcode_id WHERE quote.job_id=job.id)) ORDER BY it.id)
 FROM public.order_items it LEFT JOIN public.thaans t ON t.id=it.thaan_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id LEFT JOIN public.fabric_stock fs ON fs.id=it.fabric_stock_id LEFT JOIN public.barcodes fb ON fb.id=fs.barcode_id LEFT JOIN public.fabrics f ON f.id=t.fabric_id LEFT JOIN public.finished_products piece ON piece.id=it.finished_product_id LEFT JOIN public.products product ON product.id=piece.product_id LEFT JOIN public.barcodes pb ON pb.id=piece.barcode_id LEFT JOIN LATERAL public.production_piece_context(piece.id) context ON piece.id IS NOT NULL LEFT JOIN public.customer_tailoring_jobs job ON job.id=it.customer_tailoring_job_id LEFT JOIN public.counter_tailoring_details detail ON detail.job_id=job.id WHERE it.order_id=o.id))
 FROM public.orders o JOIN public.locations loc ON loc.id=o.source_location_id LEFT JOIN public.profiles person ON person.id=o.salesperson_user_id WHERE o.id=p_bill;
$$;
REVOKE ALL ON FUNCTION public.capture_counter_print_record(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.counter_bill(p_code text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Counter billing access required'; END IF;
 SELECT print.document||jsonb_build_object('paid',payment.bill_id IS NOT NULL,'paid_at',payment.paid_at) INTO result FROM public.counter_bill_print_records print JOIN public.orders o ON o.id=print.bill_id LEFT JOIN public.counter_bill_payments payment ON payment.bill_id=o.id WHERE o.code=btrim(p_code) OR o.id::text=btrim(p_code);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.counter_bill(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.counter_bill(text) TO authenticated;

CREATE FUNCTION public.counter_scan_barcode(p_barcode text,p_source uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE data jsonb;piece public.finished_products%rowtype;variants jsonb;exact jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Counter access required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=p_source AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom'))) THEN RAISE EXCEPTION 'Select an active Showroom floor'; END IF;
 SELECT p.* INTO piece FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id WHERE b.code=btrim(p_barcode);
 IF FOUND THEN
  data:=public.finished_product_sale_scan(btrim(p_barcode));
  RETURN jsonb_build_object('kind','product','id',piece.id,'barcode',p_barcode,'name',data->>'product','design',public.production_piece_context(piece.id)->>'design','size',public.production_piece_context(piece.id)->>'size','sp_paise',data->'sp_paise','sp_version_id',data->>'sp_version_id','available',piece.status='available' AND piece.current_location_id=p_source AND coalesce((SELECT public.inventory_balance(i.id,p_source) FROM public.inventory_items i WHERE i.finished_product_id=piece.id),0)=1);
 END IF;
 variants:=public.pos_reserve_variants(btrim(p_barcode));
 SELECT value INTO exact FROM jsonb_array_elements(variants) WHERE value->>'barcode'=btrim(p_barcode) LIMIT 1;
 IF exact IS NULL THEN SELECT value INTO exact FROM jsonb_array_elements(public.direct_fabric_sale_catalog(btrim(p_barcode))) LIMIT 1;END IF;
 IF exact IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('kind','fabric','barcode',exact->>'barcode','name',exact->>'fabric_name','batch',exact->>'batch_code','cuts',exact->'cuts','variants',variants);
END; $$;
REVOKE ALL ON FUNCTION public.counter_scan_barcode(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.counter_scan_barcode(text,uuid) TO authenticated;

CREATE FUNCTION public.customer_tailoring_work(p_code text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE owner boolean:=public.has_role(auth.uid(),'owner');counter boolean:=public.has_role(auth.uid(),'counter');
BEGIN
 IF NOT owner AND NOT counter AND NOT (public.has_role(auth.uid(),'tailor') AND public.has_perm(auth.uid(),'tailoring.manage_jobs')) THEN RAISE EXCEPTION 'Customer Tailoring access required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',j.id,'code',j.code,'bill_id',d.bill_id,'bill_code',o.code,'garment',j.garment,'status',j.status,'delivery_date',d.delivery_date,'customer',c.name,'contact',c.phone,'factory',f.name,'tailor',t.real_name,'paid',CASE WHEN d.bill_id IS NOT NULL THEN EXISTS(SELECT 1 FROM public.counter_bill_payments WHERE bill_id=d.bill_id) END,
 'total_paise',CASE WHEN owner OR counter THEN price.final_customer_price_paise::text END,
 'cp_paise',CASE WHEN public.can_view_thaan_cp(NULL) AND price.fabric_cp_total_paise IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.material_issue_lines line JOIN public.material_issues issue ON issue.id=line.material_issue_id LEFT JOIN public.customer_issue_fabric_costs cost ON cost.issue_line_id=line.id WHERE issue.customer_tailoring_job_id=j.id AND issue.issue_type='additional' AND line.thaan_id IS NOT NULL AND cost.issue_line_id IS NULL) THEN (price.fabric_cp_total_paise+coalesce((SELECT sum(cost.amount_paise) FROM public.customer_issue_fabric_costs cost JOIN public.material_issue_lines line ON line.id=cost.issue_line_id JOIN public.material_issues issue ON issue.id=line.material_issue_id WHERE issue.customer_tailoring_job_id=j.id AND issue.issue_type='additional'),0))::text END)
 ORDER BY j.created_at DESC,j.id) FROM public.customer_tailoring_jobs j LEFT JOIN public.customers c ON c.id=j.customer_id JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id JOIN public.tailors t ON t.id=a.tailor_id LEFT JOIN public.counter_tailoring_details d ON d.job_id=j.id LEFT JOIN public.orders o ON o.id=d.bill_id LEFT JOIN public.counter_tailoring_prices price ON price.job_id=j.id
 WHERE (owner OR counter OR public.owns_tailor_assignment(j.tailor_assignment_id)) AND (nullif(btrim(p_code),'') IS NULL OR j.code=btrim(p_code) OR j.id::text=btrim(p_code) OR o.code=btrim(p_code) OR o.id::text=btrim(p_code))),'[]');
END; $$;
REVOKE ALL ON FUNCTION public.customer_tailoring_work(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.customer_tailoring_work(text) TO authenticated;

CREATE FUNCTION public.issue_additional_customer_fabric(p_request uuid,p_job uuid,p_source uuid,p_barcode text,p_quantity integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE stock jsonb;inv uuid;result uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.issue_to_tailoring') THEN RAISE EXCEPTION 'Counter fabric issue permission required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=p_source AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom'))) THEN RAISE EXCEPTION 'Active Showroom floor required'; END IF;
 SELECT value INTO stock FROM jsonb_array_elements(public.pos_reserve_variants(p_barcode)) WHERE value->>'barcode'=btrim(p_barcode) LIMIT 1;
  IF (SELECT count(*) FROM jsonb_array_elements(stock->'cuts') cut WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(cut->'locations') loc WHERE loc->>'id'=p_source::text AND (loc->>'quantity_mm')::numeric>0))<>1 THEN RAISE EXCEPTION 'Scan a unique physical Thaan barcode'; END IF;
  SELECT (cut->>'inventory_item_id')::uuid INTO inv FROM jsonb_array_elements(stock->'cuts') cut WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(cut->'locations') loc WHERE loc->>'id'=p_source::text AND (loc->>'quantity_mm')::numeric>0) LIMIT 1;
 IF inv IS NULL OR p_quantity IS NULL OR p_quantity<=0 THEN RAISE EXCEPTION 'Available scanned Thaan and positive metres required'; END IF;
 result:=public.post_material_issue(p_request,'customer_tailoring',p_job,p_source,'additional',jsonb_build_array(jsonb_build_object('inventory_item_id',inv,'quantity',p_quantity)),'Additional customer fabric; original customer total unchanged');
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.issue_additional_customer_fabric(uuid,uuid,uuid,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_additional_customer_fabric(uuid,uuid,uuid,text,integer) TO authenticated;

CREATE FUNCTION public.tailoring_work_catalog() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') AND NOT(public.has_role(auth.uid(),'counter') AND public.has_perm(auth.uid(),'pos.issue_to_tailoring')) AND NOT(public.has_role(auth.uid(),'production') AND public.has_perm(auth.uid(),'production.view')) THEN RAISE EXCEPTION 'Tailoring or production work access required'; END IF;
 RETURN jsonb_build_object('products',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name) ORDER BY name,id) FROM public.products WHERE active),'[]'), 'designs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name) ORDER BY code,id) FROM public.designs WHERE active),'[]'));
END; $$;
REVOKE ALL ON FUNCTION public.tailoring_work_catalog() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tailoring_work_catalog() TO authenticated;

-- The Owner-approved margin follows all recorded fabric issued to this job.
-- Missing old issue-time costs stay unknown; today's catalogue CP is never substituted.
CREATE FUNCTION public.customer_job_fabric_cp(p_job uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN original.cp IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id LEFT JOIN public.customer_issue_fabric_costs c ON c.issue_line_id=l.id WHERE i.customer_tailoring_job_id=p_job AND i.issue_type='additional' AND l.thaan_id IS NOT NULL AND c.issue_line_id IS NULL)
 THEN original.cp+coalesce((SELECT sum(c.amount_paise)::bigint FROM public.customer_issue_fabric_costs c JOIN public.material_issue_lines l ON l.id=c.issue_line_id JOIN public.material_issues i ON i.id=l.material_issue_id WHERE i.customer_tailoring_job_id=p_job AND i.issue_type='additional'),0) END
 FROM(SELECT coalesce((SELECT fabric_cp_total_paise FROM public.counter_tailoring_prices WHERE job_id=p_job),(SELECT q.fabric_cp_total_paise FROM public.customer_tailoring_jobs j JOIN public.customer_tailoring_quotes q ON q.id=j.quote_id WHERE j.id=p_job)) cp) original;
$$;
REVOKE ALL ON FUNCTION public.customer_job_fabric_cp(uuid) FROM PUBLIC,anon,authenticated;
