BEGIN;
-- Read-only classification. A scan never receives stock until its existing workflow runs.
CREATE FUNCTION public.resolve_finished_receipt(p_code text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE value text:=btrim(p_code); production public.production_jobs; bill public.orders; job public.customer_tailoring_jobs;
  customer_allowed boolean; production_allowed boolean; jobs jsonb; matches integer;
BEGIN
  customer_allowed:=public.has_role(auth.uid(),'owner') OR
    (public.has_role(auth.uid(),'counter') AND public.has_perm(auth.uid(),'pos.issue_to_tailoring')) OR public.has_perm(auth.uid(),'production.receive');
  production_allowed:=public.has_role(auth.uid(),'owner') OR public.has_perm(auth.uid(),'production.receive') OR public.has_perm(auth.uid(),'stock.price_finished');
  IF NOT(customer_allowed OR production_allowed) THEN RAISE EXCEPTION 'Workshop receipt access required'; END IF;
  IF value IS NULL OR length(value) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Scan a customer bill, tailoring job or Production ID'; END IF;
  SELECT * INTO production FROM public.production_jobs WHERE code=value OR scan_code=value OR id::text=value;
  SELECT * INTO bill FROM public.orders WHERE kind='counter_bill' AND (code=value OR scan_code=value OR id::text=value);
  SELECT * INTO job FROM public.customer_tailoring_jobs WHERE code=value OR scan_code=value OR id::text=value;
  matches:=(production.id IS NOT NULL)::integer+(bill.id IS NOT NULL)::integer+(job.id IS NOT NULL)::integer;
  IF matches>1 THEN RAISE EXCEPTION 'This code matches multiple document types. Use its exact document ID'; END IF;
  IF production.id IS NOT NULL THEN
    IF NOT production_allowed THEN RAISE EXCEPTION 'Shop production receipt or pricing permission required'; END IF;
    RETURN jsonb_build_object('kind','production','id',production.id,'code',production.code,'status',production.status,
      'name',(SELECT name FROM public.products WHERE id=production.product_id));
  END IF;
  IF bill.id IS NULL AND job.id IS NULL THEN RAISE EXCEPTION 'No matching customer stitching or shop production document'; END IF;
  IF NOT customer_allowed THEN RAISE EXCEPTION 'Customer stitching receipt permission required'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',j.id,'code',j.code,'bill_code',o.code,'garment',j.garment,'status',j.status,
    'customer',c.name,'design',coalesce(d.design_name_snapshot,d.custom_design),'factory',factory.name,'tailor',tailor.real_name) ORDER BY j.created_at,j.id),'[]'::jsonb)
  INTO jobs FROM public.customer_tailoring_jobs j
    LEFT JOIN public.counter_tailoring_details d ON d.job_id=j.id
    LEFT JOIN public.orders o ON o.id=d.bill_id
    LEFT JOIN public.customers c ON c.id=j.customer_id
    JOIN public.tailor_assignments assignment ON assignment.id=j.tailor_assignment_id
    JOIN public.tailoring_factories factory ON factory.id=assignment.factory_id
    JOIN public.tailors tailor ON tailor.id=assignment.tailor_id
  WHERE (job.id IS NOT NULL AND j.id=job.id) OR (bill.id IS NOT NULL AND d.bill_id=bill.id);
  IF jsonb_array_length(jobs)=0 THEN RAISE EXCEPTION 'This customer bill has no stitching garments to receive'; END IF;
  RETURN jsonb_build_object('kind','customer','id',coalesce(bill.id,job.id),'code',coalesce(bill.code,job.code),'jobs',jobs);
END; $$;
REVOKE ALL ON FUNCTION public.resolve_finished_receipt(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_finished_receipt(text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
