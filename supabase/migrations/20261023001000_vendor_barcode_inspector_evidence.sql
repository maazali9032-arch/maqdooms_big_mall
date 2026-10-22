BEGIN;

-- F-prefixed vendor pieces are already a valid owner-inspector root. Include
-- their receipt and per-piece purchase record in the immutable evidence trail
-- as well, so an owner sees the same provenance as for shop-made pieces.
DO $$
DECLARE
  original text;
  updated text;
BEGIN
  original := pg_get_functiondef('public.owner_barcode_inspect(text,timestamptz,text,integer)'::regprocedure);
  updated := replace(
    original,
    $needle$FROM public.finished_products r WHERE id IN (SELECT id FROM selected_pieces)
 UNION ALL

 SELECT 'finished_product_receipts:'$needle$,
    $replacement$FROM public.finished_products r WHERE id IN (SELECT id FROM selected_pieces)
 UNION ALL

 SELECT 'vendor_finished_product_receipts:'||r.id AS key, 'vendor_finished_product_receipts'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'created_by')::uuid AS actor_id,
 'Vendor ready-made receipt'::text AS title, to_jsonb(r) AS data
 FROM public.vendor_finished_product_receipts r WHERE r.id IN(SELECT vendor_receipt_id FROM selected_pieces WHERE vendor_receipt_id IS NOT NULL)
 UNION ALL

 SELECT 'vendor_finished_product_receipt_pieces:'||r.finished_product_id AS key, 'vendor_finished_product_receipt_pieces'::text AS source, r.finished_product_id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 NULL::uuid AS actor_id,
 'Vendor ready-made piece details'::text AS title, to_jsonb(r) AS data
 FROM public.vendor_finished_product_receipt_pieces r WHERE r.finished_product_id IN(SELECT id FROM selected_pieces)
 UNION ALL

 SELECT 'finished_product_receipts:'$replacement$
  );
  IF updated = original THEN
    RAISE EXCEPTION 'Vendor barcode inspector evidence insertion point missing';
  END IF;
  EXECUTE updated;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
