# Automatic finished-garment receipt detection

Finished Products → Receive finished garments now has one scanner. The Customer stitching / Shop production selection buttons are removed. Staff scan a customer bill, customer tailoring-job code or owner production-job code. Exact database matches determine the workflow; code prefixes alone never determine it.

The source label displays Customer stitching or Shop production with the original document reference. Customer stitching shows the linked garments, customer, factory and tailor; one matching job is selected automatically. A bill with multiple jobs retains a garment selector. Staff still enter the finished name, size and SP before receiving and generating the customer's finished-garment barcode. Shop production opens the existing whole-batch Workshop receipt and piece pricing/printing flow automatically. Re-scanning a received job retains the existing receipt behavior.

Detection itself is read-only. The original receive, pricing, inventory and barcode-generation services retain their mutation rules. The shared scanner is disabled while a child receipt/payment-free pricing operation is pending or its result is uncertain. A failed lookup does not remount or repost the previous receipt. Existing piece transfer/history remains below the receipt workspace.

## Access and rollout

`resolve_finished_receipt(text)` accepts original codes, UUIDs and the new short `scan_code` values. Owner access or appropriate receiving/pricing permissions are required. Customer details are available only to Owner, authorized Counter staff or users with `production.receive`. This avoids the legacy customer-work lookup's narrower role restriction without opening the full tailoring workspace. The returned details contain no fabric CP or billing totals. Unknown codes, ambiguous identities and bills without stitching get explicit errors.

Prepared migration: `20261020000200_unified_finished_receipt_lookup.sql`, with identical Drizzle mirror `0069_unified_finished_receipt_lookup.sql`. It depends on the short scan-code columns in migration 0066. Deploy the function before the application change. No production migration or deployment was performed during this task.

**20 October live update:** 0069 is now applied live with its prerequisites. Follow-up migration `20261020000400_customer_finished_receiver_access.sql` / Drizzle `0071_customer_finished_receiver_access.sql` is also applied. Stock Entry already has `production.receive`; the receive RPC accepted it but its final finished-item result reader did not, rolling back the receipt with a role error. 0071 aligns that reader with the existing receiving permission. It does not open the full tailoring workspace or alter RLS, table grants, role defaults or billing access. Live rollback dry-run/post-commit stock-only lookup checks and historical checksums passed. No customer garment receipt was posted by testing. The default-role receive/barcode/reprint flow, exact retries and revoked/denied access are exercised by `scripts/customer-finished-receiver-cases.mjs` in the disposable full-chain harness.

## Verification

**Latest production workflow, 20 October:** Migration 0072 is applied. The shop-production branch now reads the scanned order, requires positive initial SP for every piece and only then receives/generates barcodes on explicit confirmation. This supersedes the earlier scan-to-receive behavior. Customer-finished garments already require SP. Existing barcodes are preserved. See `docs/PRODUCTION_PRICED_RECEIPT.md`.

The disposable PGlite test chain checks customer bill/job and production detection, original/short/UUID lookups, source details, no stock writes during detection, receiving-worker authorization, denied roles and bills without stitching. TypeScript, targeted lint and the application build cover the component integration. Physical scanner acceptance remains a rollout check.
