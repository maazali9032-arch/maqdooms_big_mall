# Phase 15 — Reporting + Audit + Owner Controls

Implemented and applied live on 4 October 2026 (Asia/Calcutta), governed by the
Master Plan Sections 24–25, 29–31. Phase 14 was the verified transaction baseline.
Phase 16 is not started. This phase adds reporting and prospective audit evidence;
it does not post transactions or automatically correct business records.

## Reporting and business decisions

Owner Reports replaces the old limited legacy-sales summary. Reports and Audit
remain on their existing routes. The new checked Owner RPC provides 24 datasets:

- Current stock by item and location; Fabric + Batch / CP / SP; batches; internal
  Thans; consumables; consumable receipts and CP.
- Customer Tailoring Jobs and charges; Factory / Section / Tailor / assignment /
  charge / Design / Product configuration; Material Issues; Tailor issued material
  and recorded piece usage.
- Owner Production Jobs; complete Production Cost revisions, input evidence and
  per-piece allocations; Finished Products, SP, cost and location.
- Transfers; movements; orders and private financial/sale-time snapshots;
  production status and Workshop receipt history.
- Legacy reconciliation; exact records requiring Owner review; staff access;
  canonical plus legacy audit; separate legacy sales, tailoring and movements.

Stock comes from the canonical location ledger, grouped by location and unit.
Workshop, Showroom and recorded child locations retain separate direct balances;
the same child stock is not added a second time. Stock is current state, not an
invented historical balance. Unlinked Than quantities and missing costs/prices
remain unknown; legacy quantity snapshots are explicitly identified separately.
Fabric barcode remains at Fabric + Batch level with individual Than rows internally.

Current stock/catalogue/access/control datasets ignore transaction date bounds.
Dated history uses half-open [from, to) event bounds; undated rows remain visible.
India date inputs make the selected Through date inclusive by sending the next
India midnight as the exclusive end. Search filters report records, not overview
aggregates. All matching counts/totals are calculated in the database independently
of pages loaded; UI pages contain 50 records, RPC allows 1–200, and all pages can
be requested using stable keys. Audit is newest first across both recorded sources.
Reports are not a frozen export snapshot while other users are transacting.

Paid sales totals require completed direct Fabric/Finished Product orders with
recorded payment confirmation. Customer Tailoring booked customer prices are
reported separately, not assumed to be collected revenue. Legacy history is
preserved separately and never silently added into canonical totals. Financial
aggregates are returned as decimal strings and displayed with exact BigInt paise;
stock units remain separate, with integer mm displayed as metres.

Material issued and actual recorded Finished Product allocations are distinct.
Customer Tailoring actual consumption is explicitly not recorded; no waste or
consumption is inferred. Production Cost reports retain every revision, all
components including Design/Embroidery, input evidence and actual allocations.
Original order financial snapshots remain unchanged by later cost/SP revisions.

Owner controls show counts and exact affected records for unresolved legacy jobs,
unreconciled non-draft Thans, negative balances, Finished Product stock/status/
location mismatches, unpriced available pieces, completed jobs not received and
received jobs without finalized costs. Links reuse existing inventory, tailoring,
access and audit workflows. No new unrestricted correction API was introduced.

## Migration and schema

- Supabase: `20261004000600_phase15_owner_reporting_audit.sql`.
- Byte-identical Drizzle mirror: `0029_phase15_owner_reporting_audit.sql`;
  journal index 29, appended without changing historical entries.
- SHA256: `479aa0ad31bc4e041476e0d0b62b1b35434750692056dfe4b236be0a2b72b2b8`.
- No new tables, columns, relationships, FK/check constraints, data/backfill,
  seed, opening balances, cost/SP assumptions or historical reconstruction.
- Indexes: `phase15_audit_time_idx` on `erp_audit_records(occurred_at,id)`;
  `phase15_order_kind_time_idx` on `orders(kind,status,completed_at,id)`.
- Three functions with fixed public search path: `owner_erp_report(text,
  timestamptz,timestamptz,text,integer,text)`, `owner_erp_overview(timestamptz,
  timestamptz)`, and trigger-only `capture_owner_domain_audit()`.
- `phase15_legacy_audit_immutable` rejects UPDATE/DELETE on `audit_log` using
  the existing immutable-history guard. Browser roles lose INSERT/UPDATE/DELETE/
  TRUNCATE on this table; existing checked definer logging continues working.

