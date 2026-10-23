BEGIN;

-- `document` is both a PL/pgSQL variable and a receipt column. Qualify the
-- receipt column so discount calculation can run for GST and non-GST bills.
DO $$
DECLARE original text; updated text;
BEGIN
  original:=pg_get_functiondef('public.record_counter_bill_discount_revision(uuid,integer)'::regprocedure);
  updated:=replace(
    original,
    'SELECT document->''lines'', (document->>''total_paise'')::bigint INTO adjusted_lines,gross FROM public.counter_bill_print_records WHERE bill_id=p_bill;',
    'SELECT receipt.document->''lines'', (receipt.document->>''total_paise'')::bigint INTO adjusted_lines,gross FROM public.counter_bill_print_records receipt WHERE receipt.bill_id=p_bill;'
  );
  updated:=replace(
    updated,
    'FROM jsonb_array_elements((SELECT document->''lines'' FROM public.counter_bill_print_records WHERE bill_id=p_bill)) print_line',
    'FROM jsonb_array_elements((SELECT receipt.document->''lines'' FROM public.counter_bill_print_records receipt WHERE receipt.bill_id=p_bill)) print_line'
  );
  IF updated=original THEN
    RAISE EXCEPTION 'Counter bill discount receipt-document integration point missing';
  END IF;
  EXECUTE updated;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
