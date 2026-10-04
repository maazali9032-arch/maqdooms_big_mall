# Phase 3 — Locations + Inventory Ledger

Implemented on 3 October 2026. The ERP master plan is the business authority;
the Implementation History is the chronological record. Phase 4 and later
receiving/barcode/sales/production workflows are deliberately not implemented.

## Migration and preservation

- Canonical: `supabase/migrations/20261003000200_phase3_locations_ledger.sql`.
- Identical mirror: `drizzle/migrations/0012_phase3_locations_ledger.sql`, journal
  index 12. Apply one chain only, never both copies to one database.
- All earlier SQL migrations remain byte-for-byte unchanged. No production/live
  migration, manual DB operation, seed rewrite, cost conversion or deployment.
- This migration creates structures/guards only. It does not populate stock,
  reconcile legacy items, guess rack locations, assign opening balances to Workshop,
  generate barcodes or alter existing legacy quantities/history.

## Single authority and explicit opening reconciliation

An item without an `inventory_items` row retains its existing quantity authority:
legacy Than `stock_movements`, consumable `qty_on_hand`, or existing Finished Product
status/current location. Its quantity is shown as unlocated until explicitly verified.

Owner calls `reconcile_inventory_item` with item kind/id, exact positive quantity
allocations to active locations, and a reason/reference. The complete sum must equal
the current legacy quantity. No price is exposed or inferred. A zero-stock item takes
an empty allocation list and creates no movement. Unattributed/unlinked Than identity,
invalid/negative legacy quantities, active unlocated holds, or pre-existing unlinked
domain movements block reconciliation rather than being silently repaired.

The function locks the physical item, records the old quantity/actor/time/reason in
an immutable authority row, and creates explicit opening ADJUSTMENT movements with
`OPENING:<inventory-item-id>` reference and an atomic Owner audit record. The original
ledger remains historical evidence. Its quantities are not added to the new opening.

After cutover, the item balance comes exclusively from `inventory_movements`:

```text
At a location = sum(incoming quantities) - sum(outgoing quantities)
Total item stock = all incoming quantities - all outgoing quantities
Transfer = one event with source and destination, equal quantity at both ends
```

`thaan_available_mm` and `v_thaan_stock` choose the authority per Than, so existing
overview/dashboard queries receive the canonical total. Consumable display queries
use `material_available_qty`, retaining the old quantity field as historical input.
Catalog quantities distinguish unreconciled legacy stock from reconciled stock;
location balances never put unlocated legacy stock in an invented location.

Legacy movement writes/Counter sales/receiving corrections cannot change reconciled
stock. The rejection is atomic, including rollback of an old sale's bill. Unlocated
holds cannot be placed on reconciled items. This is intentional: Phase 3 does not
implement the later location-aware sale/receiving/reservation workflows. The Owner
confirmation UI states that existing Counter sales/reservations cannot use this stock
yet. Unreconciled legacy items continue operating under the existing APIs, with an
added locked nonnegative-stock guard. No application-wide automatic cutover occurs.

## Tables, columns, constraints and indexes

- New `inventory_items`: UUID PK; unique FK per Than/consumable/Finished Product,
  exactly one physical item; unit; nonnegative `legacy_quantity_snapshot`;
  required reconciler profile/time/reason. Than unit mm and piece unit pc.
  Immutable after creation. Unique indexes support authority lookup/duplicate prevention.
- `inventory_movements.inventory_item_id`: FK to authority. New writes require it
  through `movement_authority_required` CHECK, initially NOT VALID to retain any
  pre-existing unlinked history. Automatically validated only if existing rows are
  clean. Existing unlinked rows are neither rewritten nor counted as new authority.
- `inventory_movements_item_location_idx`: authority/time/id index for balance/history.
  Existing item/source/destination/event indexes and immutable-history guards retained.
- `stock_transfers.request_id`: unique UUID; `request_payload`: exact retry payload;
  `posted_at`: posting timestamp. Old rows retain NULL additions, unchanged original values.
- Existing item/transfer/order/issue FKs, quantity/unit constraints and one-transfer-event
  partial unique index are reused. No CP/SP column, permission seed or role seed change.

## Functions, views and triggers

New functions:

1. `inventory_balance(uuid,uuid DEFAULT NULL)` — private arithmetic helper;
   PUBLIC/anon/authenticated cannot execute directly.
2. `guard_location_operations()` — preserve roots/codes; prevent deletion and
   deactivation of occupied sublocations.
3. `manage_showroom_location(uuid,text,text,boolean DEFAULT true)` — Owner creates
   dynamic Showroom children, renames them or deactivates empty ones, with atomic audit.
   No fixed floors; Workshop/Showroom roots remain permanent.
4. `guard_inventory_movement()` — item/stock/unit/actor/reason validation,
   stable item/location locks, active locations, correct direction, source balance,
   one-piece count, bounded integer-mm totals. SALE requires a matching existing Order
   item/source; TRANSFER requires a draft posting transaction. Product external entry
   goes to Workshop, with an explicit verified-opening exception for existing location.
