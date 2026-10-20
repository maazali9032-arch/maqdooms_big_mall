# GST centralization and operational-input audit

Date: 19 October 2026

## Scope and result

The Owner-only **Administration → GST Configuration** remains the sole source for legal identity, business GSTIN and state, effective dates, price mode, invoice presentation, HSN/SAC mappings, GST rates and category/item overrides. No operational screen owns a separate business registration, GST rate or HSN/SAC setting.

The audit removes duplicated tax-treatment choices from Counter/POS and Stock Entry. Migration `20261019000100_gst_operational_input_audit.sql` changes only the two transaction functions that enforce those choices. It is forward-only, has no data backfill and does not alter existing invoices, purchase documents or tax snapshots.

## Pages inspected

| Page or service | Result |
| --- | --- |
| Owner GST Configuration (`src/features/gst/GstConfigurationPage.tsx`) | Retained. It is the central effective-dated configuration and the correct home for business-level values. |
| Counter/POS (`src/features/pos/CounterWorkspace.tsx`) | Removed always-visible supply-type, customer GSTIN and customer state-code inputs. Ordinary retail bills derive intra-state treatment. **Add GST business invoice details** reveals only a customer GSTIN when needed; its first two digits and the effective registered state derive CGST/SGST or IGST. Payment method, customer identity, salesperson, advance/balance and printing remain. |
| Counter transaction service (`gst_snapshot_counter_bill`) | Retained and strengthened. It recalculates tax and derives supply server-side rather than trusting a browser dropdown. It preserves immutable invoice, business, customer and line snapshots. |
| Stock Entry (`src/features/inventory/StockRegistration.tsx`) | Replaced an always-visible purchase GST panel with **Supplier invoice available?**. **No** creates stock only. **Yes** reveals transaction-specific supplier invoice/ITC fields. Supplier GSTIN derives supply treatment. CP stays GST-exclusive. |
| Purchase transaction service (`create_barcode_batch_with_gst`) | Changed only to allow no GST purchase payload. With a payload it still snapshots calculated values and optional actual invoice values, reconciliation and ITC status. It never represents a calculated estimate as a supplier invoice. |
| Customer Tailoring and Owner Production | No direct GST configuration controls were found. They stay operational workflows; completed Counter bills receive invoice snapshots through the central service. |
| Billing and thermal receipt (`src/features/pos/CounterBillReceipt.tsx`) | Retained. It renders the saved tax snapshot, never today’s configuration. |
| GST reports (`src/features/gst/GstReport.tsx`) | Retained. It is Owner-only reconciliation of immutable invoices, purchases, ITC and append-only adjustments. |

## Legal/accounting points for CA confirmation

- The current rule requires a valid customer GSTIN when staff explicitly request a GST business invoice. Confirm the invoice/B2B treatment, threshold rules and any customer fields required by the business's CA.
- Supplier GSTIN is optional because Stock Entry permits an invoice whose GSTIN has not yet been captured. Confirm when ITC status should be moved from `pending` to `eligible`; the system does not claim it automatically.
- The current location model identifies Showroom floors but has no separate registration-state field. With one registered business state, floor location does not change GST jurisdiction. Add registered branch/state data before using the same database for separately registered branches.
- GST rates, HSN/SAC mappings, invoice wording and return figures remain subject to CA validation. The reports are reconciliation support, not filing software.

## Verification

20 October follow-up: prepared migration 0070 (`20261020000300_gst_option_consistency.sql`) supersedes the original estimate fallback for new purchase documents. Missing actual supplier GST produces zero recorded eligible/ineligible/reversed ITC and zero non-creditable adjustment; calculated GST remains a separate estimate. Purchase mode and its resulting adjustment are visible in reconciliation. No historical purchase values are rewritten. No-invoice stock entry uses the established non-GST batch API, avoiding the missing-argument schema-cache failure. See `docs/GST_CONFIGURATION.md` for the 16-combination disposable regression verification and pending rollout requirements.

- Supabase and Drizzle migration mirrors are byte-identical.
- `node --env-file=.env scripts/gst-operational-input-audit-test.mjs` applies the forward migration inside a transaction, verifies the revised function contracts, then rolls the transaction back.
- No migration was applied to the connected database and no production rows or settings were changed during this audit.
