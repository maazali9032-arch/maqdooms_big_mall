# Phase 13 — Finished Product Inventory + Transfer

Implemented and applied live on 4 October 2026 (Asia/Calcutta), under Master
Plan Sections 8, 21, Phase 13 and Sections 30–31. Phase 14 is not implemented.

## Workflow and decisions

Phase 11 remains the only manufactured-piece receipt workflow: completed job,
actual per-piece material usage, unique Product Barcode and one piece of stock
received into Workshop. Phase 13 moves selected physical pieces from Workshop
to Showroom, then from Showroom to a dynamically configured child sublocation.
Location names and floor counts are never hard-coded.

Transfers use adjacent hierarchy steps. Explicit Owner returns use the reverse
steps; a move between sublocations passes through Showroom. This preserves the
existing Owner return capability while making the required location path explicit.
Direct Workshop-to-sublocation moves and sibling-to-sibling shortcuts are rejected,
including through the previously available generic transfer API. Fabric and
consumable transfer rules are unchanged. No sale, order, automatic stock correction,
pricing update, new role or manufacturing/receipt shortcut is introduced.

Owner selects 1–200 distinct available Product IDs at one active source, an active
adjacent destination, and an explicit reason/reference. Each selected Product is
one whole piece: quantities are derived as exactly 1 pc, never guessed or divided.
The existing posting function locks inventory items and locations in stable order,
checks ledger availability, posts the header/lines/movements/audit and updates each
piece's location atomically. An unavailable, stale, invalid or insufficient piece
rejects the entire batch. Global quantity is conserved.

Retries canonicalize the selected ID order and bind request ID to actor, source,
destination, exact pieces and trimmed reason. Changed requests and requests already
used by a generic transfer are rejected. A successful retry returns the original
posted document, even after subsequent location changes. Uncertain network outcomes
freeze the UI payload and offer the same request for retry. Definite database
rejections allow correction and a new request.

Product identity, ProductBarcode, job/Product/Design genealogy, material usage,
production costs/allocations, SP versions and availability status remain unchanged.
Location and the existing append-only movement/document/audit history are the only
business changes made when an Owner posts a transfer.

## New migration and exact schema contract

Canonical `supabase/migrations/20261004000400_phase13_finished_product_inventory.sql`;
byte-identical mirror `drizzle/migrations/0027_phase13_finished_product_inventory.sql`;
Drizzle journal entry 27. Apply only one chain. No historical migration was edited,
deleted, renamed or replayed. No data backfill, opening stock, seed, price or
reconciliation operation occurs in this migration.

New table `finished_product_transfer_requests`:

- `request_id uuid` primary key; exact retry identity.
- `actor_id uuid NOT NULL` foreign key to profiles.
- `transfer_id uuid NOT NULL UNIQUE` foreign key to stock_transfers; one domain
  request per posted transfer document.
- `payload jsonb NOT NULL`; actor/location/piece/reason evidence.
- `recorded_at timestamptz NOT NULL DEFAULT now()`.
- `phase13_transfer_actor_time_idx(actor_id, recorded_at)`.
- RLS enabled; authenticated SELECT is restricted to active Owner. Browser
  INSERT/UPDATE/DELETE/TRUNCATE and anonymous/PUBLIC privileges are revoked.
  service_role retains administrative table privileges. Existing immutable-history
  trigger function rejects UPDATE/DELETE even for privileged sessions.

New partial index `phase13_piece_movement_time_idx` on inventory_movements
`(finished_product_id, occurred_at DESC, id)` for non-null Finished Products.

New `guard_finished_product_transfer_path()` and INSERT trigger
`phase13_finished_transfer_path` on inventory_movements validate active adjacent
locations, matching source/current location, available status and exactly 1 pc
for Finished Product TRANSFER events. Other movement kinds/items are unchanged.
The trigger function has no browser/anonymous execute grant.

New checked APIs (fixed public search_path, SECURITY DEFINER):

