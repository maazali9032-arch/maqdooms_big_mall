# Phase 12 — Production Costing and Finished Product SP

Implemented and applied live on 4 October 2026 (Asia/Calcutta). Master Plan
Sections 16, 19–20, Phase 12 and Sections 30–31 govern this phase. Phase 11
provides the completed job, actual pieces, material usage and Workshop receipt.
No Phase 13/14 transfer or sale workflow was implemented.

## Owner workflow and business decisions

Owner selects a completed Production Job whose full set of actual Finished
Products has been received. Begin an initial/new cost revision, then explicitly
confirm each issued material's billed quantity and cost basis. The initial
revision's expected version is NULL; revisions retain the version seen when
editing began. Concurrent/newer cost revisions require refreshing the review.

Every issued line must appear exactly once. Billed quantity must cover the sum
of actual per-piece usage and cannot exceed issued quantity. Fabric is whole
millimetres internally; consumables retain native units/three decimal places.
Unused issued material can be explicitly billed at zero quantity/zero cost where
actual piece usage is zero. No billed quantity, waste, leftover return or cost is
automatically inferred.

Fabric uses the actual Fabric + Batch CP version explicitly selected by Owner:
quantity_mm × CP_per_m ÷ 1000. Consumables use either a matching native-unit
receipt CP explicitly selected by Owner, or an explicit Owner-confirmed actual
total amount when no receipt basis is selected (including legacy material).
Receipt selection confirms a costing rate source; it does not invent physical
FIFO/lot provenance for pooled stock. Each consumable's cost category is explicitly
confirmed as buttons, thread, padding or other consumables. No classification is
guessed from a legacy name. Existing recorded category is shown for confirmation.

Owner enters total job tailoring/production charge, named applicable other costs,
and the retained Design/Embroidery charge basis. Where a retained charge exists,
Owner must choose once for the whole job or once per piece. The amount comes from
the immutable job charge snapshot, never the current configurable Design charge.
It cannot be silently omitted. Where the job has no charge snapshot, Owner must
explicitly confirm not applicable; a zero Design line documents that decision.
No example charge, missing charge, margin, buffer or automatic wastage is invented.

Complete Production Cost sums fabric, production/tailoring, Design/Embroidery,
buttons, thread, padding, other consumables and named other applicable production
costs. Source-based material components round once to whole paise using positive
half-up rounding; integer money then remains exact. Inputs, source IDs, quantities,
charge basis and final component values remain permanently recorded.

Average cost is total ÷ Production Quantity. Per-piece stored allocations use
whole paise: floor(total/quantity), with one additional paise assigned to the first
remainder pieces in piece-number order. Allocations sum exactly to the total and
differ by at most one paise; the Owner sees both the average and exact allocations.
This is currency precision handling, not an invented charge or unequal material use.
Production quantity and individual material genealogy are not rewritten.

Owner reviews the recorded complete cost, then explicitly sets SP for one available
piece or all available pieces of that job. The price request must reference the
latest finalized cost version; each price history version records its reviewed
cost version and reason. No cost-based markup/minimum margin/automatic SP exists.
Explicit zero SP is supported. New cost revisions do not change existing SP;
the Owner view identifies prices reviewed against older cost versions.
Retries retain the same UUID/payload, including uncertain network outcomes.

Owner's Product Barcode scan includes the latest per-piece internal cost/version.
Counter sees SP but no cost fields/version, CP, charge or internal breakdown.
Assigned Tailor sees only operational genealogy and no SP value/internal cost.
Owner-only Production Costing panel appears on Tailoring; financial APIs reject
other roles even if called directly. Existing session query-cache clearing on
identity/access changes is reused.

## Migration and schema record

New canonical `supabase/migrations/20261004000300_phase12_production_costing.sql`.
Byte-identical mirror `drizzle/migrations/0026_phase12_production_costing.sql`;
journal index 26 appended without changing old entries. SHA256:
`c1b51c07c181a9bcc36c3b90f93296807c16397849cdca0204b9ad56163e2d49`.
Live uses existing Supabase/private migration ledgers, never the mirror chain.
No old migration, seed, business row or original column value was modified.

New tables:

- `production_cost_requests`: UUID request PK, required actor profile and Production
  Job FKs, exact JSONB payload/result UUID/time; job/time index. Generic result UUID
  is checked by RPC (cost version for costing, job for pricing). Owner-only RLS.
