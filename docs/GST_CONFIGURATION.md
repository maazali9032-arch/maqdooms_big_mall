# GST configuration, invoices and reconciliation

GST is an Owner-controlled, effective-dated subsystem. Migration `20261017000400_gst_centralization.sql` creates no active configuration and seeds no rates. Existing receiving and Counter transactions continue through their established behavior until the Owner saves an enabled version after CA validation.

## Owner setup

The configuration editor loads the most recently saved version using SELECT access to the original GST tables, protected by their existing Owner-only RLS policies. It does not depend on the newer `owner_gst_configuration` RPC being deployed. All four original A/B option groups remain. The save-success message follows a read-back of the saved version; loading requests have a 15-second deadline and explicit retry on failure. Its effective date is displayed in local time; changes use the save time unless the Owner explicitly chooses a different date. Future dates remain scheduled. Migration `20261019000300_gst_configuration_reload.sql` (Drizzle `0067_gst_configuration_reload.sql`) additionally makes POS/Stock Entry (including Owner-operated POS) read the effective active version rather than an unscheduled draft or future version; it preserves every existing configuration and invoice. That migration is not required to restore the settings form or save/reload its options.

Open **Administration → GST Configuration**. Enter the legal identity, GSTIN, state code, effective date and one default rule for each supported category: stock purchase, fabric sale, finished-product sale and tailoring service. Every rule needs its CA-verified HSN/SAC and rate. Optional references such as `FABRIC:VELVET`, `PRODUCT:SHERWANI` and `SERVICE:ALTERATION` override a category default.

Choose whether selling prices include GST or have GST added, how the invoice presents totals, whether fabric and stitching are displayed together or separately, and how non-creditable purchase GST is reported. Saving creates a new immutable version; it does not rewrite old invoices.

## Stock receiving

CP remains the base purchase cost per metre excluding GST. When GST is active, Stock Entry first asks **Supplier invoice available?**. Selecting **No** receives stock without creating a GST purchase or ITC record. Selecting **Yes** reveals the supplier GSTIN, invoice number/date, ITC status and optional actual invoice totals for reconciliation. The supplier GSTIN determines intra-state versus inter-state treatment; staff do not choose it manually. Missing actual values remain estimates from the Owner-approved rule and are never treated as a verified supplier invoice or an automatic ITC claim. Transfers and production continue to carry base CP; tax is not added again during an internal movement.

## Counter billing

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

Run `node --env-file=.env scripts/gst-centralization-test.mjs`. It checks migration parity, applies the complete migration to the connected PostgreSQL database in a transaction, verifies core objects and confirms zero seeded configurations, then rolls everything back.
