-- Live rollout metadata reconciliation only. Run before missing prerequisite/Phases 2-7.
-- Existing Phase 1 schema/backfill was compared against a disposable canonical replay.
-- Preserve all business rows and original migration files. Adoption is NOT execution.
BEGIN;
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
 version text PRIMARY KEY,
 statements text[],
 name text
);
CREATE TABLE supabase_migrations.erp_execution_history (
 version text PRIMARY KEY REFERENCES supabase_migrations.schema_migrations(version),
 filename text NOT NULL,
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 mode text NOT NULL CHECK (mode IN ('applied','adopted_existing_schema','skipped_demo_seed')),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 verification jsonb NOT NULL
);
REVOKE ALL ON SCHEMA supabase_migrations FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA supabase_migrations FROM PUBLIC,anon,authenticated;
-- Fail rather than record adoption against a database missing the verified baseline.
DO $$ BEGIN
 IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('locations','fabric_stock','fabric_stock_costs','fabric_stock_prices','barcodes','customer_tailoring_jobs','production_jobs','finished_products','orders','order_items','inventory_movements','erp_audit_records')) <> 12 THEN
  RAISE EXCEPTION 'Verified Phase 1 baseline is missing';
 END IF;
 IF EXISTS (SELECT 1 FROM public.thaans t JOIN public.fabric_stock s ON s.id=t.fabric_stock_id WHERE t.fabric_id IS DISTINCT FROM s.fabric_id OR t.batch_id IS DISTINCT FROM s.batch_id) THEN
  RAISE EXCEPTION 'Existing Fabric + Batch mapping requires reconciliation';
 END IF;
 IF (SELECT count(*) FROM public.locations WHERE kind IN ('workshop','showroom')) <> 2 THEN
  RAISE EXCEPTION 'Workshop/Showroom roots require reconciliation';
 END IF;
