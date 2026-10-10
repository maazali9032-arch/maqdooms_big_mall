# Owner-approved Stock Entry revision — 11 October 2026

New deliveries use Provider → Delivery Batch → Fabric Type → individual coded
physical Thans. Stock Entry appears in the authorized staff sidebar and is their
landing page. A provider name can be reused from history; every delivery gets a
different B-number. Godown means the existing central Workshop location.

The first word of the provider name supplies its first and last two letters:
Raymonds Textiles → RDS. Each new Fabric Type gets a collision-checked random
eight-digit number. Each physical Than gets the next suffix a…z, aa, ab… and
its own length and printed Code128 barcode. A single Than starts with a, leaving
room for later additions. Provider words must contain at least three English
letters after punctuation removal. A submission accepts 1–500 Thans; more can
be appended to the same type in additional submissions.

CP per metre is optional. Stock Entry can supply it during registration or scan
their own registered barcode and fill missing CP later. They cannot retrieve
recorded CP or overwrite it. Owner retains CP reporting and existing correction
controls. Unknown CP stays unknown: no zero-cost backfill occurs. Customer
tailoring requires known CP; a direct sale using SP retains its original unknown
cost snapshot even if CP is supplied afterward.

## Database design and preservation

Applied live: `supabase/migrations/20261011000000_stock_registration.sql`.
Drizzle mirror: `drizzle/migrations/0030_stock_registration.sql` (identical bytes).
SHA256: `d08171f1b88d4523ae92435382650941d548c6fff02dadb207ed0b16d6629a6f`.
Both migration ledgers record the new migration. Historical migrations are intact.

Four new tables store provider snapshots, parent Fabric Types, individual variants,
and private retry requests. A new physical Than has one operational fabrics leaf,
one barcode, one fabric_stock row and one internal Than. Its parent grouping is
stored separately, preserving the existing transaction APIs. The historical
thaans.barcode column remains unused for these new registrations. Previous shared
Fabric+Batch barcodes are preserved; no historical stock is recoded.

Constraints enforce unique codes, parent/ordinal pairs, stock/Than correspondence,
positive ordinals and valid provider/suffix formats. The batch sequence and
batch/created-time index support registration. Audit and immutability triggers
protect new metadata; guarded triggers on fabrics, fabric_stock and thaans prevent
registered identities being rewritten or receiving a second physical Than.
Quantity/status changes remain available through existing transaction APIs.

Owner-only RLS protects all four raw tables. Browser writes and private helper
execution are revoked. Authorized registration RPCs enforce active roles,
inventory.receive permissions and ownership; CP retry payloads are private.
Advisory locks, parent locks and actor-bound request IDs make exact retries safe.
All batch, inventory, movement, optional CP and audit writes are atomic.

Migration application preserved the complete row fingerprints of **75 existing
public tables / 378 rows** captured immediately before rollout. The four new tables
were empty after application. No backfill, live stock fixture, seed replacement,
historical CP update or manual database change was performed.

## Verification

- 5,611 local assertions: cumulative phase regressions, 231 new database checks,
  11 navigation checks, 18 independently decoded barcode checks and 16 actual
  component browser checks. Both migration chains and clean replay pass.
- 367 live database security/schema checks and 10 anonymous PostgREST checks pass.
- A separate read-only schema recheck confirms the new extension is recorded and
  matches the full expected cumulative schema.
- TypeScript, scoped lint and the final Vercel-preset production build pass.
  Eight existing fast-refresh warnings remain.

Evidence is stored in the STOCK_REGISTRATION_* JSON files in this directory.
The live security verifier's obsolete fixed CP total was replaced with comparison
against the actual current privileged baseline (11 canonical CP rows, 16 legacy).
The first final security run stopped at that assertion; the corrected complete
run passed. No database adjustment was used to satisfy a test.

## Remaining acceptance

Application source has not been pushed or deployed. Live business transaction
fixtures, real staff login, physical printer/scanner acceptance, large-history
performance and multi-connection concurrency tests remain. Four pre-existing
legacy job domain/assignment decisions still require Owner input. Factory custody,
two-stage transfer receipts and other diagram changes are outside this revision.
