BEGIN;

-- Invalid historic assignments become available POS IDs instead of being lost.
UPDATE public.pos_terminals t
SET assigned_user_id = NULL, updated_at = clock_timestamp()
WHERE t.assigned_user_id IS NOT NULL
  AND (
    EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = t.assigned_user_id AND r.role_key = 'owner'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.user_roles r ON r.user_id = p.id AND r.role_key = 'counter'
      WHERE p.id = t.assigned_user_id
    )
  );

CREATE OR REPLACE FUNCTION public.owner_set_user_pos_terminal(
  p_user uuid,
  p_terminal uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Owner required';
  END IF;
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'Counter user required';
  END IF;
  IF p_terminal IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = p_user AND role_key = 'owner'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.user_roles r ON r.user_id = p.id AND r.role_key = 'counter'
      WHERE p.id = p_user
    )
  ) THEN
    RAISE EXCEPTION 'Assign a Counter user who is not an Owner';
  END IF;

  PERFORM 1 FROM public.pos_terminals
  WHERE assigned_user_id = p_user OR id = p_terminal
  FOR UPDATE;

  UPDATE public.pos_terminals
  SET assigned_user_id = NULL, updated_at = clock_timestamp()
  WHERE assigned_user_id = p_user AND (p_terminal IS NULL OR id <> p_terminal);

  IF p_terminal IS NOT NULL THEN
    UPDATE public.pos_terminals
    SET assigned_user_id = p_user, active = true, updated_at = clock_timestamp()
    WHERE id = p_terminal AND assigned_user_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That POS ID is already assigned to another user';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_set_user_pos_terminal(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_set_user_pos_terminal(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
