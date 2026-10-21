-- Include recorded scanner identities in work-list/receipt projections; do not replace internal keys.
DO $$ DECLARE signature text; original text; updated text; BEGIN
 FOREACH signature IN ARRAY ARRAY['public.customer_tailoring_work(text)','public.resolve_finished_receipt(text)','public.production_history_base(uuid,integer)'] LOOP
  original:=pg_get_functiondef(signature::regprocedure);
  updated:=replace(original,'''code'',j.code','''code'',j.code,''scan_code'',j.scan_code');
  updated:=replace(updated,'''bill_code'',o.code','''bill_code'',o.code,''bill_scan_code'',o.scan_code');
  IF signature='public.resolve_finished_receipt(text)' THEN
   updated:=replace(updated,'''code'',production.code','''code'',production.code,''scan_code'',production.scan_code');
   updated:=replace(updated,'''code'',coalesce(bill.code,job.code)','''code'',coalesce(bill.code,job.code),''scan_code'',coalesce(bill.scan_code,job.scan_code)');
  END IF;
  IF updated=original THEN RAISE EXCEPTION 'Scanner identity projection insertion point missing: %',signature; END IF;
  EXECUTE updated;
 END LOOP;
END; $$;
NOTIFY pgrst,'reload schema';
