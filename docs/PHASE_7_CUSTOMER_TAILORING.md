# Phase 7 — Customer + Customer Tailoring

Authority: root Implementation Master Plan, especially sections 10–13, 23, 26,
27, 30 and 31. Actual chronological implementation record: Implementation History.
Phase 7 only; no general consumables/issues, Owner Production or Phase 9 management.

## Requirements and verified baseline

| Phase 7 requirement | Baseline | Actual implementation |
| --- | --- | --- |
| Customer creation/selection, WhatsApp | Existing customer contacts and deduplicating creation RPC | Reused in Counter's inline customer selector/contact capture; contacts saved in Order snapshot. |
| Customer Tailoring Job | Phase 1 domain tables; existing UI uses legacy jobs | New canonical job creation and selection/history on Counter and Tailoring screens. |
| Factory → Section → Tailor | Business tables and immutable assignment genealogy exist but no setup UI | Filtered selectors and minimum Owner setup; existing active identities preserved. |
| Required quantity / stock | Located internal Thans and locked ledger exist | Explicit exact-mm cuts, grouped requirements and atomic required fabric Material Issue. |
| Applicable Tailoring Charge | Owner-only versioned tables exist; no configuration endpoint | Owner defines applicable named amount, append-only versions; Counter selects name without amount. |
| CP + charge / final price | Private price table/formula exists; no complete booking workflow | Private quote uses CP snapshots plus exactly the selected charge amount; safe API returns final price only. |
| Job status, bill/order | Legacy workflow only | Existing open/in progress/ready/delivered/cancelled statuses, immutable booked Order, safe customer bill and Owner cost history. |

## Migration

- `supabase/migrations/20261003000600_phase7_customer_tailoring.sql`.
- Identical `drizzle/migrations/0016_phase7_customer_tailoring.sql`; journal index 16,
  version 7, `when=1790985960000`, breakpoints true. Apply one chain only.
- Both SHA-256: `ce8a20195a72705974de8fdb2fdf3f60ad0cfe78651f5a818cf858e08ddb5722`.
- No edits to older SQL, seeds, configuration, production data or manual/live DB writes.

### Tables, columns, relationships and constraints

New `customer_tailoring_quotes`: UUID primary key; created_by profile FK; source
location FK; selected charge-version FK; array-only `cuts jsonb`; nonnegative BIGINT
fabric CP total and applicable charge; generated final price = sum; created_at.
Private cuts record exact item/Than/Fabric Stock IDs, quantity, CP version/unit value
and rounded amount. These JSON references are derived and validated by the guarded
RPC, not new relational FKs. No authenticated INSERT/UPDATE/DELETE grants. Owner
SELECT RLS only, service-role ALL, immutable quote UPDATE/DELETE trigger.

Existing `customer_tailoring_jobs`: nullable unique `request_id uuid`,
`request_payload jsonb` and unique `quote_id uuid` FK. Payload contains quote ID,
customer, assignment, garment and notes, never CP. Old rows get NULL.
Existing `orders`: nullable unique `tailoring_request_id uuid`; reuse Phase 6
customer_snapshot/completed_at columns. A completed Order means the order is booked
and its required fabric issued; the separate job status tracks tailoring/delivery.
No payment-received claim or invented payment gateway/accounting state.

Two partial indexes: new-job created_at/ID history and MATERIAL_ISSUE events by
issue-line ID. Existing constraints/FKs reused for assignment factory/section,
customer, job, requirements, source, internal Than/Fabric Stock pairs, issue lines,
ledger and Order. One Order item represents the job (`quantity=1`, `unit='job'`,
SP NULL). Its private financial row stores **aggregate** fabric CP and applicable
charge, not a per-metre cost. Private quote cuts retain per-metre CP separately.
Existing generated price and selected-charge snapshot constraints are unchanged.

No backfill or reconciliation DML. Existing data and historical migrations retained.

### APIs, functions, triggers and permissions

All definer APIs use a fixed public search path and active-role checks. PUBLIC/anon
EXECUTE revoked, authenticated EXECUTE granted with authorization inside. Trigger
functions are private. No new role, permission seed or financial override authority.

| API | Authorization / behavior |
| --- | --- |
| `setup_customer_tailoring_assignment(text,text,text,text,text,text,uuid)` | Owner minimum bootstrap: create/reuse matching active Factory, optional Section, real Tailor and current assignment. Optional login must be active Tailor. Repeated identical setup returns same assignment; different existing assignment/name/profile is rejected. No silent reassignment. |
| `set_customer_tailoring_charge(text,text,bigint)` | Owner defines named applicable amount; appends a charge version and audit. Same current amount returns existing version. No hardcoded business amounts. |
| `customer_tailoring_catalog()` | Owner/Counter; operational Fabric Barcode/located cuts, current active hierarchy and charge names/version IDs. Removes SP fields; CP absent. Charge amounts returned only to Owner. |
| `quote_customer_tailoring(uuid,jsonb,uuid)` | Owner/Counter + `pos.issue_to_tailoring`; private immutable CP/charge quote; returns only quote UUID and final customer price. No reservation or inventory write. |
| `create_customer_tailoring(uuid,uuid,uuid,uuid,text,text)` | Same booking authorization; consumes owned/unbooked quote, validates current costs/charge, active hierarchy and stock; atomically creates job, price snapshot, requirements, fabric Material Issue/events, Order/private financials and audit. Returns job UUID only. |
| `set_customer_tailoring_status(uuid,text)` | Owner/Counter with operational permission, or assigned Tailor with job permission. Reuses existing job-status values without inventing a transition graph. Audited; no automatic return or price change. |
| `customer_tailoring_history(uuid,integer)` | Guarded safe definer projection; Owner/Counter all new jobs, Tailor only assigned jobs. Counter gets final price only; Tailor final price NULL. Operational material/user/location/genealogy references returned. Default 50, cap 200. |
| `owner_customer_tailoring_costs(uuid)` | Owner-checked SECURITY INVOKER with existing RLS; original quote CP amounts, charge/version and final price. |

