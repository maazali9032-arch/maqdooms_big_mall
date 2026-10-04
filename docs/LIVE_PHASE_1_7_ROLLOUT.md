# Live Phase 1–7 rollout — 3 October 2026

Authenticated PostgreSQL 17.6 connection to the existing Supabase project
`tattausfxmlrmxxrheeb` through `aws-0-ap-south-1.pooler.supabase.com:5432`.
Credentials remain in ignored `.env`; this report contains no credentials or
customer/staff rows. The repository's older Supabase project ID is different;
configuration was not changed as part of this database-only rollout.

## Existing state and reconciliation

The database had no Supabase or Drizzle migration ledger. The Phase 1 public
schema and conservative backfill were already present. Comparison with a
disposable canonical PostgreSQL replay found identical public columns/nullability,
352 non-NOT-NULL constraints, indexes, trigger definitions, policies, and normalized
function bodies, except the missing historical `complete_fabric_sale` function.
PostgreSQL 18 represents NOT NULL in `pg_constraint`; live PostgreSQL 17 does not.
Column nullability was compared separately, so this version difference was not
treated as missing constraints.

Supabase defaults additionally granted anonymous table access and surplus
authenticated table/function privileges. Two new migrations resolve these
deployment differences. Existing Phase 1 is **adopted after verification**, not
replayed: no barcode IDs, stock IDs, CP/SP versions or reconciliation records were
regenerated. Historical migration execution dates are unknown. The demo seed is
explicitly marked skipped and was never replayed against live data.

## Actual execution order

| Order | Canonical migration | Result and purpose |
| --- | --- | --- |
| 1 | `20261003000700_live_migration_tracking.sql` | Applied. Creates restricted migration metadata and records verified baseline/adoption/seed-skip provenance. Removes surplus anonymous table and authenticated TRUNCATE/REFERENCES/TRIGGER grants; removes default direct browser table grants for future postgres-owned public tables. |
| 2 | `20260927000100_customer_multi_fabric_sale.sql` | Applied unchanged. Restores the missing historical multi-fabric sale function and its execution grants. No sale is executed. Complete Phase 1 schema then matches the reference. |
| 3 | `20261003000800_live_function_grants_reconciliation.sql` | Applied. Removes direct anon/authenticated grants on three internal legacy trigger functions and removes default direct browser grants on future postgres-owned public functions. |
| 4 | `20261003000100_phase2_authorization.sql` | Applied. Active staff/role ceilings, Owner financial access, scoped Stock Entry CP, domain RLS and protected RPC execution. |
| 5 | `20261003000200_phase3_locations_ledger.sql` | Applied. Canonical inventory identities, explicit reconciliation, location balances and guarded transfers/movements. No opening stock inferred. |
| 6 | `20261003000300_phase4_fabric_receiving_barcode.sql` | Applied. Guarded receiving, one Fabric + Batch barcode, Workshop inward, CP/SP version workflows and safe scans. |
| 7 | `20261003000400_phase5_transfer_history.sql` | Applied. Owner transfer document/history reader; reuses Phase 3 posting. |
| 8 | `20261003000500_phase6_direct_fabric_sale.sql` | Applied. Location-aware SP sale, immutable Orders/financial history and idempotency. |
| 9 | `20261003000600_phase7_customer_tailoring.sql` | Applied. Private CP-plus-charge quotes, guarded customer tailoring booking, required issues, Orders and assigned Tailor statuses. |

`20261003000000_phase1_domain_model.sql` and eight earlier schema migrations are
recorded as `adopted_existing_schema`; the earlier demo seed is recorded as
`skipped_demo_seed`. These labels explicitly distinguish adoption from execution.
All 19 repository migration versions now have matching provenance records.

One initial Phase 2 transaction failed its verification because Supabase's direct
authenticated grants kept three internal trigger helpers executable after PUBLIC
was revoked. That entire transaction rolled back. Migration `...00800...` repaired
the cause and the original, unchanged Phase 2 migration succeeded on retry.
One connection attempt also returned transient `28P01`; a fresh retry connected.
No failed attempt was treated as an applied migration.

## New repair objects and permission changes

