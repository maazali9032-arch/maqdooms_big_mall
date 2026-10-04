# Database migrations — Maqdoom's Big Mall ERP

**Phase 12 live update — 4 October 2026:**
`20261004000300_phase12_production_costing.sql` applied/verified; byte-identical
mirror `0026_phase12_production_costing.sql`, appended journal index 26. Adds immutable
cost input/request/price-review provenance, checked complete cost revisions/exact
allocations, explicit Owner-reviewed SP, Owner-only internal scan costs. Design
charge included with explicit Owner basis; no automatic FIFO/markup/repricing.
All 27 versions recorded/hash-checked; 70 old tables / 366 rows preserved; no live
financial fixture or backfill. See [Phase 12 details](../../docs/PHASE12_PRODUCTION_COSTING.md)
and permanent history. Phase 13 not started; earlier boundary statements are historical.


**Phase 11 live update — 4 October 2026:**
`20261004000200_phase11_finished_products.sql` applied and verified; byte-identical
mirror `0025_phase11_finished_products.sql`, appended journal index 25. Adds immutable
completed-job receipt/piece registry, unique manufacture-event index, identity/
receipt guards, actual per-piece material genealogy, unique Product Barcodes and
role-filtered scan. Every piece first enters Workshop through the production ledger.
All 26 SQL versions recorded/hash-checked; 68 old tables / 366 rows preserved;
no live fixtures/backfill or costing/SP setup. See
[Phase 11 details](../../docs/PHASE11_FINISHED_PRODUCTS.md) and permanent history.
Phase 12 has not started. Earlier phase-boundary statements below are historical.


**Phase 10 live update — 4 October 2026:**
`20261004000100_phase10_owner_production.sql` applied and verified; byte-identical
mirror `0024_phase10_owner_production.sql`, appended journal index 24. Adds immutable
production request/status tables, Product/Design configuration, atomic required
material/job creation and assigned status/completion. No existing data backfill,
no finished pieces/barcodes/costing/SP. All 25 SQL versions recorded and hash-checked;
66 pre-existing tables / 366 rows preserved. See
[Phase 10 details](../../docs/PHASE10_OWNER_PRODUCTION.md) and permanent history.
Phase 11 has not started. Earlier phase-boundary statements below are historical.


**Phase 9 live update — 4 October 2026:**
`20261004000000_phase9_tailoring_management.sql` is applied and verified; mirror
`0023_phase9_tailoring_management.sql`, journal entry 23. It adds Owner hierarchy
management/assignment/filtering and immutable request/history guards, preserving
original jobs/material genealogy. All 24 SQL versions are recorded in the existing
Supabase/private ledgers. Existing applied SQL was hash-checked/skipped, never
rewritten/replayed. No hierarchy/job/stock backfill. See
[`PHASE9_TAILORING_MANAGEMENT.md`](../../docs/PHASE9_TAILORING_MANAGEMENT.md) and
the permanent Implementation History for exact changes/results. Phase 10 not started.

**Live deployment update — 3 October 2026:** Phase 1 was verified/adopted and
Phases 2–7 were applied to the existing project `tattausfxmlrmxxrheeb`. Two new
deployment reconciliation migrations (`20261003000700_live_migration_tracking.sql`
and `20261003000800_live_function_grants_reconciliation.sql`) establish migration
provenance and correct surplus Supabase default grants. Earlier statements below
about pending live deployment describe the original local implementation milestones.
Actual execution order, preservation checks, limitations and ledger guidance:
[`LIVE_PHASE_1_7_ROLLOUT.md`](../../docs/LIVE_PHASE_1_7_ROLLOUT.md).
This live database uses the Supabase migration ledger; do not replay the Drizzle
mirror chain against it. Historical SQL and existing business rows are preserved.

**Legacy reconciliation update — 3 October 2026:**
`20261003000900_live_legacy_reconciliation.sql` (mirror `0019_live_legacy_reconciliation.sql`)
was applied after all 26 issues were analyzed. It preserves immutable analysis for
all records and closes only TH-0003's current-stock location issue because its
matched receipt/full sale leave zero stock. Historical location remains unknown;
no inventory/opening balance was created. The other 25 records require Owner input:
[`exact records and decisions`](../../docs/LEGACY_RECONCILIATION_OWNER_DECISIONS.md).
No Phase 8 implementation.

