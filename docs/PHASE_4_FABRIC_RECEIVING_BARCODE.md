# Phase 4 — Fabric Stock Entry + One Barcode

Business authority: root Implementation Master Plan. Permanent record: root
Implementation History. This contract describes Phase 4 only.

## Migration and preservation

- Canonical: `supabase/migrations/20261003000300_phase4_fabric_receiving_barcode.sql`.
- Identical mirror: `drizzle/migrations/0013_phase4_fabric_receiving_barcode.sql`,
  appended journal index 13. Apply one complete chain, never both copies.
- SHA-256 of both: `5efc287ff1d1781858415ad68ab24dd110eaae1a995ad1c63a397ae225acd23b`.
- No migration DML/backfill, legacy CP/SP rewrite, label replacement, seed edits or
  guessed Workshop location. Prior SQL files remain byte-for-byte unchanged.
- Live Supabase application was not performed. Use migration files for rollout;
  never copy statements into undocumented manual database operations.

## Schema and database API

Reuses `fabrics`, `receiving_batches`, individual `thaans`, unique Fabric + Batch
`fabric_stock`, immutable `barcodes`, append-only `fabric_stock_costs` / prices,
Phase 3 inventory authority/ledger and audit records. No duplicated quantity ledger.

New `fabric_entry_requests`: request UUID PK, unique Fabric Stock FK, required
profile creator FK, JSON payload and creation timestamp. PK/unique indexes support
retry lookup and one request per entry. Payload contains CP; Owner-only SELECT RLS,
no authenticated writes, service-role privileges and immutable UPDATE/DELETE trigger.
No new columns on existing tables or other explicit indexes.

Nine new functions, authenticated API execution only where listed:

| Function | Behavior |
| --- | --- |
| `can_receive_fabric()` | Private active Owner / Stock Entry receiving-permission predicate; browser execution revoked. |
| `create_fabric_entry(request,fabric,batch,lengths,cp)` | Owned open batch, existing Fabric, 1–500 positive integer-mm Thans, required nonnegative CP. Request advisory lock and private exact-payload retry; conflicting request or duplicate Fabric + Batch rejected. Generates stable stock UUID and one `FAB-` UUID Code 128 identifier, internal Thans with NULL roll barcode, initial CP revision and audit, all atomic. |
| `update_fabric_entry(stock,lengths,cp)` | Owned new-model draft only; stock/batch/Than locks, every existing Than supplied once. Exact lengths and appended CP revision/audit; errors roll back the whole operation. Does not delete/add/reorder physical rows or change Fabric/Batch identity. |
| `complete_fabric_entry(stock)` | Owned authorized workflow, CP required, SP optional. Draft receipt creates one authority and INWARD Workshop event per Than, activates rows, closes CP workflow and audits atomically. Repeated completion returns same stock without extra receipts. Multi-fabric batch remains open while other drafts exist. Correcting-state completion closes CP only, never posts another receipt. Legacy-pending stock cannot be re-received. |
| `open_fabric_cp_correction(stock,reason)` | Owner alone opens completed stock for its original entry creator's scoped CP correction; reason/audit required. No quantity or identity change. |
| `owner_set_fabric_sp(stock,sp,reason)` | Owner-only nonnegative SP append with reason/actor/time/audit. Serialized revision allocation; barcode remains stable. Does not overwrite legacy price snapshots. |
| `fabric_stock_catalog(barcode?)` | Active Owner/Counter/Stock Entry/E-commerce operational roles; list or exact trimmed Fabric Barcode lookup. Fabric/Batch identity, internal Thans, original/available quantities, latest SP and location totals. No CP, cost revision, protected audit or retry payload. Unreconciled legacy quantity stays explicitly unlocated. |
| `fabric_stock_history(stock)` | Invoker/RLS operational history, latest 200 location movements; identity, quantity, direction, user/time/reference/reason, no cost fields. |
| `guard_phase4_fabric_identity()` | Private trigger: permanent stock identity, new-model creator retained, internal Than labels/SP copies rejected, other users/closed entry drafts cannot alter new-model Thans. Authenticated new per-Than label creation rejected; old rows retained. |

Reuses Phase 2 `domain_stock_entry_cp` without changing its implementation: Owner
reads; Stock Entry reads/edits only its own draft/Owner-opened correcting workflow;
completed reads/writes denied; revision history is inaccessible to Stock Entry.

Three new triggers: `fabric_entry_request_immutable`, `phase4_stock_identity`,
`phase4_than_identity`. Replaced security-invoker `v_thaan_overview` preserves its
column contract while reading Phase 3 quantity/holds and both movement timestamps.
SP-optional internal Thans are not labeled incomplete. Legacy per-roll completion
criteria remain for historical rows. Existing dashboard sums therefore count new receipts.

