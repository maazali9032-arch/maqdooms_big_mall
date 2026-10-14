# Owner daily operations and monthly business analysis

Approved 14–15 October 2026. Godown continues to mean Workshop.

The Dashboard defaults to today's India business day. It shows paid Counter and
E-commerce sales together, with fabric/product revenue separate from Customer
Tailoring bookings. Always-visible daily cards show Counter and online sales,
registered batches/Thaans and received metres, posted transfer documents,
new production jobs and all fabric issued that day, production jobs marked finished,
pieces received at Workshop, and new Customer Tailoring jobs. A finished job and a
Workshop receipt are distinct events. Current inventory, ongoing work and current
reviews remain explicitly independent of the selected historical day.

Reports defaults to the last completed calendar month and compares it with the
calendar month before it. A custom date range compares the preceding equal-length
period. Select a month or dates and Apply filters. Business charts use the applied
date range and location. Transaction search, vendor, fabric, sale type, channel and
credited Salesperson filters refine the evidence table only, as stated beside the
controls. Refresh updates the charts and evidence. Current stock reports ignore
historical dates explicitly.

Business rankings cover fabric + vendor, vendor, finished-product family, credited
Salesperson and sales channel. Measures use collected revenue, actual metres,
pieces or distinct paid bills, with appropriate units. Complete recorded-cost groups
can also rank by margin. A mixed online checkout is one bill; a location report
includes only its lines on that floor and counts the contributing bill once.
Group bill/customer counts must not be added together when a bill spans groups.

Costs use captured sale-time Thaan CP or the recorded per-piece production CP.
Unknown historical costs remain null. Known margin excludes unrecorded expenses;
it is not a complete net-profit figure. Unidentified customers are counted as bills,
not invented unique people. Older fabric/vendor descriptions may use current
catalogue names because no snapshot was recorded then. New completed sales capture
those dimensions and credited names immutably. Custom-design production and pieces
are included in existing reports. Salary/P2P data remains outside business analytics.

## Future website's protected paid-order API

The existing Supabase REST RPC endpoint exposes `submit_paid_ecommerce_order` to the
**service role only**. Anonymous and authenticated browser accounts, including Owner,
cannot execute it. Keep the service credential on the future website's server in an
isolated client; never place it in browser code. No credential was created or added
to this repository, and no external website or payment gateway was deployed.

The website's server must verify a settled provider payment (signature, provider
status, currency INR, its checkout ID, its expected amount and immutable cart) before
calling. A payment reference is evidence supplied by that trusted server, not a
database-generated verification of a gateway signature. User requests or an
unpaid `online_orders` record do not become paid sales automatically.

Example server-side call; all IDs are resolved from the verified checkout's
Showroom stock. Money is integer paise and fabric quantities are integer millimetres.

```ts
const { data: orderId, error } = await serverAdmin.rpc("submit_paid_ecommerce_order", {
  p_request: checkoutUuid,
  p_external_order: `website:${checkoutId}`,
  p_payment_reference: `${paymentProvider}:${settledPaymentId}`,
  p_paid_at: verifiedSettlementTimestamp,
  p_paid_total_paise: verifiedPaidAmountPaise,
  p_recorded_by: configuredExistingEcommerceOrOwnerAccountId,
  p_items: [
    {
      kind: "fabric",
      source_id: floorAId,
      inventory_item_id: thaanInventoryId,
      quantity_mm: 2000,
      sp_paise_per_m: verifiedCheckoutPricePerMetre,
    },
    {
      kind: "product",
      source_id: floorBId,
      piece_id: garmentId,
      sp_version_id: savedWorkshopPriceVersionId,
    },
  ],
  // Optional existing customer ID and credited Salesperson ID:
  p_customer: customerId,
  p_salesperson: creditedSalespersonId,
});
```

Omit optional IDs for self-service purchases. Counter attribution still requires an
active Salesperson. The integration's existing active Owner/E-commerce account is
recorded explicitly as the integration's bookkeeping identity, not as a human POS
action. The return value is the canonical order UUID, without CP.

One checkout may mix fabric cuts and whole garments from multiple active Showroom
floors. It cannot consume Workshop reserves. Up to 100 explicit cart lines are
accepted; repeated cuts for the same item/floor must be combined, and each physical
piece appears once. Product SP must match its saved current price version. Per-line
prices are nonnegative; the settled checkout total must be positive and exactly
match all lines. Price/quantity limits retain the ERP's exact supported ranges.

Stock deduction, financial snapshots, one completed order, channel evidence and
audit are one transaction. A short floor balance, stale garment SP or total mismatch
rolls back everything. Reuse the same verified payload on a retry: request IDs,
website order IDs and provider payment references prevent duplicate bills/debits.
A reused reference with changed data is rejected. In an out-of-stock conflict after
payment, the website must surface the error for resolution; this API does not create
a refund, reserve stock before payment or silently substitute another Thaan/floor.
Refund/return accounting and shipping charges are outside this implementation.

## Verification and migration

Forward-only Supabase `20261014000100_owner_business_analytics.sql` and mirrored
Drizzle `0041_owner_business_analytics.sql`; once applied, preserve these exact bytes
and use another forward migration for changes. The builder and SQL sources document
the original assembly; do not regenerate an already-applied migration with edits.

Reproducible checks: `owner-business-analytics-test.mjs` with a disposable PGlite
runtime; `owner-business-model-test.mjs`; `owner-business-analytics-ui-test.mjs` with
Playwright. Live rollout compares schema/RLS/grants and original-column fingerprints
inside a locked transaction. Live acceptance uses existing accounts read-only;
populated fixtures, payment retries and failed stock postings run only in disposable
databases. Screenshots use synthetic fixtures, not production records.
