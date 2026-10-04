# Phase 2 authorization contract — 3 October 2026

The implementation master plan is the business authority. This document describes
the authorization implemented in `20261003000100_phase2_authorization.sql`, with
the byte-identical Drizzle mirror `0011_phase2_authorization.sql` (journal index 11).
Apply one migration chain, never both copies. Prior migrations remain unchanged.

## Role boundaries

| Role | Financial access | Operational scope |
| --- | --- | --- |
| Owner | Legacy CP through cost table/material/job RPCs; all new financial tables including every production-cost component; legacy tailoring SP through Owner RPC | Existing operations and administration; SELECT on all 34 Phase 1 tables |
| Stock Entry | Current CP through explicitly scoped workflow RPCs; no raw CP table, revision/history, material-cost, job-cost or production-cost access | Own open legacy receiving drafts; CP of own new-model `draft`/`correcting` stock; cannot change SP or reopen completed stock |
| Counter | Direct-sale SP and Finished Product SP; final Customer Tailoring price RPC only; no CP, charge/design-cost versions, production costs, financial reconciliation or financial audit rows | Existing sales/customer/job creation and issue operations; new stock/product/hierarchy/catalogue reads and Customer Tailoring job/requirement/issue reads |
| Tailor | No CP, cost history, production cost or pricing RPC | Assigned Customer Tailoring/Owner Production jobs, own assignments and their factory/section; assigned materials; existing status RPC retained. Counter issues materials; Tailor no longer operates Counter |

Existing `ecommerce_manager` is retained. No Factory login role is created. Role
unions still apply: an account explicitly assigned Owner retains Owner access.
All sensitive checks require an active profile. Permission overrides cannot grant
Owner-only finance/administration/stock adjustments/price overrides, nor bypass
receiving/sales/issuing role ceilings. Existing role/override data is preserved;
bootstrap returns the effective restricted permissions.

## Database inventory

No tables, columns, indexes, relationships or constraints are added or altered.
There is no DML/backfill, reassignment of legacy creators, ledger population,
CP/SP conversion, or production-data operation in this migration.

New functions:

- `can_enter_legacy_cp(uuid)`: Owner or active Stock Entry with receiving permission,
  own Than and own batch, both draft. Unknown/unattributed legacy work is Owner-only.
- `stock_entry_cp(uuid)`: current legacy CP for one authorized workflow row; no history.
- `stock_entry_set_cp(uuid,integer)`: validates nonnegative CP, locks batch then Than,
  checks scope after locking, and upserts the existing legacy CP record.
- `guard_receiving_authorization()`: trigger guard for batch/Than INSERT/UPDATE,
  stamps Stock Entry creators, prevents ownership/batch takeover and SP changes,
  rejects closed/unowned work. A narrow existing Counter sale depletion exception
  changes only `status` and `updated_at` from active to depleted.
- `guard_legacy_cost_write()`: applies workflow authorization inside correction RPCs
  as well as direct CP writes. Owner remains authorized for historical stock.
- `owner_tailoring_line_prices()`: Owner-only legacy SP snapshots, complementing
  the existing CP reader; non-Owners cannot SELECT the snapshot column directly.
- `owns_tailor_assignment(uuid)`: active Tailor login matched to active real Tailor
  profile and the specified assignment. Historical assignment identity is retained;
  validity end dates do not silently erase assigned-job history.
- `domain_stock_entry_cp(uuid,bigint DEFAULT NULL)`: locks an existing stock identity;
  NULL reads latest CP, a nonnegative value appends a cost revision. Stock Entry
  requires its own `draft`/`correcting` record and receiving permission. No raw cost
  history, stock creation, reopening, activation, SP, barcode or ledger operation.
- `customer_tailoring_final_price(uuid)`: active Owner/Counter receive only the
  latest stored final customer price; no CP or charge breakdown. This reads a
  Phase 1 snapshot; it does not calculate/issue a new bill or implement Phase 7.

Replaced function definitions (new migration, historical files unchanged):

- `has_perm`: hard role ceilings above; Owner full access, other existing effective
  permissions/overrides retained within the allowed role scope.
- `bootstrap_current_user`: existing active/effective access behavior retained;
  verifies Auth user existence and serializes initial role provisioning with an
  advisory transaction lock. Existing initial Owner/subsequent Counter defaults remain.
- `tailoring_job_totals`: assigned-job scope for Tailor; both internal CP and
  SP-derived totals NULL for non-Owners; operational line counts retained.
- `issue_tailoring_fabrics`: existing validated atomic issue/locking behavior
  retained; removes SP-derived line/total amounts from its browser response.
  Existing historical snapshots and Owner audit detail remain unchanged.