**Owner test-data clarification — 3 October 2026:** The user explicitly declared
the reviewed stock testing data and authorized deliberate scenario distributions.
Applied `20261003001000_live_test_stock_scenarios.sql`, mirrored as
`0020_live_test_stock_scenarios.sql`. This commissions 18 canonical items with
27 exact opening allocations, adds two named test Showroom sublocations, and keeps
three draft fixtures unreceived (including intentional missing CP/SP). All recorded
quantities, IDs, legacy history and existing prices are retained. All stock issues
are now explicit test dispositions; four jobs are unchanged pending scope clarification.
[`Scenario matrix and provenance`](../../docs/TEST_STOCK_SCENARIOS.md).

This folder is the canonical, executable copy of the complete database schema
for the ERP. The same files also live under `drizzle/migrations/` (the tool
that applies them to the live database); the copies here use timestamped
names so they can be replayed in order on a fresh Supabase/Postgres project
with `supabase db push`, `psql -f`, or the SQL editor — in filename order.

Do not edit or delete existing migration files. New schema changes are added
as new files with a later timestamp.

## Apply order

| File                                             | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `20260924000000_erp_core_schema.sql`             | Full schema: access control (profiles, roles, permissions, role_permissions, user_roles, user_permission_overrides), domain tables (fabrics, suppliers, receiving_batches, thaans, thaan_costs, customers, tailoring_jobs, tailoring_job_lines, materials, sales, sale_items, stock_movements, listings, listing_thaan_links, listing_variants, holds, online_orders, audit_log, whatsapp_templates, whatsapp_messages), foreign keys, unique constraints (incl. thaan barcode), indexes, security-definer functions (`has_perm`, `has_role`, `log_audit`, `bootstrap_current_user`, `cut_thaan`, `commit_receiving_batch`, `adjust_thaan`, `place_hold`, `release_hold`), GRANTs, row-level security on every table, and all RLS policies. Seeds the role and permission catalogue. |
| `20260924000100_demo_seed_data.sql`              | Fictional demo data, clearly marked `(DEMO)`: suppliers, fabrics, materials, receiving batches, thaans TH-0001..TH-0014 with costs, inward/sale/tailoring/wastage/adjustment ledger movements, sales, tailoring jobs, listings, online orders, a hold, WhatsApp templates, sample audit entries. Safe to skip on a production project.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `20260924000200_reporting_views.sql`             | Reporting/derived layer: views `v_thaan_overview`, `v_movement_log`, `v_listing_availability` and functions `dashboard_metrics()`, `tailoring_job_totals()`, with grants.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `20260926000000_role_access_hardening.sql`       | Role/module access, active-user enforcement, last-owner triggers, scoped reads, cost-column protection and listing image policies.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `20260926000100_requirements_completion.sql`     | Effective permission bootstrap, concurrency-safe last-owner protection, final read-policy scoping, secured reporting/hold functions, online-only link invariant and private listing-image bucket creation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `20260926000200_incomplete_stock_correction.sql` | Atomic in-place correction and revalidation of committed incomplete thaans, with idempotent inward-ledger activation and audit history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `20260926000300_pos_customer_details.sql`        | POS customer contact/WhatsApp capture with deduplication, plus database enforcement that fabric can only be issued to assigned, actionable tailoring jobs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `20260926000400_tailor_job_assignment.sql`       | Links jobs to active Tailor staff, scopes each Tailor to assigned work, and adds validated job creation, reassignment, status and POS eligibility operations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `20260927000000_tailoring_multi_cut.sql`         | Lets Owner/Counter staff create assigned jobs at POS and atomically issue multiple staged thaan cuts through the existing ledger operation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `20260927000100_customer_multi_fabric_sale.sql`  | Atomically completes one customer bill containing multiple staged thaan cuts, with hold-aware stock revalidation, price/cost snapshots and audit entries for every line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Invariants the schema enforces

- Inventory is an append-only ledger: remaining length is always derived from
  `stock_movements`; `cut_thaan()` and the atomic multi-fabric sale operation
  both enforce row locks, hold-aware availability checks and price/cost
  snapshots.
- Lengths are integer millimetres; money is integer paise.
- Costs live only in `thaan_costs`, gated by the `inventory.view_cost`
  permission — counter staff receive no rows.
- `audit_log` is append-only and gated by `audit.view`.
- Depleted thaans are never hard-deleted (status `depleted`/`archived`).
- The last active Owner cannot be demoted or deactivated (serialized and enforced by database triggers).

## Phase 1 additive domain model — 3 October 2026

