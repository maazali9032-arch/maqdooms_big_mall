BEGIN;

-- Vendor-purchased garments have no production job or production specification.
-- Keep the existing production descriptor guard intact for manufactured pieces.
CREATE OR REPLACE FUNCTION public.guard_production_descriptor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='finished_products' THEN
  IF NEW.vendor_receipt_id IS NOT NULL THEN
   RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM public.production_piece_specs WHERE production_job_id=NEW.production_job_id) THEN
   IF NOT EXISTS(SELECT 1 FROM public.production_piece_specs WHERE production_job_id=NEW.production_job_id AND piece_number=NEW.piece_number AND product_id=NEW.product_id AND design_id IS NOT DISTINCT FROM NEW.design_id) THEN RAISE EXCEPTION 'Piece must match its recorded production specification'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM public.production_jobs WHERE id=NEW.production_job_id AND product_id=NEW.product_id AND design_id IS NOT DISTINCT FROM NEW.design_id) THEN
   RAISE EXCEPTION 'Piece must match its recorded production';
  END IF;
 ELSE
  IF (NEW.size,NEW.custom_design) IS DISTINCT FROM(OLD.size,OLD.custom_design) AND NOT(OLD.size IS NULL AND OLD.custom_design IS NULL AND OLD.status='open' AND OLD.created_by=auth.uid() AND NOT EXISTS(SELECT 1 FROM public.production_batch_requests WHERE production_job_id=OLD.id)) THEN RAISE EXCEPTION 'Issued production descriptors are permanent'; END IF;
 END IF;
 RETURN NEW;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;