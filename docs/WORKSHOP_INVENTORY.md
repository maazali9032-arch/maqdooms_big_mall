# Workshop inventory hierarchy — 12 October 2026

Inventory → Fabric Stock now shows an always-open **Batch → Fabric Type → individual
Thaan** hierarchy, with the most recently created batch first. No dropdown/collapse
controls hide the hierarchy. Search and barcode scanning filter the same rows, keeping
matching batch/type headings. The lower duplicate search and Fabric Stock heading
are removed. The upper Incomplete only checkbox composes with the current search.

Rows show name, colour, received/saved length, Workshop available metres, permitted
CP per metre, state and the Barcode action at the far right. Fabric SP is omitted;
Counter enters it when billing. Missing required name/type/colour/length or missing
or zero CP makes a row incomplete. Optional remarks/design/rack do not. Hidden CP
remains Restricted, while the safe incomplete flag still works.

Click a Thaan name for its details popup. Click Barcode for its unchanged label and
Print this barcode to print that label only, without CP. Historical shared labels
remain shared; no new label identity is invented for legacy records.

## Edits and permissions

- Existing `inventory.edit_thaan` plus receive permission and original registering
  user/Owner ownership controls edits. Existing CP-view permission still limits staff
  to their own registrations. Owner sees all permitted inventory CP.
- New independent Owner-managed actions: `inventory.correct_cp` and
  `inventory.correct_workshop`. No default staff grants. Owner can grant them to
  specific users. Existing missing-CP action permits correcting own missing/zero CP.
- Names/colour are explicit audited corrections. Type-name correction changes the
  registered fabric group's display name, not its ID, code or membership. The popup
  states this group-wide effect. Historical legacy type reassignment is disabled.
- A pending registered Thaan accepts actual partial measurements; completing colour
  and positive length reuses its first atomic Workshop receipt. Measured-stock
  length means **Workshop available metres**, not original received length. Quantity
  corrections append ADJUSTMENT movements; CP corrections append cost versions.
- Original received length, historical transfers/sales/receipts/cost versions and
  barcode IDs remain unchanged. Reasons and a current version token are required.
  Stale edits fail; frozen exact retries do not duplicate costs/adjustments.
- Unlocated legacy balances remain unknown with Needs reconciliation. No Workshop
  location/quantity is guessed. Pending labels remain unavailable until measured.

## Migration

Canonical `supabase/migrations/20261012000200_workshop_inventory_hierarchy.sql`;
identical mirror `drizzle/migrations/0036_workshop_inventory_hierarchy.sql`, journal36.
SHA256 `5ebfce41046f1cc907dfb83861c697bdb01ce730e8d61158d11d0c5ab93760ce`.

Adds two permission metadata rows; no new tables, columns, constraints, indexes,
relationships, seed data or historical backfill. New authenticated APIs
`workshop_fabric_inventory` and `edit_workshop_thaan`; anonymous access denied.
Replaces registration group, variant-draft and operational identity guard functions
to permit only explicit authenticated receipt-marked corrections. Existing trigger
bindings, RLS, audit and history protection remain. New APIs use fixed search paths.

Live rollout preserved original-column fingerprints for 81 tables / 1,026 baseline
rows; ledger now has 37 migration versions, still 81 tables. No business fixtures or
user overrides executed live. Prior migration files remain unchanged.

## Verification

- 360 cumulative disposable checks across demo Supabase, demo Drizzle and clean
  Supabase replay. Includes zero-CP detection, CP visibility, metadata/identity
  preservation, permissions, stale edits, CP version preservation and adjustment
  idempotency. Prior stock-entry rules remain covered in the same full replay.
- 19 actual-component browser checks: always-visible hierarchy, batch order,
  shared filters, zero/missing CP, exact selected-label printing, popup editing,
  frozen retry, positive CP removing incomplete state, 320/390/768/1440 widths.
- Independent live schema/grants/RLS reference check, live role/API checks and
  cumulative security verification; evidence under `WORKSHOP_INVENTORY_*`.
- TypeScript, scoped ESLint (one Fast Refresh module-layout warning), whitespace
  check and Vercel-preset production build pass. Desktop/mobile captures inspected.

Existing four legacy job decisions, general legacy reconciliation, Showroom inventory
redesign and other modules remain unchanged. Physical acceptance/concurrency testing
and confirmation of the automatic deployment remain outside the completed checks.
