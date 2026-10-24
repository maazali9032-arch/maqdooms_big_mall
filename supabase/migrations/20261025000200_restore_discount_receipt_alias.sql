BEGIN;

-- `document` is both a PL/pgSQL variable and a receipt-table column. A later
-- full-function replacement reintroduced the ambiguity fixed in 20261023001700.
DO $$
DECLARE original text; updated text;
BEGIN
  original:=pg_get_functiondef('public.record_counter_bill_discount_revision(uuid,integer)'::regprocedure);
  updated:=replace(
    original,
    'SELECT document->''lines'',(document->>''total_paise'')::bigint INTO adjusted_lines,gross FROM public.counter_bill_print_records WHERE bill_id=p_bill;',
    'SELECT receipt.document->''lines'',(receipt.document->>''total_paise'')::bigint INTO adjusted_lines,gross FROM public.counter_bill_print_records receipt WHERE receipt.bill_id=p_bill;'
  );
  updated:=replace(
    updated,
    'FROM jsonb_array_elements((SELECT document->''lines'' FROM public.counter_bill_print_records WHERE bill_id=p_bill)) print_line',
    'FROM jsonb_array_elements((SELECT receipt.document->''lines'' FROM public.counter_bill_print_records receipt WHERE receipt.bill_id=p_bill)) print_line'
  );
  IF updated=original OR updated LIKE '%SELECT document->''lines''%' OR updated LIKE '%SELECT document->>''total_paise''%' THEN
    RAISE EXCEPTION 'Counter bill discount receipt-column qualification was not applied';
  END IF;
  EXECUTE updated;
END $$;

-- Deployment guard for the two POS regressions fixed today.
DO $$
DECLARE discount_definition text; gst_definition text;
BEGIN
  discount_definition:=pg_get_functiondef('public.record_counter_bill_discount_revision(uuid,integer)'::regprocedure);
  gst_definition:=pg_get_functiondef('public.gst_snapshot_counter_bill(uuid,jsonb)'::regprocedure);
  IF discount_definition NOT LIKE '%receipt.document%' THEN
    RAISE EXCEPTION 'POS regression guard: receipt document is not qualified';
  END IF;
  IF gst_definition NOT LIKE '%configuration_id%' OR gst_definition NOT LIKE '%customer_gstin%' THEN
    RAISE EXCEPTION 'POS regression guard: GST sale context contract is incomplete';
  END IF;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