`20261003000000_phase1_domain_model.sql` follows all ten earlier migrations. Its
Lovable/Drizzle execution-path mirror is `drizzle/migrations/0010_phase1_domain_model.sql`
(journal index 10). Apply one chain to a database; do not apply both copies.

This adds 34 domain tables, identity/history relationship guards, safe Fabric + Batch
backfill, reconciliation records, and sealed RLS for new objects. Legacy schema/data,
RPCs, role policies and old migration files are retained. New tables are not enabled
for application workflows yet. Full contract, migration scope and test instructions:
[`docs/PHASE_1_DOMAIN_MODEL.md`](../../docs/PHASE_1_DOMAIN_MODEL.md). The permanent
implementation history records validation and the fact that live deployment was not
performed. The earlier invariants above describe the legacy application; they do not
claim Phase 2 financial authorization or later ERP workflows are complete.

## Phase 2 authorization — 3 October 2026

`20261003000100_phase2_authorization.sql` follows Phase 1; its identical execution-path
mirror is `drizzle/migrations/0011_phase2_authorization.sql` (journal index 11).
Apply only one chain. This adds active-role/assignment RLS, Owner-only financial access,
scoped Stock Entry CP endpoints, SP authorization guards and restricted RPC execution.
It does not backfill or change business data or implement the Phase 3 ledger.
See [`docs/PHASE_2_AUTHORIZATION.md`](../../docs/PHASE_2_AUTHORIZATION.md) and the permanent
Implementation History for all policies/functions/grants, validation and deployment limits.
Live migration application has not been performed.

## Phase 3 locations and ledger — 3 October 2026

`20261003000200_phase3_locations_ledger.sql` follows Phase 2, mirrored identically
as `drizzle/migrations/0012_phase3_locations_ledger.sql` (journal index 12). Apply
one chain only. The migration creates no stock balances or guessed locations.
Owner explicitly reconciles individual items before the new location ledger becomes
their single quantity authority. It implements dynamic Showroom Locations, guarded
atomic/idempotent transfers, explicit corrections, balances and history.
Converted items reject old unlocated sales/receiving/hold writes; later location-aware
workflows remain in their own phases. See
[`docs/PHASE_3_LOCATIONS_LEDGER.md`](../../docs/PHASE_3_LOCATIONS_LEDGER.md) and the
Implementation History for tables/functions/guards/RLS, tests and rollout limitations.
Not applied to a live database; no manual database operation performed.

## Phase 4 Fabric Stock Entry + One Barcode — 3 October 2026

`20261003000300_phase4_fabric_receiving_barcode.sql`, mirrored as
`drizzle/migrations/0013_phase4_fabric_receiving_barcode.sql` (journal index 13),
adds guarded draft/Workshop receipt, one Fabric + Batch barcode, scoped CP corrections,
Owner SP revisions and safe scans. Apply one chain only. New authenticated per-Than
label creation is rejected; existing labels/data/history remain preserved. No data backfill,
live application or manual database writes. Full contract:
[`docs/PHASE_4_FABRIC_RECEIVING_BARCODE.md`](../../docs/PHASE_4_FABRIC_RECEIVING_BARCODE.md).

## Phase 5 Workshop ↔ Showroom Transfer — 3 October 2026

`20261003000400_phase5_transfer_history.sql` is the Phase 5 transfer-document reader,
mirrored as `drizzle/migrations/0014_phase5_transfer_history.sql` (journal index 14).
It reuses existing atomic posting/ledger rules unchanged; adds only an Owner-guarded
invoker history API with authenticated execution and revoked anonymous access.
No data/schema backfill or live application. Apply one chain only. Contract:
[`docs/PHASE_5_STOCK_TRANSFERS.md`](../../docs/PHASE_5_STOCK_TRANSFERS.md).

## Phase 6 Direct Fabric Sale — 3 October 2026

`20261003000500_phase6_direct_fabric_sale.sql`, mirrored as
`drizzle/migrations/0015_phase6_direct_fabric_sale.sql` (journal index 15), adds
guarded atomic location-aware checkout, idempotent Orders and immutable price
snapshots/history. Counter receives SP and final amounts; CP history stays Owner-only.
Existing rows/migrations are preserved; no data backfill or live application.
Apply one chain only. Contract:
[`docs/PHASE_6_DIRECT_FABRIC_SALE.md`](../../docs/PHASE_6_DIRECT_FABRIC_SALE.md).

## Phase 7 Customer + Customer Tailoring — 3 October 2026

