# Approved role workspaces

Stock Entry sees Stock Entry, Stock Transfer, Stock Inventory, Finished Products
and Account. Counter sees POS, Customer Tailoring, Owner Production and Account.
E-commerce sees Showroom Fabric, Showroom Finished Products and Account. Tailor
sees Customer Tailoring, Production Tailoring and Account. Salesperson sees My Work
and Account. Production sees Fabric, Ongoing Production and Account. Multiple roles
combine their workspaces; Owner retains all work and grouped Administration.

Owner-controlled personal action exceptions remain subject to role eligibility.
Workshop receipt and SP remain available when transfer permission is denied.
No record-creator filter was reintroduced for Stock Entry CP or inventory edits.

## Production

1. Scan a physical Thaan barcode, choose Workshop/Godown or a Showroom source,
   product, predefined/custom design, size, whole piece count and assigned Tailors.
   Posting deducts exactly the entered fabric quantity immediately.
2. Print its stable Production ID document. It contains the assignment, design,
   size, count and actual issues; CP is excluded from the printed document.
3. Counter's Additional production fabric tab accepts that Production ID and a
   physical Thaan barcode. Each additional issue deducts at its selected source and
   captures that issue's current CP privately in the same transaction.
4. Production/Tailor marks all work finished. Stock Entry/Owner scans Production ID
   in Finished Products, receives the complete planned batch into Workshop and
   generates one stable barcode per physical piece. No partial receipt is offered.
5. All recorded fabric issue costs, including extras, are divided across the pieces.
   Integer paise remainders are assigned in piece-number order; allocations sum
   exactly to issued fabric CP. This is issued-fabric CP, not reconstructed actual
   consumption, wastage, labour or full manufacturing cost. Historical issues without
   captured CP are explicitly unknown and cannot be silently received by this path.
6. Stock Entry/Owner sets SP in Workshop, individually or for all available pieces
   in that job. Printed labels contain product, design, size, saved SP and barcode.
   Transfer to Showroom requires recorded SP; POS sells using that saved SP.

Positive length and positive CP are required before a Thaan becomes active or
receives usable stock. Missing/zero CP and missing length stay as draft details.
Colour and the inventory correction reason remain optional. Existing measurements,
identities, ledgers and historical data are preserved; no automatic backfill.

## Accounts and administration

New self-signups receive no work role; Owner assigns access. Add Staff creates an
isolated signup session, then uses Owner-authorized role assignment without replacing
the Owner session. Hosted signup availability, rate limits and email confirmation
still follow the configured authentication provider. New Tailor records select an
existing active Tailor login or use Create new Tailor account. Historical Tailors
without logins are retained. Account supports own name, email and password updates;
passwords are never displayed. Email changes follow provider confirmation.

## Separate E-commerce website

`storefront_catalog()` is a read-only RPC available to anon/authenticated. It returns
only published linked listings, current Showroom/floor stock and an availability
state. Workshop, suppliers, accounts, CP and production costs are excluded.
`showroom_stock(p_kind)` and `ecommerce_listing_stock()` are protected staff RPCs.
All derive availability from the current ledger; a POS sale is reflected immediately
in the next API read. Internal E-commerce screens poll every 10 seconds and offer
Refresh. The separate website still needs the manual connection requested by Owner.
Its refresh/realtime behavior is controlled by that website. Legacy manual/untracked
listing definitions remain preserved but are excluded from the new public catalog.

## Verification and migration

Run `scripts/role-workspaces-test.mjs <PGlite module path>` for cumulative Supabase
and Drizzle replay against populated and clean databases. Run
`scripts/role-workspaces-ui-test.mjs <Playwright module path>` for actual components
with synthetic data only. The production build uses the existing isolated build
runner. Proof files are under `docs/ROLE_WORKSPACES_*_VERIFICATION.json`.

Migration `20261014000000_role_workspaces.sql` is mirrored byte-for-byte as Drizzle
`0040_role_workspaces.sql`. The controlled rollout compares live/reference schemas
and checks original-column row fingerprints plus metadata/audit row preservation
inside the locked migration transaction. No business fixtures run live. The SQL
builder accepts a read-only pre-migration function/policy snapshot as its explicit
argument; the committed SQL is the replay artifact. Never regenerate or modify an
already-applied migration.
