BEGIN;

-- Vendor-purchased pieces enter Workshop at receipt. Once received, they use
-- the same transfer path as every other finished product. The prior trigger
-- applied the initial-location rule to every update, blocking their transfer.
CREATE OR REPLACE FUNCTION public.validate_finished_product() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_quantity integer;
BEGIN
  IF NEW.vendor_receipt_id IS NOT NULL THEN
    IF NEW.production_job_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.vendor_finished_product_receipts WHERE id=NEW.vendor_receipt_id) THEN
      RAISE EXCEPTION 'A vendor finished product requires one valid vendor receipt';
    END IF;
    IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.locations WHERE id=NEW.current_location_id AND active AND kind='workshop') THEN
      RAISE EXCEPTION 'Vendor Finished Products must initially enter Workshop';
    END IF;
  ELSE
    SELECT quantity INTO v_quantity FROM public.production_jobs WHERE id=NEW.production_job_id FOR UPDATE;
    IF v_quantity IS NULL OR NEW.piece_number > v_quantity THEN RAISE EXCEPTION 'Piece number exceeds Production Job quantity'; END IF;
    IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.locations WHERE id=NEW.current_location_id AND kind='workshop') THEN
      RAISE EXCEPTION 'Finished Products must initially return to Workshop';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND (NEW.production_job_id,NEW.vendor_receipt_id,NEW.product_id,NEW.design_id,NEW.piece_number,NEW.barcode_id)
    IS DISTINCT FROM (OLD.production_job_id,OLD.vendor_receipt_id,OLD.product_id,OLD.design_id,OLD.piece_number,OLD.barcode_id) THEN
    RAISE EXCEPTION 'Finished Product identity cannot be rewritten';
  END IF;
  RETURN NEW;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
