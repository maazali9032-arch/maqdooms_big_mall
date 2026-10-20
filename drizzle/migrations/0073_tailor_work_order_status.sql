BEGIN;
-- Expose the real job status on the existing price-free workshop projection.
DO $$
DECLARE original text; revised text;
BEGIN
 original:=pg_get_functiondef('public.tailor_work_order(text)'::regprocedure);
 revised:=replace(original,'''job_code'',job.code','''job_code'',job.code,''status'',job.status');
 IF revised=original THEN RAISE EXCEPTION 'Expected tailor work-order projection not found'; END IF;
 EXECUTE revised;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
