BEGIN;

-- Counter bill totals can change only through an immutable discount revision.
-- This preserves completed-sale history while allowing the initial discount and
-- the Owner's one-hour correction to update the displayed bill total.
CREATE OR REPLACE FUNCTION public.guard_phase6_order_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order uuid; o public.orders%rowtype;
BEGIN
 IF TG_TABLE_NAME='orders' THEN
  IF OLD.sale_request_id IS NOT NULL AND OLD.status='completed' THEN
   IF OLD.kind='counter_bill'
      AND (to_jsonb(NEW)-'final_customer_price_paise') IS NOT DISTINCT FROM (to_jsonb(OLD)-'final_customer_price_paise')
      AND EXISTS(
        SELECT 1
        FROM public.counter_bill_discount_revisions revision
        WHERE revision.bill_id=OLD.id
          AND revision.final_paise=NEW.final_customer_price_paise
      )
   THEN
     RETURN NEW;
   END IF;
   RAISE EXCEPTION 'Completed sale history is permanent';
  END IF;
 ELSE
  v_order:=CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  SELECT * INTO o FROM public.orders WHERE id=v_order;
  IF o.sale_request_id IS NOT NULL AND o.status='completed' THEN RAISE EXCEPTION 'Completed sale items are permanent'; END IF;
  IF TG_OP='UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id AND EXISTS(
   SELECT 1 FROM public.orders WHERE id=OLD.order_id AND sale_request_id IS NOT NULL AND status='completed')
  THEN RAISE EXCEPTION 'Completed sale items are permanent'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;

-- Reports must use the vendor receipt CP when a finished product was purchased
-- rather than made through the production workflow.
DO $$
DECLARE original text; updated text;
BEGIN
  original:=pg_get_functiondef('public.business_sale_facts(timestamp with time zone,timestamp with time zone,text)'::regprocedure);
  updated:=replace(original,
    'THEN fi.production_cost_snapshot_paise::text',
    'THEN coalesce(fi.production_cost_snapshot_paise,fi.cp_snapshot_paise)::text'
  );
  updated:=replace(updated,
    'AND fi.production_cost_snapshot_paise IS NOT NULL THEN (it.final_customer_price_paise-fi.production_cost_snapshot_paise)::text',
    'AND coalesce(fi.production_cost_snapshot_paise,fi.cp_snapshot_paise) IS NOT NULL THEN (it.final_customer_price_paise-coalesce(fi.production_cost_snapshot_paise,fi.cp_snapshot_paise))::text'
  );
  IF updated=original THEN
    RAISE EXCEPTION 'Vendor ready-made sales reporting integration point missing';
  END IF;
  EXECUTE updated;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
