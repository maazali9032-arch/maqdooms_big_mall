-- E-commerce admin foundation (Phase A, 29 Oct 2026).
-- The ERP's E-commerce section decides what is published; the separate storefront
-- only reads shopper-safe fields through the storefront_* functions below.
-- Decisions: one product page per design with many scanned pieces; online price =
-- showroom SP for garments; fabric shows a staff-set "from" price per metre and is
-- enquire-only; WhatsApp enquiries only (no online orders or holds yet); each
-- category belongs to exactly one section (main or mahib); sold-out pages stay.
BEGIN;

-- 0. Remove the four September demo listings (never published, no stock linked).
DO $$
DECLARE demo uuid[] := ARRAY['55555555-5555-5555-5555-555555555501','55555555-5555-5555-5555-555555555502',
                             '55555555-5555-5555-5555-555555555503','55555555-5555-5555-5555-555555555504']::uuid[];
BEGIN
  IF EXISTS (SELECT 1 FROM public.listings WHERE id = ANY(demo) AND published) THEN
    RAISE EXCEPTION 'A demo listing is published; stop instead of removing it';
  END IF;
  DELETE FROM public.online_orders WHERE listing_id = ANY(demo);
  DELETE FROM public.listing_finished_product_links WHERE listing_id = ANY(demo);
  DELETE FROM public.listings WHERE id = ANY(demo);  -- variants and thaan links cascade
END $$;

-- 1. Categories: one level, each in exactly one section.
CREATE TABLE public.ecommerce_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL CHECK (section IN ('main', 'mahib')),
  name text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 80),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
  description text CHECK (description IS NULL OR length(description) <= 500),
  banner_path text,
  sort_order integer NOT NULL DEFAULT 0,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ecommerce_categories_section_name ON public.ecommerce_categories(section, lower(name));
ALTER TABLE public.ecommerce_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ecommerce_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ecommerce_categories TO authenticated;
CREATE POLICY ecommerce_categories_staff_read ON public.ecommerce_categories FOR SELECT TO authenticated
  USING (public.has_perm(auth.uid(), 'ecommerce.manage_listings'));
CREATE TRIGGER phase15_row_audit AFTER INSERT OR UPDATE OR DELETE ON public.ecommerce_categories
  FOR EACH ROW EXECUTE FUNCTION public.capture_owner_domain_audit();

-- 2. Product (listing) settings.
ALTER TABLE public.listings
  ADD COLUMN category_id uuid REFERENCES public.ecommerce_categories(id),
  ADD COLUMN thumbnail_path text,
  ADD COLUMN featured_in_category boolean NOT NULL DEFAULT false,
  ADD COLUMN featured_rank integer,
  ADD COLUMN home_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT listings_thumbnail_in_images CHECK (thumbnail_path IS NULL OR thumbnail_path = ANY(images));
COMMENT ON COLUMN public.listings.price_paise IS
  'Fabric products only: staff-set display price per metre ("from"). Garment prices come from the showroom SP.';
CREATE UNIQUE INDEX listings_one_home_featured_per_category ON public.listings(category_id)
  WHERE home_featured AND archived_at IS NULL;
CREATE TRIGGER phase15_row_audit AFTER INSERT OR UPDATE OR DELETE ON public.listing_finished_product_links
  FOR EACH ROW EXECUTE FUNCTION public.capture_owner_domain_audit();
CREATE TRIGGER phase15_row_audit AFTER INSERT OR UPDATE OR DELETE ON public.listing_thaan_links
  FOR EACH ROW EXECUTE FUNCTION public.capture_owner_domain_audit();

-- 3. Shop settings shown on the storefront (single row).
CREATE TABLE public.ecommerce_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  whatsapp_number text NOT NULL CHECK (whatsapp_number ~ '^[1-9][0-9]{9,14}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id)
);
ALTER TABLE public.ecommerce_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ecommerce_settings FROM PUBLIC, anon, authenticated;
INSERT INTO public.ecommerce_settings(whatsapp_number) VALUES ('919610415415');
-- (single boolean-keyed row: changes are audited explicitly in ecom_save_settings)

