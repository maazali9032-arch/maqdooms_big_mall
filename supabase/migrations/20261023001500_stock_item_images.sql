-- One stored image may be linked to many physical stock items.  The UI resolves
-- batch/type/piece inheritance before saving these links, so every barcode has
-- one clear effective image without duplicating the underlying object.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'stock-images',
  'stock-images',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE public.stock_item_images (
  item_kind text NOT NULL CHECK (item_kind IN ('thaan', 'finished_product')),
  item_id uuid NOT NULL,
  storage_path text NOT NULL CHECK (btrim(storage_path) <> ''),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_kind, item_id)
);

ALTER TABLE public.stock_item_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_item_images_read ON public.stock_item_images
  FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));

CREATE POLICY stock_images_read ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'stock-images' AND public.is_active_staff(auth.uid())
  );
CREATE POLICY stock_images_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'stock-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.is_active_staff(auth.uid())
    AND (
      public.has_role(auth.uid(), 'owner')
      OR public.has_perm(auth.uid(), 'inventory.receive')
      OR public.has_perm(auth.uid(), 'production.receive')
    )
  );
CREATE POLICY stock_images_delete ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'stock-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.is_active_staff(auth.uid())
  );

CREATE FUNCTION public.save_stock_item_images(p_links jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  entry jsonb;
  link_kind text;
  link_id uuid;
  link_path text;
  link_mime text;
  saved_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Active staff required';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'owner')
    OR public.has_perm(auth.uid(), 'inventory.receive')
    OR public.has_perm(auth.uid(), 'production.receive')
  ) THEN
    RAISE EXCEPTION 'Stock image access required';
  END IF;
  IF jsonb_typeof(p_links) <> 'array' OR jsonb_array_length(p_links) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Provide 1 to 5000 image links';
  END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(p_links)
  LOOP
    link_kind := entry->>'item_kind';
    link_id := (entry->>'item_id')::uuid;
    link_path := btrim(entry->>'storage_path');
    link_mime := entry->>'mime_type';

    IF link_kind NOT IN ('thaan', 'finished_product')
       OR link_mime NOT IN ('image/jpeg', 'image/png', 'image/webp')
       OR split_part(link_path, '/', 1) <> auth.uid()::text THEN
      RAISE EXCEPTION 'Invalid stock image link';
    END IF;
    IF link_kind = 'thaan' AND NOT EXISTS (SELECT 1 FROM public.thaans WHERE id = link_id) THEN
      RAISE EXCEPTION 'Thaan not found';
    END IF;
    IF link_kind = 'finished_product' AND NOT EXISTS (
      SELECT 1 FROM public.finished_products WHERE id = link_id
    ) THEN
      RAISE EXCEPTION 'Finished product not found';
    END IF;

    INSERT INTO public.stock_item_images(item_kind,item_id,storage_path,mime_type,created_by)
    VALUES(link_kind,link_id,link_path,link_mime,auth.uid())
    ON CONFLICT (item_kind,item_id) DO UPDATE SET
      storage_path = EXCLUDED.storage_path,
      mime_type = EXCLUDED.mime_type,
      updated_at = now();
    saved_count := saved_count + 1;
  END LOOP;
  RETURN saved_count;
END;
$$;

REVOKE ALL ON TABLE public.stock_item_images FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.stock_item_images TO authenticated;
REVOKE ALL ON FUNCTION public.save_stock_item_images(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_stock_item_images(jsonb) TO authenticated;

