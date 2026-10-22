BEGIN;

ALTER TABLE public.stock_count_audits DROP CONSTRAINT stock_count_audits_item_kinds_check;
ALTER TABLE public.stock_count_audits ADD CONSTRAINT stock_count_audits_item_kinds_check
  CHECK (item_kinds <@ ARRAY['fabric', 'finished_product', 'production_finished', 'vendor_finished']);
ALTER TABLE public.stock_count_items DROP CONSTRAINT stock_count_items_item_kind_check;
ALTER TABLE public.stock_count_items ADD CONSTRAINT stock_count_items_item_kind_check
  CHECK (item_kind IN ('fabric', 'production_finished', 'vendor_finished', 'finished_product'));

CREATE OR REPLACE FUNCTION public.create_stock_count_audit(
  p_request uuid, p_name text, p_kinds text[], p_locations uuid[], p_staff uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE result uuid := gen_random_uuid(); item_count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF p_request IS NULL OR nullif(btrim(p_name), '') IS NULL
    OR p_kinds IS NULL OR cardinality(p_kinds) NOT BETWEEN 1 AND 4
    OR p_kinds <@ ARRAY['fabric', 'finished_product', 'production_finished', 'vendor_finished'] IS NOT TRUE
    OR p_locations IS NULL OR cardinality(p_locations) < 1 OR p_staff IS NULL THEN
    RAISE EXCEPTION 'Name, at least one item type, location and assigned staff member are required';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id = p_staff AND active)
    OR (SELECT count(*) FROM public.locations WHERE id = ANY(p_locations) AND active) <> cardinality(p_locations) THEN
    RAISE EXCEPTION 'Assigned staff member and all locations must be active';
  END IF;

  INSERT INTO public.stock_count_audits(id, request_id, name, item_kinds, location_ids, assigned_to, created_by)
  VALUES(result, p_request, btrim(p_name), p_kinds, p_locations, p_staff, auth.uid());

  IF 'fabric' = ANY(p_kinds) THEN
    INSERT INTO public.stock_count_items(audit_id, item_kind, barcode, location_id, details)
    SELECT result, 'fabric', coalesce(v.code, t.barcode, b.code), l.id,
      jsonb_build_object('name', coalesce(g.name, f.name), 'batch', rb.code, 'location', l.name, 'category', 'Fabric / Thaan', 'quantity_mm', public.inventory_balance(i.id, l.id)::text)
    FROM public.inventory_items i
    JOIN public.thaans t ON t.id = i.thaan_id
    JOIN public.fabric_stock fs ON fs.id = t.fabric_stock_id
    JOIN public.fabrics f ON f.id = fs.fabric_id
    JOIN public.locations l ON l.id = ANY(p_locations)
    LEFT JOIN public.stock_registration_variants v ON v.thaan_id = t.id
    LEFT JOIN public.stock_registration_fabric_types g ON g.id = v.fabric_type_id
    LEFT JOIN public.receiving_batches rb ON rb.id = fs.batch_id
    LEFT JOIN public.barcodes b ON b.id = fs.barcode_id
    WHERE i.unit = 'mm' AND public.inventory_balance(i.id, l.id) > 0;
  END IF;

  IF p_kinds && ARRAY['finished_product', 'production_finished', 'vendor_finished'] THEN
    INSERT INTO public.stock_count_items(audit_id, item_kind, barcode, location_id, details)
    SELECT result,
      CASE WHEN p.vendor_receipt_id IS NULL THEN 'production_finished' ELSE 'vendor_finished' END,
      b.code, p.current_location_id,
      jsonb_strip_nulls(jsonb_build_object(
        'name', product.name,
        'design', public.production_piece_context(p.id)->>'design',
        'size', public.production_piece_context(p.id)->>'size',
        'location', l.name,
        'category', CASE WHEN p.vendor_receipt_id IS NULL THEN 'Shop-produced garment' ELSE 'Vendor-purchased garment' END,
        'batch', coalesce(vendor_receipt.code, production.code)
      ))
    FROM public.finished_products p
    JOIN public.inventory_items i ON i.finished_product_id = p.id
    JOIN public.barcodes b ON b.id = p.barcode_id
    JOIN public.products product ON product.id = p.product_id
    JOIN public.locations l ON l.id = p.current_location_id
    LEFT JOIN public.production_jobs production ON production.id = p.production_job_id
    LEFT JOIN public.vendor_finished_product_receipts vendor_receipt ON vendor_receipt.id = p.vendor_receipt_id
    WHERE p.status = 'available' AND p.current_location_id = ANY(p_locations)
      AND public.inventory_balance(i.id, p.current_location_id) = 1
      AND (
        'finished_product' = ANY(p_kinds)
        OR (p.vendor_receipt_id IS NULL AND 'production_finished' = ANY(p_kinds))
        OR (p.vendor_receipt_id IS NOT NULL AND 'vendor_finished' = ANY(p_kinds))
      );
  END IF;

  SELECT count(*) INTO item_count FROM public.stock_count_items WHERE audit_id = result;
  IF item_count = 0 THEN RAISE EXCEPTION 'No currently tracked items match the chosen locations and types'; END IF;
  INSERT INTO public.erp_audit_records(actor_id, action, entity_table, entity_id, new_value)
  VALUES(auth.uid(), 'create_stock_count_audit', 'stock_count_audits', result,
    jsonb_build_object('items', item_count, 'kinds', p_kinds, 'locations', p_locations, 'assigned_to', p_staff));
  RETURN result;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
