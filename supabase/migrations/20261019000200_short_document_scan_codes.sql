-- Separate compact scanner identities from invoice numbers, UUIDs and historical business codes.
BEGIN;
ALTER TABLE public.orders ADD COLUMN scan_code text UNIQUE CHECK(scan_code ~ '^BL-[23456789ABCDEFGH]{12}$');
ALTER TABLE public.production_jobs ADD COLUMN scan_code text UNIQUE CHECK(scan_code ~ '^PJ-[23456789ABCDEFGH]{12}$');
ALTER TABLE public.customer_tailoring_jobs ADD COLUMN scan_code text UNIQUE CHECK(scan_code ~ '^TJ-[23456789ABCDEFGH]{12}$');

CREATE FUNCTION public.assign_document_scan_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prefix text; candidate text; taken boolean;
BEGIN
  prefix:=CASE TG_TABLE_NAME WHEN 'orders' THEN 'BL' WHEN 'production_jobs' THEN 'PJ' ELSE 'TJ' END;
  -- Serialize generation within each document family so even a simultaneous collision is retried.
  PERFORM pg_advisory_xact_lock(hashtextextended('document-scan:'||prefix,0));
  LOOP
    candidate:=prefix||'-'||translate(left(replace(gen_random_uuid()::text,'-',''),12),'0123456789abcdef','23456789ABCDEFGH');
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE scan_code=$1 OR code=$1)',TG_TABLE_NAME) INTO taken USING candidate;
    EXIT WHEN NOT taken;
  END LOOP;
  NEW.scan_code:=candidate;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.assign_document_scan_code() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER assign_order_scan_code BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.assign_document_scan_code();
CREATE TRIGGER assign_production_scan_code BEFORE INSERT ON public.production_jobs FOR EACH ROW EXECUTE FUNCTION public.assign_document_scan_code();
CREATE TRIGGER assign_tailoring_scan_code BEFORE INSERT ON public.customer_tailoring_jobs FOR EACH ROW EXECUTE FUNCTION public.assign_document_scan_code();

CREATE FUNCTION public.preserve_document_scan_code() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.scan_code IS DISTINCT FROM OLD.scan_code THEN RAISE EXCEPTION 'Document scan identity is permanent'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.preserve_document_scan_code() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER preserve_order_scan_code BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.preserve_document_scan_code();
CREATE TRIGGER preserve_production_scan_code BEFORE UPDATE ON public.production_jobs FOR EACH ROW EXECUTE FUNCTION public.preserve_document_scan_code();
CREATE TRIGGER preserve_tailoring_scan_code BEFORE UPDATE ON public.customer_tailoring_jobs FOR EACH ROW EXECUTE FUNCTION public.preserve_document_scan_code();

-- Private normalizer. Existing authorized RPCs keep their own permission/ownership checks.
CREATE FUNCTION public.resolve_document_scan_code(p_value text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(
    (SELECT code FROM public.orders WHERE scan_code=p_value),
    (SELECT code FROM public.production_jobs WHERE scan_code=p_value),
    (SELECT code FROM public.customer_tailoring_jobs WHERE scan_code=p_value),p_value)
$$;
REVOKE ALL ON FUNCTION public.resolve_document_scan_code(text) FROM PUBLIC,anon,authenticated;

-- Preserve complete existing RPC bodies, permissions and return contracts. Normalize short
-- aliases only at existing exact-code comparisons; original codes and UUIDs remain accepted.
DO $$
DECLARE fn record; definition text; original text;
BEGIN
  FOR fn IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('counter_bill','customer_tailoring_work','production_job_document','tailor_work_order',
       'receive_production_barcode','issue_additional_production_fabric')
  LOOP
    original:=pg_get_functiondef(fn.oid);
    definition:=replace(original,'btrim(p_code)','public.resolve_document_scan_code(btrim(p_code))');
    definition:=replace(definition,'btrim(p_bill)','public.resolve_document_scan_code(btrim(p_bill))');
    IF definition=original THEN RAISE EXCEPTION 'No exact document lookup found in %',fn.proname; END IF;
    IF fn.proname='counter_bill' THEN
      definition:=replace(definition,'''tax'',public.gst_invoice_document(o.id)', '''scan_code'',o.scan_code,''tax'',public.gst_invoice_document(o.id)');
      IF definition NOT LIKE '%''scan_code'',o.scan_code%' THEN RAISE EXCEPTION 'Counter scan field insertion failed'; END IF;
    ELSIF fn.proname='production_job_document' THEN
      definition:=replace(definition,'''code'',job.code','''code'',job.code,''scan_code'',job.scan_code');
    ELSIF fn.proname='tailor_work_order' THEN
      definition:=replace(definition,'''job_code'',job.code','''job_code'',job.code,''scan_code'',job.scan_code');
    END IF;
    EXECUTE definition;
  END LOOP;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