52 tables receive `phase15_row_audit` AFTER INSERT/UPDATE/DELETE triggers:
roles, permissions, fabrics, suppliers, receiving_batches, customers, sale_items,
tailoring_job_lines, profiles, user_roles, user_permission_overrides,
role_permissions, locations, barcodes, fabric_stock, thaans, thaan_costs,
stock_movements, sales, tailoring_jobs, customer_tailoring_jobs,
finished_product_receipts, finished_product_materials, materials,
consumable_receipts, consumable_receipt_costs, inventory_movements, material_issues,
material_issue_lines, stock_transfers, stock_transfer_lines, production_jobs,
production_status_events, finished_products, orders, order_items,
production_cost_lines, finished_product_cost_allocations, tailoring_factories,
tailoring_sections, tailors, tailor_assignments, products, designs, tailoring_charges,
fabric_stock_costs, fabric_stock_prices, finished_product_prices,
customer_tailoring_prices, tailoring_charge_versions, design_charge_versions,
production_cost_versions.

New financial version inserts capture the actual preceding revision by the
existing parent key and revision; other inserts correctly have no previous row.
Updates/deletes capture actual OLD/NEW JSON, actor auth.uid(), timestamp, table,
record identity and recorded reference/reason/code. Composite permission records
use deterministic audit-only UUIDs and their real keys as reference. Administrative
sessions without auth.uid retain NULL actor rather than inventing a user. Exact
no-op updates and profile last_login-only updates are excluded. Audit is written
in the same transaction; failure rolls back the triggering change.

Existing workflow audit entries remain; row evidence complements them and is
not silently deduplicated. No audit trigger is installed on the audit table itself.
Legacy details stay identified as legacy, with unavailable previous value NULL.
There is no claim to reconstruct old before/after values or to log failed attempts.

## Security

Both report RPCs require an active Owner through existing has_role checks before
reading any protected data. PUBLIC/anon execute is revoked; authenticated execute
does not bypass the Owner guard. Trigger-function execute is revoked from PUBLIC,
anon and authenticated. Owner audit RLS and all existing private CP/cost/order
financial RLS remain intact. Counter, Tailor, StockEntry and other non-Owner users
cannot retrieve report financials or audit financial rows. Existing session access
changes clear query caches. No existing business permission is broadened.

## Verification actually completed

- 681 new populated database assertions across Supabase demo, Drizzle demo and
  clean Supabase disposable PostgreSQL chains. All 24 reports, whole-population
  aggregates, exact CP/SP/cost evidence, canonical stock/sale changes, pagination
  including newest-first combined audit, date bounds, revision old/new values,
  access/location changes, legacy immutability, invalid inputs and non-Owner denial.
- All Phase 1–14 and reconciliation assertions pass cumulatively: 5,262 database
  checks plus 40 barcode/money and nine exact report money/quantity/date checks
  = **5,311 local assertions**. Original assertions retained.
- TypeScript noEmit, scoped ESLint and isolated production build pass. Full lint
  retains 217 prior formatting errors in four legacy scripts and eight prior
  fast-refresh warnings; no new errors. No deploy was performed.
- Live Phase 14 catalog matched the reference before rollout. Only the new file
  was applied, at approximately 06:38 UTC, transactionally with metadata recording
  and schema comparison including functions/triggers/RLS/grants. All 75 existing
  public tables / 366 rows retain original-column fingerprints. All 30 SQL
  migration versions have matching execution hashes. Later read-only rollout
  verifies Phase 15. No business fixture or correction was posted live.
- **331 live read-only checks** pass for actual Owner, Counter, Tailor and StockEntry,
  financial protections, all Owner report queries, anonymous/raw-write denial,
  migration hashes and prior approved test-stock integrity. Both new PostgREST
  APIs are registered and return 401/42501 to anonymous calls.

Evidence: `PHASE15_VERIFICATION.json`, `PHASE15_LIVE_VERIFICATION.json`,
`PHASE15_SECURITY_VERIFICATION.json`, `PHASE15_API_VERIFICATION.json`.

## Limits and phase boundary

Browser acceptance and real concurrent-user pagination/race acceptance remain
unverified. Populated transactions were tested only in disposable databases;
live canonical production/Finished Product tables remain empty. Four prior
`job_domain_and_assignment_unverified` Owner decisions are unchanged. No automated
legacy correction, stock valuation with unknown costs, guessed usage, financial
history overwrite, migration rewrite, configuration/environment change, deployment,
commit/push or Phase 16 dashboard/navigation/performance/polish work was performed.
