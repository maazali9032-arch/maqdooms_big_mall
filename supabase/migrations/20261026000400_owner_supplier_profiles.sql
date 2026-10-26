BEGIN;

CREATE OR REPLACE FUNCTION public.owner_supplier_profiles() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'gstin', s.gstin,
      'phone', s.phone,
      'email', s.email,
      'address', s.address
    ) ORDER BY lower(s.name), s.id)
    FROM public.suppliers s
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_save_supplier_profile(
  p_id uuid,
  p_name text,
  p_gstin text,
  p_phone text,
  p_email text,
  p_address text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result uuid;
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_gstin text := upper(btrim(coalesce(p_gstin, '')));
  normalized_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  normalized_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  normalized_address text := nullif(btrim(coalesce(p_address, '')), '');
  previous jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;
  IF normalized_name = '' THEN
    RAISE EXCEPTION 'Supplier name required';
  END IF;
  IF normalized_gstin <> '' AND normalized_gstin !~ '^[0-9]{2}[A-Z0-9]{13}$' THEN
    RAISE EXCEPTION 'Supplier GSTIN must contain 15 valid characters';
  END IF;
  IF normalized_email IS NOT NULL AND normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter a valid supplier email address';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE lower(btrim(s.name)) = lower(normalized_name)
      AND (p_id IS NULL OR s.id <> p_id)
  ) THEN
    RAISE EXCEPTION 'A supplier with this name already exists';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.suppliers(name, gstin, phone, email, address)
    VALUES(normalized_name, nullif(normalized_gstin, ''), normalized_phone, normalized_email, normalized_address)
    RETURNING id INTO result;
  ELSE
    SELECT to_jsonb(s) INTO previous FROM public.suppliers s WHERE s.id = p_id FOR UPDATE;
    IF previous IS NULL THEN RAISE EXCEPTION 'Supplier not found'; END IF;
    UPDATE public.suppliers
    SET name = normalized_name,
        gstin = nullif(normalized_gstin, ''),
        phone = normalized_phone,
        email = normalized_email,
        address = normalized_address
    WHERE id = p_id
    RETURNING id INTO result;
  END IF;

  INSERT INTO public.erp_audit_records(
    actor_id, action, entity_table, entity_id, previous_value, new_value, reference
  ) VALUES (
    auth.uid(),
    CASE WHEN p_id IS NULL THEN 'create_supplier_profile' ELSE 'update_supplier_profile' END,
    'suppliers', result, previous,
    (SELECT to_jsonb(s) FROM public.suppliers s WHERE s.id = result),
    'SUPPLIER:' || result::text
  );
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_supplier_profiles() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_save_supplier_profile(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_supplier_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_save_supplier_profile(uuid, text, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
