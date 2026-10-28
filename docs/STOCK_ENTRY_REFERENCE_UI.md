# Stock Entry reference layout — 12 October 2026

> **Current implementation note (29 October 2026):** This reference captures the early fabric receiving UI. It is superseded for active operations by [the current system reference](CURRENT_SYSTEM_REFERENCE.md), which covers the unified three-type receiving flow.

Owner-approved presentation update based on the latest screenshot. Implemented
locally; that original frontend-publication note is now historical.

- Compact batch information row on wide screens, stacked fields on mobile.
- One optional-entry notice explains when actual stock becomes available.
- Separate white fabric cards with heading/icon, Remove action, picker and count.
- Expandable individual Thaan rows show barcode status, colour, length, optional
  CP per metre and a remove action. Desktop headings align with their fields;
  mobile retains explicit labels. Large groups scroll within a bounded region.
- Removing a draft Thaan updates its fabric count and preserves other rows' values.
  At least one Thaan per fabric remains. These controls exist only before generation;
  no generated barcode, historical record or stock is deleted.
- Full-width Add Another Fabric Type action, compact summary and prominent
  Cancel / Generate All Barcodes footer. Saved supplier suggestions, permanent
  batch numbering, optional values, permissions and frozen retries are retained.

The screenshot's Bill/Invoice No. is not added in this UI-only change. The form uses
its existing persisted batch fields; no unsaved invoice field is presented. CP still
means per metre, and example placeholder values do not create measurements/costs.
Sidebar, search and account controls retain their existing behaviour.

No database, migration, configuration, pricing or permission changes. No live writes.

37 actual-component browser checks pass, including draft row removal/count/value
retention, collapse state, scanner completion, grouped printing, exact retries and
320/390/768/1440 responsiveness. Desktop/mobile captures were inspected. TypeScript,
scoped ESLint, whitespace checks and Vercel-preset build pass.

Proof: `STOCK_ENTRY_REFERENCE_UI_VERIFICATION.json`,
`STOCK_ENTRY_REFERENCE_BUILD_VERIFICATION.json`,
`STOCK_ENTRY_REFERENCE_DESKTOP.png` and `STOCK_ENTRY_REFERENCE_MOBILE.png`.

No commit, push or deployment performed. Physical staff acceptance remains.
