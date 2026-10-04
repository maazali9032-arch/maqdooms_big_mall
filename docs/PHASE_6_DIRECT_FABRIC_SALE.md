# Phase 6 — Direct Fabric Sale

Authority: Implementation Master Plan, including sections 9, 23, 26, 30 and 31.
Permanent chronological record: root Implementation History. Phase 7 is not included.

## Baseline mapping and scope

| Requirement | Baseline | Phase 6 result |
| --- | --- | --- |
| Counter scan | Phase 4 safe Fabric Stock scan; legacy POS scans individual roll labels | Direct Fabric Sale scans one Fabric + Batch barcode and selects internal Thans. |
| Current SP | Owner versioned Fabric Stock SP exists | Quoted version is revalidated under parent locks at checkout. |
| Customer sale | Legacy customer selector and sales exist | Reuse customer selector; optional existing customer or walk-in; snapshot contacts on Order. |
| Quantity deduction | Phase 3 canonical location ledger; legacy POS cannot write reconciled stock | Atomic SALE events linked to Order items at the selected location. |
| Order / history | Phase 1 tables exist, with Owner reads only | Immutable completed documents, safe Counter history and separate Owner CP snapshots. |
| CP protection | Phase 2 financial RLS and scoped receiving CP | Preserved; sale RPC writes private snapshots without returning CP to Counter. |

Counter → Direct Fabric Sale: scan barcode, select active Workshop/Showroom/dynamic
Showroom sublocation, enter explicit physical Than cuts in metres, add to sale, select
an existing customer or walk-in, review total, confirm customer payment received,
complete. Multiple Fabric + Batch groups can share one order at one source location.
Blank/zero input skips a Than; submitted quantities must be positive integer mm.
No automatic physical-roll allocation, price override, discount, tax, payment gateway,
tailoring charge or invented wastage. Existing legacy POS/tailoring controls remain
labelled separately. New customers/Customer Tailoring workflow remains Phase 7.

## Version-controlled migration

- Canonical: `supabase/migrations/20261003000500_phase6_direct_fabric_sale.sql`.
- Identical mirror: `drizzle/migrations/0015_phase6_direct_fabric_sale.sql`.
- Journal index 15 appended, timestamp `1790985900000`. Apply one chain only.
- SHA-256 of both: `8652e05d27628b7c8456823d76aec0a2edbf948814763218f166292afba1d56f`.
- No historical migration edits, table removals, seed changes, data/backfill,
  production/live application or undocumented manual database operations.

### Tables, constraints, relationships and indexes

Existing `orders` gains nullable `sale_request_id uuid UNIQUE`,
`sale_request_payload jsonb`, `customer_snapshot jsonb`, `completed_at timestamptz`
and `payment_confirmed_at timestamptz`. Existing rows retain all old values and get
NULL in the new columns. Request payload stores source, cuts/SP revision IDs,
customer, reference and payment confirmation; it contains no CP.

New partial `phase6_sale_history_idx` indexes new orders by creation time/ID;
`phase6_sale_movement_idx` indexes SALE events by order item. The movement index
is nonunique to preserve any old historical events; new Phase 6 duplicate posting
is prevented by a guarded item lock instead of rewriting legacy history.
All existing FKs and item/quantity/unit/price constraints are reused unchanged:
customer/location → Order → items → financial snapshots and SALE movements;
each item references the actual internal Than and its Fabric Stock identity.
No new table or FK is needed.

### Functions and triggers

