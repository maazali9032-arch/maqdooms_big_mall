-- Website category photos.
-- Each category can have one photo (4:5, uploaded through the ERP's crop pipeline as
-- categories/<category id>/<uuid>.webp plus its .card.webp copy in the ecommerce-images bucket).
-- The storefront already shows banner_path through storefront_categories(); this only adds a way
-- for E-commerce staff to set or clear it. No table change.

CREATE OR REPLACE FUNCTION public.ecom_set_category_banner(p_id uuid, p_path text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ecom_require_staff();
  IF p_path IS NOT NULL AND p_path !~ ('^categories/' || p_id::text || '/[0-9a-f-]{36}\.webp$') THEN
    RAISE EXCEPTION 'This photo does not belong to this category';
  END IF;
  UPDATE public.ecommerce_categories SET banner_path = p_path, updated_at = now() WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Category not found'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ecom_set_category_banner(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ecom_set_category_banner(uuid, text) TO authenticated;