Migration `...00700...` creates `supabase_migrations.schema_migrations` with
`version` text primary key, `statements` text array and `name` text; and
`supabase_migrations.erp_execution_history` with version primary key/FK, filename,
SHA256, mode, recorded timestamp and JSON verification. CHECK constraints enforce
SHA256 format and applied/adopted/skipped modes. Primary keys provide indexes.
No new business relationships, triggers or functions are introduced by either repair.
The metadata schema/tables deny PUBLIC, anon and authenticated access. Schema-level
access denial protects these administrative objects; they are not application RLS
tables. Migration ledger entries and execution provenance commit atomically with
their file's DDL and verification.

Migration `...00800...` changes grants/default privileges only, covering
`protect_last_owner_profile`, `protect_last_owner_role`, and
`protect_profile_activation`. Existing business RLS policies and function bodies
are preserved by the repair. The approved Phase 2–7 migrations then implement their
documented policy, function, constraint and index changes; their original SQL and
phase contracts remain the detailed scope specification.

The repair filenames sort after Phase 7 but were deliberately executed as
prerequisites in the order above. The timestamped Supabase ledger tracks individual
versions, not a highest-timestamp watermark. Mirrors are
`drizzle/migrations/0017_live_migration_tracking.sql` and
`0018_live_function_grants_reconciliation.sql`, with appended journal entries.
No pre-existing SQL file was modified or deleted.

**Use the Supabase migration ledger for this live database.** Its Drizzle ledger
does not exist; blindly using Drizzle's migrator would try to replay the historical
schema. Do not apply the mirror chain again, use `drizzle push`, or reset the DB.
The controlled runner verifies recorded hashes and current cumulative schema on
resume, skips recorded files, and stops on differences.

## Verification and preservation

- Every executed file committed in its own transaction. Phase verification compared
  columns, constraints, indexes, normalized function bodies/EXECUTE grants, triggers,
  policies, RLS and browser SELECT/INSERT/UPDATE/DELETE grants with canonical replay.
  Each phase passed before the next began; Phase 7 was checked again after rollout.
- Count plus sorted original-column row digests matched for all **60 pre-existing
  public tables / 276 rows** across the rollout. Existing labels, CP/SP, genealogy,
  sales, customers, roles and audit records were preserved. No business fixture or
  transaction was executed live. No reset, drop/delete of data, reseed or rewrite.
- Read-only live authenticated-role checks passed **42 checks** using existing active
  staff. Owner sees 10 Fabric Stock CP rows and 16 legacy CP rows; Counter, Tailor
  and Stock Entry see zero. Counter and Tailor cost RPCs reject access; Stock Entry
  cannot read committed legacy CP. Owner/Counter catalog and history RPCs execute.
  Anonymous table/Phase 7 API/metadata access is denied. Direct quote/ledger INSERT
  and stock TRUNCATE are denied. No staff profiles were created or changed.
- The existing Counter test user also holds Tailor; the Tailor test uses a separate
  non-Counter/non-Owner user. This is recorded rather than claiming synthetic pure
  role fixtures were introduced live. Inactive-user and mutation/race scenarios
  remain covered by disposable tests, not live production fixtures.
- Evidence: `LIVE_PHASE_1_7_ROLLOUT_VERIFICATION.json` captures the final resumed
  execution (repair 00800 and Phases 2–7), including unchanged row fingerprints;
  `LIVE_PHASE_1_7_SECURITY_VERIFICATION.json` records read-only checks and all 19
  migration provenance/hash records. The first two applied files are recorded in
  the live ledger and actual execution history above.

## Remaining operational work

Schema rollout does not resolve unknown legacy business facts. The unchanged
26 reconciliation records cover 17 Than locations, four material opening locations,
four legacy job domains/assignments and one inconsistent/missing Fabric Stock CP.
`inventory_items` remains empty: an Owner must explicitly reconcile opening quantities
and locations before legacy items can use the new location-aware operational ledger.
No locations, balances, CP values, assignments, charges or production data were guessed.

The app was not built/deployed in this database-only task. Browser, live PostgREST
authenticated sessions, scanner/printer and multi-connection business races remain
unverified. Phase 8 implementation has not begun.