5. `guard_legacy_inventory_authority()` — lock legacy writers on the same physical
   item; reject negative stock and writes to reconciled legacy quantity; retain legacy
   movement history; freeze reconciled Than identity/original length and consumable
   unit/old quantity; keep Finished Product status/location consistent with ledger.
6. `reconcile_inventory_item(text,uuid,jsonb,text)` — opening contract above.
7. `post_inventory_transfer(uuid,uuid,uuid,jsonb,text)` — Owner-only atomic multi-item
   transfer with an exact stable request UUID/payload. Identical retry returns the same
   transfer without another event/audit; conflicting retry rejects. Duplicate items,
   invalid units/quantity, inactive locations and overdraw reject the whole transaction.
   Locks authority IDs and locations in stable order; pieces move their current location.
8. `record_inventory_correction(uuid,uuid,text,numeric,boolean,text)` — Owner's explicit
   ADJUSTMENT/RETURN/WASTAGE only; positive quantity, valid direction and reason required.
   No generic SALE/PRODUCTION/receiving endpoint. Piece removal archives its zero count;
   return restores one available piece in Workshop, preserving genealogy.
9. `guard_posted_transfer_history()` — immutable transfer identity; require all lines'
   matching ledger events before posting; no rewriting posted/cancelled transfers, no
   line edits/deletion or appending after posting.
10. `inventory_catalog()` — role-gated nonfinancial item/quantity/authority/unlinked-row
    metadata. No CP/SP or production cost.
11. `inventory_locations()` — invoker/RLS location reader.
12. `inventory_location_balances()` — invoker/RLS balance reader.
13. `inventory_movement_history(integer DEFAULT 200)` — invoker/RLS traceability
    reader, bounded to 1–500 rows, includes actor/time/reason/reference and job/order links.
14. `material_available_qty(uuid)` — canonical consumable quantity with active-role
    or assigned-material check.

Replaced `thaan_available_mm(uuid)` retains active-role/assigned legacy material gate
and now chooses the single authority. Replaced `v_thaan_stock` preserves its columns
and security_invoker behavior; dependent existing views receive canonical totals.
New `v_inventory_location_balances` computes source/destination deltas, no editable
balance cache. Global balances require operational roles so a Tailor's filtered job
history cannot accidentally appear as an incomplete/negative global balance.

Ten new triggers: authority immutable, location operations, movement balance,
legacy movement/hold/Than/material authority, piece location/status authority,
transfer header history and transfer line history. Exact names are in the migration.
Existing domain identity/link/financial-history guards are retained.

## Permissions and scope

- Mutations are Owner-only, irrespective of overrides. Transfer permission was not
  inferred for Counter/Stock Entry because it is not in their master-plan role scope.
- Authenticated has SELECT only on the new authority table; mutations are through
  guarded functions. PUBLIC/anon receives no new table/RPC access; trigger and private
  arithmetic functions cannot be invoked directly by browser roles.
- Owner/Counter/Stock Entry/existing E-commerce Manager can read nonfinancial catalog
  quantities/balances/history. Owner's existing Phase 2 policy covers ledger/history.
- Tailor retains assigned-job/material scope, no global inventory catalog/balances.
  Consumable catalog/read helper now checks assigned legacy/new issue records for Tailor.
- No CP, financial history, charge, production-cost or audit-access widening. Owner's
  `erp_audit_records` capture Phase 3 location/reconciliation/transfer/correction actions
  atomically. Whole-system audit completion remains Phase 15.

## Application and verification

Inventory has a new “Locations & transfers” tab with stock quantities by location,
unlocated/zero stock, dynamic location management, explicit split opening allocations,
multi-item transfers, corrections and traceable history. Owner mutation forms are absent
for other inventory users; backend checks independently enforce the same restriction.
Transfer requests retain their UUID for unchanged-payload retries. Related job/order
IDs are displayed where present. No new navigation routes or barcode/production UI.

Fabric display/input uses metres and exact integer-mm conversion; consumables retain
their own units/three-decimal precision, including count units that can exceed one.
One Finished Product is enforced by DB constraints. Unit-conversion helpers are exercised
by the executable tests, including `1.001m → 1001mm` and multiple consumable pieces.

Local validation uses disposable PostgreSQL/PGlite with real authenticated-role/JWT
fixtures. Test-only Order/product/hierarchy records exercise ledger relationships;
they are not seed/application implementation of later phases. Both full migration
paths and a clean no-demo chain are replayed. The Phase 2 security matrix runs against
the full Phase 3 schema via `--include-phase3`; Phase 1 retains its bounded regression.

Live Supabase application/parity, actual PostgREST/auth/browser workflow rendering,
realtime publication and multi-connection concurrency are unverified. PGlite is a
single connection; item/location/advisory locks are implemented and inspected but
not claimed race-tested. Correction requests do not have transfer-style retry keys;
the UI does not automatically retry them. Inspect history before repeating an uncertain
correction. Live rollout must apply version-controlled files, never manual SQL.

Phase 4 receiving/one-barcode/SP workflows, Phase 5 sales, later material issues and
production/costing/completion/reservations are intentionally pending. Existing data
requiring identity, location, holds or unlinked-domain reconciliation remains explicit.