-- 4. Public photo bucket for e-commerce photos (inventory photos stay private).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ecommerce-images', 'ecommerce-images', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
CREATE POLICY ecommerce_images_staff_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ecommerce-images' AND public.has_perm(auth.uid(), 'ecommerce.manage_listings'));
CREATE POLICY ecommerce_images_staff_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ecommerce-images' AND public.has_perm(auth.uid(), 'ecommerce.manage_listings'));
CREATE POLICY ecommerce_images_staff_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'ecommerce-images' AND public.has_perm(auth.uid(), 'ecommerce.manage_listings'));
CREATE POLICY ecommerce_images_staff_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'ecommerce-images' AND public.has_perm(auth.uid(), 'ecommerce.manage_listings'));

-- 5. Shared helpers (internal; not callable from the browser).
CREATE OR REPLACE FUNCTION public.ecom_slugify(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(left(btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-'), 70), '')
$$;

-- Resolve any physical stock barcode to one Thaan or one finished piece.
CREATE OR REPLACE FUNCTION public.resolve_stock_barcode(p_code text, OUT thaan_id uuid, OUT piece_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE code_in text := btrim(coalesce(p_code, '')); bound_table text; bound_id uuid; v_barcode uuid; rolls integer;
BEGIN
  IF code_in = '' OR length(code_in) > 200 THEN RAISE EXCEPTION 'Scan a stock barcode'; END IF;
  SELECT v.thaan_id INTO thaan_id FROM public.stock_registration_variants v
  WHERE v.code IN (code_in, upper(code_in)) AND v.thaan_id IS NOT NULL LIMIT 1;
  IF thaan_id IS NOT NULL THEN RETURN; END IF;
  SELECT record_table, record_id INTO bound_table, bound_id FROM public.barcode_identity_bindings WHERE code = upper(code_in);
  IF bound_table = 'thaans' THEN thaan_id := bound_id; RETURN;
  ELSIF bound_table = 'barcodes' THEN v_barcode := bound_id;
  ELSIF bound_table IS NOT NULL THEN RAISE EXCEPTION 'This is a document barcode, not a stock item';
  END IF;
  IF v_barcode IS NULL THEN SELECT id INTO v_barcode FROM public.barcodes WHERE code IN (code_in, upper(code_in)) LIMIT 1; END IF;
  IF v_barcode IS NULL THEN RAISE EXCEPTION 'No stock item matches this barcode'; END IF;
  SELECT id INTO piece_id FROM public.finished_products WHERE barcode_id = v_barcode;
  IF piece_id IS NOT NULL THEN RETURN; END IF;
  SELECT count(*)::int INTO rolls FROM public.thaans t JOIN public.fabric_stock s ON s.id = t.fabric_stock_id WHERE s.barcode_id = v_barcode;
  IF rolls > 1 THEN RAISE EXCEPTION 'This label covers several rolls; scan the roll''s own barcode'; END IF;
  SELECT t.id INTO thaan_id FROM public.thaans t JOIN public.fabric_stock s ON s.id = t.fabric_stock_id WHERE s.barcode_id = v_barcode;
  IF thaan_id IS NULL THEN RAISE EXCEPTION 'No stock item matches this barcode'; END IF;
END;
$$;

-- Facts about one finished piece, as the storefront needs them.
CREATE OR REPLACE FUNCTION public.ecom_piece_facts(p_piece uuid)
RETURNS TABLE(piece_id uuid, barcode text, product_id uuid, product_name text, design text, design_key text,
              size text, sp_paise bigint, location_name text, available boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, b.code, p.product_id, pr.name,
    nullif(coalesce(d.name, j.custom_design, vp.vendor_style, ''), ''),
    p.product_id::text || ':' || lower(btrim(coalesce(d.name, j.custom_design, vp.vendor_style, ''))),
    nullif(btrim(coalesce(j.size, vp.size, '')), ''),
    sp.sp_paise::bigint, l.name,
    (p.status = 'available' AND l.active AND l.kind = 'showroom_sublocation' AND public.is_showroom_location(l.id)
      AND coalesce(sp.sp_paise, 0) > 0
      AND coalesce((SELECT public.inventory_balance(i.id, l.id) FROM public.inventory_items i WHERE i.finished_product_id = p.id), 0) = 1)
  FROM public.finished_products p
  JOIN public.products pr ON pr.id = p.product_id
  JOIN public.barcodes b ON b.id = p.barcode_id
  LEFT JOIN public.designs d ON d.id = p.design_id
  LEFT JOIN public.production_jobs j ON j.id = p.production_job_id
  LEFT JOIN public.vendor_finished_product_receipt_pieces vp ON vp.finished_product_id = p.id
  LEFT JOIN public.locations l ON l.id = p.current_location_id
  LEFT JOIN LATERAL (SELECT x.sp_paise FROM public.finished_product_prices x WHERE x.finished_product_id = p.id
                     ORDER BY x.revision DESC LIMIT 1) sp ON true
  WHERE p.id = p_piece
$$;

-- Facts about one Thaan: its fabric name and whether any metres are on a showroom floor.
CREATE OR REPLACE FUNCTION public.ecom_thaan_facts(p_thaan uuid)
RETURNS TABLE(thaan_id uuid, barcode text, fabric_name text, colour text, showroom_mm numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, coalesce(v.code, t.barcode, bc.code), coalesce(g.name, f.name), f.colour,
    coalesce((SELECT sum(public.inventory_balance(i.id, l.id)) FROM public.inventory_items i
              JOIN public.locations l ON l.active AND l.kind = 'showroom_sublocation' AND public.is_showroom_location(l.id)
              WHERE i.thaan_id = t.id), 0)
  FROM public.thaans t
  JOIN public.fabric_stock s ON s.id = t.fabric_stock_id
  JOIN public.fabrics f ON f.id = s.fabric_id
  JOIN public.barcodes bc ON bc.id = s.barcode_id
  LEFT JOIN public.stock_registration_variants v ON v.thaan_id = t.id
  LEFT JOIN public.stock_registration_fabric_types g ON g.id = v.fabric_type_id
  WHERE t.id = p_thaan
$$;

-- What a product page offers right now, derived from the stock ledger (never stored).
CREATE OR REPLACE FUNCTION public.ecom_listing_offer(p_listing uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.listings%rowtype; sizes jsonb; fabric_in_stock boolean; pieces integer; rolls integer;
BEGIN
  SELECT * INTO l FROM public.listings WHERE id = p_listing;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*)::int INTO pieces FROM public.listing_finished_product_links WHERE listing_id = p_listing;
  SELECT count(*)::int INTO rolls FROM public.listing_thaan_links WHERE listing_id = p_listing;
  IF pieces > 0 THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('size', s.size, 'price_paise', s.price, 'left', s.left_n)
             ORDER BY (s.size ~ '^[0-9]+$') DESC, nullif(regexp_replace(coalesce(s.size, ''), '[^0-9]', '', 'g'), '')::int, s.size), '[]'::jsonb)
    INTO sizes
    FROM (
      SELECT f.size, min(f.sp_paise) FILTER (WHERE f.available) AS price,
             count(*) FILTER (WHERE f.available)::int AS left_n
      FROM public.listing_finished_product_links k
      CROSS JOIN LATERAL public.ecom_piece_facts(k.finished_product_id) f
      WHERE k.listing_id = p_listing
      GROUP BY f.size
    ) s;
    RETURN jsonb_build_object('kind', 'garment', 'sizes', sizes,
      'total_left', (SELECT coalesce(sum((x->>'left')::int), 0) FROM jsonb_array_elements(sizes) x),
      'price_min', (SELECT min((x->>'price_paise')::bigint) FROM jsonb_array_elements(sizes) x WHERE (x->>'left')::int > 0),
      'price_max', (SELECT max((x->>'price_paise')::bigint) FROM jsonb_array_elements(sizes) x WHERE (x->>'left')::int > 0),
      'sold_out', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(sizes) x WHERE (x->>'left')::int > 0));
  ELSIF rolls > 0 THEN
    SELECT bool_or(f.showroom_mm > 0) INTO fabric_in_stock
    FROM public.listing_thaan_links k CROSS JOIN LATERAL public.ecom_thaan_facts(k.thaan_id) f WHERE k.listing_id = p_listing;
    RETURN jsonb_build_object('kind', 'fabric', 'price_from_paise_per_m', l.price_paise,
      'sold_out', NOT coalesce(fabric_in_stock, false));
  END IF;
  RETURN jsonb_build_object('kind', 'empty', 'sold_out', true);
END;
$$;

REVOKE ALL ON FUNCTION public.ecom_slugify(text), public.resolve_stock_barcode(text), public.ecom_piece_facts(uuid),
  public.ecom_thaan_facts(uuid), public.ecom_listing_offer(uuid) FROM PUBLIC, anon, authenticated;

-- 6. Staff functions (Owner and E-commerce Manager).
CREATE OR REPLACE FUNCTION public.ecom_require_staff() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_perm(auth.uid(), 'ecommerce.manage_listings') THEN RAISE EXCEPTION 'E-commerce access required'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ecom_require_staff() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ecom_categories_admin() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ecom_require_staff();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'section', c.section, 'name', c.name, 'slug', c.slug,
      'description', c.description, 'banner_path', c.banner_path, 'sort_order', c.sort_order, 'hidden', c.hidden,
      'products', (SELECT count(*) FROM public.listings x WHERE x.category_id = c.id AND x.archived_at IS NULL),
      'published', (SELECT count(*) FROM public.listings x WHERE x.category_id = c.id AND x.archived_at IS NULL AND x.published))
    ORDER BY c.section, c.sort_order, c.name) FROM public.ecommerce_categories c), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.ecom_save_category(p_id uuid, p_section text, p_name text, p_slug text,
  p_description text, p_sort_order integer, p_hidden boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result uuid; clean_slug text := coalesce(public.ecom_slugify(p_slug), public.ecom_slugify(p_name));
BEGIN
  PERFORM public.ecom_require_staff();
  IF p_section NOT IN ('main', 'mahib') THEN RAISE EXCEPTION 'Choose Main store or Mahib'; END IF;
  IF nullif(btrim(p_name), '') IS NULL OR clean_slug IS NULL THEN RAISE EXCEPTION 'Category name required'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.ecommerce_categories(section, name, slug, description, sort_order, hidden)
    VALUES (p_section, btrim(p_name), clean_slug, nullif(btrim(p_description), ''), coalesce(p_sort_order, 0), coalesce(p_hidden, false))
    RETURNING id INTO result;
  ELSE
    UPDATE public.ecommerce_categories SET section = p_section, name = btrim(p_name), slug = clean_slug,
      description = nullif(btrim(p_description), ''), sort_order = coalesce(p_sort_order, 0),
      hidden = coalesce(p_hidden, false), updated_at = now()
    WHERE id = p_id RETURNING id INTO result;
    IF result IS NULL THEN RAISE EXCEPTION 'Category not found'; END IF;
    -- A product's section follows its category; home-featured stays one per category.
  END IF;
  RETURN result;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'A category with this name or web address already exists';
END;
$$;

CREATE OR REPLACE FUNCTION public.ecom_delete_category(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ecom_require_staff();
  IF EXISTS (SELECT 1 FROM public.listings WHERE category_id = p_id) THEN
    RAISE EXCEPTION 'This category has products; hide it instead, or move its products first';
  END IF;
  DELETE FROM public.ecommerce_categories WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Category not found'; END IF;
END;
$$;

-- Scan a barcode in the E-commerce section: what it is, whether it can be published, where it already is.
CREATE OR REPLACE FUNCTION public.ecom_scan(p_barcode text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; f record; t record; current_listing jsonb; matches jsonb;
BEGIN
  PERFORM public.ecom_require_staff();
  SELECT * INTO r FROM public.resolve_stock_barcode(p_barcode);
  IF r.piece_id IS NOT NULL THEN
    SELECT * INTO f FROM public.ecom_piece_facts(r.piece_id);
    SELECT jsonb_build_object('id', l.id, 'title', l.title, 'published', l.published) INTO current_listing
    FROM public.listing_finished_product_links k JOIN public.listings l ON l.id = k.listing_id AND l.archived_at IS NULL
    WHERE k.finished_product_id = r.piece_id LIMIT 1;
    SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', l.id, 'title', l.title, 'published', l.published)), '[]'::jsonb) INTO matches
    FROM public.listings l JOIN public.listing_finished_product_links k ON k.listing_id = l.id
    CROSS JOIN LATERAL public.ecom_piece_facts(k.finished_product_id) other
    WHERE l.archived_at IS NULL AND other.design_key = f.design_key;
    RETURN jsonb_build_object('kind', 'piece', 'stock_id', f.piece_id, 'barcode', f.barcode, 'product', f.product_name,
      'design', f.design, 'size', f.size, 'sp_paise', f.sp_paise, 'location', f.location_name, 'available', coalesce(f.available, false),
      'suggested_title', btrim(f.product_name || coalesce(' ' || f.design, '')),
      'current_listing', current_listing, 'matching_listings', matches);
  END IF;
  SELECT * INTO t FROM public.ecom_thaan_facts(r.thaan_id);
  SELECT jsonb_build_object('id', l.id, 'title', l.title, 'published', l.published) INTO current_listing
  FROM public.listing_thaan_links k JOIN public.listings l ON l.id = k.listing_id AND l.archived_at IS NULL
  WHERE k.thaan_id = r.thaan_id LIMIT 1;
  RETURN jsonb_build_object('kind', 'fabric', 'stock_id', t.thaan_id, 'barcode', t.barcode, 'product', t.fabric_name,
    'design', t.colour, 'available', coalesce(t.showroom_mm, 0) > 0, 'suggested_title', btrim(t.fabric_name || coalesce(' ' || t.colour, '')),
    'current_listing', current_listing, 'matching_listings', '[]'::jsonb);
END;
$$;

-- Link a scanned item to a product page (shared by create and add).
CREATE OR REPLACE FUNCTION public.ecom_link_scanned(p_listing uuid, p_barcode text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; f record; t record; l public.listings%rowtype; existing_key text;
BEGIN
  PERFORM public.ecom_require_staff();
  SELECT * INTO l FROM public.listings WHERE id = p_listing AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  SELECT * INTO r FROM public.resolve_stock_barcode(p_barcode);
  IF r.piece_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.listing_thaan_links WHERE listing_id = p_listing) THEN
      RAISE EXCEPTION 'This product page is for fabric; garments need their own page';
    END IF;
    SELECT * INTO f FROM public.ecom_piece_facts(r.piece_id);
    IF NOT coalesce(f.available, false) THEN RAISE EXCEPTION 'This piece is not available on a showroom floor with a saved SP'; END IF;
    IF EXISTS (SELECT 1 FROM public.listing_finished_product_links k JOIN public.listings x ON x.id = k.listing_id AND x.archived_at IS NULL
               WHERE k.finished_product_id = r.piece_id AND k.listing_id <> p_listing) THEN
      RAISE EXCEPTION 'This piece is already on another product page';
    END IF;
    SELECT other.design_key INTO existing_key FROM public.listing_finished_product_links k
      CROSS JOIN LATERAL public.ecom_piece_facts(k.finished_product_id) other WHERE k.listing_id = p_listing LIMIT 1;
    IF existing_key IS NOT NULL AND existing_key <> f.design_key THEN
      RAISE EXCEPTION 'Only identical pieces (same product and design) can share a page; sizes may differ';
    END IF;
    INSERT INTO public.listing_finished_product_links(listing_id, finished_product_id) VALUES (p_listing, r.piece_id) ON CONFLICT DO NOTHING;
  ELSE
    IF EXISTS (SELECT 1 FROM public.listing_finished_product_links WHERE listing_id = p_listing) THEN
      RAISE EXCEPTION 'This product page is for garments; fabric needs its own page';
    END IF;
    SELECT * INTO t FROM public.ecom_thaan_facts(r.thaan_id);
    IF coalesce(t.showroom_mm, 0) <= 0 THEN RAISE EXCEPTION 'This roll has no metres on a showroom floor'; END IF;
    INSERT INTO public.listing_thaan_links(listing_id, thaan_id) VALUES (p_listing, r.thaan_id) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE public.listings SET stock_mode = 'linked', updated_at = now() WHERE id = p_listing;
  RETURN public.ecom_listing_offer(p_listing);
END;
$$;
REVOKE ALL ON FUNCTION public.ecom_link_scanned(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ecom_create_product(p_barcode text, p_title text, p_category uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE base text := public.ecom_slugify(p_title); candidate text; n integer := 1; result uuid;
BEGIN
  PERFORM public.ecom_require_staff();
  IF nullif(btrim(p_title), '') IS NULL OR base IS NULL THEN RAISE EXCEPTION 'Product name required'; END IF;
  IF p_category IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ecommerce_categories WHERE id = p_category) THEN
    RAISE EXCEPTION 'Category not found';
  END IF;
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM public.listings WHERE slug = candidate) LOOP n := n + 1; candidate := base || '-' || n; END LOOP;
  INSERT INTO public.listings(title, slug, stock_mode, published, category_id, images, tags)
  VALUES (btrim(p_title), candidate, 'linked', false, p_category, '{}', '{}') RETURNING id INTO result;
  PERFORM public.ecom_link_scanned(result, p_barcode);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.ecom_add_stock(p_listing uuid, p_barcode text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ecom_require_staff();
  RETURN public.ecom_link_scanned(p_listing, p_barcode);
END;
$$;

CREATE OR REPLACE FUNCTION public.ecom_remove_stock(p_listing uuid, p_stock_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ecom_require_staff();
  DELETE FROM public.listing_finished_product_links WHERE listing_id = p_listing AND finished_product_id = p_stock_id;
  DELETE FROM public.listing_thaan_links WHERE listing_id = p_listing AND thaan_id = p_stock_id;
  UPDATE public.listings SET updated_at = now() WHERE id = p_listing;
  RETURN public.ecom_listing_offer(p_listing);
END;
$$;

-- Save the editable details of a product page. Photos are paths in the public
-- 'ecommerce-images' bucket under the product's own folder.
CREATE OR REPLACE FUNCTION public.ecom_save_product(p_listing uuid, p_details jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d jsonb := coalesce(p_details, '{}'::jsonb); imgs text[]; thumb text; is_fabric boolean; fabric_price bigint;
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
  UPDATE public.listings SET
    title = btrim(d->>'title'),
    description = nullif(btrim(d->>'description'), ''),
    tags = coalesce((SELECT array_agg(DISTINCT btrim(x)) FROM jsonb_array_elements_text(coalesce(d->'tags', '[]'::jsonb)) x WHERE btrim(x) <> ''), '{}'),
    seo_title = nullif(left(btrim(d->>'seo_title'), 70), ''),
    seo_description = nullif(left(btrim(d->>'seo_description'), 170), ''),
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

CREATE OR REPLACE FUNCTION public.ecom_set_published(p_listing uuid, p_published boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.listings%rowtype; offer jsonb;
BEGIN
  PERFORM public.ecom_require_staff();
  SELECT * INTO l FROM public.listings WHERE id = p_listing AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF p_published THEN
    offer := public.ecom_listing_offer(p_listing);
    IF l.category_id IS NULL THEN RAISE EXCEPTION 'Choose a category before publishing'; END IF;
    IF l.thumbnail_path IS NULL THEN RAISE EXCEPTION 'Add at least one photo before publishing'; END IF;
    IF offer->>'kind' = 'empty' THEN RAISE EXCEPTION 'Scan at least one piece or roll into this product first'; END IF;
  END IF;
  UPDATE public.listings SET published = coalesce(p_published, false),
    home_featured = CASE WHEN coalesce(p_published, false) THEN home_featured ELSE false END, updated_at = now()
  WHERE id = p_listing;
END;
$$;

CREATE OR REPLACE FUNCTION public.ecom_set_featured(p_listing uuid, p_featured boolean, p_rank integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ecom_require_staff();
  UPDATE public.listings SET featured_in_category = coalesce(p_featured, false),
    featured_rank = CASE WHEN coalesce(p_featured, false) THEN p_rank END, updated_at = now()
  WHERE id = p_listing AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ecom_set_home_featured(p_listing uuid, p_on boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.listings%rowtype;
BEGIN
  PERFORM public.ecom_require_staff();
  SELECT * INTO l FROM public.listings WHERE id = p_listing AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF coalesce(p_on, false) THEN
    IF l.category_id IS NULL OR NOT l.published THEN RAISE EXCEPTION 'Publish the product in a category first'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('maqdooms:home-featured:' || l.category_id::text, 0));
    UPDATE public.listings SET home_featured = false, updated_at = now()
    WHERE category_id = l.category_id AND home_featured AND id <> p_listing;
  END IF;
  UPDATE public.listings SET home_featured = coalesce(p_on, false), updated_at = now() WHERE id = p_listing;
END;
$$;

CREATE OR REPLACE FUNCTION public.ecom_archive_product(p_listing uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ecom_require_staff();
  UPDATE public.listings SET archived_at = now(), published = false, home_featured = false,
    featured_in_category = false, updated_at = now()
  WHERE id = p_listing AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ecom_catalogue_admin() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ecom_require_staff();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'slug', l.slug, 'published', l.published,
      'category_id', l.category_id, 'category', c.name, 'section', c.section, 'thumbnail', l.thumbnail_path,
      'images', to_jsonb(l.images), 'featured_in_category', l.featured_in_category, 'featured_rank', l.featured_rank,
      'home_featured', l.home_featured, 'updated_at', l.updated_at, 'offer', public.ecom_listing_offer(l.id))
    ORDER BY l.updated_at DESC)
    FROM public.listings l LEFT JOIN public.ecommerce_categories c ON c.id = l.category_id
    WHERE l.archived_at IS NULL), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.ecom_product_admin(p_listing uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.listings%rowtype;
BEGIN
  PERFORM public.ecom_require_staff();
  SELECT * INTO l FROM public.listings WHERE id = p_listing AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  RETURN jsonb_build_object('id', l.id, 'title', l.title, 'slug', l.slug, 'description', l.description, 'tags', to_jsonb(l.tags),
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

CREATE OR REPLACE FUNCTION public.ecom_settings_admin() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ecom_require_staff();
  RETURN (SELECT jsonb_build_object('whatsapp_number', whatsapp_number, 'updated_at', updated_at) FROM public.ecommerce_settings);
END;
$$;

CREATE OR REPLACE FUNCTION public.ecom_save_settings(p_whatsapp_number text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE digits text := regexp_replace(coalesce(p_whatsapp_number, ''), '[^0-9]', '', 'g');
BEGIN
  PERFORM public.ecom_require_staff();
  IF length(digits) = 10 THEN digits := '91' || digits; END IF;  -- a 10-digit Indian mobile
  IF digits !~ '^[1-9][0-9]{9,14}$' THEN RAISE EXCEPTION 'Enter a WhatsApp number with country code'; END IF;
  UPDATE public.ecommerce_settings SET whatsapp_number = digits, updated_at = now(), updated_by = auth.uid();
  INSERT INTO public.erp_audit_records(actor_id, action, entity_table, entity_id, new_value)
  VALUES (auth.uid(), 'ecommerce_settings_saved', 'ecommerce_settings', md5('ecommerce_settings')::uuid, jsonb_build_object('whatsapp_number', digits));
END;
$$;

REVOKE ALL ON FUNCTION public.ecom_categories_admin(), public.ecom_save_category(uuid,text,text,text,text,integer,boolean),
  public.ecom_delete_category(uuid), public.ecom_scan(text), public.ecom_create_product(text,text,uuid),
  public.ecom_add_stock(uuid,text), public.ecom_remove_stock(uuid,uuid), public.ecom_save_product(uuid,jsonb),
  public.ecom_set_published(uuid,boolean), public.ecom_set_featured(uuid,boolean,integer),
  public.ecom_set_home_featured(uuid,boolean), public.ecom_archive_product(uuid), public.ecom_catalogue_admin(),
  public.ecom_product_admin(uuid), public.ecom_settings_admin(), public.ecom_save_settings(text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ecom_categories_admin(), public.ecom_save_category(uuid,text,text,text,text,integer,boolean),
  public.ecom_delete_category(uuid), public.ecom_scan(text), public.ecom_create_product(text,text,uuid),
  public.ecom_add_stock(uuid,text), public.ecom_remove_stock(uuid,uuid), public.ecom_save_product(uuid,jsonb),
  public.ecom_set_published(uuid,boolean), public.ecom_set_featured(uuid,boolean,integer),
  public.ecom_set_home_featured(uuid,boolean), public.ecom_archive_product(uuid), public.ecom_catalogue_admin(),
  public.ecom_product_admin(uuid), public.ecom_settings_admin(), public.ecom_save_settings(text)
TO authenticated;

-- 7. Public storefront functions (no login). Shopper-safe fields only: never
-- barcodes, floors, costs, stock IDs or exact fabric metres.
CREATE OR REPLACE FUNCTION public.storefront_product_card(p_listing uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('slug', l.slug, 'title', l.title, 'thumbnail', l.thumbnail_path,
    'category', jsonb_build_object('slug', c.slug, 'name', c.name, 'section', c.section),
    'kind', o->>'kind', 'price_min_paise', o->'price_min', 'price_max_paise', o->'price_max',
    'price_from_paise_per_m', o->'price_from_paise_per_m', 'sold_out', (o->>'sold_out')::boolean,
    'featured_in_category', l.featured_in_category, 'featured_rank', l.featured_rank, 'home_featured', l.home_featured)
  FROM public.listings l JOIN public.ecommerce_categories c ON c.id = l.category_id
  CROSS JOIN LATERAL (SELECT public.ecom_listing_offer(l.id) o) x
  WHERE l.id = p_listing AND l.published AND l.archived_at IS NULL AND NOT c.hidden
$$;
REVOKE ALL ON FUNCTION public.storefront_product_card(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.storefront_settings() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('whatsapp_number', whatsapp_number) FROM public.ecommerce_settings
$$;

CREATE OR REPLACE FUNCTION public.storefront_categories(p_section text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('slug', c.slug, 'name', c.name, 'section', c.section,
      'description', c.description, 'banner', c.banner_path,
      'products', (SELECT count(*) FROM public.listings l WHERE l.category_id = c.id AND l.published AND l.archived_at IS NULL))
    ORDER BY c.section, c.sort_order, c.name), '[]'::jsonb)
  FROM public.ecommerce_categories c
  WHERE NOT c.hidden AND (p_section IS NULL OR c.section = p_section)
$$;

CREATE OR REPLACE FUNCTION public.storefront_products(p_section text DEFAULT NULL, p_category text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(public.storefront_product_card(l.id)
           ORDER BY l.featured_in_category DESC, l.featured_rank NULLS LAST, l.updated_at DESC), '[]'::jsonb)
  FROM public.listings l JOIN public.ecommerce_categories c ON c.id = l.category_id
  WHERE l.published AND l.archived_at IS NULL AND NOT c.hidden
    AND (p_section IS NULL OR c.section = p_section) AND (p_category IS NULL OR c.slug = p_category)
$$;

CREATE OR REPLACE FUNCTION public.storefront_home_featured() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(public.storefront_product_card(l.id) ORDER BY c.section, c.sort_order, c.name), '[]'::jsonb)
  FROM public.listings l JOIN public.ecommerce_categories c ON c.id = l.category_id
  WHERE l.home_featured AND l.published AND l.archived_at IS NULL AND NOT c.hidden
$$;

CREATE OR REPLACE FUNCTION public.storefront_product(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.storefront_product_card(l.id) || jsonb_build_object(
    'description', l.description, 'images', to_jsonb(l.images), 'tags', to_jsonb(l.tags),
    'seo_title', coalesce(l.seo_title, l.title), 'seo_description', l.seo_description,
    'sizes', CASE WHEN o->>'kind' = 'garment' THEN o->'sizes' ELSE '[]'::jsonb END)
  FROM public.listings l JOIN public.ecommerce_categories c ON c.id = l.category_id
  CROSS JOIN LATERAL (SELECT public.ecom_listing_offer(l.id) o) x
  WHERE l.slug = p_slug AND l.published AND l.archived_at IS NULL AND NOT c.hidden
$$;

REVOKE ALL ON FUNCTION public.storefront_settings(), public.storefront_categories(text), public.storefront_products(text,text),
  public.storefront_home_featured(), public.storefront_product(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront_settings(), public.storefront_categories(text), public.storefront_products(text,text),
  public.storefront_home_featured(), public.storefront_product(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
