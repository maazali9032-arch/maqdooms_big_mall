BEGIN;

CREATE OR REPLACE FUNCTION public.vendor_readymade_stock(p_search text DEFAULT NULL, p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  can_read boolean := public.has_role(auth.uid(), 'owner')
    OR (public.has_role(auth.uid(), 'stock_entry') AND public.has_perm(auth.uid(), 'inventory.receive'));
  can_see_cost boolean := public.has_role(auth.uid(), 'owner');
BEGIN
  IF NOT can_read THEN
    RAISE EXCEPTION 'Owner or authorised Stock Entry staff required';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Limit must be between 1 and 500';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_value ORDER BY received_at DESC, barcode)
    FROM (
      SELECT
        receipt.created_at AS received_at,
        barcode.code AS barcode,
        jsonb_strip_nulls(jsonb_build_object(
          'id', piece.id,
          'barcode', barcode.code,
          'product', product.name,
          'style', receipt_piece.vendor_style,
          'size', receipt_piece.size,
          'sp_paise', price.sp_paise,
          'cp_paise', CASE WHEN can_see_cost THEN receipt_piece.cp_paise END,
          'batch_code', receipt.code,
          'supplier', receipt.supplier_name,
          'arrival_date', receipt.arrival_date,
          'location', location.name,
          'location_kind', location.kind,
          'status', piece.status,
          'available', piece.status = 'available' AND inventory.id IS NOT NULL
            AND public.inventory_balance(inventory.id, piece.current_location_id) = 1
        )) AS row_value
      FROM public.finished_products piece
      JOIN public.vendor_finished_product_receipt_pieces receipt_piece
        ON receipt_piece.finished_product_id = piece.id
      JOIN public.vendor_finished_product_receipts receipt ON receipt.id = receipt_piece.receipt_id
      JOIN public.barcodes barcode ON barcode.id = piece.barcode_id
      JOIN public.products product ON product.id = piece.product_id
      JOIN public.locations location ON location.id = piece.current_location_id
      LEFT JOIN public.inventory_items inventory ON inventory.finished_product_id = piece.id
      LEFT JOIN LATERAL (
        SELECT sp_paise
        FROM public.finished_product_prices
        WHERE finished_product_id = piece.id
        ORDER BY revision DESC
        LIMIT 1
      ) price ON true
      WHERE (p_search IS NULL OR btrim(p_search) = '' OR concat_ws(' ', barcode.code, product.name,
        receipt_piece.vendor_style, receipt_piece.size, receipt.code, receipt.supplier_name, location.name)
        ILIKE '%' || btrim(p_search) || '%')
      ORDER BY receipt.created_at DESC, barcode.code
      LIMIT p_limit
    ) rows
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.vendor_readymade_stock(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_readymade_stock(text, integer) TO authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;
