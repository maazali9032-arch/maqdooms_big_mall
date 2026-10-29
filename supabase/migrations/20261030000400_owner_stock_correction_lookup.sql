-- Owner stock correction screen (audit 29 Oct 2026).
-- Resolves any physical fabric or finished-piece barcode to its stock-ledger item
-- and its current quantity per operational location. The correction itself is
-- posted through the existing audited record_inventory_correction().
BEGIN;

CREATE OR REPLACE FUNCTION public.owner_stock_correction_lookup(p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  code_in text := btrim(coalesce(p_barcode, ''));
  v_thaan uuid;
  v_piece uuid;
  v_barcode uuid;
  bound_table text;
  bound_id uuid;
  roll_count integer;
  item public.inventory_items%rowtype;
  item_label text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF code_in = '' OR length(code_in) > 200 THEN RAISE EXCEPTION 'Scan a stock barcode'; END IF;

  -- 1. Individual Thaan label (six-character T code or older registration code)
  SELECT thaan_id INTO v_thaan FROM public.stock_registration_variants WHERE code IN (code_in, upper(code_in)) AND thaan_id IS NOT NULL LIMIT 1;
  -- 2. Six-character identity binding
  IF v_thaan IS NULL THEN
    SELECT record_table, record_id INTO bound_table, bound_id
    FROM public.barcode_identity_bindings WHERE code = upper(code_in);
    IF bound_table = 'thaans' THEN v_thaan := bound_id;
    ELSIF bound_table = 'barcodes' THEN v_barcode := bound_id;
    ELSIF bound_table IS NOT NULL THEN
      RAISE EXCEPTION 'This is a document barcode, not a stock item';
    END IF;
  END IF;
  -- 3. Printed barcode record (finished piece or older fabric label)
  IF v_thaan IS NULL AND v_barcode IS NULL THEN
    SELECT id INTO v_barcode FROM public.barcodes WHERE code IN (code_in, upper(code_in)) LIMIT 1;
  END IF;
  IF v_barcode IS NOT NULL THEN
    SELECT id INTO v_piece FROM public.finished_products WHERE barcode_id = v_barcode;
    IF v_piece IS NULL THEN
      SELECT count(*)::int INTO roll_count FROM public.thaans t JOIN public.fabric_stock s ON s.id = t.fabric_stock_id WHERE s.barcode_id = v_barcode;
      IF roll_count > 1 THEN RAISE EXCEPTION 'This label covers several rolls; scan the roll''s own barcode'; END IF;
      SELECT t.id INTO v_thaan FROM public.thaans t JOIN public.fabric_stock s ON s.id = t.fabric_stock_id WHERE s.barcode_id = v_barcode;
    END IF;
  END IF;
  IF v_thaan IS NULL AND v_piece IS NULL THEN RAISE EXCEPTION 'No stock item matches this barcode'; END IF;

  SELECT * INTO item FROM public.inventory_items
  WHERE (v_thaan IS NOT NULL AND thaan_id = v_thaan) OR (v_piece IS NOT NULL AND finished_product_id = v_piece);
  IF NOT FOUND THEN RAISE EXCEPTION 'This item has no stock record yet (draft label or not received)'; END IF;

  IF v_thaan IS NOT NULL THEN
    SELECT coalesce(g.name, f.name) || coalesce(' · ' || f.colour, '') INTO item_label
    FROM public.thaans t
    JOIN public.fabric_stock s ON s.id = t.fabric_stock_id
    JOIN public.fabrics f ON f.id = s.fabric_id
    LEFT JOIN public.stock_registration_variants v ON v.thaan_id = t.id
    LEFT JOIN public.stock_registration_fabric_types g ON g.id = v.fabric_type_id
    WHERE t.id = v_thaan;
  ELSE
    SELECT pr.name || coalesce(' · ' || coalesce(d.name, j.custom_design), '') || coalesce(' · ' || j.size, '') INTO item_label
    FROM public.finished_products p
    JOIN public.products pr ON pr.id = p.product_id
    LEFT JOIN public.designs d ON d.id = p.design_id
    LEFT JOIN public.production_jobs j ON j.id = p.production_job_id
    WHERE p.id = v_piece;
  END IF;

  RETURN jsonb_build_object(
    'inventory_item_id', item.id,
    'kind', CASE WHEN v_thaan IS NOT NULL THEN 'fabric' ELSE 'piece' END,
    'unit', item.unit,
    'label', coalesce(item_label, 'Stock item'),
    'barcode', code_in,
    'total', public.inventory_balance(item.id, NULL),
    'locations', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'kind', l.kind,
               'quantity', public.inventory_balance(item.id, l.id)) ORDER BY l.kind DESC, l.name)
      FROM public.locations l
      WHERE l.active AND l.kind IN ('workshop', 'showroom_sublocation')
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.owner_stock_correction_lookup(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_stock_correction_lookup(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
