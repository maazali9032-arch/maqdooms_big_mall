-- Retire the 19 legacy tables replaced by the current model (audit 29 Oct 2026).
-- All were empty on live when this was written. They stay as empty history:
-- * every table: no further writes (grants revoked + a row trigger that also stops
--   SECURITY DEFINER functions and direct admin writes);
-- * 10 tables nothing live reads: SELECT also revoked from staff.
-- The other 9 stay readable because a live screen, view, row policy or
-- validation trigger still reads them (they simply return nothing).
-- Reversible: drop the trigger and re-grant in a later migration.
BEGIN;

CREATE OR REPLACE FUNCTION public.reject_retired_table_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Table % was retired on 29 October 2026 and no longer accepts writes', TG_TABLE_NAME
    USING HINT = obj_description(TG_RELID, 'pg_class');
END;
$$;
REVOKE ALL ON FUNCTION public.reject_retired_table_write() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('sales',                      'orders and counter_bills', false),
    ('sale_items',                 'order_items', false),
    ('stock_movements',            'inventory_movements', false),
    ('holds',                      'nothing yet (online reservations will use the current ledger)', false),
    ('tailoring_jobs',             'customer_tailoring_jobs and production_jobs', false),
    ('tailoring_job_lines',        'material_issues and material_issue_lines', false),
    ('tailoring_charge_versions',  'counter_tailoring_prices', false),
    ('customer_tailoring_prices',  'counter_tailoring_prices', false),
    ('finished_product_materials', 'finished_product_cost_allocations', false),
    ('tailoring_charges',          'counter_tailoring_prices', true),
    ('customer_tailoring_quotes',  'counter_tailoring_prices', true),
    ('thaan_costs',                'fabric_stock_costs', true),
    ('consumable_receipts',        'material_batches and material_units', true),
    ('consumable_receipt_costs',   'material_batches and material_units', true),
    ('production_cost_inputs',     'production_cost_lines', true),
    ('ecommerce_paid_receipts',    'nothing yet (online orders will use orders)', true),
    ('ecommerce_sale_sources',     'nothing yet (online orders will use orders)', true),
    ('gst_purchase_lines',         'gst_purchase_documents', true),
    ('whatsapp_messages',          'nothing yet (no WhatsApp provider)', true)
  ) AS t(tbl, replaced_by, hide)
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM PUBLIC, anon, authenticated', r.tbl);
    IF r.hide THEN
      EXECUTE format('REVOKE SELECT ON public.%I FROM PUBLIC, anon, authenticated', r.tbl);
    END IF;
    EXECUTE format('CREATE TRIGGER retired_table_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_retired_table_write()', r.tbl);
    EXECUTE format('CREATE TRIGGER retired_table_truncate_guard BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.reject_retired_table_write()', r.tbl);
    EXECUTE format('COMMENT ON TABLE public.%I IS %L', r.tbl,
      'RETIRED 29 Oct 2026 - replaced by ' || r.replaced_by || '. Kept as empty history; no writes.');
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
