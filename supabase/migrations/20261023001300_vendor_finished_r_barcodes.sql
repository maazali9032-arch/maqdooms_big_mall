BEGIN;

-- Keep every physical label six characters while making vendor-purchased
-- finished garments visually distinct from shop-produced (F) and customer (C)
-- garments: R00000 through RZZZZZ.
ALTER TABLE public.barcode_identity_reservations
  DROP CONSTRAINT barcode_identity_reservations_code_check;
ALTER TABLE public.barcode_identity_reservations
  ADD CONSTRAINT barcode_identity_reservations_code_check
  CHECK (code ~ '^[TPFBJCR][0-9A-Z]{5}$');

-- Protect any coincidental historical R labels before allocating the namespace.
INSERT INTO public.barcode_identity_reservations(code)
SELECT DISTINCT code FROM (
  SELECT code FROM public.barcodes UNION ALL SELECT barcode FROM public.thaans
  UNION ALL SELECT code FROM public.stock_registration_variants
  UNION ALL SELECT code FROM public.orders UNION ALL SELECT scan_code FROM public.orders
  UNION ALL SELECT code FROM public.production_jobs UNION ALL SELECT scan_code FROM public.production_jobs
  UNION ALL SELECT code FROM public.customer_tailoring_jobs UNION ALL SELECT scan_code FROM public.customer_tailoring_jobs
) labels WHERE code ~ '^R[0-9A-Z]{5}$'
ON CONFLICT DO NOTHING;

CREATE SEQUENCE public.barcode_six_r MINVALUE 0 MAXVALUE 60466175 START 0 NO CYCLE;
REVOKE ALL ON SEQUENCE public.barcode_six_r FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.next_six_barcode(p_prefix text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ordinal bigint; candidate text;
BEGIN
  IF p_prefix IS NULL OR p_prefix NOT IN ('T','P','F','B','J','C','R') THEN
    RAISE EXCEPTION 'Unknown barcode type';
  END IF;
  LOOP
    BEGIN
      ordinal := nextval(('public.barcode_six_' || lower(p_prefix))::regclass);
    EXCEPTION WHEN SQLSTATE '2200H' THEN
      RAISE EXCEPTION 'Six-character barcode namespace % exhausted; identifiers cannot wrap or be reused', p_prefix USING ERRCODE='2200H';
    END;
    candidate := p_prefix || public.barcode_base36_five(ordinal);
    INSERT INTO public.barcode_identity_reservations(code) VALUES(candidate) ON CONFLICT DO NOTHING;
    IF FOUND THEN RETURN candidate; END IF;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.new_typed_finished_barcode(p_prefix text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result uuid;
BEGIN
  IF p_prefix IS NULL OR p_prefix NOT IN ('F','C','R') THEN
    RAISE EXCEPTION 'Finished barcode type required';
  END IF;
  INSERT INTO public.barcodes(code,kind,created_by) VALUES(p_prefix,'product',auth.uid()) RETURNING id INTO result;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.enforce_product_six_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.kind='product' THEN
    NEW.code := public.next_six_barcode(CASE WHEN NEW.code='C' THEN 'C' WHEN NEW.code='R' THEN 'R' ELSE 'F' END);
  END IF;
  RETURN NEW;
END; $$;

DO $$
DECLARE original text; updated text;
BEGIN
  original := pg_get_functiondef('public.receive_vendor_finished_products(uuid,text,date,text,jsonb)'::regprocedure);
  updated := replace(original, 'barcode_id:=public.new_finished_piece_barcode();', 'barcode_id:=public.new_typed_finished_barcode(''R'');');
  IF updated = original THEN
    RAISE EXCEPTION 'Vendor finished barcode allocation integration point missing';
  END IF;
  EXECUTE updated;

  original := pg_get_functiondef('public.bind_six_barcode_identity()'::regprocedure);
  updated := replace(
    original,
    'code_value !~ ''^[TPFBJC][0-9A-Z]{5}$''',
    'code_value !~ ''^[TPFBJCR][0-9A-Z]{5}$'''
  );
  IF updated = original THEN
    RAISE EXCEPTION 'Vendor barcode identity binding integration point missing';
  END IF;
  EXECUTE updated;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
