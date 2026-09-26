-- Extend the existing customer record for POS contact capture. Name remains a
-- useful display field but is optional for counter sales.
ALTER TABLE public.customers ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public.customers ADD COLUMN whatsapp_phone text;

-- A counter may only issue fabric to a real, currently actionable tailoring
-- job that has an assignee. This also protects the cut operation if a stale or
-- fabricated job UUID is submitted outside the UI.
CREATE OR REPLACE FUNCTION public.require_eligible_tailoring_job()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.tailoring_jobs j
    WHERE j.id = NEW.job_id
      AND j.status IN ('open', 'in_progress')
      AND (j.tailor_id IS NOT NULL OR nullif(btrim(j.tailor_name), '') IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Tailoring job is not assigned or is no longer available';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_eligible_tailoring_job ON public.tailoring_job_lines;
CREATE TRIGGER trg_require_eligible_tailoring_job
BEFORE INSERT OR UPDATE OF job_id ON public.tailoring_job_lines
FOR EACH ROW EXECUTE FUNCTION public.require_eligible_tailoring_job();

-- Reuse a matching customer whenever a contact/WhatsApp number (or a
-- name-only profile) already exists. Advisory locks serialize matching contact
-- numbers so concurrent counter requests do not create avoidable duplicates.
CREATE OR REPLACE FUNCTION public.find_or_create_customer(
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_whatsapp_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text := nullif(btrim(p_name), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_whatsapp text := nullif(btrim(p_whatsapp_phone), '');
  v_notes text := nullif(btrim(p_notes), '');
  v_phone_key text;
  v_whatsapp_key text;
  v_customer_id uuid;
BEGIN
  IF NOT public.has_perm(auth.uid(), 'pos.sell') THEN
    RAISE EXCEPTION 'Permission denied: pos.sell';
  END IF;

  v_phone_key := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');
  v_whatsapp_key := nullif(regexp_replace(coalesce(v_whatsapp, ''), '[^0-9]', '', 'g'), '');

  IF v_name IS NULL AND v_phone_key IS NULL AND v_whatsapp_key IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_phone_key IS NOT NULL AND v_whatsapp_key IS NOT NULL
     AND v_phone_key <> v_whatsapp_key THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('maqdooms:customer:' || least(v_phone_key, v_whatsapp_key), 0)
    );
    PERFORM pg_advisory_xact_lock(
      hashtextextended('maqdooms:customer:' || greatest(v_phone_key, v_whatsapp_key), 0)
    );
  ELSIF coalesce(v_phone_key, v_whatsapp_key) IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('maqdooms:customer:' || coalesce(v_phone_key, v_whatsapp_key), 0)
    );
  ELSE
    PERFORM pg_advisory_xact_lock(
      hashtextextended('maqdooms:customer-name:' || lower(v_name), 0)
    );
  END IF;

  SELECT c.id INTO v_customer_id
  FROM public.customers c
  WHERE (
      v_phone_key IS NOT NULL
      AND v_phone_key IN (
        nullif(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), ''),
        nullif(regexp_replace(coalesce(c.whatsapp_phone, ''), '[^0-9]', '', 'g'), '')
      )
    ) OR (
      v_whatsapp_key IS NOT NULL
      AND v_whatsapp_key IN (
        nullif(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), ''),
        nullif(regexp_replace(coalesce(c.whatsapp_phone, ''), '[^0-9]', '', 'g'), '')
      )
    ) OR (
      v_phone_key IS NULL
      AND v_whatsapp_key IS NULL
      AND v_name IS NOT NULL
      AND lower(btrim(coalesce(c.name, ''))) = lower(v_name)
    )
  ORDER BY c.created_at, c.id
  LIMIT 1;

  IF v_customer_id IS NOT NULL THEN
    UPDATE public.customers
    SET name = coalesce(name, v_name),
        phone = coalesce(phone, v_phone),
        whatsapp_phone = coalesce(whatsapp_phone, v_whatsapp),
        notes = coalesce(notes, v_notes)
    WHERE id = v_customer_id;
    RETURN v_customer_id;
  END IF;

  INSERT INTO public.customers(name, phone, whatsapp_phone, notes)
  VALUES (v_name, v_phone, v_whatsapp, v_notes)
  RETURNING id INTO v_customer_id;

  PERFORM public.log_audit(
    'create_customer',
    'customer',
    v_customer_id::text,
    jsonb_build_object(
      'has_name', v_name IS NOT NULL,
      'has_phone', v_phone IS NOT NULL,
      'has_whatsapp', v_whatsapp IS NOT NULL
    )
  );
  RETURN v_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.find_or_create_customer(text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_or_create_customer(text,text,text,text) TO authenticated;
