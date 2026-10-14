# Owner mobile Global Barcode Inspector

The floating barcode button is mounted by OwnerDashboard only. It requires the Owner session, a phone user agent, a coarse primary pointer and a compact phone viewport (portrait or landscape; width or height below 768px). Desktop (including narrow windows), tablets/iPadOS, staff, and other pages have no button. Changing role/page/viewport unmounts the scanner.

The button opens the existing Sheet as a mobile bottom drawer and starts the rear camera. Locally bundled @zxing/browser decodes CODE128 and other supported formats; frames remain on the device. Manual typing and keyboard scanners use the same BarcodeEntry component extracted from Workshop stock search. Camera results submit through that same lookup. Permission denial, missing camera, network retry and unknown codes have explicit states. Tracks stop on detection, close, unmount, backgrounding or a late permission response.

## Recorded evidence

Exact physical fabric/registered Thaan, legacy Thaan, fabric-group, finished product, production code/UUID and order code/UUID are supported. A code collision is returned as ambiguous rather than choosing a record. Item details and reconciled current balances appear separately from the newest-first lifecycle. Missing location reconciliation does not become a guessed location or balance.

Evidence includes existing receipts, current ledger transfers, sales, production status/receipt, material issues, returns, wastage, adjustments, linked bills/jobs, CP/lagat and cost/SP versions, issue-time cost snapshots, allocations, and captured audit before/after values. Legacy movements are included only where not already mirrored in the new ledger. Legacy CP is labelled its saved current record, not reconstructed revisions. Related job documents can cover several materials/pieces; these are not additional stock for the scanned item. Catalogue and actor display names are current where no immutable name snapshot exists.

Each event identifies its source and recorded timestamp/user. Records with no captured timestamp stay in an undated section. All older dated events are accessible using a stable timestamp/key cursor; no fixed history cutoff. Numeric evidence is transported as exact strings, including nested money/quantity snapshots.

## Backend

Forward migration: 20261015000100_owner_barcode_inspector.sql / Drizzle 0043.
SHA256: 8cc7df224e281acfddd20cd276f17a427b7a58bd02c0f4470d4639b6e0418f2c.

owner_barcode_inspect is STABLE SECURITY DEFINER with a fixed pg_catalog/public/pg_temp search path. Its first statement checks active Owner role via auth.uid(); staff permissions and client visibility cannot bypass it. Anonymous/service-role execution is revoked; the exact JSON helper is private. Only SELECT operations occur. No operational RPC, INSERT, UPDATE, DELETE, stock adjustment or audit mutation is invoked by inspection.

RPC arguments: p_barcode (trimmed exact identifier, 1–200 characters), p_limit (1–100; UI 50), optional paired p_before timestamp and p_before_key. The response distinguishes found/unknown/ambiguous and includes item details, current stock, linked records, undated evidence, paginated events and next cursor.

## Verification

1,509 cumulative database assertions passed across populated Supabase, populated Drizzle and clean Supabase replays. Coverage includes actual transfers/sales/receipts/production/issues/costs, returns/wastage/adjustments, all older pages, exact numeric transport, unchanged table fingerprints, unknown codes and every staff role/inactive Owner denial.

30 actual-component browser checks passed at 320/390/430px. They cover all role/page/device exclusions, camera permission fallback, actual CODE128 decoding through a video MediaStream, stream cleanup, pagination, unknown codes and retry. Screenshots use synthetic fixture data. A physical phone camera and hosted authenticated login were not available for this acceptance run.

69 live checks passed in read-only transactions using 30 existing barcodes (including both posted transfers) and existing role accounts. All 88 public-table row fingerprints were preserved by rollout and live acceptance. No real stock, accounts, payments or audit records were created/deleted for testing.

Unrelated in-progress POS/Production/navigation changes are excluded from this feature's commit and build. Their pending cleanup migration 0042 is not applied as part of the inspector.

The forward-only legacy-evidence extension 20261015000200 / Drizzle 0044 links singular legacy audit entity names and saved batch/bill codes, and preserves recorded actor names. SHA256: b58a245b230ff32b9748fa09b389233e7ff79ddbef1b7897e98f6c5859b3fa79. The already-applied 0043 bytes remain unchanged. Fresh isolated Vercel production build passed, including camera decoding chunks.
