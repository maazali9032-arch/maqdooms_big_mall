BEGIN;

CREATE OR REPLACE FUNCTION public.guard_phase7_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%rowtype;
BEGIN
 IF TG_TABLE_NAME='customer_tailoring_jobs' THEN
  IF OLD.request_id IS NOT NULL THEN
   IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Booked job identity and price selection are permanent';
   ELSIF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')
    AND NOT (
     OLD.size IS NULL
     AND nullif(btrim(NEW.size),'') IS NOT NULL
     AND (to_jsonb(NEW)-ARRAY['status','size']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','size'])
    )
   THEN
    RAISE EXCEPTION 'Booked job identity and price selection are permanent';
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='orders' THEN
  IF OLD.tailoring_request_id IS NOT NULL AND OLD.status='completed' THEN RAISE EXCEPTION 'Booked tailoring Order is permanent'; END IF;
 ELSIF TG_TABLE_NAME='order_items' THEN
  SELECT * INTO o FROM public.orders WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  IF o.tailoring_request_id IS NOT NULL AND o.status='completed' THEN RAISE EXCEPTION 'Booked tailoring Order item is permanent'; END IF;
  IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.orders WHERE id=OLD.order_id AND tailoring_request_id IS NOT NULL AND status='completed') THEN RAISE EXCEPTION 'Booked tailoring Order item is permanent'; END IF;
 ELSIF TG_TABLE_NAME='job_material_requirements' THEN
  IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM public.customer_tailoring_jobs WHERE id=OLD.customer_tailoring_job_id AND request_id IS NOT NULL) THEN RAISE EXCEPTION 'Booked required quantity is permanent'; END IF;
  IF TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM public.customer_tailoring_jobs WHERE id=NEW.customer_tailoring_job_id AND request_id IS NOT NULL) THEN
   IF NEW.material_id IS NOT NULL THEN
    IF TG_OP<>'INSERT' OR NEW.material_issue_line_id IS NULL THEN RAISE EXCEPTION 'Consumable requirement must reference its explicit required issue'; END IF;
    -- The Phase 8 relationship guard verifies line, job, quantity, type and posting.
   ELSIF EXISTS(SELECT 1 FROM public.job_material_requirements WHERE customer_tailoring_job_id=NEW.customer_tailoring_job_id AND fabric_stock_id=NEW.fabric_stock_id)
   OR NEW.unit<>'mm' OR NEW.quantity IS DISTINCT FROM (
    SELECT sum((x->>'quantity')::numeric) FROM public.customer_tailoring_jobs j JOIN LATERAL(SELECT cuts FROM public.customer_tailoring_quotes WHERE id=j.quote_id UNION ALL SELECT cuts FROM public.counter_tailoring_prices WHERE job_id=j.id) q ON true
    CROSS JOIN jsonb_array_elements(q.cuts) x WHERE j.id=NEW.customer_tailoring_job_id AND (x->>'fabric_stock_id')::uuid=NEW.fabric_stock_id)
   THEN RAISE EXCEPTION 'Required quantity must match the booked quote exactly once'; END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
