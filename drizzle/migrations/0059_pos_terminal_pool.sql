BEGIN;

-- POS identities are an Owner-managed pool. They are not created from roles,
-- and an Owner is never assigned one even when they also hold the Counter role.
ALTER TABLE public.pos_terminals ALTER COLUMN assigned_user_id DROP NOT NULL;
DELETE FROM public.pos_terminals t USING public.user_roles r
WHERE r.user_id = t.assigned_user_id AND r.role_key = 'owner';

CREATE OR REPLACE FUNCTION public.owner_pos_terminals()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', t.id, 'code', t.code, 'active', t.active,
      'user_id', p.id, 'user_name', p.full_name, 'user_active', p.active
    ) ORDER BY t.code)
    FROM public.pos_terminals t
    LEFT JOIN public.profiles p ON p.id = t.assigned_user_id
  ), '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.owner_create_pos_terminal(p_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
  IF nullif(btrim(p_code), '') IS NULL THEN RAISE EXCEPTION 'POS ID required'; END IF;
  INSERT INTO public.pos_terminals(code, assigned_user_id)
  VALUES (btrim(p_code), NULL)
  RETURNING id INTO result;
  INSERT INTO public.erp_audit_records(actor_id, action, entity_table, entity_id, new_value)
  VALUES (auth.uid(), 'create_pos_terminal', 'pos_terminals', result, jsonb_build_object('code', btrim(p_code)));
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.owner_rename_pos_terminal(p_terminal uuid, p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
  IF nullif(btrim(p_code), '') IS NULL THEN RAISE EXCEPTION 'POS ID required'; END IF;
  UPDATE public.pos_terminals SET code = btrim(p_code), updated_at = clock_timestamp() WHERE id = p_terminal;
  IF NOT FOUND THEN RAISE EXCEPTION 'POS terminal not found'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.owner_assign_pos_terminal(
  p_terminal uuid,
  p_user uuid DEFAULT NULL,
  p_active boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
  IF p_user IS NOT NULL AND (
    EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role_key = 'owner')
    OR NOT EXISTS(
      SELECT 1 FROM public.profiles p
      JOIN public.user_roles r ON r.user_id = p.id AND r.role_key = 'counter'
      WHERE p.id = p_user AND p.active
    )
  ) THEN
    RAISE EXCEPTION 'Assign a currently active Counter user who is not an Owner';
  END IF;
  UPDATE public.pos_terminals
  SET assigned_user_id = p_user, active = coalesce(p_active, true), updated_at = clock_timestamp()
  WHERE id = p_terminal;
  IF NOT FOUND THEN RAISE EXCEPTION 'POS terminal not found'; END IF;
END; $$;

REVOKE ALL ON FUNCTION public.owner_create_pos_terminal(text), public.owner_rename_pos_terminal(uuid, text), public.owner_assign_pos_terminal(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_create_pos_terminal(text), public.owner_rename_pos_terminal(uuid, text), public.owner_assign_pos_terminal(uuid, uuid, boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
