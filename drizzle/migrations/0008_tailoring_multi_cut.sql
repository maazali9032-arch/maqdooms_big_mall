-- Counter staff may create a real tailoring work order while preparing an
-- issue. Tailors themselves still receive assigned work rather than creating
-- arbitrary jobs for other staff.
CREATE OR REPLACE FUNCTION public.active_tailors()
RETURNS TABLE(id uuid, full_name text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner', 'counter']) THEN
    RAISE EXCEPTION 'Permission denied: Owner or Counter required';
  END IF;

  RETURN QUERY
  SELECT p.id, p.full_name, p.email
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role_key = 'tailor'
  WHERE p.active
  ORDER BY lower(p.full_name), lower(coalesce(p.email, ''));
END;
$$;

CREATE OR REPLACE FUNCTION public.create_tailoring_job(
  p_garment text,
  p_tailor_id uuid,
  p_customer_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_code text;
  v_tailor_name text;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner', 'counter']) THEN
    RAISE EXCEPTION 'Permission denied: Owner or Counter required';
  END IF;
  IF nullif(btrim(p_garment), '') IS NULL THEN
    RAISE EXCEPTION 'Garment is required';
  END IF;

  SELECT coalesce(nullif(btrim(p.full_name), ''), p.email, 'Tailor')
  INTO v_tailor_name
  FROM public.profiles p
  WHERE p.id = p_tailor_id
    AND p.active
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id AND ur.role_key = 'tailor'
    );

  IF v_tailor_name IS NULL THEN
    RAISE EXCEPTION 'Select an active user with the Tailor role';
  END IF;

  v_code := 'TJ-' || upper(substr(replace(v_id::text, '-', ''), 1, 8));
  INSERT INTO public.tailoring_jobs(
    id, code, garment, tailor_id, tailor_name, customer_id, notes, created_by
  ) VALUES (
    v_id,
    v_code,
    btrim(p_garment),
    p_tailor_id,
    v_tailor_name,
    p_customer_id,
    nullif(btrim(p_notes), ''),
    auth.uid()
  );

  PERFORM public.log_audit(
    'create_tailoring_job',
    'tailoring_job',
    v_id::text,
    jsonb_build_object('code', v_code, 'tailor_id', p_tailor_id)
  );
  RETURN v_id;
END;
$$;

-- Commit every staged fabric cut in one database transaction. cut_thaan()
-- remains the authoritative ledger operation and is reused for every item; if
-- any item fails validation, PostgreSQL rolls the entire batch back.
CREATE OR REPLACE FUNCTION public.issue_tailoring_fabrics(
  p_job_id uuid,
  p_items jsonb,
  p_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item jsonb;
  v_barcode text;
  v_length_mm integer;
  v_result jsonb;
  v_price_paise integer;
  v_selling_value integer;
  v_results jsonb := '[]'::jsonb;
  v_total_length integer := 0;
  v_total_value integer := 0;
BEGIN
  IF NOT public.has_perm(auth.uid(), 'pos.issue_to_tailoring') THEN
    RAISE EXCEPTION 'Permission denied: pos.issue_to_tailoring';
  END IF;
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'A tailoring job is required';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Fabric cuts must be supplied as a list';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one fabric cut';
  END IF;
  IF jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'A maximum of 50 fabric cuts can be issued together';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) item
    GROUP BY lower(btrim(item->>'barcode'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'The same thaan cannot be added more than once';
  END IF;

  FOR v_item IN
    SELECT item
    FROM jsonb_array_elements(p_items) item
    ORDER BY lower(btrim(item->>'barcode'))
  LOOP
    v_barcode := nullif(btrim(v_item->>'barcode'), '');
    IF v_barcode IS NULL THEN
      RAISE EXCEPTION 'Every fabric cut requires a barcode';
    END IF;
    IF coalesce(v_item->>'length_mm', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Invalid cut length for thaan %', v_barcode;
    END IF;
    v_length_mm := (v_item->>'length_mm')::integer;

    v_result := public.cut_thaan(
      p_barcode => v_barcode,
      p_length_mm => v_length_mm,
      p_purpose => 'tailoring',
      p_job_id => p_job_id,
      p_category => coalesce(nullif(btrim(v_item->>'category'), ''), 'outer fabric'),
      p_reason => p_reason
    );

    SELECT t.price_paise INTO v_price_paise
    FROM public.thaans t
    WHERE t.id = (v_result->>'thaan_id')::uuid;
    v_selling_value := round(v_length_mm::numeric / 1000 * v_price_paise)::integer;
    v_total_length := v_total_length + v_length_mm;
    v_total_value := v_total_value + v_selling_value;
    v_results := v_results || jsonb_build_array(
      v_result || jsonb_build_object('selling_value_paise', v_selling_value)
    );
  END LOOP;

  PERFORM public.log_audit(
    'issue_tailoring_fabrics',
    'tailoring_job',
    p_job_id::text,
    jsonb_build_object(
      'cut_count', jsonb_array_length(p_items),
      'total_length_mm', v_total_length,
      'total_selling_value_paise', v_total_value
    )
  );

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'cut_count', jsonb_array_length(p_items),
    'total_length_mm', v_total_length,
    'total_selling_value_paise', v_total_value,
    'cuts', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_tailoring_fabrics(uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_tailoring_fabrics(uuid,jsonb,text) TO authenticated;
