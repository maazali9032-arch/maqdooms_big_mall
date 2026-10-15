# Billing, production and shared workspaces — 15 October 2026

This completes the remaining approved workflow changes after the Owner dashboard,
Reports, Audit, role workspaces and mobile barcode inspector releases. Earlier
implementation-history entries describe their state at the time; this release
supersedes the pending POS/production/navigation notes in section 54.

## Inventory and navigation

Fabric Inventory has three responsive views: Fabric stock & scan, Stock movements,
and Depleted / archived. Movements read the actual location ledger, including
posted transfers. Legacy/internal Thaans and the separate Receiving pipeline are
removed from this page. Finished Products and Materials & Consumables have their
own sidebar destinations. Locations & Floors, Factories & Tailors and Products &
Designs are Owner Administration definitions. Sales History and Salesperson
Performance are under Owner Reports & Tracking. The redundant Customers menu and
production tab strip are removed. Existing operational history is retained.

Fabric and finished-product transfer notes are optional. Omitted notes get an
explicit system annotation rather than a fabricated staff explanation.

## Counter

The operator chooses the Showroom floor before scanning. Fabric and finished
product scans append compact rows. Direct fabric uses exact per-metre pricing;
finished pieces use saved fixed SP and its reviewed cost version. Selected fabric
cuts can become one tailoring job with one manually entered whole-job total,
garment, due date, defined/custom design and Factory → Tailor. That total replaces
per-metre pricing for its grouped cuts and is counted once. Customer contact is
optional; saved normalized contacts are reused. Counter requires a credited
Salesperson. Factory/Tailor assignment and CP never appear on the printed bill.

Only bills containing tailoring can be unpaid. There are no deposits or partial
payments. An unpaid bill deducts stock immediately; later full collection creates
an immutable payment receipt without rewriting the bill. Parent bill collections
and tailoring booking amounts remain distinct in reporting. Exact retries are
idempotent, including a committed bill whose receipt response was interrupted.

Reserve summaries show numeric Showroom and Workshop quantities; opening them
reveals Batch → Fabric → physical barcode → location details without CP. The
selected floor remains the source for both new bills and additional issues.

Additional fabric is issued against an existing customer bill/job or Production
ID. The job must remain eligible for an issue. Its quantity and captured issue-time
CP increase; the customer's original total stays fixed. As explicitly approved,
the original job's recorded fabric cost and margin include subsequent issues.
Missing historical issue-time CP stays unknown. Labour and other unrecorded costs
are excluded; these figures are not net profit. Tailoring collections have no
invented revenue allocation across their fabric cuts/vendors.

## Production and receipt

New Production starts with Workshop or an active Showroom floor. Scanned physical
Thaans, available issue metres, piece count, shared product/design/size defaults,
individual overrides, one Factory and one or more Tailors produce one unique ID.
Every piece requires a defined design or written Custom design. Issuance deducts
stock immediately and snapshots fabric CP. Different products/sizes under one ID
retain their actual descriptors through receipts, labels, Counter/Ecom sales,
Reports and the Owner inspector. Ongoing shows unfinished jobs and retains the
existing Open → In progress → Completed status sequence.

All pieces arrive at Workshop together. Stock Entry sees completed jobs awaiting
receipt, receives the complete quantity, sets SP and prints individual barcodes,
then transfers selected pieces to Showroom. Total original plus additional issued
fabric CP is split equally across all pieces, with deterministic paise remainder
allocation. Detailed consumed/unused/wasted tracking and partial completion remain
deferred as requested.

## Shared Owner definitions and permissions

Owner Administration manages factories and their Tailors, product/design
definitions and Showroom floors in one place. Existing staff can be explicitly
added to a factory as Tailors, retaining their other roles, or created using the
existing isolated Create Staff flow. The UI explains that this grants the Tailor
role. Reassignment affects future work; existing jobs retain their original
assignment. Deactivation preserves historical records. Every work picker reads
the shared definitions. No Section setup or duplicate configuration links are
presented in operational pages.

Salespeople see their own attributed combined bill once, with nested tailoring
progress; linked internal booking orders are not repeated as separate billed
amounts. Financial Reports and the read-only global barcode inspector remain
Owner-only in the database. The inspector includes the new payment, job-cost and
per-piece specification evidence without reconstructing absent history.

## Verification and rollout

Forward migrations 0045–0050 have matching Supabase/Drizzle copies. Their rollout
runner compares the canonical schema and permissions, fingerprints every existing
public table, applies each version transactionally with its checksum, and refuses
schema drift or changed existing rows. No operational fixtures run on the live DB.

Evidence files: `WORKFLOW_WORKSPACES_DATABASE_VERIFICATION.json`,
`WORKFLOW_WORKSPACES_UI_VERIFICATION.json`, `WORKFLOW_WORKSPACES_BUILD.json`,
`WORKFLOW_WORKSPACES_ROLLOUT.json`, and `WORKFLOW_WORKSPACES_LIVE_VERIFICATION.json`.
Browser screenshots contain disposable synthetic data. Database tests cover clean
and populated Supabase/Drizzle replays, exact money, retries, rollback, cost
reconciliation, both sales channels, and role denials. Browser checks cover
320/390/768/1440 layouts, scanning, shared defaults/overrides, grouping and Owner
definition visibility. Separate regression proofs cover Dashboard/Reports and
the inspector's actual CODE128 decoder, camera denial and cleanup.

No real sale, production issue, staff account or inventory fixture is created for
live acceptance. Physical-phone camera testing and an authenticated hosted
browser session remain device/user acceptance steps. The separate future Ecom
website and payment gateway connection remain outside this ERP release.

Rollout and acceptance completed: forward 0045–0050 applied, all rows in 88 pre-existing public tables preserved; 86 read-only live checks passed over 30 existing barcodes, both posted transfers and all 96 current public tables. No live operational fixtures were posted. Isolated Vercel production build passed; source push is recorded in Git history. Due-today/overdue dashboard alerts now use actual recorded delivery dates. Historical jobs without due dates remain excluded.

Forward 0050 retains the existing Showroom-only authorization on the older finished-sale endpoint and captures actual per-piece design/size. It supersedes that compatibility function without editing previously applied migration bytes.

Live role probes compare all business/audit and account identity/access fields. The normal concurrent profile last_login timestamp is excluded from acceptance fingerprints; atomic migration preservation includes every existing column.

Production deployment confirmed for source fbe59dc: successful Vercel commit status and live JavaScript bundle contains the new combined bill and floor-first UI. See WORKFLOW_WORKSPACES_DEPLOYMENT.json. Authenticated hosted browser and physical-phone camera acceptance remain unperformed.
