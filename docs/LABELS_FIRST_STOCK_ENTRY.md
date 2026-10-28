# Labels-first Stock Entry — 12 October 2026

> **Current implementation note (29 October 2026):** This is the original labels-first receiving rollout note. Current receiving supports fabric, vendor ready-made, and material-unit batches; use [the current system reference](CURRENT_SYSTEM_REFERENCE.md) for the active workflow.

Implemented following the Owner's images and explicit authorization. The database
migration is applied and verified live. The original frontend-publication note is now historical.

The subsequent [optional-details revision](OPTIONAL_THAAN_DETAILS.md) now also
supports expandable per-Thaan fields before generation and independently saved
partial details. It supersedes the original scanner-only measurement entry below.

## Workflow

Stock Entry opens **Scan Existing Barcode** and **Create Batch** cards. Scanning
shows details below the scanner. Create Batch accepts arrival date, supplier/provider
(history selection or new name), remarks, and fabric types with physical Thaan counts.
These counts are not metres. Repeated supplier names create separate delivery batches.

Generate All Barcodes creates one permanent unique code per physical Thaan, retaining
the provider prefix, random fabric number and sequential `a…z, aa, ab…` rules.
Batch IDs retain `B0001…`; the image's date-based ID was illustrative. The next stage
shows one fabric type's labels together in input order. Print All Labels for This
Fabric and Print Again print only that group with the same codes. Previous/Next
Fabric Type navigates groups. Existing batch labels can be reopened. Additional
Thaans continue the current suffix sequence; another fabric gets a new group.
Labels contain no CP.

After attaching labels, scan each barcode and record actual colour, positive length
and optional CP. Unknown length stays NULL: a pending label creates no inventory
item or stock movement. Measurement atomically activates the Thaan and posts exactly
one Workshop inward movement. Missing CP can be filled later with existing permission.
No SP is set during Stock Entry. Legacy nonregistered barcodes retain read-only
catalogue scanning; historical identities are not converted or reissued.

## Migration and security

- Canonical: `supabase/migrations/20261012000000_labels_first_stock_entry.sql`.
- Identical Drizzle mirror: `drizzle/migrations/0034_labels_first_stock_entry.sql`,
  journal entry 34. Two representations of one logical migration.
- SHA256: `c5a9e0c8ff36cbe6ae40cd196a784b1086c239f94fceb1a7f3e3fd367cc0e682`.
- Adds nullable `stock_registration_fabric_types.label_position` with a positive
  value constraint, and `stock_registration_variants.details_recorded_at`.
  Historical values remain NULL; actual colour reuses existing `fabrics.colour`.
- New APIs: `create_barcode_batch`, `complete_barcode_thaan`,
  `registered_thaan_details`; private trigger function `guard_label_variant_history`.
- Replaces `registration_operational_identity_guard`, `registration_insert_thans`,
  `register_fabric_type`, `stock_registration_catalog` and `fabric_stock_catalog`
  definitions through the new migration only. Replaces the existing
  `registration_variants_immutable` trigger definition to allow the first measured
  timestamp while retaining permanent links and deletion protection.
- No new tables, indexes or relationships. Reuses unique barcode indexes, stock
  ledger, cost versions, authenticated request receipts and audit triggers.
  No historical quantity backfill, barcode reassignment or seed change.
- New Owner-managed actions: `stock.generate_labels`, `stock.measure_thaan`,
  `inventory.view_registered_cp`, with Stock Entry defaults. Existing receiving,
  printing and missing-CP permissions still apply.
- Owner or original registering staff with measurement permission may complete a
  Thaan. Other authorized stock staff can see safe details, but cannot complete it
  or see its CP. Staff CP visibility is limited to their own registrations with the
  new permission; Owner retains full visibility. Existing RLS remains.
- New APIs deny anonymous access, enforce role/action/ownership and fixed search
  paths. Direct variant writes remain denied. First length/colour writes require
  the matching authenticated measurement receipt; subsequent overwrites fail.
- Frozen actor-bound requests allow exact retries without duplicate batches,
  barcodes or receipts; changed payloads fail. A matching fresh measurement request
  also cannot create a second inward movement.

## Limits and verification

Initial submission supports 1–100 types, 1–500 Thaans per type and 5,000 total.
Append operations support further labels, up to 500 per call. Combine duplicate
trimmed/case-insensitive fabric names in an initial submission; later separate
groups may reuse descriptive names. Measurement requires actual colour and positive
integer millimetres. Optional CP is integer paise; explicit zero is supported.
Original recorded length/colour cannot be overwritten through this workflow.
Existing stock/cost corrections remain; no new colour correction UI. Print Again
indicates a print attempt, not confirmation of physical printing.

Evidence: `LABELS_FIRST_STOCK_ENTRY_*_VERIFICATION.json` and
`LABELS_FIRST_STOCK_ENTRY_REGRESSION_DATABASE.json` in this directory.

- 201 database checks across demo Supabase, demo Drizzle and clean Supabase replay.
- 27 actual-component browser checks: grouped printing and same-code reprinting,
  scanning/measurement, frozen retries and widths 320/390/768/1440.
- 5,493 historical database checks across 18 suites. Historical suites retain
  original migration boundaries; the new suite checks the full chain.
- Live canonical schema/RLS/grants match; 14 dedicated live checks, 420 cumulative
  security checks and 6 anonymous PostgREST discovery/denial checks pass.
- TypeScript, scoped lint, whitespace checks and Vercel-preset production build pass.

Live rollout preserved original-column fingerprints across the baseline 81 public
tables / 470 rows. Only permission and migration/audit metadata were added. No live
fixture batches, measurements, CP, transfers or sales were created. The ledger now
has 35 versions; table count stays 81. Independent verification confirms the hash.

Frontend publication, physical printer/scanner acceptance and live concurrency/load
testing remain. Four previously recorded legacy job decisions are unchanged.
No commit, push or deployment was performed.
