-- Link tailoring work to real, active staff accounts. Existing free-text
-- tailor_name values are preserved for history but are no longer sufficient
-- to make an open job eligible for a new fabric issue.
UPDATE public.tailoring_jobs j
SET tailor_id = NULL
WHERE tailor_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = j.tailor_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tailoring_jobs_tailor_id_fkey'
      AND conrelid = 'public.tailoring_jobs'::regclass
  ) THEN
    ALTER TABLE public.tailoring_jobs
      ADD CONSTRAINT tailoring_jobs_tailor_id_fkey
      FOREIGN KEY (tailor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS tailoring_jobs_tailor_id_idx
  ON public.tailoring_jobs(tailor_id);

-- Only an Owner needs the staff directory used by the assignment controls.
-- Returning the minimal three fields avoids reopening broad profiles access.
CREATE OR REPLACE FUNCTION public.active_tailors()
RETURNS TABLE(id uuid, full_name text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Permission denied: Owner required';
  END IF;

  RETURN QUERY
  SELECT p.id, p.full_name, p.email
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role_key = 'tailor'
  WHERE p.active
  ORDER BY lower(p.full_name), lower(coalesce(p.email, ''));
END;
$$;

-- The POS consumes this function instead of accepting an arbitrary job UUID.
-- A pure Tailor sees only their work. Owners and Counters see every eligible
-- assigned job so they can issue fabric at the counter.
CREATE OR REPLACE FUNCTION public.eligible_tailoring_jobs()
RETURNS TABLE(
  id uuid,
  code text,
  garment text,
  status text,
  tailor_id uuid,
  tailor_name text,
  tailor_email text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_restrict_to_self boolean;
BEGIN
  IF NOT public.has_perm(auth.uid(), 'pos.issue_to_tailoring') THEN
    RAISE EXCEPTION 'Permission denied: pos.issue_to_tailoring';
  END IF;

  v_restrict_to_self := public.has_role(auth.uid(), 'tailor')
    AND NOT public.has_any_role(auth.uid(), ARRAY['owner', 'counter']);

  RETURN QUERY
  SELECT
    j.id,
    j.code,
    j.garment,
    j.status,
    j.tailor_id,
    coalesce(nullif(btrim(p.full_name), ''), p.email, j.tailor_name, 'Tailor'),
    p.email
  FROM public.tailoring_jobs j
  JOIN public.profiles p ON p.id = j.tailor_id AND p.active
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role_key = 'tailor'
  WHERE j.status IN ('open', 'in_progress')
    AND (NOT v_restrict_to_self OR j.tailor_id = auth.uid())
  ORDER BY j.created_at DESC;
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
  IF NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Permission denied: Owner required';
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

CREATE OR REPLACE FUNCTION public.assign_tailoring_job(
  p_job_id uuid,
  p_tailor_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tailor_name text;
  v_previous_tailor_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Permission denied: Owner required';
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

  SELECT j.tailor_id INTO v_previous_tailor_id
  FROM public.tailoring_jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tailoring job not found';
  END IF;

  UPDATE public.tailoring_jobs
  SET tailor_id = p_tailor_id, tailor_name = v_tailor_name
  WHERE id = p_job_id;

  PERFORM public.log_audit(
    'assign_tailoring_job',
    'tailoring_job',
    p_job_id::text,
    jsonb_build_object(
      'previous_tailor_id', v_previous_tailor_id,
      'tailor_id', p_tailor_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_tailoring_job_status(
  p_job_id uuid,
  p_status text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tailor_id uuid;
  v_previous_status text;
BEGIN
  IF p_status NOT IN ('open', 'in_progress', 'ready', 'delivered', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid tailoring status';
  END IF;

  SELECT j.tailor_id, j.status INTO v_tailor_id, v_previous_status
  FROM public.tailoring_jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tailoring job not found';
  END IF;

  IF NOT public.has_role(auth.uid(), 'owner')
     AND NOT (public.has_role(auth.uid(), 'tailor') AND v_tailor_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the assigned Tailor or Owner can change this job';
  END IF;

  UPDATE public.tailoring_jobs SET status = p_status WHERE id = p_job_id;
  PERFORM public.log_audit(
    'update_tailoring_status',
    'tailoring_job',
    p_job_id::text,
    jsonb_build_object('from', v_previous_status, 'to', p_status)
  );
END;
$$;

-- Enforce the same eligibility at the write boundary used by cut_thaan().
CREATE OR REPLACE FUNCTION public.require_eligible_tailoring_job()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.tailoring_jobs j
    JOIN public.profiles p ON p.id = j.tailor_id AND p.active
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role_key = 'tailor'
    WHERE j.id = NEW.job_id
      AND j.status IN ('open', 'in_progress')
      AND (
        NOT (
          public.has_role(auth.uid(), 'tailor')
          AND NOT public.has_any_role(auth.uid(), ARRAY['owner', 'counter'])
        )
        OR j.tailor_id = auth.uid()
      )
  ) THEN
    RAISE EXCEPTION 'Tailoring job is not assigned or is no longer available';
  END IF;

  RETURN NEW;
END;
$$;

-- Tailors see only their assigned work; Owners and Counters retain the views
-- needed by their existing screens. Mutations go through the validated RPCs.
DROP POLICY IF EXISTS "manage jobs" ON public.tailoring_jobs;
DROP POLICY IF EXISTS "read tailoring_jobs" ON public.tailoring_jobs;
CREATE POLICY "read tailoring_jobs" ON public.tailoring_jobs FOR SELECT TO authenticated USING (
  public.has_any_role(auth.uid(), ARRAY['owner', 'counter'])
  OR public.has_perm(auth.uid(), 'reports.view')
  OR tailor_id = auth.uid()
);

DROP POLICY IF EXISTS "read tailoring_job_lines" ON public.tailoring_job_lines;
CREATE POLICY "read tailoring_job_lines" ON public.tailoring_job_lines FOR SELECT TO authenticated USING (
  public.has_any_role(auth.uid(), ARRAY['owner', 'counter'])
  OR public.has_perm(auth.uid(), 'reports.view')
  OR EXISTS (
    SELECT 1 FROM public.tailoring_jobs j
    WHERE j.id = tailoring_job_lines.job_id AND j.tailor_id = auth.uid()
  )
);

REVOKE INSERT, UPDATE, DELETE ON public.tailoring_jobs FROM authenticated;
REVOKE ALL ON FUNCTION public.active_tailors() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eligible_tailoring_jobs() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_tailoring_job(text,uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_tailoring_job(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_tailoring_job_status(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.active_tailors() TO authenticated;
GRANT EXECUTE ON FUNCTION public.eligible_tailoring_jobs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tailoring_job(text,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_tailoring_job(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_tailoring_job_status(uuid,text) TO authenticated;
