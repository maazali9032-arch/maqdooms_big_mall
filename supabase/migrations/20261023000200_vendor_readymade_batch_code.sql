BEGIN;

ALTER TABLE public.vendor_finished_product_receipts ADD COLUMN code text;
UPDATE public.vendor_finished_product_receipts
SET code = 'VRB-' || upper(substr(replace(id::text, '-', ''), 1, 10))
WHERE code IS NULL;
ALTER TABLE public.vendor_finished_product_receipts ALTER COLUMN code SET NOT NULL;
ALTER TABLE public.vendor_finished_product_receipts ADD CONSTRAINT vendor_finished_receipts_code_key UNIQUE(code);

CREATE OR REPLACE FUNCTION public.assign_vendor_finished_batch_code() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.code IS NULL THEN
    NEW.code := 'VRB-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 10));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vendor_finished_receipts_assign_code
BEFORE INSERT ON public.vendor_finished_product_receipts
FOR EACH ROW EXECUTE FUNCTION public.assign_vendor_finished_batch_code();

DO $$
DECLARE original text; updated text;
BEGIN
  original := pg_get_functiondef('public.receive_vendor_finished_products(uuid,text,date,text,jsonb)'::regprocedure);
  updated := replace(
    original,
    'RETURN jsonb_build_object(''receipt_id'',saved.id,''pieces'',',
    'RETURN jsonb_build_object(''receipt_id'',saved.id,''batch_code'',saved.code,''pieces'',');
  updated := replace(
    updated,
    'RETURN jsonb_build_object(''receipt_id'',receipt_id,''pieces'',result);',
    'RETURN jsonb_build_object(''receipt_id'',receipt_id,''batch_code'',(SELECT code FROM public.vendor_finished_product_receipts WHERE id=receipt_id),''pieces'',result);');
  IF updated = original THEN
    RAISE EXCEPTION 'Vendor receipt response integration point missing';
  END IF;
  EXECUTE updated;
END $$;

COMMIT;