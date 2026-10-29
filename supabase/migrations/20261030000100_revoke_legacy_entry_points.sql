-- Security hardening step 2 (audit 29 Oct 2026: F7 remainder).
-- These legacy entry points were referenced only by frontend code removed in the
-- same release (old Direct Fabric Sale / Customer Tailoring screens and unused
-- hooks). No screen calls them. Grants only; no function body or data changes.
-- The only database caller (issue_tailoring_fabrics -> cut_thaan) is itself
-- revoked here and runs as SECURITY DEFINER. Reversible with a later GRANT.
BEGIN;

REVOKE EXECUTE ON FUNCTION
  public.cut_thaan(text,integer,text,uuid,uuid,text,text),
  public.complete_fabric_sale(jsonb,uuid,text),
  public.issue_tailoring_fabrics(uuid,jsonb,text),
  public.commit_receiving_batch(uuid),
  public.adjust_thaan(uuid,integer,text,text),
  public.complete_counter_fabric_sale(uuid,uuid,jsonb,uuid,boolean,text,uuid),
  public.complete_counter_fabric_sale(uuid,uuid,jsonb,uuid,boolean,text),
  public.book_counter_tailoring(uuid,uuid,jsonb,bigint,uuid,uuid,uuid,text,text)
FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
