# Phase 8 — Consumables + Material Issues

Implemented and live verified on 2026-10-04 (Asia/Calcutta). Phase 9 has not started.

The Master Plan Sections 10–14, 26 (Phase 8), 30 and 31 define this scope. The
Phase 0 audit and verified Phase 1–7/live reconciliation history supplied the
baseline. `systems_operations_guide.md` was searched for and is absent from this
checkout; the Master Plan and permanent Implementation History remain the authority.

## Workflows

- Inventory → **Consumables** shows buttons, thread, padding and other materials,
  native units and location balances. Legacy records without a canonical item
  explicitly require opening-location reconciliation; no receipt guesses an opening.
- Owner and Stock Entry with `inventory.receive` receive a new or already reconciled
  consumable into an explicitly selected active Workshop, Showroom or sublocation.
  Quantity, receipt reference/reason and receipt CP per native unit are explicit.
  New catalogue/item, receipt, private CP, INWARD movement and audit commit together.
  CP can be edited in the form before submission. After posting Stock Entry has no
  ongoing receipt/catalogue CP read. Existing catalogue CP/SP is never overwritten
  by restocking; each receipt retains its submitted CP separately.
- Owner can explicitly classify or deactivate/reactivate materials. Unit and the
  historical `qty_on_hand` are preserved. Existing categories default to `other`,
  meaning no inferred classification; the Owner can choose the known category.
- Counter/POS and Tailoring → **Material Issues** issue actual quantities to an
  open/in-progress canonical Customer Tailoring Job or existing Production Job.
  Factory, optional Section and Tailor derive from the job's existing assignment;
  the caller cannot substitute these relationships. Production creation remains
  Phase 10. This phase does not migrate the four unresolved legacy tailoring jobs.
- A Required Material Issue records the explicitly entered requirement against
  its matching posted issue line. Customer Tailoring's quoted required fabric was
  already issued at booking and cannot be issued again as required fabric.
  Additional fabric/consumables require **Additional Material Issue**, an explicit
  quantity and reason, linked to the same job. No automatic wastage or buffer exists.
  A fresh request cannot issue the same already-declared material as required again;
  later quantities use Additional Material Issue. Multiple initial production Than
  lines from one Fabric + Batch remain allowed within the same required issue.
- Every issue line has exactly one matching debit, source, unit, quantity, job and
  actor. Material/fabric, Batch/barcode/internal Than, assignment, source, issuer,
  timestamp and movement IDs are available in history. Tailor sees assigned jobs
  and issues only. Source quantities cannot become negative.
- Receipt and issue submissions retain their request UUID and payload during an
  uncertain network result; the UI freezes the submitted form and offers retry of
  that same request. Confirmed database rejections allow correction. Completed retry
  returns the existing result, even when a job has subsequently closed; changed
  payloads or another actor cannot take over a request.

## Versioned migration

Canonical: `supabase/migrations/20261003001100_phase8_consumables_material_issues.sql`.
Mirror: `drizzle/migrations/0021_phase8_consumables_material_issues.sql`.
Journal: append-only entry 21. SHA256:
`6dc6283c4a8a623b14c8773d17c9ef6e54abc36549c0ad982e3da2f45aeaba37`.
The live Supabase ledger and private ERP execution history record version
`20261003001100`, its filename, hash, applied mode and verification. Do not replay
the uninitialized Drizzle ledger against this existing live database.

Final review added a separate migration, preserving the already-applied file:
`supabase/migrations/20261003001200_phase8_required_issue_guard.sql`, mirror
`drizzle/migrations/0022_phase8_required_issue_guard.sql`, journal entry 22.
It adds private `guard_phase8_required_repeat()` and the BEFORE INSERT
`phase8_required_issue_once` trigger on issue lines. A previously declared job
material/Fabric + Batch requires Additional Material Issue. Lines in the same
initial production issue and Phase 7 booking are preserved. No data/backfill, new
permission or pricing change. The separate hash is recorded in the verification
JSON and both live migration ledgers. All 23 repository migrations are recorded.

