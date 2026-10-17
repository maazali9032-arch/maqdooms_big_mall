# GST configuration, invoices and reconciliation

GST is an Owner-controlled, effective-dated subsystem. Migration `20261017000400_gst_centralization.sql` creates no active configuration and seeds no rates. Existing receiving and Counter transactions continue through their established behavior until the Owner saves an enabled version after CA validation.

## Owner setup

Open **Administration → GST Configuration**. Enter the legal identity, GSTIN, state code, effective date and one default rule for each supported category: stock purchase, fabric sale, finished-product sale and tailoring service. Every rule needs its CA-verified HSN/SAC and rate. Optional references such as `FABRIC:VELVET`, `PRODUCT:SHERWANI` and `SERVICE:ALTERATION` override a category default.

Choose whether selling prices include GST or have GST added, how the invoice presents totals, whether fabric and stitching are displayed together or separately, and how non-creditable purchase GST is reported. Saving creates a new immutable version; it does not rewrite old invoices.

## Stock receiving

CP remains the base purchase cost per metre excluding GST. When GST is active, Stock Entry shows base value, GST and supplier amount for each complete Thaan row and the batch total. Supplier GSTIN, invoice number/date, supply type, ITC status and optional actual invoice totals are recorded for reconciliation. Transfers and production continue to carry base CP; tax is not added again during an internal movement.

## Counter billing

The Counter selects intra-state or inter-state supply and may record the customer GSTIN/state code and payment method. The server recalculates every line using the active effective-dated rules inside the same sale transaction. It stores an immutable business, customer, line and tax snapshot, updates the payable total, and only then records full or advance payment. Retrying the same request stays idempotent.

Customer reprints read the saved snapshot. The bill has dedicated **58 mm** and **80 mm** print actions and shows taxable value plus CGST/SGST or IGST. The existing price-free tailor work order remains separate.

## Reports and corrections

The GST page provides period totals, rate/HSN-SAC grouping, supplier reconciliation, eligible/ineligible/reversed ITC and an estimated net liability. Manual adjustments require a positive amount, document reference and reason; they are append-only and audited. These figures support operational reconciliation and do not replace CA filing software.

## Boundaries

- No unverified GST rate is a system default.
- The current repository has no public e-commerce checkout/payment transaction to tax. E-commerce listings and stock visibility remain unchanged; a future checkout must call the same tax service and persist a snapshot.
- Previously completed bills do not gain a fabricated tax snapshot.
- A physical printer test is required for each 58/80 mm printer and browser-driver combination.
- GST registration details, HSN/SAC choices, rates, ITC treatment and filing totals require CA approval.

## Verification

Run `node --env-file=.env scripts/gst-centralization-test.mjs`. It checks migration parity, applies the complete migration to the connected PostgreSQL database in a transaction, verifies core objects and confirms zero seeded configurations, then rolls everything back.
