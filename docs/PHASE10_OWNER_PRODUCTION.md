# Phase 10 — Owner Production

Implemented and applied live on 4 October 2026 (Asia/Calcutta). Master Plan
Sections 15–16, Phase 10 and Sections 30–31 govern this change. The Phase 0
P01/T05 finding was that anonymous legacy Customer Tailoring was not Owner
Production. Phase 1 supplied the separate domain, Phase 8 supplied exact material
issues, and Phase 9 supplied the dynamic hierarchy. These are reused, preserving
Customer Tailoring and all existing data.

## Workflow

Owner configures Products and Designs, including optional explicit Design /
Embroidery Charges. Codes and IDs are permanent; names and active state may be
changed with an audit reason. A blank charge preserves the existing charge;
an explicitly entered zero is a real zero version. No absent charge is guessed.

Owner selects one Product, one Design, a positive whole piece count, current
Factory / optional Section / Tailor assignment, source location, and exact total
required fabric/material quantities. At least one fabric line is mandatory.
Creating the job issues those quantities atomically through the Phase 8 ledger.
Amounts are totals for the entire job, without multiplication, buffer or wastage.
Multiple Than rows from a Fabric + Batch can be selected internally. Fabric uses
whole millimetres in storage and metres in the form; consumables use their native
unit with at most three decimal places. Initial items share one source; subsequent
explicit issues can use other sources through the existing Material Issues panel.

The job opens after the initial issue, progresses to `in_progress`, then
`completed`. Owner or its assigned active Tailor records each transition with a
reason and expected previous status. Completed jobs cannot reopen or receive new
issues. Existing historical assignment links remain intact after reassignment.
Counter can issue materials to an open/in-progress Production Job through the
existing Phase 8 controls, but the Counter role cannot create/configure/progress
Owner Production. An account also holding Tailor can work on its assigned jobs.

Owner Production appears as a separate panel on the existing Tailoring route.
It has no customer, order, customer bill or Customer Tailoring price. Request UUID
and actor-bound payload retries prevent duplicate jobs/issues/status/configuration;
uncertain requests freeze form values and expose a retry of that same payload.

Completion here confirms the entire job only. Phase 11 will create individual
Finished Products and their unique Product Barcodes, including Workshop-first
location. No piece, stock return, Showroom placement or Product Barcode is created
by Phase 10 completion. No Complete Production Cost or SP is calculated. The
selected Design charge version is retained for Phase 12 costing.

## Migration inventory

Canonical new migration: `20261004000100_phase10_owner_production.sql`.
Byte-identical mirror: `drizzle/migrations/0024_phase10_owner_production.sql`.
Drizzle journal appended at index 24. Live execution uses the existing Supabase
ledger, never the Drizzle mirror. SHA256:
`85ad3f59045bf4670b9b29cd042edb1b0159b8335bff4a37a7527ce9d008cd30`.

No existing migration was edited, renamed, deleted or replayed. No existing
business row/column value was changed by deployment; no seed or backfill was run.
No configuration, production fixture, customer or transaction was created live.

New tables:

- `production_requests`: UUID request PK, required actor FK to profiles, exact
  JSONB payload, required result UUID, timestamp. Generic result references are
  validated by each RPC rather than a polymorphic FK. Registry supports catalogue,
  job and status operations. `(actor_id, recorded_at)` index. Payload can contain
  Owner Design charge data and is Owner-only under RLS.
- `production_status_events`: UUID PK, required job FK to production_jobs, UNIQUE
  request FK to production_requests, checked previous status `open/in_progress`,
  checked next status `in_progress/completed`, required actor profile FK, nonblank
  reason, timestamp. `(job_id, recorded_at)` index. Owner or assigned Tailor SELECT.

Existing `products`, `designs`, `design_charge_versions`, `production_jobs`,
`job_material_requirements`, `material_issues`, `material_issue_lines`,
`inventory_movements` and `erp_audit_records` are reused through checked RPCs.
Their existing UUID/FK/check/unique relationships remain unchanged. Job links to
one Product, one Design, one retained Design charge version if present, and one
historical Tailor assignment. Requirements retain individual issued-line links.
No new columns, relationship rewrites or indexes on existing tables were needed.

Functions/triggers:

- Private `guard_phase10_production` / `phase10_history_guard` triggers on
  Products, Designs and Production Jobs prevent deletion, catalogue code rewrites,
  or job identity/quantity/assignment/charge snapshot/notes/creator/time rewrites.
  Status must follow the stated transitions and have posted required fabric.
- Existing `reject_domain_history_rewrite` / new `phase10_immutable` triggers
  retain request and status-event history permanently.
- `manage_production_catalog`: Owner-only create/edit/activate/deactivate
  Product/Design, append explicit Design charge version, audit and idempotency.
- `create_owner_production`: Owner-only validate catalogue/current hierarchy,
  snapshot latest existing Design charge version, create one open job, issue exact
  requirements, audit and register the request atomically. No automatic quantities.
- `progress_owner_production`: Owner or assigned Tailor with manage_jobs,
  compare current status, retain actor/reason/time event and audit atomically.
- `owner_production_catalog`: Owner-only Product/Design configuration and current
  internal Design charge. Raw charge versions retain existing Owner financial RLS.
- `owner_production_history`: bounded Owner or assigned-Tailor operational JSON,
  Product/Design/piece count/hierarchy, named requirements/Batch/Than genealogy and
  status events. No CP, Design charge, production cost or SP projection.

Browser permissions: raw writes/TRUNCATE denied for both new tables and existing
domain. New tables enable RLS; Owner SELECT on both and assigned-Tailor SELECT on
events. service_role table privileges retained. Five browser RPCs explicitly
allow authenticated/service_role execution and check active role/assignment
internally; anonymous/PUBLIC execution revoked. Trigger helper is private. No new
role or module access grant. PostgREST reload is part of the migration.

## Verification and limitations

Disposable PostgreSQL verified canonical/mirror chains with demo data and the clean
chain, plus old-row preservation. 399 Phase 10 assertions cover ten-piece jobs,
separate Designs, no customer/order/later-phase records, exact native/fabric
quantities, idempotent changed/unchanged retries, charge snapshots, disabled
catalogue/closed assignments, historical assignments after moves, invalid stock,
job/status late-failure rollback, immutable identity/events, role/RLS/financial
denials and terminal completion. Earlier suites passed with the new migration.
Total: 2,970 database/business assertions plus 25 barcode/money assertions.

Production client/server build, TypeScript and scoped ESLint passed. Eight existing
Fast Refresh warnings remain. Full-repo lint still reports the same 217 existing
formatting errors across four unchanged legacy/test-stock scripts.

Live Session Pooler connection and Phase 9 cumulative schema verified before
application. Migration applied transactionally with cumulative schema comparison,
including constraints/indexes/functions/triggers/RLS/grants; fingerprints of all
66 old tables / 366 rows match. Both migration ledgers record the new file and hash;
all 25 SQL versions match repository hashes. Subsequent read-only Phase 10 schema
verification, 157 live security checks and five real PostgREST registration /
anonymous-denial checks passed. Evidence JSON files sit alongside this document.

No browser click-through acceptance, live business-transaction fixture or actual
multi-connection race test was performed. Existing four legacy job classification /
assignment decisions remain untouched. Live canonical Production catalogue and
jobs remain empty until explicitly configured/created by Owner. Phase 11 onward,
legacy-screen retirement, costing and product sales remain outside this phase.
No commit, push or application deployment was performed. Stop for Phase 11 approval.
