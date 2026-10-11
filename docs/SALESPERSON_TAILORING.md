# Salesperson and manual Customer Tailoring totals — 11 October 2026

Reuse the existing login and staff records. The added role key is `salesperson`;
the stable Salesperson ID is the existing profiles UUID, displayed with their name
in billing selectors. No duplicate salesperson identity or login table is created.
Owner assigns roles in Manage Access and controls individual action overrides.
A person can hold Counter and Salesperson roles together. Assigning Salesperson
alone provides My Work and Settings, without billing or inventory access.

Each newly created canonical bill selects one active Salesperson. The bill stores
salesperson_user_id separately from created_by (actual authenticated POS operator).
Linked customer tailoring jobs store the same ID. Attribution is immutable; old
records retain null rather than guessing who sold them.

My Work displays attributed bills, customer-facing amounts, fabric quantities,
barcodes, location and linked Factory/Section/Tailor/job status. Its checked API
filters non-Owner callers to their own authenticated ID, including when a person
also has Counter duties. Owner can view all attributed work or filter a Salesperson.
History is paginated by creation time plus UUID. CP, private costing/retry payloads
and other Salespeople's work are excluded. Pure Salesperson has no raw bill or
private pricing access. Account deactivation preserves credit and denies login access.

## Billing and stitching

For fabric only, scan the original barcode, select source and Salesperson, enter
price per metre and metres, then complete the paid sale. For stitching, use selected
metres directly (no fabric SP needed), or carry an existing unsubmitted cart into
Customer Tailoring. Select customer, Factory → Section → Tailor, garment and one
final customer total. The final amount is entered by Counter, not calculated from
CP or a predefined charge. One booking creates the linked job, required material
issue and bill; fabric is deducted once. A transport failure freezes the request
for an exact retry, including price and Salesperson. Returning to fabric sale is
disabled while that booking result is uncertain.

Tailoring booking retains existing payment semantics: recording its final agreed
bill amount does not claim payment was received. Direct and Finished Product
sales still require received-payment confirmation. Finished Product bill attribution
is added without changing Owner product SP or production costing.

Internal known CP is captured separately. An unknown component makes the original
fabric CP total unknown; later stock CP entry does not rewrite the booking snapshot.
No fabricated zero CP or separate stitching cost is inserted to match the manual
selling total. Owner's tailoring report and cost view distinguish the new snapshots.

## Migration and preservation

Migration: `supabase/migrations/20261011000200_salesperson_tailoring_pricing.sql`.
Identical mirror: `drizzle/migrations/0032_salesperson_tailoring_pricing.sql`.
Adds nullable profiles FKs on orders/customer_tailoring_jobs and corresponding
Salesperson/time indexes. Adds one immutable Owner-only counter_tailoring_prices
table for entered total, nullable original fabric CP, private cut snapshots and
recording actor/time. Adds attribution guards, audit trigger, checked directory/
work/booking APIs and attributed overloads for fabric/Finished Product sales.
Existing material requirement guard, tailoring history/cost API and Owner report
are updated to support both pricing models. No older migration is rewritten.

New permissions: salesperson.view_work, pos.assign_salesperson,
pos.enter_tailoring_total. Their defaults grant personal viewing to Salesperson
and selection/manual total entry to Counter. Owner keeps full control. No existing
account is assigned a role automatically. No salesperson or price backfill occurs.
Existing six-argument sale and CP-based booking APIs retain their signatures for
historical retry/read compatibility; new uncredited canonical bills are rejected
by the attribution guard. Updated billing uses the attributed APIs.

## Acceptance and rollout

Verification evidence is in the separate SALESPERSON_TAILORING_* JSON files.
Local tests cover both populated migration chains and a clean replay, own-work
privacy, cross-user rejection, price/retry/stock consistency, missing CP, historical
preservation, report support, status changes and Finished Product attribution.
Browser tests use isolated synthetic fixtures rather than live staff transactions.

The compatible frontend must be published and Owner must assign Salesperson to
active staff before new billing. Do not guess a default Salesperson for old clients.
No push/deployment, live fixture transaction, real staff login, printer/scanner
acceptance or multi-connection race test is performed by this implementation.
Four earlier legacy job-domain/assignment decisions remain for Owner input.
