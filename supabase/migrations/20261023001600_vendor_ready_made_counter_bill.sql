BEGIN;

-- A vendor ready-made piece has a receipt CP and saved SP, but no production
-- cost version. Allow its sale snapshot to record that receipt evidence without
-- pretending it is a production-costed piece.
ALTER TABLE public.finished_product_sale_snapshots
  ALTER COLUMN cost_version_id DROP NOT NULL,
  ALTER COLUMN reviewed_cost_version_id DROP NOT NULL;

DO $$
DECLARE
  procedure_name regprocedure;
  original text;
  updated text;
  after_validation text;
  production_validation text := $validation$
   SELECT cost_version_id INTO reviewed_id FROM public.finished_product_price_reviews WHERE price_id=price.id; SELECT id INTO cost_id FROM public.production_cost_versions WHERE production_job_id=piece.production_job_id ORDER BY revision DESC LIMIT 1; SELECT amount_paise INTO cost_amount FROM public.finished_product_cost_allocations WHERE finished_product_id=piece.id AND cost_version_id=cost_id;
   IF reviewed_id IS DISTINCT FROM cost_id OR cost_amount IS NULL OR NOT EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=cost_id AND payload ? 'materials') THEN RAISE EXCEPTION 'Recorded piece CP and reviewed saved SP required'; END IF;
   SELECT jsonb_build_object('quantity_snapshot',v.quantity_snapshot,'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.production_cost_lines l WHERE l.cost_version_id=v.id),'[]')) INTO evidence FROM public.production_cost_versions v WHERE v.id=cost_id;$validation$;
  vendor_aware_validation text := $validation$
   IF piece.vendor_receipt_id IS NOT NULL THEN
    SELECT vp.cp_paise INTO cost_amount
    FROM public.vendor_finished_product_receipt_pieces vp
    WHERE vp.finished_product_id=piece.id;
    IF cost_amount IS NULL THEN RAISE EXCEPTION 'Recorded vendor piece CP required'; END IF;
    cost_id:=NULL; reviewed_id:=NULL;
    evidence:=jsonb_build_object('source_kind','vendor_purchase','receipt_id',piece.vendor_receipt_id,'recorded_cp_paise',cost_amount::text);
   ELSE
    SELECT cost_version_id INTO reviewed_id FROM public.finished_product_price_reviews WHERE price_id=price.id;
    SELECT id INTO cost_id FROM public.production_cost_versions WHERE production_job_id=piece.production_job_id ORDER BY revision DESC LIMIT 1;
    SELECT amount_paise INTO cost_amount FROM public.finished_product_cost_allocations WHERE finished_product_id=piece.id AND cost_version_id=cost_id;
    IF reviewed_id IS DISTINCT FROM cost_id OR cost_amount IS NULL OR NOT EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=cost_id AND payload ? 'materials') THEN RAISE EXCEPTION 'Recorded piece CP and reviewed saved SP required'; END IF;
    SELECT jsonb_build_object('quantity_snapshot',v.quantity_snapshot,'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.production_cost_lines l WHERE l.cost_version_id=v.id),'[]')) INTO evidence FROM public.production_cost_versions v WHERE v.id=cost_id;
   END IF;$validation$;
  financial_insert text := 'INSERT INTO public.order_item_financials(order_item_id,production_cost_snapshot_paise) VALUES(item_id,cost_amount);';
  vendor_aware_financial_insert text := $financial$
   IF piece.vendor_receipt_id IS NOT NULL THEN
    INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise) VALUES(item_id,cost_amount);
   ELSE
    INSERT INTO public.order_item_financials(order_item_id,production_cost_snapshot_paise) VALUES(item_id,cost_amount);
   END IF;$financial$;
BEGIN
  FOREACH procedure_name IN ARRAY ARRAY[
    'public.complete_counter_bill_multi(uuid,jsonb,jsonb,boolean,uuid,uuid,text,text)'::regprocedure,
    'public.gst_stage_counter_bill_multi(uuid,jsonb,jsonb,boolean,uuid,uuid,text,text)'::regprocedure
  ] LOOP
    original:=pg_get_functiondef(procedure_name);
    updated:=replace(original,production_validation,vendor_aware_validation);
    IF updated=original THEN
      RAISE EXCEPTION 'Vendor ready-made Counter billing validation integration point missing in %', procedure_name;
    END IF;
    after_validation:=updated;
    updated:=replace(updated,financial_insert,vendor_aware_financial_insert);
    IF updated=after_validation THEN
      RAISE EXCEPTION 'Vendor ready-made Counter financial snapshot integration point missing in %', procedure_name;
    END IF;
    -- The GST staging function was created before vendor pieces existed and
    -- still requires an inner production-job join for its receipt snapshot.
    IF procedure_name::text LIKE 'gst_stage_counter_bill_multi%' THEN
      updated:=replace(updated,'JOIN public.production_jobs j ON j.id=piece.production_job_id','LEFT JOIN public.production_jobs j ON j.id=piece.production_job_id');
    END IF;
    EXECUTE updated;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
