-- Customers page fix (audit 29 Oct 2026).
-- The page counted bills and tailoring jobs from the retired legacy tables
-- (sales, tailoring_jobs), so every customer showed 0 bills and Rs 0.
-- Spend = completed counter bills (their total already includes tailoring lines;
-- the separate customer_tailoring orders are per-job copies and are not added).
BEGIN;

CREATE OR REPLACE FUNCTION public.owner_customer_activity()
RETURNS TABLE(customer_id uuid, bill_count integer, spend_paise bigint, last_bill_at timestamptz,
              tailoring_jobs integer, open_tailoring_jobs integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN RAISE EXCEPTION 'Owner access required'; END IF;
  RETURN QUERY
  SELECT c.id,
    coalesce(b.n, 0)::integer,
    coalesce(b.total, 0)::bigint,
    b.last_at,
    coalesce(j.n, 0)::integer,
    coalesce(j.open_n, 0)::integer
  FROM public.customers c
  LEFT JOIN (
    SELECT o.customer_id, count(*) n, sum(o.final_customer_price_paise) total, max(o.completed_at) last_at
    FROM public.orders o
    WHERE o.kind = 'counter_bill' AND o.status = 'completed' AND o.customer_id IS NOT NULL
    GROUP BY o.customer_id
  ) b ON b.customer_id = c.id
  LEFT JOIN (
    SELECT t.customer_id, count(*) n, count(*) FILTER (WHERE t.status NOT IN ('delivered', 'cancelled')) open_n
    FROM public.customer_tailoring_jobs t
    WHERE t.customer_id IS NOT NULL
    GROUP BY t.customer_id
  ) j ON j.customer_id = c.id;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_customer_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_customer_activity() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