| Object | Change |
| --- | --- |
| `materials` | New `category` text, NOT NULL/default `other`, CHECK buttons/thread/padding/other. Original columns/values preserved. |
| `consumable_receipts` | Immutable UUID receipt and unique request UUID; private JSON retry payload; material/item/location/profile FKs; exact positive numeric(18,3) quantity, unit, required reason, receiver/time. Material/time/ID index. |
| `consumable_receipt_costs` | Immutable one-to-one receipt FK/PK; per-unit CP bigint with 0–2147483647 paise CHECK. No assumed valuation allocation. |
| `material_issues` | Nullable unique `request_id` and JSON payload, preserving old issues. Assignment/time/ID index. Existing job XOR/assignment/source/type/append-only guards reused. |
| `material_issue_lines` | Material/issue index; existing identity XOR, FKs, native-unit/quantity and append-only checks reused. |
| `inventory_movements` | Nullable unique `consumable_receipt_id` FK; private trigger verifies receipt identity/destination/quantity/unit/actor and rejects other references on receipt postings. Existing issue linkage/balance/actor/once-only guards reused. |
| `job_material_requirements` | Nullable unique `material_issue_line_id` FK; new trigger checks required issue/posted movement/same job/item/quantity/unit, and makes posted requirements immutable. |
| `guard_phase7_history()` | Replaced by this new migration, permitting only INSERT of a consumable requirement with an explicit issue-line FK, validated by the new Phase 8 trigger. Quoted fabric, existing requirements, booked identity, order and price protections retained. |

New security-definer RPCs with fixed public search path:
`receive_consumable`, `manage_consumable`, `consumable_catalog`,
`consumable_receipt_history`, `material_issue_jobs`, `post_material_issue`,
`material_issue_history`. Private trigger functions:
`guard_consumable_receipt_link`, `guard_phase8_requirement`.

No new permission keys, roles or hierarchy records. RPC EXECUTE is authenticated
only and each body enforces its active-role/permission ceiling. Private trigger
helpers deny PUBLIC/anon/authenticated EXECUTE. New receipt tables enable RLS;
Owner reads operational receipts and CP, Stock Entry reads only own operational
receipts. Browser receipt columns exclude the CP-containing retry payload, including
for Owner; receipt CP is available to Owner through its RLS-protected cost table.
Authenticated browsers have no raw mutation grants on these new tables. Service role
retains trusted administration grants. Canonical issues use existing RLS; RPC history
also scopes Tailor to assigned jobs and projects no CP/SP/internal financial fields.

Posting serializes request IDs with transaction advisory locks. Issue posting locks
the job, material catalogue rows and canonical items in stable order, then the source;
receiving locks existing material/item before its destination. These coordinate with
the existing ledger's item/location locks and catalogue deactivation. No concurrent
multi-connection acceptance test is claimed.

No stock/data backfill, inferred costs/prices, new live business fixtures, historical
ID changes, deletes, resets or applied-migration rewrites. The only existing-row
addition is the documented `category='other'` metadata default; all prior column
values and all 366 rows across the 63 pre-existing public tables were fingerprinted
unchanged before, within and after the live transaction. The migration explicitly
notifies PostgREST to reload its schema on commit.

## Verification and limitations

- 372 new Phase 8 checks: native decimal quantities/paise, each category, receipt and
  issue retry, changed requests, wrong source, insufficient stock, invalid units/
  categories/quantities, late failure rollback, genealogy, explicit additional
  fabric, unchanged booked price, immutable requirements, existing Production Job
  linkage, raw-write denial, CP secrecy, assigned Tailor scope, revoked permissions,
  inactive staff and anonymous denial. Canonical/mirror demo and clean chains pass.
- Phase 1–7: 1,599 regression checks (Phase 1 remains its bounded baseline; Phase 2–7
  run with Phase 8 loaded). Legacy reconciliation 207 and test-stock provenance 96
  checks also pass. Total local checks: **2,274**.
- Live cumulative schema comparisons include columns, constraints, indexes,
  functions/EXECUTE, triggers, policies and RLS/browser CRUD; migration retry skips
  its recorded hashes. **93** live role/hash/schema-state security checks pass.
  Three actual PostgREST RPC requests confirm registration and anonymous 401/42501.
- TypeScript and isolated production client/server build pass. Application and
  Phase 8 affected-script lint: zero errors, eight pre-existing fast-refresh warnings.
  Full repository lint still has **217 pre-existing formatting-only errors** in four
  untouched reconciliation scripts (see verification JSON), which were not changed
  as part of this phase. Build retains existing plugin/mixed-import notices.
- No authenticated browser interaction, scanner/printer or live business fixtures
  were executed. Operational receiving and job posting acceptance is tested on
  disposable PostgreSQL; live checks use read-only transactions/existing staff.
- Four historical tailoring jobs remain unresolved/unchanged. Existing test stock
  allocations/IDs/CP/SP remain unchanged. No Production Job creation, Phase 9
  management, finished products or automatic cost allocation/FIFO/LIFO/weighted
  costing was introduced; complete production costing is Phase 12.

Evidence: `PHASE8_VERIFICATION.json`, `PHASE8_LIVE_VERIFICATION.json`,
`PHASE8_SECURITY_VERIFICATION.json`, `PHASE8_API_VERIFICATION.json`.

Stopped after Phase 8. Phase 9 requires approval.