- `thaan_available_mm`: retains the existing balance calculation but requires an
  active operational role or a Tailor assigned to that material; inactive/unassigned
  users cannot bypass the stock RLS through this definer helper.

Three new triggers: `phase2_receiving_auth` on receiving batches,
`phase2_thaan_auth` on Thans, and `phase2_cost_auth` on legacy CP.

RLS/grants:

- Replace both permissive legacy cost policies with `owner_costs` (Owner ALL).
- Replace batch ALL policy with Owner ALL and Stock Entry owned-draft INSERT/UPDATE;
  Stock Entry has no batch DELETE authorization. Existing nonfinancial reads remain.
- Replace legacy job/line SELECT policies with active role/assigned-job checks;
  replace Than/movement SELECT policies with operational roles or assigned Tailor scope.
- Revoke authenticated SELECT on legacy tailoring `price_snapshot_paise`.
- `phase2_owner_read` on every Phase 1 table: authenticated SELECT with active Owner
  predicate; includes sealed finance, audit, reconciliation, orders and genealogy.
- `phase2_counter_stock`: locations, barcodes, stock identity/SP versions, products,
  designs, Finished Products/SP, factories, sections, Tailors and assignments.
- `phase2_entry_stock`: locations, fabric stock and barcodes, containing no CP.
- `phase2_tailor_self`, `phase2_tailor_assignment`, `phase2_tailor_factory`,
  `phase2_tailor_section`: self/assignment hierarchy scope.
- `phase2_customer_jobs` (Counter or assigned Tailor), `phase2_production_jobs`
  (assigned Tailor), `phase2_job_requirements` (visible parent job),
  `phase2_job_issues` (assigned Tailor or Counter Customer Tailoring issues),
  `phase2_issue_lines` (visible parent issue), `phase2_tailor_fabric` and
  `phase2_tailor_barcode` (visible assigned issue identity).
- New tables remain closed to browser INSERT/UPDATE/DELETE; future operational
  mutation RPCs/policies belong to their phases. Existing immutable-history guards stay.
- Revoke PUBLIC/anon EXECUTE on all public SECURITY DEFINER functions. Explicit
  authenticated helper/RPC grants retained/restored; new guard triggers are not callable
  by browser roles. Existing Phase 1 trigger functions remain sealed.
- `v_thaan_stock` changed to `security_invoker=true` to honor underlying RLS.

## Application changes

Session bootstrap fails closed; stale asynchronous loads cannot restore old access.
Identity/access changes cancel and clear React Query data and remount the protected
subtree, discarding local form state. Missing/inactive bootstrap fails the route guard.
Focus/60-second refresh and existing profile realtime checks remain; no claim is
made that live realtime role-change publication is configured. Database checks apply
immediately; displayed access updates on the next successful refresh.

Receiving shows only own draft batches to Stock Entry, uses scoped CP reads/writes,
and disables/skips SP submission for non-Owners. Global Inventory CP remains Owner-only.
Tailoring queries omit restricted SP columns and enrich Owner-only prices via RPC;
non-Owner tailoring material/aggregate SP displays are hidden, including Counter staging.
Tailor navigation/home excludes Counter. Three new client RPC type definitions added.

## Verification and limits

`scripts/phase2-security-test.mjs` replays both full migration chains against disposable
PGlite PostgreSQL with Supabase Auth/storage scaffolding. Queries run under actual
`authenticated` database role and different `auth.uid()` values; tests exercise both
reads and rejected mutations, not frontend concealment. Run with the external PGlite
runtime path; no application dependency, .env access or live DB connection is used.
Phase 1 suite now explicitly excludes Phase 2 files, preserving its Phase 1-only
sealed-schema assertions and regression baseline.

Live Supabase migration application, PostgREST introspection, OAuth/browser sign-in,
realtime delivery, browser cache-state behavior and multi-connection concurrency
remain unverified. PGlite is single-connection; locks are present but concurrent races
are not claimed tested. Production remains unchanged.

Legacy receiving still requires SP for activation. Stock Entry enters/edits own
open-draft CP; Owner supplies SP/completes legacy stock. Committed/unattributed
legacy corrections are Owner-only. New-model correcting CP authorization exists,
but creating/opening/closing that receiving workflow belongs to Phase 4. Historical
CP overwrites in the legacy model remain legacy behavior; the new model appends revisions.
Automatic financial/action audit completion belongs to Phase 15.

No Phase 3 ledger, balances, transfers or later billing, receiving/barcode cutover,
production costing calculation, completion, mutation workflows or new ERP screens
are implemented here. All are intentionally pending their approved phase.
