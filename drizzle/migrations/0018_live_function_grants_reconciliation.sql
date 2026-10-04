-- Supabase function defaults supplied direct browser grants in addition to PUBLIC.
-- Phase 2 revokes PUBLIC on these internal trigger helpers; direct defaults must
-- not leave them callable. No function body or business data is changed.
BEGIN;
REVOKE ALL ON FUNCTION public.protect_last_owner_profile(),
  public.protect_last_owner_role(),public.protect_profile_activation()
  FROM anon,authenticated;
-- Later functions receive only explicit phase-specific browser grants.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon,authenticated;
COMMIT;
