# Documentation map

## Use this first

[Current system reference](CURRENT_SYSTEM_REFERENCE.md) is the active operating reference as of **29 October 2026**. It consolidates the implemented workflow across stock, materials, transfers, factories, POS, GST, returns, suppliers, roles and reporting.

`supabase/migrations/` is the canonical database migration history. Confirm the migration ledger in the target environment before treating a repository feature as deployed there.

## Historical and focused documents

The remaining documents in this directory are retained because they record owner decisions, rollout constraints, test evidence, page-specific behaviour or a previous phase. A date in a title is intentional: it describes the document's point-in-time scope.

- `PHASE_*`, `LIVE_PHASE_*` and `LEGACY_*` documents are chronological rollout and decision records.
- `COUNTER_*`, `POS_*`, `PRODUCTION_*`, `STOCK_*`, `WORKSHOP_*` and `UNIFIED_*` documents describe focused workflows and implementation details.
- `LABEL_*`, `SIX_CHARACTER_BARCODES.md` and `SHORT_DOCUMENT_SCAN_CODES.md` document barcode and printer decisions; the current reference defines the active full barcode contract.
- `GST_*`, `ACCESS_*`, `ROLE_*`, `MODULE_*`, `WORKFLOW_*` and reporting documents preserve the relevant control and permission context.

When a historical note conflicts with the current system reference, follow the current system reference. Historical documents must not be rewritten to imply that their older rollout state is today's state.