END $$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20260924000000','erp_core_schema',ARRAY['adopted_existing_schema: existing business data preserved; historical execution not asserted']);
INSERT INTO supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) VALUES ('20260924000000','20260924000000_erp_core_schema.sql','e58a8bb2a25f564bd3b9b56e9b2ea26e16c27b2cb9cca343bbd9e0eebbccbc1e','adopted_existing_schema','{"basis":"Live schema compared with canonical replay through Phase 1; no historical SQL replayed; original execution dates unknown","demo_seed":"Never replay demo seed into existing database","version_specific_note":"Verified cumulative existing schema, not historical execution"}'::jsonb);
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20260924000100','demo_seed_data',ARRAY['skipped_demo_seed: existing business data preserved; historical execution not asserted']);
INSERT INTO supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) VALUES ('20260924000100','20260924000100_demo_seed_data.sql','492fc0e01669f1c4aee120f418a093da61061160362b254d531c1d7763f33a46','skipped_demo_seed','{"basis":"Live schema compared with canonical replay through Phase 1; no historical SQL replayed; original execution dates unknown","demo_seed":"Never replay demo seed into existing database","version_specific_note":"Verified cumulative existing schema, not historical execution"}'::jsonb);
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20260924000200','reporting_views',ARRAY['adopted_existing_schema: existing business data preserved; historical execution not asserted']);
INSERT INTO supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) VALUES ('20260924000200','20260924000200_reporting_views.sql','ab52169b6f7497be16292f9931340c53dd328c4039416e4e9aeac65e4213b3ca','adopted_existing_schema','{"basis":"Live schema compared with canonical replay through Phase 1; no historical SQL replayed; original execution dates unknown","demo_seed":"Never replay demo seed into existing database","version_specific_note":"Verified cumulative existing schema, not historical execution"}'::jsonb);
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20260926000000','role_access_hardening',ARRAY['adopted_existing_schema: existing business data preserved; historical execution not asserted']);
INSERT INTO supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) VALUES ('20260926000000','20260926000000_role_access_hardening.sql','5417ea7df87aacbab5523097c566142255b272289d1d3400776efa2ba9c4e7bb','adopted_existing_schema','{"basis":"Live schema compared with canonical replay through Phase 1; no historical SQL replayed; original execution dates unknown","demo_seed":"Never replay demo seed into existing database","version_specific_note":"Verified cumulative existing schema, not historical execution"}'::jsonb);
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20260926000100','requirements_completion',ARRAY['adopted_existing_schema: existing business data preserved; historical execution not asserted']);
INSERT INTO supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) VALUES ('20260926000100','20260926000100_requirements_completion.sql','8ab1c0f26d947a40a85fc9dabbdabd9205ba30c85199b935e1a0c260a9aa4a65','adopted_existing_schema','{"basis":"Live schema compared with canonical replay through Phase 1; no historical SQL replayed; original execution dates unknown","demo_seed":"Never replay demo seed into existing database","version_specific_note":"Verified cumulative existing schema, not historical execution"}'::jsonb);
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20260926000200','incomplete_stock_correction',ARRAY['adopted_existing_schema: existing business data preserved; historical execution not asserted']);
INSERT INTO supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) VALUES ('20260926000200','20260926000200_incomplete_stock_correction.sql','bdcdf62eba2dcd9994bd7bf2182f5bc63525de2f090771d86c7c81c6f79a95f2','adopted_existing_schema','{"basis":"Live schema compared with canonical replay through Phase 1; no historical SQL replayed; original execution dates unknown","demo_seed":"Never replay demo seed into existing database","version_specific_note":"Verified cumulative existing schema, not historical execution"}'::jsonb);
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20260926000300','pos_customer_details',ARRAY['adopted_existing_schema: existing business data preserved; historical execution not asserted']);
INSERT INTO supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) VALUES ('20260926000300','20260926000300_pos_customer_details.sql','408e05becabeab1246e3d8f5a626676ba0874aafa043ff6d0aee12d457f67e15','adopted_existing_schema','{"basis":"Live schema compared with canonical replay through Phase 1; no historical SQL replayed; original execution dates unknown","demo_seed":"Never replay demo seed into existing database","version_specific_note":"Verified cumulative existing schema, not historical execution"}'::jsonb);
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20260926000400','tailor_job_assignment',ARRAY['adopted_existing_schema: existing business data preserved; historical execution not asserted']);
INSERT INTO supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) VALUES ('20260926000400','20260926000400_tailor_job_assignment.sql','99e086992702877545d279a9bb759153bbc5b6e4d4b5df398e61c692edc2aac2','adopted_existing_schema','{"basis":"Live schema compared with canonical replay through Phase 1; no historical SQL replayed; original execution dates unknown","demo_seed":"Never replay demo seed into existing database","version_specific_note":"Verified cumulative existing schema, not historical execution"}'::jsonb);
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20260927000000','tailoring_multi_cut',ARRAY['adopted_existing_schema: existing business data preserved; historical execution not asserted']);
INSERT INTO supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) VALUES ('20260927000000','20260927000000_tailoring_multi_cut.sql','7ba27328f5e71a89e0fb1708379c8b84d1afc730da17601e8c90e0770c991781','adopted_existing_schema','{"basis":"Live schema compared with canonical replay through Phase 1; no historical SQL replayed; original execution dates unknown","demo_seed":"Never replay demo seed into existing database","version_specific_note":"Verified cumulative existing schema, not historical execution"}'::jsonb);
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20261003000000','phase1_domain_model',ARRAY['adopted_existing_schema: existing business data preserved; historical execution not asserted']);
INSERT INTO supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) VALUES ('20261003000000','20261003000000_phase1_domain_model.sql','3c7baf5f4d04a1189a88dfad857ba8b31d2e0a278bd739f918a1165096586116','adopted_existing_schema','{"basis":"Live schema compared with canonical replay through Phase 1; no historical SQL replayed; original execution dates unknown","demo_seed":"Never replay demo seed into existing database","version_specific_note":"All Phase 1 columns, non-NOT-NULL constraints, indexes, trigger definitions, policies and normalized function bodies matched; existing backfill retained"}'::jsonb);
-- Supabase bootstrap defaults granted anonymous access to existing legacy tables.
-- Canonical migrations authorize table reads through authenticated RLS only.
-- Remove surplus direct grants, including RLS-bypassing TRUNCATE capability.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;
-- New tables must receive only explicit grants from their phase migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon,authenticated;
COMMIT;
