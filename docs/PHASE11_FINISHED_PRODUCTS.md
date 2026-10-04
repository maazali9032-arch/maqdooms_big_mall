# Phase 11 — Finished Products + Product Barcodes

Implemented and applied live on 4 October 2026 (Asia/Calcutta). Master Plan
Sections 17–18, Phase 11 and Sections 30–31 govern this phase. Phase 10 records
whole-job completion; this phase confirms individual physical pieces and their
Workshop receipt. No Phase 12 or later workflow was implemented.

## Implemented workflow

Owner selects a completed Production Job and enters actual usage per physical
piece against its issued fabric/material rows. Inputs show material name, Batch,
internal Than identity and total issued quantity. Fabric inputs are metres;
storage uses whole millimetres. Consumables retain native units and at most three
decimal places. Each piece needs positive actual fabric usage. No quantity is
automatically divided by job quantity, copied to other pieces, multiplied,
rounded or inflated. Unallocated issued material remains visible in job history;
no waste/return/cost is inferred.

One checked receipt creates all pieces of the completed job, numbered 1 through
job Quantity. Each gets a UUID, permanent Product/Design/Job relationship and
independent `PRD-` Product Barcode with random UUID identity. Codes need not encode
genealogy/cost, per the Master Plan. Barcode kind is product, distinct from the
one Fabric + Batch barcode. Codes and piece identities cannot be rewritten.

The receipt creates one canonical inventory item per piece with initial snapshot
zero, then one `PRODUCTION` movement of exactly 1 pc into Workshop. These are new
manufactured stock, not legacy opening balances. No material is deducted a second
time: it was already issued by Phase 10/8. No piece enters Showroom directly.
Job material allocations reference actual issue lines from the same job, in the
same native unit, and cumulative per-line allocations cannot exceed issued quantity.

Batch creation, barcodes, allocations, item authority, stock movements, receipt
registry and audit are one transaction. Actor-bound request/payload retries return
the same job without recreating anything. A changed request or a second request
for an already received job is rejected. Existing partial/historical pieces are
retained and block automatic recreation rather than being overwritten. No such
partial canonical job exists in the live database at deployment.

Owner/Counter can scan Product Barcodes; active Tailors can retrieve only their
assigned jobs' pieces. Lookup returns Product, Design, Production Job, piece number,
job quantity/status, actual fabric/material usage with Fabric + Batch barcode and
internal Than IDs, historical assignment, Factory/Section/Tailor, status events,
Workshop receipt actor/time/reason, current location, current ledger balance and
availability. Lookup is bounded to 100 rows; scanning one unique code retrieves
one piece. Unknown, fabric or unpermitted codes return no match.

The Finished Products panel appears on Tailoring and Counter routes according to
existing module access. It has a per-piece quantity grid, barcode/manual scanning,
read-only genealogy/history and printable Code 128 labels with product/design/piece/
job identity. Labels contain no CP/internal cost. The existing encoder/print helper
is reused; the helper accepts an optional frame title and keeps the Fabric default.

No Complete Production Cost or SP setter exists in this phase. Existing SP may be
read for Owner/Counter through the already-established version table; absent SP is
NULL and shown as not set. Tailor receives no SP value. No internal charge/CP/cost
projection is added. The UI explicitly says costing/SP setup awaits Phase 12.
Existing generic Phase 3 ledger operations remain unchanged and authoritative;
lookup reflects their current location/status. The dedicated Finished Product
transfer and sale workflows remain Phases 13 and 14.

## Migration record

Canonical new file: `supabase/migrations/20261004000200_phase11_finished_products.sql`.
Byte-identical mirror: `drizzle/migrations/0025_phase11_finished_products.sql`.
Drizzle journal appended at index 25, without rewriting older entries.
SHA256: `60d13e54d09816b654486dd35ed51218ffce0314f81c6db9f182746d00bf49af`.
Live uses the existing Supabase/private ledgers; never replay the Drizzle mirror.
No existing migration, seed, business row or original column value was changed.

New tables and relationships:

- `finished_product_receipts`: request UUID PK; required UNIQUE Production Job FK
  enforces one full receipt per job; required actor profile and Workshop location
  FKs; exact JSONB payload; nonblank reason; timestamp. `(actor_id,recorded_at)` index.
