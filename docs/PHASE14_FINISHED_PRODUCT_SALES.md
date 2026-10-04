# Phase 14 — Finished Product Counter + Sales

Implemented and applied live on 4 October 2026 (Asia/Calcutta). Master Plan
Sections 17–23, 29–31 and Phase 14 govern this work. Phase 13 provides physical
piece locations and transfers; Phase 12 provides actual finalized costs and
Owner-reviewed SP. Phase 15 is not implemented.

## Business workflow and decisions

Owner/Counter scans a unique ProductBarcode. The scan reuses the existing
Product/Design/job/material/Factory/Section/Tailor/receipt genealogy and adds
current SP version, location activity and identical-piece availability/counts.
Owner additionally receives full recorded production cost; Counter receives no
internal production-cost keys or breakdown. Missing prices remain explicitly
unset and cannot be sold; zero Owner SP is an explicit valid price.

Identical pieces are scoped to the same Production Job, whose bulk pieces share
the recorded Product/Design/production genealogy. Different jobs are never
silently merged based on Product/Design names, which could hide different fabric
or production histories. Available counts require status available and an actual
canonical ledger balance of one at the recorded location, not the planned job
quantity. Sold/archived/unreconciled pieces do not count.

Each location returns its direct physical quantity and subtree quantity. Showroom
subtree quantity includes its child sublocations; the screen labels the separate
direct quantity as outside sublocations. Global identical availability sums direct
quantities once. Example ten pieces: Workshop 7, Showroom total 3 (1 directly in
Showroom), Display 2; global total 10. Active/inactive locations remain visible
for physical traceability; checkout requires an active source.

Each physical piece must be scanned/selected explicitly. One paid order contains
1–50 distinct whole pieces from one source location. Owner or Counter requires
`pos.sell`; select an existing customer or explicitly use walk-in, optionally enter
a customer reference, and confirm received payment for the displayed exact total.
Existing customer creation remains available in the existing POS/customer flow.
No unrequested discount, markup, delivery fee or surcharge is invented: final
line price equals current Owner SP, additional sales charges are zero and total
is the exact sum. Explicit zero prices remain allowed. Monetary values and totals
must remain within the existing exact safe-integer paise range.

Checkout supplies Product IDs and expected SP version IDs only. It does not accept
caller-provided quantities, costs, prices or extra item fields. A changed/missing
current SP requires refreshing/reviewing the cart. Job locks serialize existing
Owner SP/cost revision workflows; inventory/location locks use the established
stable order. Under those locks, each piece must still be available with one pc
at source. All order items, financial evidence, one-pc SALE debits, sold statuses,
payment/completion markers, order total and audit commit in one transaction. One
invalid piece or final failure rolls everything back.

Sale request UUIDs share the Phase 6 sale namespace and orders unique constraint.
The new workflow binds actor, source, exact items/version IDs, customer, payment
confirmation and reference. Exact retry returns the completed original order;
changed payload/actor/kind is rejected. The UI freezes the full request after an
uncertain network outcome and retries it without a second stock deduction.
Definite database rejection permits correcting the cart and creating a new request.

SP never auto-changes after a cost revision. At sale, the latest actually finalized
production cost and exact per-piece allocation are snapshotted, while the selected
SP version and the cost version originally reviewed for that SP are retained
separately. This preserves both current actual costing and Owner price provenance
without silently repricing or requiring an invented markup/review rule.

Completed history preserves customer snapshot, physical ProductBarcode, Product/
Design/job labels, location label, actor ID/name, quantity/unit, SP, final price,
charges, date/time, reference and SALE movement. Owner also sees sale-time per-piece
production cost and complete cost-component evidence; Counter sees only authorized
operational/SP/final-price fields. Later customer/catalogue/location/cost changes
do not rewrite the sale snapshots. Pieces retain their IDs, barcodes, genealogy
and last sale location; only status changes to sold and physical stock decreases.

## Migration and schema contract

Canonical `supabase/migrations/20261004000500_phase14_finished_product_sales.sql`;
byte-identical `drizzle/migrations/0028_phase14_finished_product_sales.sql` mirror;
appended Drizzle journal entry 28. Apply one chain only. Prior applied migrations
are preserved, hash checked and skipped. No backfill, seed, opening quantity,
legacy reconciliation or manual business-data change occurs.

New table `finished_product_sale_snapshots`:

- `order_item_id uuid` primary key / FK order_items; one snapshot per sold line.
- Required `price_version_id` FK finished_product_prices.
- Required `cost_version_id` and `reviewed_cost_version_id` FKs
  production_cost_versions; latest actual cost and original SP review evidence.
