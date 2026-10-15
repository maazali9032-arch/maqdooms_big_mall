BEGIN;
-- Prospective validation: historical contacts and exact bill retries are retained.
CREATE FUNCTION public.guard_counter_contact_digits() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF nullif(NEW.payload->>'contact','') IS NOT NULL AND NEW.payload->>'contact' !~ '^[0-9]+$' THEN
  RAISE EXCEPTION 'Customer contact must contain digits only' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_counter_contact_digits() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER counter_contact_digits_guard BEFORE INSERT ON public.counter_bills
FOR EACH ROW EXECUTE FUNCTION public.guard_counter_contact_digits();
NOTIFY pgrst,'reload schema';
COMMIT;