- `finished_product_receipt_pieces`: Finished Product FK/PK (one receipt per physical
  piece); required request FK to receipts; `(request_id)` index. RPC and production
  movement guard verify that receipt and piece share the same Production Job.

No existing columns/FKs are changed. Reuses Phase 1 Finished Products/Barcodes,
per-piece material allocation table, Production Jobs, Product/Design identities,
material issue line provenance, Phase 3 inventory authority and audit. New partial
unique index `phase11_piece_production_event_idx` on movement finished_product_id
where kind PRODUCTION prevents duplicate manufacture events.

Functions/triggers:

- Private `guard_phase11_identity`: `phase11_barcode_history` on barcode UPDATE/
  DELETE retains Product Barcode identity; original immutable barcode trigger also
  remains. `phase11_piece_history` on Finished Product UPDATE/DELETE retains job,
  product/design, piece, barcode/kind and creation timestamp, blocks deletion and
  leaves existing location/status ledger authority intact.
- `phase11_production_receipt_guard` on movement INSERT requires a PRODUCTION event
  to match a registered piece, completed job, actor, Workshop, reference and 1 pc.
  Existing ledger guards enforce units, balances and Workshop-first incoming stock.
- New receipt/piece registry `phase11_history_immutable` triggers reuse the existing
  `reject_domain_history_rewrite` function. Existing per-piece material immutability
  and per-issued-line quantity guards are reused without modification.
- `receive_finished_products`: Owner-only checked completed-job receipt with stable
  request/job/issued-line locks, explicit full piece set/material usage, all writes
  atomic, audit and actor-bound idempotence.
- `finished_product_catalog`: checked Owner/Counter/assigned-Tailor operational
  lookup with barcode/job/limit filters, genealogy, history, ledger availability and
  permitted SP read; no CP/charge/internal production cost projection.

Permissions/RLS: both new tables enable RLS; authenticated SELECT is Owner-only;
raw writes/TRUNCATE revoked from PUBLIC/anon/authenticated; service_role table
privileges explicitly retained. Browser RPC execution granted only authenticated/
service_role with fixed public search_path and active role/assignment checks;
PUBLIC/anon execution revoked. Trigger helper private. No new role/module privilege,
no change to existing financial RLS. Tailor lookup uses checked RPC, without granting
new broad raw Finished Product/material/receipt access. Reload is migration NOTIFY.

## Actual verification

351 Phase 11 database assertions passed on canonical/mirror demo chains and clean
replay, preserving all prior table/column values. Tests include one completed job,
ten pieces and unique barcodes, numbered pieces, 1 pc Workshop ledger receipts,
explicit usage/native precision/Fabric + Batch/Than provenance, hierarchy/history,
insufficient/foreign/duplicate/missing/fractional/overallocated materials, open/
in-progress rejection, tenth-piece late-failure rollback, changed/duplicate retries,
immutability, active/assigned/anonymous/role/RLS denial, no invented cost/SP/sale,
and current location after an existing generic Phase 3 transfer in disposable tests.
No new transfer workflow was authored.

15 independent Code 128 Product Barcode decoding checks passed at three scales with
the actual ten-module label quiet zones. Earlier 2,995 assertions passed, for
3,361 total local assertions. TypeScript, production client/server build and scoped
lint passed. Existing eight Fast Refresh warnings and 217 unrelated formatting
errors in four unchanged legacy/test-stock scripts remain documented.

Live Session Pooler connection and cumulative Phase 10 schema checked first. Only
the new migration was applied transactionally; cumulative functions/constraints/
indexes/triggers/policies/RLS/grants verified, 68 old tables / 366 old rows retained.
Two empty registry tables added (70 public tables total). All 26 SQL versions are
recorded with matching hashes. Read-only cumulative Phase 11 recheck passed;
188 live security/hash/API checks and two actual PostgREST registration/anonymous
401/42501 denial checks passed. Exact evidence stored in the Phase 11 JSON files.

No live business fixture/receipt/piece/barcode/stock movement was created. No manual
database change, commit, push or application deployment was performed. Browser
click-through, physical-printer/scanner acceptance and actual multi-connection
race tests remain unverified. Four existing legacy job decisions are untouched.
Live Product/Design/job/piece catalogues remain empty awaiting real Owner setup.
Finished Product costing/SP configuration, dedicated transfers and sales remain
future phases. Stop here and await Phase 12 approval.
