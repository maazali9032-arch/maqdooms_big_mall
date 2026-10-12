# Optional details during batch creation — 12 October 2026

The subsequent UI polish adds compact numbered fabric headers, remove icons,
label-count badges and a dropdown for optional rows. Desktop rows use aligned
columns with sticky headings; mobile rows retain visible field labels. Corrupted
separator text is removed. Stock-entry behaviour and database rules remain unchanged.

Extends the labels-first Stock Entry workflow to match panel 5 of the Owner's
latest reference. Database migration is applied live; frontend publication remains.

- Enter supplier, arrival date, remarks, fabric types and physical Thaan counts.
- Expand any fabric type to show its individual Thaan rows. Enter actual colour,
  length in metres and/or optional CP per metre, independently, or leave them blank.
  Collapsing rows retains entries. Reducing counts cannot silently discard filled rows.
- Generate the permanent unique codes atomically with the optional details. Barcodes
  appear at generation, not as temporary/reserved identities in the optional form.
- Print one fabric type at a time; reprints reuse codes. CP never appears on labels.
- Scan attached labels to see saved details and fill only missing fields. Partial
  colour, length or CP can be saved independently. No value is invented.
- Both actual colour and positive length are required for first Workshop inward.
  A saved length without colour remains pending and unavailable, with no inventory
  item/movement. CP remains optional. Exact/fresh matching retries cannot add receipts.
- Saved values cannot be overwritten through this completion workflow. Existing
  Owner correction workflows remain. Legacy scans and sidebar organization unchanged.

## Database and security

One logical migration:
`supabase/migrations/20261012000100_optional_thaan_details.sql`, with identical mirror
`drizzle/migrations/0035_optional_thaan_details.sql` and journal entry 35.

SHA256: `f19cbc59b968e74a481b124ab97b3c767793336823c2226d6faed6500c01d683`.

Adds `stock_registration_variants.draft_details jsonb NOT NULL DEFAULT '{}'` with
object/allowed-key CHECK. Historical rows receive empty metadata; no actual colour,
quantity, cost or identity is backfilled. Saved partial fields use `colour`,
`length_mm`, `cp`; real measured `thaans.original_mm` remains separate. First complete
measurement and CP reuse existing operational tables and ledger/cost APIs.

New authenticated APIs: `create_barcode_batch_with_details` and
`save_registered_thaan_details`. Replaces definitions of `guard_label_variant_history`,
`complete_barcode_thaan`, `fill_registered_thaan_cp`, `registered_thaan_details`
and `stock_registration_catalog` through the new migration only. Existing trigger
binding and audit triggers remain. No new tables/indexes/relationships or permissions.

Existing generation/measurement/receive/CP-fill/own-CP-view actions and original
registering-user/Owner restrictions apply. Draft CP is exposed only through the same
restricted scanner API. Raw variant reads retain Owner-only RLS. Anonymous execution
is denied; direct staff mutations stay denied. Original codes/links remain permanent.
Partial merges require matching immutable authenticated request receipts. The older
completion and CP-fill APIs cannot contradict already saved partial values.

## Verification

- 297 cumulative disposable database checks: full Supabase/Drizzle demo replay and
  clean Supabase replay, partial/complete/blank creation, independent scan updates,
  immutable saved values, old-API bypass denial, retry behavior, atomic invalid-batch
  rollback, CP isolation, role denials and unchanged earlier stock workflows.
- 34 actual-component browser checks: expandable/collapsed preservation, optional
  payload conversion, count-reduction protection, missing-only scanning, grouped
  print/reprint, frozen retries and responsive widths 320/390/768/1440.
- Live schema/permission reference match and original-column fingerprints preserved;
  18 dedicated live checks and 4 anonymous PostgREST denial/discovery checks pass.
- TypeScript, scoped ESLint, whitespace check and Vercel-preset build pass; patched
  TanStack server-core remains 1.169.39. Evidence under `OPTIONAL_THAAN_DETAILS_*`.

Live table count remains 81; migration versions increase to 36. No live fixture
batch, measurement, CP, stock movement, sale or user permission override was created.
Physical printer/scanner acceptance, frontend publication and live load/concurrency
testing remain. Existing four legacy job decisions are unchanged. No push/deployment.
