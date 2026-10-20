# Counter receipts and payment entry — 20 October 2026

Customer receipts contain the business identity, original accounting invoice reference, bill barcode, date, customer identity, purchased items/quantities/rates, saved GST details and payment result. Internal floor/POS identifiers and tailoring UUID references remain in records but are not printed on the customer copy. Item barcode/floor details used for internal tracing are omitted from the customer copy. The accounting invoice number is not replaced by its scanner alias.

Fabric/product-only retail receipts show paid-in-full status, without an advance/balance block. Receipts containing stitching show amount received and balance due; fully paid stitching receipts label it Amount paid. The saved GST final-first/taxable-first and separate/combined preferences remain authoritative. The invoice total is not repeated in a second footer. Customer GSTIN is printed when present.

For stitching, one Advance received input controls payment state. Zero/blank means no payment, a positive amount below total means a deposit, and the full total means paid. Balance is automatic and invalid/over-total amounts are rejected. The separate paid/unpaid status selector is removed. The Cash/Card/UPI payment-method selection remains independent.

The price-free tailor sheet shows its own job barcode, short customer-bill reference, garment, delivery date, factory, tailor, design, notes and fabric quantities/barcodes. It excludes prices, GST, deposit and balance. Customer receipts print at 58/80 mm; tailor sheets use the same explicit print styling at 80 mm. Synthetic browser previews verify paper-width layout; physical device acceptance is still required.

Extra fabric: scan the tailor job code (or customer bill), scan a physical Thaan, enter metres, confirm. A single job is selected automatically; a multi-job bill requires selecting the receiving garment. Existing permissions, open-job validation, source stock checks and idempotent retries remain. The additional issue follows the same job, updates stock, is available on a reprinted tailor work order and leaves the original customer total/advance/balance unchanged. Additional customer charging is not introduced by this UI correction.

Finished-product transfer notes are optional in the UI, matching the existing live `transfer_finished_products` fallback. The movement still records its system reason, operator, source/destination, time and pieces. Mandatory reasons for corrections or other unrelated workflows are unchanged. No database migration is required by this revision.

Verification: TypeScript, scoped ESLint, production build, `scripts/receipt-presentation-test.mjs` (optional absolute Playwright module path for visual previews), full disposable PostgreSQL migration replay and GST/extra-fabric regressions. No test customer bill was posted to production.

Release: pushed in `99cd532`; hosted POS/receipt code markers verified. Physical printer acceptance remains pending.
