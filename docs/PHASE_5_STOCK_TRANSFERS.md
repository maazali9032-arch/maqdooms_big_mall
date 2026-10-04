# Phase 5 — Workshop ↔ Showroom Transfer

Authority: root ERP Implementation Master Plan; chronological record: Implementation
History. Phase 5 only; Direct Fabric Sale remains Phase 6.

## Baseline and implementation

| Requirement | Verified baseline | Phase 5 action |
| --- | --- | --- |
| Source, destination, positive quantity | Phase 3 active locations, exact units, source balances | Reused; Fabric Barcode form displays source quantities per internal Than. |
| Atomic transfer / resulting balances | Phase 3 locked, idempotent multi-item posting and immutable ledger | Reused unchanged. Explicit physical Than selection; source/destination preview and refreshed current balances. |
| Movement history | Existing ledger events with actor/time/reference and immutable posted headers/lines | Reused; new Owner transfer-document reader groups lines with named locations, Fabric Barcode and movement references. |
| One Fabric + Batch identity | Phase 4 receiving/catalogue and stable barcode | New transfer form scans/selects that identity, never creates roll labels. |
| Refreshed screens | Generic form refreshed ledger, Than/material and dashboard queries only | Also invalidate Fabric Stock, its history and transfer-document caches, including uncertain failures. |

## Version-controlled database change

- `supabase/migrations/20261003000400_phase5_transfer_history.sql`.
- Identical mirror `drizzle/migrations/0014_phase5_transfer_history.sql`; journal
  index 14 appended. Apply one chain, never both copies.
- Both SHA-256: `76edaf7ba87880d4fb7dc87599ec1509e354192fe9d2ca403cfc42294aa48a72`.
- New `stock_transfer_history(p_stock uuid DEFAULT NULL,p_limit integer DEFAULT 50)`:
  STABLE, SECURITY INVOKER, fixed public search path, explicit active Owner check.
  Authenticated execution granted; PUBLIC/anon revoked. Existing underlying RLS applies.
- Returns posted documents with source/destination names/IDs, reference/code/request,
  actor/time/reason and immutable lines: Fabric + Batch barcode, internal Than/item,
  quantity/unit, linked movement actor/time/ID. Optional Fabric Stock filter selects
  matching documents; all their original lines remain visible. Limit clamps to 1–200.
- No tables, columns, constraints, indexes, triggers, data/backfill, role/policy seeds,
  financial permission changes or replacement posting functions. No legacy movements,
  CP/SP values, labels or balances rewritten. No live/manual database operation.

## Workflow and permissions

Owner opens Inventory → Locations & transfers → Workshop ↔ Showroom Fabric Stock
Transfer. Scan/select one Fabric + Batch; choose active source/destination, including
dynamic Showroom sublocations. Current source quantity appears per internal Than.
Enter exact metre quantities for chosen Thans; blanks/zero skip rows. No implicit
physical-roll allocation rule is invented. Unlocated stock requires explicit prior
reconciliation; Phase 4 receipts are already located in Workshop.

The actual UI helper `prepareFabricTransfer` validates positive exact mm, source
quantity, authority identity and duplicate selections. Stable inventory-ID ordering
keeps retries independent of display order. Backend `post_inventory_transfer`
revalidates availability under its existing locks and posts header/lines/events/audit
atomically. Transfers subtract/add equal quantities and preserve the global total.

The form retains a request UUID for an unchanged payload while mounted. If the
response is uncertain, matching retry can submit even after the earlier transfer
depleted the source; backend finds the posted request before deducting stock again.
Only that unchanged request bypasses frontend source preview checks; backend balance
and identity checks remain authoritative for new requests. Changing payload uses a
new UUID. No automatic retry or persistence across reloads: inspect transfer history
before submitting an uncertain transfer again after reload.

Successful posting displays transfer ID/quantity/direction and refreshed current
balances. Preview is prospective; displayed balances are current reads, not stored
historical balance snapshots. Transfer history retains original event facts.
Mutation settling refreshes ledger, Fabric Stock/history, transfer documents, Than
overview and dashboard. Existing generic transfers remain available for other items.

Mutation/document history remain Owner-only. Existing operational users retain
nonfinancial ledger/availability reads; no new transfer permission inferred for Stock
Entry, Counter, Tailor or E-commerce Manager. CP/SP/production-cost authorization and
Phase 2 session/cache boundaries remain unchanged.

## Verification

`scripts/phase5-transfer-test.mjs`: 171 checks across both full 15-migration paths and
clean no-demo replay. Uses actual Phase 4 receiving and authenticated/JWT role fixtures
in disposable PGlite 0.5.8/PostgreSQL 18.3; no live credentials or .env.

- 100m Workshop → transfer 30m → 70m Workshop / 30m Showroom, unchanged 100m total.
- Reverse transfers and dynamic floor transfers; zero final floor balance.
- Multi-Than traceability, history filters/limits and absence of financial fields.
- Same UUID/payload produces one document, one event per line and one audit.
- Full-source transfer then retry does not deduct twice.
- Overdraw, same location, zero/fractional quantity, duplicate/unknown item, missing
  reason and inactive destination rejected without changing data.
- Forced test-only late-line failure rolls back earlier line, header, events and audit.
- Posted history immutable; inactive Owner, anonymous and other roles denied posting/
  document APIs; protected CP unchanged.
- Actual UI helper: exact metre conversion, blanks/zero, duplicate/unlocated/overdraw
  errors, stable sorting and uncertain-response payload after source depletion.

164 Phase 2, 230 Phase 3 and 228 Phase 4 checks pass against the full Phase 5 schema;
278 bounded Phase 1 checks pass. TypeScript and lint pass (eight existing warnings).
Production build passed in isolated source copy, not deployed.

Live Supabase/PostgREST, authenticated browser rendering/cache behavior, hardware scan,
realtime and multi-connection races remain unverified. Locks are reused and inspected;
single-connection tests verify atomic rollback, not concurrent races. Legacy physical
location/identity reconciliation remains explicit. No Phase 6 sales, quantity-consuming
order, billing, tailoring, production, costing or reservation workflow implemented.
