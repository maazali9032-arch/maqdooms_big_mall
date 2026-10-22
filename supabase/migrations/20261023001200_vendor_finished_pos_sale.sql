BEGIN;

-- F-prefixed vendor pieces are finished products, but deliberately have no
-- production job. The owner POS scan previously requested the production-only
-- cost summary for every finished product, which rejected a valid vendor piece
-- with "Production Job required".
DO $$
DECLARE original text; updated text;
BEGIN
  original := pg_get_functiondef('public.finished_product_sale_scan(text)'::regprocedure);
  updated := replace(
    original,
    'IF public.has_role(auth.uid(),''owner'') THEN',
    'IF public.has_role(auth.uid(),''owner'') AND piece.vendor_receipt_id IS NULL THEN'
  );
  IF updated = original THEN
    RAISE EXCEPTION 'Vendor POS sale integration point missing';
  END IF;
  EXECUTE updated;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