- Required `cost_evidence jsonb`: job quantity, exact component sum and immutable
  recorded production-cost lines at sale.
- Required `item_snapshot jsonb`: barcode, Product/Design/job/piece labels,
  source location label and actor name at sale.
- `recorded_at timestamptz NOT NULL DEFAULT now()`.
- `phase14_sale_cost_idx(cost_version_id)`.
- RLS enabled, active Owner SELECT only; browser raw writes/TRUNCATE and anonymous/
  PUBLIC privileges revoked. service_role retains administrative table privileges.
  Existing immutable-history trigger rejects UPDATE/DELETE, including privileged
  sessions. New APIs alone insert through the controlled transaction.

New unique partial `phase14_piece_sale_line_idx` on inventory_movements(order_item_id)
for Finished Product SALE rows prevents duplicate debits for a sale line. Existing
Phase 6 sale-once/history guards also apply to these completed orders. No existing
table columns, function definitions or RLS policies are replaced.

Three new checked SECURITY DEFINER functions with fixed public search_path:

- `finished_product_sale_scan(text)` returns one ProductBarcode's authorized
  genealogy/SP/location/identical counts; Owner-only full-cost extension.
- `complete_finished_product_sale(uuid, uuid, jsonb, uuid, boolean, text DEFAULT NULL)`
  returns completed order UUID and requires authorized Owner/Counter + pos.sell.
- `finished_product_order_history(uuid DEFAULT NULL, integer DEFAULT 50)` returns
  latest 1–200 completed Finished Product orders or a specific order; conditional
  Owner-only production-cost/version/evidence fields.

PUBLIC/anonymous EXECUTE is revoked; authenticated EXECUTE requires runtime active
Owner/Counter checks. No Tailor/StockEntry/Ecommerce access is added. Existing raw
orders RLS remains unchanged; Counter receives finished-sale history through the
whitelisted RPC, never the private snapshot table. Existing order_item_financials
stores production_cost_snapshot_paise; CP-per-metre is not invented for a finished
piece. Existing orders/items/ledger/audit tables are reused without schema changes.
PostgREST schema reload is notified.

## Application and verification

New `src/features/pos/FinishedProductSale.tsx` on the existing POS route provides
scan, SP/availability/location counts, whole-piece cart, existing customer/walk-in
selection, payment confirmation, reference, result/retry and latest 50 completed
orders. Owner cost details are role gated; Counter responses already exclude
internal fields. Existing detailed FinishedProducts scan/genealogy/labels remain.
Receipt, transfer, correction and cost/SP review screens invalidate the new scan
cache; checkout refreshes related catalogue/inventory/history/customer caches.
RPC typings, cumulative migration test filters and live rollout/security checks
were extended. No generalized Phase 15 reporting or Phase 16 polish is implemented.

435 Phase 14 assertions pass across canonical demo, mirrored demo and clean
disposable PostgreSQL: exact direct/subtree/global counts, separate jobs, paid
Counter and Owner sales, zero/missing/stale SP, one-pc debits, no double sale,
actor-bound retry, invalid/duplicate/missing pieces, inactive/wrong source, missing
customer/unpaid/oversized/extra quantity rejection, late rollback, total overflow,
sale-time labels/customer/cost preservation after revisions, financial RLS,
immutable orders/snapshots, browser writes and inactive/anonymous/role denial.

All earlier business phases and reconciliation fixtures pass cumulatively:
4,581 database assertions plus 40 independent barcode/money checks = 4,621 local
assertions. TypeScript, scoped lint and isolated production build pass. The same
217 pre-existing formatting errors in four legacy scripts and eight existing
React fast-refresh warnings remain; no new lint errors.

Live baseline matched Phase 13; the new migration applied transactionally on the
configured Session Pooler connection. Cumulative schema/constraints/indexes/
functions/triggers/RLS/permissions match the disposable reference. All 74 existing
public tables / 366 rows retain original-column fingerprints; the new table is
empty live. All 29 migration versions are recorded with matching repository hashes.
280 live read-only security/integrity checks and three PostgREST registration/
anonymous denial checks pass; a subsequent read-only audit confirms Phase 14.
No actual customer sale, test piece, price, receipt or transfer was posted live.

Evidence: PHASE14_VERIFICATION.json, PHASE14_LIVE_VERIFICATION.json,
PHASE14_SECURITY_VERIFICATION.json, PHASE14_API_VERIFICATION.json and permanent
Implementation History. Browser acceptance and real multi-connection races remain
unverified; populated transaction behavior is tested in disposable PostgreSQL
because live canonical Finished Product tables are empty. Four previous legacy
job domain/assignment decisions remain untouched. No deployment, commit or push.
Stopped before Phase 15 pending Owner approval.
