-- Phase 8 follow-up: later quantities for the same declared job material are
-- explicit Additional Material Issues. Preserve the already-applied migration.
BEGIN;
CREATE FUNCTION public.guard_phase8_required_repeat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE header public.material_issues%rowtype;
BEGIN
 SELECT * INTO header FROM public.material_issues WHERE id=NEW.material_issue_id;
 -- Phase 7 booking inserts quoted requirements before its legacy request-less
 -- required issue. Preserve that workflow and all existing history unchanged.
 IF header.request_id IS NOT NULL AND header.issue_type='required' AND EXISTS(
 SELECT 1 FROM public.job_material_requirements req
 LEFT JOIN public.material_issue_lines original ON original.id=req.material_issue_line_id
 WHERE (req.customer_tailoring_job_id,req.production_job_id) IS NOT DISTINCT FROM
       (header.customer_tailoring_job_id,header.production_job_id)
 AND (req.material_id,req.fabric_stock_id) IS NOT DISTINCT FROM (NEW.material_id,NEW.fabric_stock_id)
 AND original.material_issue_id IS DISTINCT FROM header.id)
 THEN RAISE EXCEPTION 'Required job material already declared; use Additional Material Issue'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER phase8_required_issue_once BEFORE INSERT ON public.material_issue_lines
 FOR EACH ROW EXECUTE FUNCTION public.guard_phase8_required_repeat();
REVOKE ALL ON FUNCTION public.guard_phase8_required_repeat() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
