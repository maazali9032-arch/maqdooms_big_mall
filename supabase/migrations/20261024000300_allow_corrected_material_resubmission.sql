BEGIN;
ALTER TABLE public.job_material_consumptions
  DROP CONSTRAINT IF EXISTS job_material_consumptions_customer_tailoring_job_id_product_key;
DROP INDEX IF EXISTS public.job_material_consumptions_active_job_idx;
CREATE UNIQUE INDEX job_material_consumptions_active_job_idx
  ON public.job_material_consumptions(customer_tailoring_job_id,production_job_id)
  NULLS NOT DISTINCT WHERE reversed_at IS NULL;
COMMIT;
