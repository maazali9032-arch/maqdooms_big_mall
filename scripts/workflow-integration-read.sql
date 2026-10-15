CREATE OR REPLACE FUNCTION public.customer_tailoring_work(p_code text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE owner boolean:=public.has_role(auth.uid(),'owner');counter boolean:=public.has_role(auth.uid(),'counter');
BEGIN
 IF NOT owner AND NOT counter AND NOT (public.has_role(auth.uid(),'tailor') AND public.has_perm(auth.uid(),'tailoring.manage_jobs')) THEN RAISE EXCEPTION 'Customer Tailoring access required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',j.id,'code',j.code,'bill_id',d.bill_id,'bill_code',o.code,'garment',j.garment,'status',j.status,'created_at',j.created_at,'created_by',j.created_by,'creator',person.full_name,'delivery_date',d.delivery_date,'design',d.design_name_snapshot,'customer',c.name,'contact',c.phone,'factory',f.name,'tailor',t.real_name,'notes',j.notes,'source',loc.name,
 'paid',CASE WHEN d.bill_id IS NOT NULL THEN EXISTS(SELECT 1 FROM public.counter_bill_payments WHERE bill_id=d.bill_id) END,
 'total_paise',CASE WHEN owner OR counter THEN coalesce(price.final_customer_price_paise,old_price.final_customer_price_paise)::text END,
 'cp_paise',CASE WHEN owner THEN public.customer_job_fabric_cp(j.id)::text END,
 'fabrics',coalesce((SELECT jsonb_agg(jsonb_build_object('barcode',coalesce(v.code,th.barcode,b.code),'name',fab.name,'quantity_mm',line.quantity::text,'source',source.name,'issue_type',issue.issue_type,'issued_at',issue.issued_at,'issued_by',actor.full_name,'issue',issue.code) ORDER BY issue.issued_at,line.id) FROM public.material_issue_lines line JOIN public.material_issues issue ON issue.id=line.material_issue_id JOIN public.thaans th ON th.id=line.thaan_id JOIN public.fabrics fab ON fab.id=th.fabric_id JOIN public.fabric_stock stock ON stock.id=th.fabric_stock_id LEFT JOIN public.barcodes b ON b.id=stock.barcode_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=th.id JOIN public.locations source ON source.id=issue.source_location_id LEFT JOIN public.profiles actor ON actor.id=issue.issued_by WHERE issue.customer_tailoring_job_id=j.id),'[]'))
 ORDER BY j.created_at DESC,j.id) FROM public.customer_tailoring_jobs j LEFT JOIN public.customers c ON c.id=j.customer_id JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id JOIN public.tailors t ON t.id=a.tailor_id LEFT JOIN LATERAL(SELECT source_location_id FROM public.material_issues WHERE customer_tailoring_job_id=j.id ORDER BY issued_at,id LIMIT 1) initial_source ON true LEFT JOIN public.locations loc ON loc.id=initial_source.source_location_id LEFT JOIN public.profiles person ON person.id=j.created_by LEFT JOIN public.counter_tailoring_details d ON d.job_id=j.id LEFT JOIN public.orders o ON o.id=d.bill_id LEFT JOIN public.counter_tailoring_prices price ON price.job_id=j.id LEFT JOIN LATERAL(SELECT * FROM public.customer_tailoring_prices WHERE job_id=j.id ORDER BY revision DESC LIMIT 1) old_price ON true
 WHERE (owner OR counter OR public.owns_tailor_assignment(j.tailor_assignment_id)) AND (nullif(btrim(p_code),'') IS NULL OR j.code=btrim(p_code) OR j.id::text=btrim(p_code) OR o.code=btrim(p_code) OR o.id::text=btrim(p_code))),'[]');
END; $$;

-- Active work must not disappear behind the historical feed's latest-100 limit.
CREATE FUNCTION public.ongoing_production_work() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT(public.has_perm(auth.uid(),'production.view') OR public.has_role(auth.uid(),'tailor')) THEN RAISE EXCEPTION 'Production work access required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(public.production_job_document(j.id::text) ORDER BY j.created_at DESC,j.id) FROM public.production_jobs j WHERE j.status IN('open','in_progress') AND (public.has_perm(auth.uid(),'production.view') OR public.owns_production_job(j.id))),'[]');
END; $$;
REVOKE ALL ON FUNCTION public.ongoing_production_work() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ongoing_production_work() TO authenticated;
