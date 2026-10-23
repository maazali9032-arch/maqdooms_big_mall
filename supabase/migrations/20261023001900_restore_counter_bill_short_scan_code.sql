BEGIN;

-- The discount workflow redefined counter_bill without the document scan alias.
-- Keep the permanent internal order code for compatibility, but always return
-- and resolve the short B-prefixed customer-bill identity used on receipts.
CREATE OR REPLACE FUNCTION public.counter_bill(p_code text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','counter']) THEN
    RAISE EXCEPTION 'Counter billing access required';
  END IF;

  SELECT print.document
    || coalesce(revision.document, '{}'::jsonb)
    || jsonb_build_object(
      'scan_code', o.scan_code,
      'total_paise', o.final_customer_price_paise::text,
      'paid_amount_paise', coalesce(payment.collected, 0)::text,
      'balance_paise', (o.final_customer_price_paise - coalesce(payment.collected, 0))::text,
      'paid', coalesce(payment.collected, 0) >= o.final_customer_price_paise,
      'paid_at', payment.last_paid_at,
      'pos_code', terminal.code,
      'discount_edit_until', CASE
        WHEN o.completed_at + interval '1 hour' > clock_timestamp()
          THEN (o.completed_at + interval '1 hour')::text
        ELSE NULL
      END
    )
  INTO result
  FROM public.counter_bill_print_records print
  JOIN public.orders o ON o.id = print.bill_id
  LEFT JOIN public.counter_bill_terminal_records terminal_record ON terminal_record.bill_id = o.id
  LEFT JOIN public.pos_terminals terminal ON terminal.id = terminal_record.terminal_id
  LEFT JOIN LATERAL (
    SELECT document
    FROM public.counter_bill_discount_revisions d
    WHERE d.bill_id = o.id
    ORDER BY revision_no DESC
    LIMIT 1
  ) revision ON true
  LEFT JOIN LATERAL (
    SELECT sum(amount_paise) collected, max(paid_at) last_paid_at
    FROM public.counter_bill_payments
    WHERE bill_id = o.id
  ) payment ON true
  WHERE o.code = public.resolve_document_scan_code(btrim(p_code))
     OR o.id::text = btrim(p_code);

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.counter_bill(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.counter_bill(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;