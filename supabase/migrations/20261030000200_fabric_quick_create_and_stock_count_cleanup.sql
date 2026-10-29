-- Audit follow-up (29 Oct 2026).
-- 1. ensure_fabric(): Stock Entry's "type a new fabric name" quick-create moves
--    from a direct browser INSERT into one permission-checked function. The
--    direct INSERT grant is revoked by a later migration, applied only after the
--    frontend that calls this function is deployed.
-- 2. Drop the five-argument create_stock_count_audit overload. Migration
--    20261023000600 already drops it in the repository; it was still present on
--    live. The app calls the six-argument version.
BEGIN;

CREATE OR REPLACE FUNCTION public.ensure_fabric(p_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  clean text := btrim(coalesce(p_name, ''));
  slug text;
  new_code text;
  result uuid;
BEGIN
  IF NOT public.has_perm(auth.uid(), 'inventory.receive') THEN
    RAISE EXCEPTION 'Stock receiving permission required';
  END IF;
  IF clean = '' OR length(clean) > 120 THEN
    RAISE EXCEPTION 'Fabric name required (up to 120 characters)';
  END IF;
  -- One creator per name at a time, so two staff typing the same new name get one row.
  PERFORM pg_advisory_xact_lock(hashtextextended('maqdooms:ensure-fabric:' || lower(clean), 0));
  SELECT id INTO result FROM public.fabrics WHERE lower(name) = lower(clean) ORDER BY created_at LIMIT 1;
  IF result IS NOT NULL THEN RETURN result; END IF;

  slug := left(btrim(regexp_replace(upper(clean), '[^A-Z0-9]+', '-', 'g'), '-'), 16);
  new_code := 'FB-' || slug || '-' || right((floor(extract(epoch FROM clock_timestamp()) * 1000))::bigint::text, 4);
  WHILE EXISTS (SELECT 1 FROM public.fabrics WHERE code = new_code) LOOP
    new_code := 'FB-' || slug || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
  END LOOP;

  INSERT INTO public.fabrics(name, code, category) VALUES (clean, new_code, 'Fabric') RETURNING id INTO result;
  PERFORM public.log_audit('create_fabric', 'fabric', new_code, jsonb_build_object('name', clean));
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_fabric(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_fabric(text) TO authenticated;

DROP FUNCTION IF EXISTS public.create_stock_count_audit(uuid,text,text[],uuid[],uuid);

NOTIFY pgrst, 'reload schema';
COMMIT;