- `transfer_finished_products(uuid, uuid, uuid, jsonb, text)` returns posted
  transfer UUID. Owner-only, actor-bound retry registry, delegates posting to
  existing `post_inventory_transfer`. Registry and posting commit together.
- `finished_product_inventory(uuid DEFAULT NULL, integer DEFAULT 100)` returns
  Owner-only operational rows with barcode, Product, Design, job, piece number,
  status, current location/activity, inventory item and ledger availability.
  UUID keyset pagination covers every piece, with 1–200 rows per request.
- `finished_product_movement_history(uuid DEFAULT NULL, integer DEFAULT 100)`
  returns latest 1–200 movements, optionally filtered to a piece, including
  Workshop receipt, transfers and recorded corrections; barcode/genealogy,
  quantity/unit, locations, actor/name/time, reason/reference, transfer/header/
  line/request IDs remain linked. This is a bounded recent-history view; existing
  full immutable history remains in the database.

Authenticated users can call these APIs, but all three require active Owner at
runtime; PUBLIC/anonymous execution is revoked. No existing financial/RLS policy
or Counter/Tailor access is expanded. Neither new read API joins or returns CP,
SP or internal production-cost fields. PostgREST is notified to reload schema.

## Application and reused implementation

New `FinishedProductInventory.tsx` appears in the Owner Inventory tab and Owner
Tailoring page. It lists whole pieces and their current locations, supports loading
all keyset pages, filters loaded rows explicitly, selects pieces for checked
transfers and shows latest 200 global/per-piece movements. It shows loading/errors,
selected quantity, posting result and safe retry state. It does not add a Counter
sales screen, customer order, identical-product count or Phase 14 transaction.

RPC typings and route integration were added. Existing FinishedProducts receipt
and LocationLedger actions now invalidate the new inventory/history caches;
transfers also refresh existing scan/ledger/history caches. The existing session
provider clears caches on identity/role changes. Location configuration, inventory
items/balances/guards, stock-transfer documents, immutable movement/audit records,
ProductBarcode creation/labels and Phase 12 cost/SP remain reused.

## Verification and limits

309 Phase 13 assertions pass across canonical demo, byte-identical Drizzle demo
and clean disposable PostgreSQL chains. These include ten Workshop pieces → three
Showroom pieces → two sublocation pieces, resulting 7/1/2 location balances and ten
total; exact retry/order-independent retry, changed actor/payload, stale/mixed batch,
inactive locations, skipped hierarchy, duplicate/missing IDs, fractions, full
rollback on forced final request failure, reverse returns, pagination, linked
history, unchanged populated cost/SP/genealogy and browser/anonymous permissions.

All earlier-phase business tests and reconciliation fixtures pass cumulatively:
4,146 database assertions plus 40 independent barcode/money assertions = 4,186
local assertions. TypeScript, scoped ESLint and isolated production build pass.
Full repository lint retains the same 217 pre-existing formatting errors in four
legacy scripts and eight existing React fast-refresh warnings; no new errors.

Live baseline matched Phase 12 before applying the new migration in one transaction.
Post-application cumulative schema/constraints/indexes/functions/triggers/RLS and
permissions match the disposable reference. All 73 pre-existing public tables / 366
rows retain their original-column hashes. Only one new table is added, empty live;
all 28 migration versions are recorded with matching repository hashes. 257 live
read-only security/integrity checks and three PostgREST API registration/anonymous
denial checks pass. No production business transaction or fixture was posted live.

Evidence: PHASE13_VERIFICATION.json, PHASE13_LIVE_VERIFICATION.json,
PHASE13_SECURITY_VERIFICATION.json and PHASE13_API_VERIFICATION.json. Browser
acceptance and real multi-connection races remain unverified; live canonical
Finished Product tables currently have no business rows, so populated behavior is
verified in disposable tests. Four previously documented legacy job domain/
assignment decisions remain untouched. No UI deployment, commit or push performed.
Stopped before Phase 14 pending Owner approval.
