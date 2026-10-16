BEGIN;

CREATE TABLE public.customer_tailoring_finished_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES public.customer_tailoring_jobs(id),
  barcode_id uuid NOT NULL UNIQUE REFERENCES public.barcodes(id),
  request_id uuid NOT NULL UNIQUE,
  name text NOT NULL CHECK (btrim(name) <> '' AND length(btrim(name)) <= 120),
  size text NOT NULL CHECK (btrim(size) <> '' AND length(btrim(size)) <= 60),
  sp_paise bigint NOT NULL CHECK (sp_paise BETWEEN 1 AND 9007199254740991),
  workshop_location_id uuid NOT NULL REFERENCES public.locations(id),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'delivered')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.customer_tailoring_finished_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_tailoring_finished_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.customer_tailoring_finished_items TO authenticated;
GRANT ALL ON public.customer_tailoring_finished_items TO service_role;
CREATE POLICY customer_finished_item_read ON public.customer_tailoring_finished_items
FOR SELECT TO authenticated USING (
  public.has_any_role(auth.uid(), ARRAY['owner','counter'])
  OR EXISTS (
    SELECT 1 FROM public.customer_tailoring_jobs j
    WHERE j.id = job_id AND public.owns_tailor_assignment(j.tailor_assignment_id)
  )
);
CREATE TRIGGER customer_finished_item_immutable
BEFORE UPDATE OR DELETE ON public.customer_tailoring_finished_items
FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE OR REPLACE FUNCTION public.receive_customer_tailoring_finished_item(
  p_request uuid,
  p_job uuid,
  p_name text,
  p_size text,
  p_sp_paise bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  saved public.customer_tailoring_finished_items%rowtype;
  job public.customer_tailoring_jobs%rowtype;
  workshop uuid;
  barcode uuid;
  result public.customer_tailoring_finished_items%rowtype;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'owner')
    OR (public.has_role(auth.uid(), 'counter') AND public.has_perm(auth.uid(), 'pos.issue_to_tailoring'))
    OR public.has_perm(auth.uid(), 'production.receive')
  ) THEN RAISE EXCEPTION 'Workshop customer-stitching receipt permission required'; END IF;
  IF p_request IS NULL OR p_job IS NULL OR nullif(btrim(p_name), '') IS NULL
    OR nullif(btrim(p_size), '') IS NULL OR p_sp_paise IS NULL OR p_sp_paise <= 0
  THEN RAISE EXCEPTION 'Job, name, size, positive SP and request are required'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text, 17));
  SELECT * INTO saved FROM public.customer_tailoring_finished_items WHERE request_id = p_request;
  IF FOUND THEN
    IF (saved.job_id, saved.name, saved.size, saved.sp_paise)
      IS DISTINCT FROM (p_job, btrim(p_name), btrim(p_size), p_sp_paise)
    THEN RAISE EXCEPTION 'Receipt request reused with different data'; END IF;
    result := saved;
  ELSE
    SELECT * INTO job FROM public.customer_tailoring_jobs WHERE id = p_job FOR UPDATE;
    IF job.id IS NULL OR job.status NOT IN ('open','in_progress','ready')
    THEN RAISE EXCEPTION 'Active or ready customer tailoring job required'; END IF;
    SELECT * INTO result FROM public.customer_tailoring_finished_items WHERE job_id = p_job;
    IF result.id IS NOT NULL THEN RETURN public.customer_tailoring_finished_item(result.id::text); END IF;
    SELECT id INTO workshop FROM public.locations WHERE active AND kind = 'workshop' FOR UPDATE;
    IF workshop IS NULL THEN RAISE EXCEPTION 'Active Workshop required'; END IF;
    barcode := public.new_finished_piece_barcode();
    INSERT INTO public.customer_tailoring_finished_items(
      job_id, barcode_id, request_id, name, size, sp_paise, workshop_location_id, created_by
    ) VALUES (
      p_job, barcode, p_request, btrim(p_name), btrim(p_size), p_sp_paise, workshop, auth.uid()
    ) RETURNING * INTO result;
    UPDATE public.customer_tailoring_jobs SET status = 'ready' WHERE id = p_job;
    INSERT INTO public.erp_audit_records(actor_id, action, entity_table, entity_id, new_value, reference)
    VALUES (
      auth.uid(), 'receive_customer_tailoring_finished_item', 'customer_tailoring_finished_items', result.id,
      jsonb_build_object('job_id', p_job, 'name', result.name, 'size', result.size, 'sp_paise', result.sp_paise),
      'CUSTOMER-FINISHED:' || p_request::text
    );
  END IF;
  RETURN public.customer_tailoring_finished_item(result.id::text);
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_tailoring_finished_item(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','counter','tailor','production'])
  THEN RAISE EXCEPTION 'Customer tailoring access required'; END IF;
  RETURN (
    SELECT jsonb_build_object(
      'id', item.id, 'job_id', job.id, 'job_code', job.code,
      'bill_code', bill.code, 'barcode', barcode.code,
      'name', item.name, 'size', item.size, 'sp_paise', item.sp_paise::text,
      'customer', customer.name, 'design', details.design_name_snapshot,
      'status', item.status, 'received_at', item.created_at
    )
    FROM public.customer_tailoring_finished_items item
    JOIN public.customer_tailoring_jobs job ON job.id = item.job_id
    JOIN public.barcodes barcode ON barcode.id = item.barcode_id
    LEFT JOIN public.customers customer ON customer.id = job.customer_id
    LEFT JOIN public.counter_tailoring_details details ON details.job_id = job.id
    LEFT JOIN public.orders bill ON bill.id = details.bill_id
    WHERE item.id::text = btrim(p_code) OR barcode.code = btrim(p_code)
      OR job.id::text = btrim(p_code) OR job.code = btrim(p_code)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.receive_customer_tailoring_finished_item(uuid,uuid,text,text,bigint), public.customer_tailoring_finished_item(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_customer_tailoring_finished_item(uuid,uuid,text,text,bigint), public.customer_tailoring_finished_item(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
