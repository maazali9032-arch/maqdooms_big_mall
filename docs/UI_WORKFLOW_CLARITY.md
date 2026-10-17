# UI workflow clarity

Implemented on 17 October 2026 to make the existing inventory, POS administration,
finished-receipt and salesperson workflows easier to operate without changing their
business ownership.

## Operational changes

- **Showroom floors:** each floor expands in place to show the current positive Thaan
  balances, barcode, fabric, batch, colour and available metres. Empty floors still
  show an empty state. The result is sourced from the inventory ledger through
  `showroom_floor_distribution()`; it is not a separate stock calculation.
- **Finished Products:** customer stitching receipt and shop-production receipt share
  one **Receive finished garments** panel. Users authorized for both choose the receipt
  type; users authorized for one workflow enter that workflow directly.
- **POS terminal administration:** POS creation and customer stitched-item receipt keep
  the Supabase RPC method bound to its client. This fixes the browser error
  `Cannot read properties of undefined (reading 'rest')` without weakening database
  authorization.
- **People selectors:** business screens show staff names rather than authentication
  UUIDs. Immutable user IDs remain in database records and audit evidence.
- **Salesperson Work:** filters, bill totals, metres, payment state, salesperson, POS
  operator, source location, items and tailoring progress are displayed as structured
  bill cards. The database result now includes the POS operator's display name while
  retaining its ID.
- **Account information:** unit/storage conventions and integration status are retained
  in one compact, collapsed system-information block.

## Reporting navigation decision

No reporting destination was removed in this change.

- **Reports & Analytics** remains the Owner's historical and aggregate analysis area.
  It answers period and reconciliation questions that the current-state dashboard does
  not.
- **Audit Trail** remains the immutable evidence view for who changed operational data,
  which is required for investigation and accountability.
- **Sales History** is a direct entry to the order-history section of Reports. It is the
  only genuinely redundant sidebar link because it points to `/reports#orders`; a later
  approved navigation cleanup may remove that link while preserving the history section.
- **Salesperson Work** remains the per-person attribution view and does not replace
  financial reporting or the audit trail.

## Database and rollout

Supabase migration `20261017000300_ui_workflow_clarity.sql` and byte-identical Drizzle
mirror `0063_ui_workflow_clarity.sql` replace two existing read functions only. The
migration changes no business rows, tables, stock movements or recorded identities.
Anonymous execution is revoked and authenticated execution remains guarded inside each
function.

The focused rollout script `scripts/ui-workflow-clarity-rollout.mjs` performs a
transactional dry run by default, verifies both function bodies and grants, applies only
with `--apply`, and records the exact migration hash in the existing private execution
ledger.
