-- Product highlights (29 Oct 2026).
-- A short bullet list (up to 6 items, 60 characters each) shown on the website's
-- product page between the price and the description. Staff write or accept them
-- from the Gemini suggestion in the ERP; the storefront reads them through
-- storefront_product. Order is kept as entered.
BEGIN;

ALTER TABLE public.listings
  ADD COLUMN highlights text[] NOT NULL DEFAULT '{}'
  CONSTRAINT listings_highlights_limit CHECK (cardinality(highlights) <= 6);

-- Same as 20261030000600 plus highlights.
CREATE OR REPLACE FUNCTION public.ecom_save_product(p_listing uuid, p_details jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d jsonb := coalesce(p_details, '{}'::jsonb); imgs text[]; thumb text; is_fabric boolean; fabric_price bigint; hl text[];
BEGIN
  PERFORM public.ecom_require_staff();
  PERFORM 1 FROM public.listings WHERE id = p_listing AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF nullif(btrim(d->>'title'), '') IS NULL OR length(d->>'title') > 120 THEN RAISE EXCEPTION 'Product name required (up to 120 characters)'; END IF;
  SELECT coalesce(array_agg(x), '{}') INTO imgs FROM jsonb_array_elements_text(coalesce(d->'images', '[]'::jsonb)) x;
  IF cardinality(imgs) > 6 THEN RAISE EXCEPTION 'Up to 6 photos'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(imgs) x WHERE x NOT LIKE p_listing::text || '/%') THEN RAISE EXCEPTION 'Photos must be uploaded for this product'; END IF;
  thumb := nullif(d->>'thumbnail', '');
  IF thumb IS NOT NULL AND NOT thumb = ANY(imgs) THEN RAISE EXCEPTION 'The starred photo must be one of the product photos'; END IF;
  IF thumb IS NULL AND cardinality(imgs) > 0 THEN thumb := imgs[1]; END IF;
  IF nullif(d->>'category_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ecommerce_categories WHERE id = (d->>'category_id')::uuid) THEN
    RAISE EXCEPTION 'Category not found';
  END IF;
  is_fabric := EXISTS (SELECT 1 FROM public.listing_thaan_links WHERE listing_id = p_listing);
  fabric_price := CASE WHEN is_fabric THEN nullif(d->>'fabric_price_paise', '')::bigint END;
  IF fabric_price IS NOT NULL AND (fabric_price <= 0 OR fabric_price > 100000000) THEN RAISE EXCEPTION 'Enter a valid price per metre'; END IF;
  SELECT coalesce(array_agg(btrim(x) ORDER BY n), '{}') INTO hl
    FROM jsonb_array_elements_text(coalesce(d->'highlights', '[]'::jsonb)) WITH ORDINALITY AS h(x, n)
    WHERE btrim(x) <> '';
  IF cardinality(hl) > 6 THEN RAISE EXCEPTION 'Up to 6 highlights'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(hl) x WHERE length(x) > 60) THEN RAISE EXCEPTION 'Each highlight can be up to 60 characters'; END IF;
  UPDATE public.listings SET
    title = btrim(d->>'title'),
    description = nullif(btrim(d->>'description'), ''),
    tags = coalesce((SELECT array_agg(DISTINCT btrim(x)) FROM jsonb_array_elements_text(coalesce(d->'tags', '[]'::jsonb)) x WHERE btrim(x) <> ''), '{}'),
    seo_title = nullif(left(btrim(d->>'seo_title'), 70), ''),
    seo_description = nullif(left(btrim(d->>'seo_description'), 170), ''),
    highlights = hl,
    category_id = nullif(d->>'category_id', '')::uuid,
    images = imgs,
    thumbnail_path = thumb,
    price_paise = fabric_price,
    sale_price_paise = NULL,
    -- moving category drops home-featured so the one-per-category rule can't break
    home_featured = CASE WHEN category_id IS DISTINCT FROM nullif(d->>'category_id', '')::uuid THEN false ELSE home_featured END,
    updated_at = now()
  WHERE id = p_listing;
END;
$$;

-- Same as 20261030000600 plus highlights.
CREATE OR REPLACE FUNCTION public.ecom_product_admin(p_listing uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.listings%rowtype;
BEGIN
  PERFORM public.ecom_require_staff();
  SELECT * INTO l FROM public.listings WHERE id = p_listing AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  RETURN jsonb_build_object('id', l.id, 'title', l.title, 'slug', l.slug, 'description', l.description, 'tags', to_jsonb(l.tags),
    'highlights', to_jsonb(l.highlights),
    'seo_title', l.seo_title, 'seo_description', l.seo_description, 'category_id', l.category_id,
    'images', to_jsonb(l.images), 'thumbnail', l.thumbnail_path, 'fabric_price_paise', l.price_paise,
    'published', l.published, 'featured_in_category', l.featured_in_category, 'featured_rank', l.featured_rank,
    'home_featured', l.home_featured, 'offer', public.ecom_listing_offer(l.id),
    'stock', coalesce((
      SELECT jsonb_agg(jsonb_build_object('stock_id', f.piece_id, 'barcode', f.barcode, 'kind', 'piece', 'size', f.size,
        'sp_paise', f.sp_paise, 'location', f.location_name, 'available', f.available) ORDER BY f.size, f.barcode)
      FROM public.listing_finished_product_links k CROSS JOIN LATERAL public.ecom_piece_facts(k.finished_product_id) f
      WHERE k.listing_id = l.id), '[]'::jsonb)
      || coalesce((
      SELECT jsonb_agg(jsonb_build_object('stock_id', t.thaan_id, 'barcode', t.barcode, 'kind', 'fabric', 'colour', t.colour,
        'available', t.showroom_mm > 0) ORDER BY t.barcode)
      FROM public.listing_thaan_links k CROSS JOIN LATERAL public.ecom_thaan_facts(k.thaan_id) t
      WHERE k.listing_id = l.id), '[]'::jsonb));
END;
$$;

-- Same as 20261030000600 plus highlights.
CREATE OR REPLACE FUNCTION public.storefront_product(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.storefront_product_card(l.id) || jsonb_build_object(
    'description', l.description, 'images', to_jsonb(l.images), 'tags', to_jsonb(l.tags),
    'highlights', to_jsonb(l.highlights),
    'seo_title', coalesce(l.seo_title, l.title), 'seo_description', l.seo_description,
    'sizes', CASE WHEN o->>'kind' = 'garment' THEN o->'sizes' ELSE '[]'::jsonb END)
  FROM public.listings l JOIN public.ecommerce_categories c ON c.id = l.category_id
  CROSS JOIN LATERAL (SELECT public.ecom_listing_offer(l.id) o) x
  WHERE l.slug = p_slug AND l.published AND l.archived_at IS NULL AND NOT c.hidden
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
