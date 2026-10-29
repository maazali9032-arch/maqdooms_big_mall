-- Final F9 step (29 Oct 2026). Apply only after the frontend that uses the
-- e-commerce functions and ensure_fabric() is deployed: the old frontend wrote
-- these tables directly. All writes now go through permission-checked,
-- audited SECURITY DEFINER functions. Staff keep their read access.
BEGIN;

DROP POLICY IF EXISTS "manage listings" ON public.listings;
DROP POLICY IF EXISTS "manage variants" ON public.listing_variants;
DROP POLICY IF EXISTS "manage listing links" ON public.listing_thaan_links;
DROP POLICY IF EXISTS "manage orders" ON public.online_orders;
DROP POLICY IF EXISTS "manage fabrics" ON public.fabrics;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  public.listings, public.listing_variants, public.listing_thaan_links,
  public.listing_finished_product_links, public.online_orders, public.fabrics
FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