Private `guard_phase7_history()` adds four triggers: booked job identity immutable
except status, completed tailoring Order/header/items permanent, required quantity
matching its quote exactly once and immutable afterward. Quote uses existing generic
history rejection trigger. `guard_phase7_issue_once()` adds a locked BEFORE INSERT
movement trigger rejecting repeated issue-line events. Existing immutable issue,
financial/price and movement triggers remain in force.

Two new Counter SELECT policies expose completed new tailoring Orders/items only.
Existing job/requirements/issue assignment RLS remains unchanged. Financial tables
and private quote stay Owner-only. New helpers do not grant raw domain writes.

## Workflow, pricing and transaction behavior

Counter scans one Fabric + Batch barcode, chooses Workshop/Showroom/dynamic sublocation,
selects actual internal Than quantities, customer and recorded WhatsApp contact,
Factory → relevant Section/no section → relevant Tailor, garment, applicable charge,
then calculates final customer price. Customer WhatsApp is captured when provided;
no new mandatory-contact rule or messaging/provider integration is invented.

Pricing: sum rounded `quantity_mm × current CP_paise_per_m / 1000` across selected
Thans, plus exactly the selected Owner-configured applicable charge amount. No SP,
charge scaling by metres/pieces, discount, tax or additional fee. Mixed batches retain
their individual CP rates. Missing CP blocks quoting; missing SP does not. Explicit
zero charge/cost values are permitted. Prices remain within supported safe-integer
money range. Counter cannot query CP, raw quotes, charge amounts or internal totals.

Quote creation locks charge → sorted Fabric Stock parents → sorted inventory IDs →
source. Booking locks request advisory key → quote → customer → active assignment/
Tailor/Factory/Section → charge → sorted stock parents/items → source. CP/charge
versions and stock are revalidated; no availability reservation is made by quoting.
SP revisions cannot affect tailoring. A later-line failure rolls back the whole booking.
Required fabric issuance is the minimum Section 10 dependency for Phase 7; general
consumables and Additional Material Issue workflows remain Phase 8.

One quote books once. Same creator/request/payload returns the original job before
current-price/stock checks, even after depletion or later revisions; different request
payload/Counter is rejected. Owner may administer matching requests/quotes. The form
retains its request UUID and freezes edits for uncertain responses; known DB rejection
unlocks and clears quote for revalidation. No automatic retries/reload persistence:
resolve while mounted, or inspect job/order history before resubmitting after reload.

Booked prices, quantity/assignment and issue history remain unchanged by later edits
to CP, SP or charges. No automatic WASTAGE. Cancellation/reopening only update the
audited job status; they never undo stock issues or rewrite booked prices. Actual
inventory returns/repricing require a later explicit controlled workflow.

Bill printing uses an escaped explicit customer-safe projection: identity/contact,
garment, location, Fabric/Batch quantities and final customer price. Owner cost fields
never enter printable HTML. No paid status is claimed for tailoring Orders.
Status changes are audited; no automatic Tailoring start is assumed from issuing stock.

Counter creation/history lives on POS; Owner/assigned Tailor also see it on Tailoring.
Legacy jobs/stock remain separately labelled; no legacy migration or dual stock writes.
Existing session role-change cache clearing is retained. Booking settlement refreshes
new jobs, direct-sale availability, Fabric Stock/history, location/Than/movement,
dashboard and customer caches. Owner setup refreshes the same catalogue namespace.

## Validation and limits

Actual tests/counts are recorded in history. `phase7-tailoring-test.mjs` checks both
17-file chains and no-demo execution in disposable PGlite PostgreSQL, all pre-existing
table/column values unchanged by migration, actual authenticated/JWT roles, CP+charge
with no SP and changed SP, snapshots, mixed stock rates, safe bills, atomic rollback,
stock moved after quote, duplicate/depletion retries, assigned Tailors and cost denial.
Earlier phase tests support `--include-phase7`; Phase 1 remains bounded.

Live Supabase/PostgREST, browser cache/rendering, physical scanner/printer, realtime
and multi-connection races remain unverified. Locks inspected; single-connection tests
verify transactions/access, not concurrent scheduling. No production deployment.
Only minimum hierarchy bootstrap and required fabric issuance dependencies were added;
full hierarchy editing/reassignment/disable management and generic material/issues,
Additional Material, returns, production and later phases remain pending.
