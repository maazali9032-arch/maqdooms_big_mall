BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS salesperson_code text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_salesperson_code_digits;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_salesperson_code_digits
  CHECK (salesperson_code IS NULL OR salesperson_code ~ '^[0-9]{1,12}$');

CREATE UNIQUE INDEX IF NOT EXISTS profiles_salesperson_code_unique
  ON public.profiles(salesperson_code)
  WHERE salesperson_code IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS public.salesperson_code_seq START WITH 1;

WITH ranked AS (
  SELECT p.id, row_number() OVER (ORDER BY p.created_at, p.id) AS number
  FROM public.profiles p
  WHERE public.has_role(p.id, 'salesperson')
    AND p.salesperson_code IS NULL
)
UPDATE public.profiles p
SET salesperson_code = lpad(ranked.number::text, 3, '0')
FROM ranked
WHERE p.id = ranked.id;

SELECT setval(
  'public.salesperson_code_seq',
  greatest(coalesce((SELECT max(salesperson_code::bigint) FROM public.profiles WHERE salesperson_code IS NOT NULL), 0), 1),
  true
);

CREATE OR REPLACE FUNCTION public.next_salesperson_code() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE candidate text;
BEGIN
  LOOP
    candidate := lpad(nextval('public.salesperson_code_seq')::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE salesperson_code = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;
REVOKE ALL ON FUNCTION public.next_salesperson_code() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assign_salesperson_code_on_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role_key = 'salesperson' THEN
    UPDATE public.profiles
    SET salesperson_code = public.next_salesperson_code()
    WHERE id = NEW.user_id AND salesperson_code IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_role_assign_salesperson_code ON public.user_roles;
CREATE TRIGGER user_role_assign_salesperson_code
AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.assign_salesperson_code_on_role();

CREATE OR REPLACE FUNCTION public.owner_set_salesperson_code(p_user uuid, p_code text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE normalized text := btrim(coalesce(p_code, ''));
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;
  IF NOT public.has_role(p_user, 'salesperson') THEN
    RAISE EXCEPTION 'The selected user is not a Salesperson';
  END IF;
  IF normalized !~ '^[0-9]{1,12}$' THEN
    RAISE EXCEPTION 'Salesperson number must contain 1 to 12 digits only';
  END IF;
  UPDATE public.profiles SET salesperson_code = normalized WHERE id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  PERFORM setval('public.salesperson_code_seq', greatest(last_value, normalized::bigint), true)
  FROM public.salesperson_code_seq;
  INSERT INTO public.erp_audit_records(actor_id, action, entity_table, entity_id, new_value, reference)
  VALUES(auth.uid(), 'set_salesperson_code', 'profiles', p_user,
    jsonb_build_object('salesperson_code', normalized), 'SALESPERSON:' || p_user::text);
  RETURN normalized;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'That Salesperson number is already assigned';
END;
$$;
REVOKE ALL ON FUNCTION public.owner_set_salesperson_code(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_set_salesperson_code(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.salesperson_options() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    (public.has_any_role(auth.uid(), ARRAY['owner','counter']) AND public.has_perm(auth.uid(), 'pos.assign_salesperson'))
    OR (public.has_role(auth.uid(), 'salesperson') AND public.has_perm(auth.uid(), 'salesperson.view_work'))
  ) THEN
    RAISE EXCEPTION 'Salesperson selection permission required';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'code', p.salesperson_code
    ) ORDER BY p.full_name, p.id)
    FROM public.profiles p
    WHERE p.active
      AND public.has_role(p.id, 'salesperson')
      AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'counter') OR p.id = auth.uid())
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.snapshot_salesperson_code_on_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE code_value text;
BEGIN
  SELECT p.salesperson_code INTO code_value
  FROM public.orders o
  JOIN public.profiles p ON p.id = o.salesperson_user_id
  WHERE o.id = NEW.bill_id;
  NEW.document := NEW.document || jsonb_build_object('salesperson_code', code_value);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS counter_print_salesperson_code ON public.counter_bill_print_records;
CREATE TRIGGER counter_print_salesperson_code
BEFORE INSERT ON public.counter_bill_print_records
FOR EACH ROW EXECUTE FUNCTION public.snapshot_salesperson_code_on_receipt();

ALTER TABLE public.counter_bill_print_records DISABLE TRIGGER counter_print_immutable;
UPDATE public.counter_bill_print_records receipt
SET document = receipt.document || jsonb_build_object('salesperson_code', p.salesperson_code)
FROM public.orders o
JOIN public.profiles p ON p.id = o.salesperson_user_id
WHERE o.id = receipt.bill_id
  AND NOT receipt.document ? 'salesperson_code';
ALTER TABLE public.counter_bill_print_records ENABLE TRIGGER counter_print_immutable;

NOTIFY pgrst, 'reload schema';
COMMIT;
