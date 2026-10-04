# Phase 16 — UI / UX / Performance / Final Polish

Implemented and verified on 4 October 2026 (Asia/Calcutta). Master Plan Phase 16,
Sections 1–25, 27–32 and the verified Phase 15 history govern this work. The older
`SYSTEM_OPERATIONS_GUIDE.md` is a historical reference; its individual-roll barcode
and legacy pricing descriptions do not replace the Master Plan.

## Changes and decisions

- Dashboard now reads the existing checked Owner canonical overview RPC rather
  than seven legacy stock/sales/tailoring/e-commerce/audit queries. It shows current
  stock by location and unit, payment-confirmed direct Fabric/Finished Product
  sales for today's India date, exception counts and links to existing workflows.
  It does not mislabel legacy snapshots or issued material as canonical stock or
  actual consumption. Failed reads have retry feedback rather than zero totals.
- Counter and Tailoring use keyboard-accessible workflow tabs. Customer Tailoring,
  Owner Production, direct Fabric sales and physical Finished Product sales remain
  separate. Legacy screens remain available under explicitly labelled tabs.
  Workflow components mount only when first opened; visited components remain
  mounted and hidden when inactive, preserving carts, notes and pending retries.
  Owner-only cost/inventory tabs remain role-gated; database authorization is intact.
- Successful controlled mutations invalidate canonical overview/report queries
  centrally. Existing workflow-specific invalidation remains. Dashboard reads use
  a 30-second stale interval and explicit Refresh; no optimistic financial/stock
  rewrite is introduced.
- Sidebar marks the current page for assistive technology. A skip-to-workspace
  link and focusable main target improve keyboard navigation. Module search closes
  with Escape. The former inert notification bell is a working workspace refresh
  action with feedback; existing operation success/error notifications remain.
- Reports/Audit show at most eight summary columns and an expandable complete
  record, including nested evidence. This reduces wide repeated cells without
  discarding fields. Rows/columns are memoized; tables have sticky headers, an
  internally scrollable viewport and live loaded/total counts. Every matching row
  remains accessible through existing pagination. Clear Filters resets date,
  keyword and validation state; read errors have retry controls. Invalid date
  boundaries retain explicit validation. Stale failed overview data is not shown
  as successful current control totals.
- Barcode fields disable spellcheck/autocomplete and select existing text on
  focus for keyboard scanners/manual replacement. Enter-to-scan and the existing
  role-safe scan APIs are reused. Fabric scan has an Enter hint; physical Product
  scan explains scanning each piece. Transaction pending/retry freezes remain.
- Shared panels/cards permit shrinking on mobile. Dashboard hints wrap instead of
  truncating important information. Report and Direct Fabric Sale actions wrap;
  native controls are bounded to their container; hidden workflow panels remain
  hidden. Reduced-motion preferences are honored. Existing inventory tabs,
  receiving forms, dependent Factory/Section/Tailor filtering, empty/loading
  states and business validation are reused rather than rewritten.
- Isolated barcode print frames have an accessible-hidden frame, meaningful print
  title, crisp SVG rendering and page-break protection. Customer bill CSS supports
  small widths, print margins, repeated headers and unsplit lines; the safe customer
  projection still excludes CP/internal cost. General page printing hides workspace
  chrome/buttons/tab controls and retains panel titles. No barcode identity or
  price is encoded differently and no new paid scanner/print service is used.

## Files

New:

- `src/features/reports/OwnerDashboard.tsx`.
- `src/shared/components/workflow-tabs.tsx`, `query-state.tsx`.
- `src/app/providers/query-client.ts`.
- `scripts/phase16-ui-test.mjs` and disposable fixture files in
  `scripts/fixtures/phase16/` (`index.html`, `main.tsx`, `client.ts`, `session.tsx`).
- This document and Phase 16 verification JSON evidence.

Modified:

- `src/routes/_authenticated/dashboard.tsx`, `pos.tsx`, `tailoring.tsx`.
- `src/app/layouts/AppShell.tsx`, `src/router.tsx`,
  `src/shared/components/page.tsx`, `src/styles.css`.
- `src/features/reports/OwnerReports.tsx`.
- `src/features/pos/DirectFabricSale.tsx`, `FinishedProductSale.tsx`.
- `src/features/inventory/FabricStock.tsx`, `fabric-label.ts`.
- `src/features/tailoring/customer-tailoring-bill.ts`.
- Permanent Implementation History.

Pre-existing workspace edits were preserved. No commit, push or history rewrite.

## Database / security / verification

No database change is required: **no Phase 16 migration**, schema, columns,
relationships, constraints, indexes, functions/triggers, RLS/grants, seed/backfill
or live business data changes. Read-only Session Pooler checks verify the existing
cumulative Phase 15 catalog against the reference and all 30 migration hashes.
331 live read-only role/security/integrity checks pass; four prior legacy job
domain/assignment decisions remain unchanged. CP/cost protection remains at the
database layer. No fixture authenticates to or writes the live ERP.

All cumulative Phase 1–15/reconciliation tests pass again: 5,262 database assertions,
40 Fabric/Product Barcode/money assertions and nine report money/quantity/India
date checks. **24 new browser fixture checks** pass using headless Edge and the
actual React components with synthetic RPC reads: exact canonical amounts/units,
unvisited lazy mount, hidden/preserved drafts, one-time mount, bounded table/full
evidence, search/empty/clear states, invalid date feedback, failures/retry,
successful mutation invalidation, no document overflow at 320/390/768/1440px,
customer print CP exclusion, isolated label frame/title, Owner access loss and no
browser runtime errors. Total **5,335 local assertions**. Mobile/desktop fixture
screenshots were inspected; test controls are fixture-only and not shipped routes.

TypeScript noEmit, scoped ESLint and isolated production build pass. Full lint
retains the same 217 pre-existing formatting errors in four legacy scripts and
eight fast-refresh warnings; no new errors. Dashboard client chunk measured
3.42 kB (1.56 kB gzip), down from the Phase 15 build's 6.80 kB (2.17 kB gzip).
This is the route chunk, not total application transfer or a Core Web Vitals claim.
Existing >500 kB shared-chunk warning remains. No production latency/load benchmark
or broad dependency/configuration update was attempted.

Evidence: `PHASE16_VERIFICATION.json`, `PHASE16_UI_VERIFICATION.json`,
`PHASE16_LIVE_VERIFICATION.json`, `PHASE16_SECURITY_VERIFICATION.json`.

## Limitations / final boundary

Authenticated operational browser acceptance with real staff, scanner/printer
hardware, deployed-network/Core Web Vitals and concurrent-user acceptance remain
unverified. Browser checks use synthetic data; real transactions and populated
role protections are verified in disposable PostgreSQL. No real sale/receipt,
job edit, opening balance, cost/SP change, audit reconstruction or automatic legacy
reconciliation was performed live. Four existing Owner decisions remain. UI is
not deployed or pushed. Phase 16 is the last specified implementation phase;
stop here and await Owner acceptance/deployment instructions.
