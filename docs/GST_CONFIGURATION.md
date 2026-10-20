# GST configuration, invoices and reconciliation

GST is an Owner-controlled, effective-dated subsystem. Migration `20261017000400_gst_centralization.sql` creates no active configuration and seeds no rates. Existing receiving and Counter transactions continue through their established behavior until the Owner saves an enabled version after CA validation.

## Owner setup

The configuration editor loads the most recently saved version using SELECT access to the original GST tables, protected by their existing Owner-only RLS policies. It does not depend on the newer `owner_gst_configuration` RPC being deployed. All four original A/B option groups remain. The save-success message follows a read-back of the saved version; loading requests have a 15-second deadline and explicit retry on failure. Its effective date is displayed in local time; changes use the save time unless the Owner explicitly chooses a different date. Future dates remain scheduled. Migration `20261019000300_gst_configuration_reload.sql` (Drizzle `0067_gst_configuration_reload.sql`) additionally makes POS/Stock Entry (including Owner-operated POS) read the effective active version rather than an unscheduled draft or future version; it preserves every existing configuration and invoice. That migration is not required to restore the settings form or save/reload its options.

Open **Administration → GST Configuration**. Enter the legal identity, GSTIN, state code, effective date and one default rule for each supported category: stock purchase, fabric sale, finished-product sale and tailoring service. Every rule needs its CA-verified HSN/SAC and rate. Optional references such as `FABRIC:VELVET`, `PRODUCT:SHERWANI` and `SERVICE:ALTERATION` override a category default.

Choose whether selling prices include GST or have GST added, how the invoice presents totals, whether fabric and stitching are displayed together or separately, and how non-creditable purchase GST is reported. Saving creates a new immutable version; it does not rewrite old invoices.

## Stock receiving

CP remains the base purchase cost per metre excluding GST. When GST is active, Stock Entry first asks **Supplier invoice available?**. Selecting **No** receives stock without creating a GST purchase or ITC record. Selecting **Yes** reveals the supplier GSTIN, invoice number/date, ITC status and optional actual invoice totals for reconciliation. The supplier GSTIN determines intra-state versus inter-state treatment; staff do not choose it manually. Missing actual values remain estimates from the Owner-approved rule and are never treated as a verified supplier invoice or an automatic ITC claim. Transfers and production continue to carry base CP; tax is not added again during an internal movement.

## Counter billing

The paid-retail correction is prepared in `20261020000100_gst_paid_retail_bill.sql` (Drizzle `0068_gst_paid_retail_bill.sql`). The prior GST wrapper called the public unpaid-bill path even for paid fabric-only sales, causing “Unpaid is available only on bills containing Customer Tailoring”. It also attempted to alter the total after the immutable completed-sale boundary. The correction stages stock/order lines through a private function with the existing authorization, validation and locking, calculates GST while the bill remains draft, then finalizes and captures the receipt before payment. The public unpaid-retail prohibition remains intact. Failed tax calculation rolls the entire operation back; exact retries do not duplicate stock deductions or payments. This prepared migration has not been applied to production during this task.

Ordinary Counter bills use the registered business state automatically, so staff do not select intra-state/inter-state treatment or repeatedly enter state codes. When a GST business invoice is required, the user opens **Add GST business invoice details** and enters the customer's GSTIN. The system derives the supply treatment from that GSTIN's state code and the effective business registration state. Payment method remains transaction-specific. The server recalculates every line using the active effective-dated rules inside the same sale transaction, stores an immutable business, customer, line and tax snapshot, updates the payable total, and only then records full or advance payment. Retrying the same request stays idempotent.

Customer reprints read the saved snapshot. The bill has dedicated **58 mm** and **80 mm** print actions and shows taxable value plus CGST/SGST or IGST. The existing price-free tailor work order remains separate.

The receipt honors the invoice display and tailoring display saved in its tax snapshot: final-price-first emphasizes the payable total before the tax breakdown; taxable-first leads with taxable value and taxes. Separate tailoring presentation lists fabric and stitching tax components with HSN/SAC; combined presentation keeps the customer-facing job together. These preferences never alter an older snapshot.

## Reports and corrections

The GST page provides period totals, rate/HSN-SAC grouping, supplier reconciliation, eligible/ineligible/reversed ITC and an estimated net liability. Manual adjustments require a positive amount, document reference and reason; they are append-only and audited. These figures support operational reconciliation and do not replace CA filing software.

## Boundaries

- No unverified GST rate is a system default.
- Migration `20261019000100_gst_operational_input_audit.sql` changes only server function definitions. It preserves historical snapshots and documents; apply it together with the matching application release.
- The current repository has no public e-commerce checkout/payment transaction to tax. E-commerce listings and stock visibility remain unchanged; a future checkout must call the same tax service and persist a snapshot.
- Previously completed bills do not gain a fabricated tax snapshot.
- A physical printer test is required for each 58/80 mm printer and browser-driver combination.
- GST registration details, HSN/SAC choices, rates, ITC treatment and filing totals require CA approval.

## Verification

### 20 October: stock-entry and option consistency correction

`createStockBatch` routes **No supplier invoice** through the established `create_barcode_batch_with_details` API. It does not omit the required purchase argument from the GST API. Invoice submissions send `p_purchase` explicitly through a bound client method. A schema-cache rejection is a definite rejection, so the form can be corrected and resubmitted; uncertain network outcomes still retain the original request for retry.

Prepared migration `20261020000300_gst_option_consistency.sql` / Drizzle `0070_gst_option_consistency.sql` also accepts omitted/null purchase payloads, fixes each purchase line's Thaan lookup, and prevents calculated GST from becoming ITC/non-creditable-cost evidence when actual supplier GST is absent. It supersedes the estimate-fallback limitation recorded in History Section 64 for future purchases; it does not revise historical documents.

POS and purchase estimates select item overrides before category defaults and round each component consistently with the database. A tailoring job can include several fabrics with different rates: invoice lines now carry `source_cut_ordinal` to preserve each cut separately without changing existing snapshot amounts. Finished-product sales use their product rule. The latest effective disabled configuration stops GST rather than reviving an older enabled version. POS submits the preview configuration ID; a changed version rejects the transaction for refresh instead of silently collecting a different amount.

All four choices remain available. Price mode controls calculation; invoice display controls saved receipt summary order; tailoring display controls saved separate/combined presentation; purchase mode controls the recorded non-creditable-cost adjustment. Reports display the saved purchase mode and cost adjustment, and rate aggregation now qualifies line totals to avoid ambiguous-column errors. Screen and thermal receipts share snapshot presentation components. A future configuration takes effect on its scheduled date; historical reprints retain their original settings.

Verification: `scripts/stock-batch-request-test.mjs`, `scripts/gst-configuration-reader-test.mjs`, and the disposable full migration harness `scripts/short-document-codes-test.mjs <absolute-path-to-pglite-module>` (including `gst-option-consistency-cases.mjs`). Tests cover all 16 option combinations, multi-fabric tailoring, override/default selection, paid totals, rendered preferences, invoice/no-invoice purchase paths, ITC evidence, reports, historical reprints and disabled/stale settings. No live database is used by this harness. Migration 0070 and the application changes still require production rollout and hosted/printer acceptance; they were not deployed by this task.

Run `node --env-file=.env scripts/gst-centralization-test.mjs`. It checks migration parity, applies the complete migration to the connected PostgreSQL database in a transaction, verifies core objects and confirms zero seeded configurations, then rolls everything back.