`20261003000600_phase7_customer_tailoring.sql`, mirrored as
`drizzle/migrations/0016_phase7_customer_tailoring.sql` (journal index 16), adds
private CP-plus-charge quotes, guarded customer job booking, required fabric issues,
Orders/bills/history and assigned Tailor statuses. Minimum Owner hierarchy bootstrap
and configurable charge revisions support this phase; general Phase 8/9 management
is deferred. Counter receives only final tailoring price; CP/charge breakdown is Owner-only.
No historical migration edits, backfill or live application. Apply one chain only.
Contract: [`docs/PHASE_7_CUSTOMER_TAILORING.md`](../../docs/PHASE_7_CUSTOMER_TAILORING.md).

## Environment files (unchanged)

`.env` contains real credentials and must never be committed — it is excluded
from version control. `.env.example` holds placeholders only
(`VITE_SUPABASE_URL=`, `VITE_SUPABASE_PUBLISHABLE_KEY=`, ...); copy it to
`.env` and fill in values for a new environment.
# Phase 8 live status (2026-10-04)

`20261003001100_phase8_consumables_material_issues.sql` is applied and verified on
the configured live database. Its byte-identical Drizzle mirror is
`0021_phase8_consumables_material_issues.sql`, journal entry 21. It adds explicit
consumable receiving/private receipt CP and job-linked required/additional Material
Issues; it preserves existing stock, prices, booked orders and historical IDs.
Final review also applied `20261003001200_phase8_required_issue_guard.sql`, mirror
`0022_phase8_required_issue_guard.sql`/journal 22: later quantities for an already
declared job material require Additional Material Issue. The first migration was
preserved. All 23 SQL versions are recorded in the Supabase/private execution ledger. Prior
applied files were skipped/hash checked, never edited or replayed. See
`docs/PHASE8_CONSUMABLES_MATERIAL_ISSUES.md` and the permanent Implementation History
for exact schema, permissions, validation and limitations. Phase 9 is not started.

## Phase 13 live status (2026-10-04)

`20261004000400_phase13_finished_product_inventory.sql` is applied and verified
on the configured live database. Its byte-identical Drizzle mirror is
`0027_phase13_finished_product_inventory.sql`, journal entry 27. Apply one chain
only; do not run Drizzle replay against the existing Supabase execution ledger.
This adds whole-piece Finished Product inventory/history, actor-bound transfer
requests and an adjacent Workshop/Showroom/sublocation transfer guard. All 73
pre-existing public tables / 366 rows were preserved. No backfill or stock/price
fixture was executed live. All 28 repository SQL versions have matching execution
hashes; old migrations were skipped, never modified or replayed. See
`docs/PHASE13_FINISHED_PRODUCT_INVENTORY.md`, Phase 13 verification JSON files and
the permanent Implementation History for exact changes and limitations. Phase 14
is not started; the earlier status entries above remain historical records.

## Phase 14 live status (2026-10-04)

`20261004000500_phase14_finished_product_sales.sql` is applied and verified live.
Byte-identical mirror: `0028_phase14_finished_product_sales.sql`, journal entry 28.
It adds checked Owner/Counter scan/counts, paid whole-piece sales and immutable
sale-time item/private financial snapshots with authorized order history. Existing
orders/ledger/financial guards are reused. All 74 old public tables / 366 rows
were preserved; no live sale or fixture was posted. All 29 SQL versions have
matching execution hashes; prior files were skipped, not edited or replayed.
Apply only one migration chain. Exact schema, rules, security, tests and limitations
are in `docs/PHASE14_FINISHED_PRODUCT_SALES.md`, its verification JSON evidence and
the permanent Implementation History. Phase 15 is not started.

## Phase 15 live status (2026-10-04)

`20261004000600_phase15_owner_reporting_audit.sql` is applied and verified live.
Byte-identical mirror: `0029_phase15_owner_reporting_audit.sql`, journal entry 29.
It adds two Owner report APIs, prospective old/new row audit on 52 domain tables,
two indexes and legacy audit immutability/raw-write protection. No tables/columns,
business backfill or seed changes. All 75 existing public tables / 366 rows were
preserved; all 30 SQL versions have matching execution hashes. Prior files were
skipped, never rewritten or replayed. Apply only one migration chain. Exact objects,
business distinctions, role checks, results and limits are in
`docs/PHASE15_REPORTING_AUDIT.md`, its four verification JSON files and the permanent
Implementation History. Phase 16 is not started; older status entries remain
historical records.
