BEGIN;

-- A factory-facing document intentionally contains operational instructions
-- only. Customer pricing, CP, advance and balance are not exposed here.
CREATE FUNCTION public.tailor_work_order(p_bill text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','tailor']) THEN RAISE EXCEPTION 'Tailoring access required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
   'job_code',job.code,'garment',job.garment,'delivery_date',detail.delivery_date,
   'design',coalesce(detail.design_name_snapshot,detail.custom_design),'notes',job.notes,
   'factory',factory.name,'tailor',tailor.real_name,
   'fabrics',coalesce((SELECT jsonb_agg(jsonb_build_object('barcode',coalesce(v.code,th.barcode,barcode.code),'name',fabric.name,'quantity_mm',line.quantity::text) ORDER BY line.id)
     FROM public.material_issues issue JOIN public.material_issue_lines line ON line.material_issue_id=issue.id
     JOIN public.thaans th ON th.id=line.thaan_id JOIN public.fabrics fabric ON fabric.id=th.fabric_id
     LEFT JOIN public.stock_registration_variants v ON v.thaan_id=th.id LEFT JOIN public.fabric_stock stock ON stock.id=th.fabric_stock_id LEFT JOIN public.barcodes barcode ON barcode.id=stock.barcode_id
     WHERE issue.customer_tailoring_job_id=job.id),'[]'::jsonb)
 ))
 FROM public.orders bill JOIN public.order_items item ON item.order_id=bill.id
 JOIN public.customer_tailoring_jobs job ON job.id=item.customer_tailoring_job_id
 JOIN public.counter_tailoring_details detail ON detail.job_id=job.id
 JOIN public.tailor_assignments assignment ON assignment.id=job.tailor_assignment_id
 JOIN public.tailoring_factories factory ON factory.id=assignment.factory_id
 JOIN public.tailors tailor ON tailor.id=assignment.tailor_id
 WHERE bill.kind='counter_bill' AND (bill.code=btrim(p_bill) OR bill.id::text=btrim(p_bill))),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.tailor_work_order(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tailor_work_order(text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