- `production_cost_inputs`: cost-line FK/PK; optional numeric(18,3) billed quantity
  and unit together, nonnegative quantity check; optional consumable receipt FK;
  checked optional Design basis job_total/per_piece/not_applicable. RPC validates
  units, actual issued material, billed usage bounds and source matching. Existing
  cost-line fields retain fabric CP and Design version/issue-line FKs and amount.
- `finished_product_price_reviews`: immutable price version FK/PK, required cost
  version FK, request FK (DEFERRABLE INITIALLY DEFERRED for atomic price/request
  posting), nonblank reason; cost-version index. RPC validates the same job/piece
  allocation and latest finalized cost review. Actor/time are retained by the
  original price version and linked request.

All three enable RLS, authenticated Owner-only SELECT and no browser writes/
TRUNCATE. service_role privileges retained. `phase12_history_immutable` triggers
reuse the existing history-rewrite rejection function. Existing cost versions,
component lines, per-piece allocations and prices remain append-only under their
original triggers/FKs/unique constraints and Owner financial RLS. No old columns,
constraints, functions/triggers or indexes are removed.

Functions:

- `finalize_production_cost`: Owner-only fixed-search-path SECURITY DEFINER RPC;
  actor-bound request/job/issued-line locking, expected revision, complete actual
  receipt, explicit costing/source/basis validation, new cost revision/components/
  input evidence/all allocations/request/audit posted in one transaction.
- `set_finished_product_sp`: Owner-only checked current registered complete cost,
  distinct available job pieces with cost allocations, explicit supported SP,
  new price versions/review links/request/audit atomically. No silent repricing.
- `owner_production_costs`: Owner-only job context/source versions/receipt CP,
  retained Design charge, all immutable cost revisions, totals/average/components/
  input evidence/allocations and current SP/review links for review/history.
- Existing `finished_product_catalog` replaced only in this new migration to mark
  pricing state accurately and add latest internal per-piece cost/version strictly
  for Owner. Operational scope, SP role ceiling, identity/genealogy and stock reads
  remain; other roles receive no internal cost keys.

New financial RPCs explicitly allow authenticated/service_role execution with
active Owner checks; PUBLIC/anon execution revoked. Existing financial RLS/role
ceilings/raw-write restrictions are retained. No role/module access grant added.
PostgREST reload is migration NOTIFY. No data/backfill/manual database operation.

## Verification and practical limits

516 new database assertions passed across canonical/mirror demo and clean replay:
complete component sum; retained Design charge included with explicit job/per-piece
basis; missing snapshot explicit NA; fractional native receipt CP rounding; exact
average and conserved allocations/remainder; matching Fabric + Batch/receipt/units;
explicit manual material cost; omitted/duplicate/foreign/under/over/fractional/negative
inputs; stale/changed/historical retries; immutable cost history; SP after latest
review, zero SP, no automatic SP change; price review provenance; late cost/price
failure rollback; active/Owner/non-Owner/anonymous financial RLS/API/raw-write denial;
Owner scan cost and Counter SP without cost keys. Earlier phase/reconciliation
suites passed with the new migration. Total: 3,877 local assertions, including
40 independent barcode/money checks and 3,837 database/business assertions.

TypeScript, scoped ESLint and production client/server build passed. Eight existing
Fast Refresh warnings remain. Full repo retains 217 existing formatting errors in
four unchanged legacy/test-stock scripts, with no new errors.

Live Session Pooler connection and cumulative Phase 11 baseline verified first.
Only the new migration applied transactionally with cumulative schema/functions/
constraints/indexes/triggers/policies/RLS/browser privilege comparison and all
70 old tables / 366 row fingerprints before commit. Three empty tables added
(73 public tables). Both ledgers record the actual new file/hash/verification;
all 27 SQL versions match repository hashes. Subsequent read-only Phase 12 schema
recheck, 232 live security/hash/API checks and three real PostgREST registration/
anonymous 401/42501 denial checks passed. Exact evidence is in Phase 12 JSON files.

No real job cost, price, stock, customer/order or fixture was posted live by schema
rollout. Live canonical jobs/pieces remain empty pending explicit Owner setup;
actual calculations were tested in disposable PostgreSQL, not on production data.
No browser acceptance or real multi-connection race test, commit, push or app
deployment. Four existing legacy job decisions remain untouched. Owner confirmations
of real cost sources/billed quantities/Design basis are required during actual use;
no missing historical CP/receipt provenance is reconstructed. Dedicated Finished
Product transfer/sale workflows remain Phases 13/14. Stop before Phase 13 approval.