| Function | Contract |
| --- | --- |
| `direct_fabric_sale_catalog(text)` | Active Owner/Counter guarded SECURITY DEFINER, fixed public search path; returns Fabric Barcode, current SP/revision, internal Than inventory IDs and active per-location quantities; never CP. |
| `complete_direct_fabric_sale(uuid,uuid,jsonb,uuid,boolean,text)` | Active Owner/Counter plus `pos.sell`; atomic idempotent posting. Server calculates every amount, stores current SP/CP snapshots, received-payment time, customer snapshot, Order/items/SALE movements/audit, then completes Order. Returns UUID only. |
| `direct_fabric_order_history(uuid,integer)` | Guarded SECURITY DEFINER, fixed safe projection; completed new direct sales, customer/quantity/SP/final amount/location/user/time/reference/movement identity. No financial join or CP keys. Default latest 50, maximum 200. |
| `owner_direct_fabric_order_costs(uuid)` | Owner check, SECURITY INVOKER and existing financial RLS; private CP-per-metre snapshots for an Order. |
| `guard_phase6_order_history()` | New triggers on Order UPDATE/DELETE and item INSERT/UPDATE/DELETE protect completed new documents, including moving items away. |
| `guard_phase6_sale_movement()` | New BEFORE INSERT ledger trigger locks authority and rejects another SALE for the same new order item or posting to a closed Order. Existing ledger guards also apply. |
| `guard_phase4_fabric_identity()` | Replaced in this new migration; retains original safeguards and adds only Counter active → depleted when other fields are unchanged and global canonical balance is zero. Existing trigger remains attached. |

Received payment is an operator attestation, not a gateway confirmation or new
payment ledger. Each amount is `round(quantity_mm * SP_paise_per_m / 1000)`,
then line amounts are summed. The UI uses BigInt with the same nonnegative
half-up rounding and safe-number limits; no floating-point stock conversion.
Zero SP is valid only when explicitly set by Owner. Missing SP blocks checkout.
Missing legacy CP remains NULL/Unknown, never substituted with SP or zero.
Historical CP/SP snapshots remain unchanged by subsequent revisions.

### Transactions, retries and permissions

Request advisory lock → sorted Fabric Stock parent locks → sorted inventory item
locks → source location lock. Parent locks serialize concurrent Owner CP/SP edits;
existing ledger guards validate exact identity, source balance, actor and units.
Any later-line failure rolls back Order, items, snapshots, movements and audit.
Retry with the same UUID, creator and exact payload returns the completed Order
before availability or current-SP checks. A changed payload/different Counter is
rejected; Owner can retrieve a matching posted request. No second stock deduction.

Two Counter SELECT policies expose completed direct fabric Orders and their items.
No authenticated raw write grants, financial RLS expansion, role seeds or permission
overrides. Existing Owner financial policies remain unchanged. Public/anonymous
execution is revoked on all new APIs; authenticated execution is guarded inside.
Trigger helpers remain private. Safe history is a definer because Counter's existing
receiving-batch RLS need not be expanded to obtain batch names.

The form retains its UUID and freezes the cart for an uncertain response; an exact
retry can resolve an already depleted sale. Explicit database rejection unlocks it.
No automatic retries or persistence across reloads: keep the page open to resolve,
or inspect Order History before resubmitting after reload. Changed SP requires
refresh, remove/re-add affected cuts and review payment amount. Settling invalidates
sale/stock/history/location/Than/movement/dashboard/customer caches. Existing
session role-change cache clearing remains authoritative for CP removal.

## Verification and limits

`scripts/phase6-sale-test.mjs` runs real authenticated/JWT role fixtures in disposable
PGlite PostgreSQL, both 16-file chains plus no-demo chain. It tests money helpers,
Workshop receiving → Showroom transfer → sale, multi-Than atomic rejection,
full-location/global depletion and retry, missing/stale/zero SP, dynamic/inactive
locations, CP snapshots/unknown legacy CP, Counter/private financial denial,
unauthorized/inactive/anonymous roles, cross-actor retries and immutable history.
Earlier security/ledger/receiving/transfer suites support `--include-phase6`;
Phase 1 retains its bounded migration test. See history for actual final counts.

Live Supabase/PostgREST, authenticated browser/cache rendering, physical scanner,
realtime and multi-connection race behavior remain unverified. Locks were inspected;
single-connection tests verify transactions, not concurrent scheduling. Legacy
location/CP/SP reconciliation remains explicit. Latest-50 history UI is bounded,
not a reporting/export system. No deployment, Phase 7 or later implementation.