PUBLIC/anon execution revoked for new APIs; authenticated execution granted with
independent active-role checks inside definer APIs. Private authorization/trigger
helpers remain sealed. Existing financial RLS/grants and role seeds unchanged.

## Application behavior

- Existing receiving route now uses Fabric, Batch, per-Than lengths, CP and one
  generated Fabric Barcode. Draft save/correction, Workshop completion and printing.
  Draft Than count is chosen at creation; editing existing lengths does not delete rows.
- Inventory defaults to Fabric Stock/scan tab. Historical barcode rows stay in the
  legacy/internal tab; new NULL-label rows are presented under their Fabric Stock.
- Counter screen includes the same Fabric Barcode scan/lookup, with authorized SP
  and availability only. Existing legacy sales remain separate; no new sales operation.
- Owner scans/revises SP, reads CP, or opens an explicit scoped CP correction.
  Session/cache protections from Phase 2 apply; successful completion clears local CP
  input and scoped CP query cache. Mutation settling refreshes server-authoritative data.
- Quantity input converts metres exactly to integer mm. Money accepts nonnegative
  values with at most two decimal places and safe integer paise; no silent rounding.
- Creation retries retain UUID for unchanged form payload within the mounted form.
  Backend verifies creator/payload. Reload does not retain retry UUID; use stock list
  to inspect uncertain submission before retrying. Completion is independently idempotent.
- Draft save and completion are separate transactions in the UI; a failed receipt
  leaves a valid saved draft/CP revision, with no partial inward ledger events.
- Local JsBarcode 3.12.3 (MIT) generates Code 128. Label contains Fabric identity,
  Batch and the barcode text/symbol, with quiet zones; no CP, SP or cost-bearing URLs.
  Print uses a dedicated frame containing only the label; no paid service or network
  barcode generator. Keyboard-wedge scanner plus manual input supported; no camera feature.

Library primary documentation: [JsBarcode](https://github.com/lindell/JsBarcode).

## Validation and limits

`scripts/phase4-fabric-test.mjs` replays both full 14-file migration paths and clean
no-demo database using disposable PGlite 0.5.8/PostgreSQL 18.3, Auth/storage shim,
actual authenticated role and JWT identities. 228 checks: preservation, optional SP,
variable Than lengths, exact Workshop quantity, no old/new double counting, retries,
late-row rollback, closed CP, ownership, private payload, CP/SP history, stable barcode,
Counter scan/CP denial, inactive/Tailor/anonymous denial and location aggregation.

`scripts/phase4-label-test.mjs`: 25 checks using actual UI barcode/money helpers.
Independent ZXing 0.23.0 Code 128 reader decodes short, new UUID and historical UUID
identifiers at three module scales; exact money validation exercised. Decoder installed
only in a temporary test runtime, not an app dependency.

Run:

```powershell
node --v8-pool-size=1 scripts/phase4-fabric-test.mjs "$env:TEMP/maqdooms-phase1-pglite/node_modules/@electric-sql/pglite/dist/index.js"
node scripts/phase4-label-test.mjs "$env:TEMP/maqdooms-phase4-barcode-verification/node_modules/@zxing/library/cjs/index.js"
node --v8-pool-size=1 scripts/phase2-security-test.mjs "$env:TEMP/maqdooms-phase1-pglite/node_modules/@electric-sql/pglite/dist/index.js" --include-phase4
node --v8-pool-size=1 scripts/phase3-ledger-test.mjs "$env:TEMP/maqdooms-phase1-pglite/node_modules/@electric-sql/pglite/dist/index.js" --include-phase4
```

164 Phase 2 security and 230 Phase 3 checks pass against the full Phase 4 schema;
278 bounded Phase 1 regression checks pass. TypeScript/lint pass (eight existing
Fast Refresh warnings); production build passed in isolated source copy, not deployed.

Live Supabase/PostgREST/Auth/browser sessions, physical scanner/printer output,
realtime and multi-connection races remain unverified. Single-connection tests verify
transactions and independent symbol decoding, not hardware or concurrent lock behavior.
Live location/identity/conflicting legacy CP/SP reconciliation remains explicit; no
automated legacy relabel/re-receive. Historical unlinked stock created after Phase 1
through old entry routes still needs documented reconciliation where present.

Phase 5 transfer refinements, Phase 6 location-aware sales and all later tailoring/
production/costing/reservation workflows are not implemented here. New stock's Fabric
Barcode is scan/price/availability enabled; legacy sale RPCs cannot consume it because
it has no roll barcode and its location ledger is authoritative. Old roll sales retain
old snapshots until their scheduled migration; Owner Fabric Stock SP edits deliberately
do not silently propagate into those historical legacy price fields.
