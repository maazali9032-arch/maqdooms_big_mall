BEGIN;

CREATE OR REPLACE FUNCTION public.release_salesperson_code_on_role_removal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.role_key = 'salesperson' THEN
    UPDATE public.profiles
    SET salesperson_code = NULL
    WHERE id = OLD.user_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS user_role_release_salesperson_code ON public.user_roles;
CREATE TRIGGER user_role_release_salesperson_code
AFTER DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.release_salesperson_code_on_role_removal();

-- Release numbers retained by users whose Salesperson role was removed before
-- the delete trigger existed. Printed bills retain their immutable snapshots.
UPDATE public.profiles p
SET salesperson_code = NULL
WHERE p.salesperson_code IS NOT NULL
  AND NOT public.has_role(p.id, 'salesperson');

NOTIFY pgrst, 'reload schema';

COMMIT;
