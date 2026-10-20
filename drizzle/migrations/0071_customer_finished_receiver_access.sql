BEGIN;
-- The receive RPC already authorizes production.receive, including Stock Entry.
-- Its result/reprint lookup must accept the same permission or the entire receipt rolls back.
DO $$
DECLARE original text; revised text;
BEGIN
  original:=pg_get_functiondef('public.customer_tailoring_finished_item(text)'::regprocedure);
  revised:=replace(original,
    'IF NOT public.has_any_role(auth.uid(), ARRAY[''owner'',''counter'',''tailor'',''production''])',
    'IF NOT (public.has_any_role(auth.uid(), ARRAY[''owner'',''counter'',''tailor'',''production'']) OR public.has_perm(auth.uid(), ''production.receive''))');
  IF revised=original THEN RAISE EXCEPTION 'Expected customer finished-item lookup access guard not found'; END IF;
  EXECUTE revised;
END; $$;
-- No table grants, RLS changes, billing access or role assignments are added.
NOTIFY pgrst,'reload schema';
COMMIT;
