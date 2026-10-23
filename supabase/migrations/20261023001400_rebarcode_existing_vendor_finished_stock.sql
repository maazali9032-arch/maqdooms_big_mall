BEGIN;

-- Vendor-purchased finished stock previously shared the F namespace with
-- shop-produced pieces. Reassign every current vendor piece to the dedicated R
-- namespace while keeping the retired F identities reserved forever.
CREATE TEMP TABLE vendor_finished_rebarcode_map (
  barcode_id uuid PRIMARY KEY,
  finished_product_id uuid NOT NULL UNIQUE,
  old_code text NOT NULL UNIQUE,
  new_code text NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO vendor_finished_rebarcode_map(barcode_id, finished_product_id, old_code, new_code)
SELECT b.id, piece.id, b.code, public.next_six_barcode('R')
FROM public.finished_products piece
JOIN public.barcodes b ON b.id = piece.barcode_id
WHERE piece.vendor_receipt_id IS NOT NULL
  AND b.code !~ '^R[0-9A-Z]{5}$'
ORDER BY piece.created_at, piece.id;

-- Barcode identities are normally immutable. This one controlled migration is
-- the explicit transition from the former shared F namespace to R.
DROP TRIGGER preserve_barcode_code ON public.barcodes;
DROP TRIGGER domain_history_immutable ON public.barcodes;
DROP TRIGGER phase11_barcode_history ON public.barcodes;
UPDATE public.barcodes barcode
SET code = mapping.new_code
FROM vendor_finished_rebarcode_map mapping
WHERE barcode.id = mapping.barcode_id;
CREATE TRIGGER phase11_barcode_history
BEFORE UPDATE OR DELETE ON public.barcodes
FOR EACH ROW EXECUTE FUNCTION public.guard_phase11_identity();
CREATE TRIGGER domain_history_immutable
BEFORE UPDATE OR DELETE ON public.barcodes
FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER preserve_barcode_code
BEFORE UPDATE ON public.barcodes
FOR EACH ROW EXECUTE FUNCTION public.preserve_physical_label_code('code');

-- Bind each new R identity to the same physical barcode record. The former F
-- reservation/binding is retained as retired identity evidence and cannot be
-- allocated to another item.
INSERT INTO public.barcode_identity_bindings(code, record_table, record_id)
SELECT new_code, 'barcodes', barcode_id
FROM vendor_finished_rebarcode_map
ON CONFLICT DO NOTHING;

-- Active audits must expect the replacement label. Completed audits retain the
-- exact code that was physically counted at that historical point in time.
DROP TRIGGER stock_count_items_immutable ON public.stock_count_items;
UPDATE public.stock_count_items item
SET barcode = mapping.new_code
FROM vendor_finished_rebarcode_map mapping
JOIN public.stock_count_audits audit ON audit.status = 'active'
WHERE item.audit_id = audit.id
  AND item.barcode = mapping.old_code;
CREATE TRIGGER stock_count_items_immutable
BEFORE UPDATE OR DELETE ON public.stock_count_items
FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE OR REPLACE FUNCTION public.guard_vendor_finished_r_barcode() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE barcode_code text;
BEGIN
  IF NEW.vendor_receipt_id IS NOT NULL THEN
    SELECT code INTO barcode_code FROM public.barcodes WHERE id = NEW.barcode_id;
    IF barcode_code IS NULL OR barcode_code !~ '^R[0-9A-Z]{5}$' THEN
      RAISE EXCEPTION 'Vendor-purchased finished products require an R barcode';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_vendor_finished_r_barcode() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_vendor_finished_r_barcode ON public.finished_products;
CREATE TRIGGER guard_vendor_finished_r_barcode
BEFORE INSERT OR UPDATE OF vendor_receipt_id, barcode_id ON public.finished_products
FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_finished_r_barcode();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.finished_products piece
    JOIN public.barcodes barcode ON barcode.id = piece.barcode_id
    WHERE piece.vendor_receipt_id IS NOT NULL
      AND barcode.code !~ '^R[0-9A-Z]{5}$'
  ) THEN
    RAISE EXCEPTION 'Vendor finished-stock rebarcode was incomplete';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
