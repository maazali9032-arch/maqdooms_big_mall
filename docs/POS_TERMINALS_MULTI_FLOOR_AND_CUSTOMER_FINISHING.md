# POS terminals, multi-floor billing and customer finishing

This is the current operational contract from 17 October 2026. It supersedes earlier POS instructions that required a Counter user to choose one Showroom floor before scanning.

## POS terminal administration

- The Owner manages POS terminal IDs in **Administration → Users & Permissions**.
- A terminal ID is an editable business code such as `F3-POS1`; it is separate from the staff account.
- A Counter user is assigned one active terminal from the Owner-managed terminal pool. Assigning the Counter role exposes the assignment control for that user.
- Owners do not receive a POS terminal ID merely because they can open the POS.
- Completed bills store the terminal ID used for the sale. Owner sales evidence and receipts can therefore identify which POS completed the transaction.
- The current live assignments are `counter@example.com` → `F3-POS1` and `maaz7do@gmail.com` → `F3-POS2`.

## One bill across all Showroom floors

The POS has no bill-level floor selector. A Counter user can scan saleable stock from any active physical Showroom floor into one customer bill.

Each scanned line retains its own `source_location_id`. The database validates and locks that exact floor balance and debits all bill lines atomically. A bill may therefore contain an F1 fabric, an F2 fabric and an F3 finished piece while remaining one invoice. If a barcode cannot identify one current source unambiguously, the UI requires an exact stock selection instead of guessing.

Receipts and Owner sales evidence retain the source floor per item and the POS terminal ID for the transaction. Extra fabric added to an existing tailoring job also uses the source recorded for the scanned stock item.

## Showroom hierarchy

`Showroom` remains an internal parent location so floors and historical records keep valid relationships. It is hidden from operational location choices and dashboard stock cards. Only active physical floors such as `Showroom F1`, `Showroom F2` and `Showroom F3` appear as current Showroom stock.

## Customer bill, advance and balance

The customer invoice can combine ordinary fabric, finished products and tailoring. Fabric pricing remains per metre and a tailoring group's stitching charge is added once.

Counter enters the amount paid as the advance. The system calculates the remaining balance from the final bill total. Payment events are appended to the recorded bill; earlier payment evidence is not overwritten. The customer receipt includes prices, paid amount and balance.

## Tailor work order

The same sale can print a second document for the tailor. It contains the job, product or garment, design, size, selected fabric and custom notes needed for production. It excludes selling prices, advance, balance and other customer payment details.

## Receiving the customer's stitched garment

When the customer's stitched garment returns to Workshop, staff scan the customer bill or tailoring job. If one bill has multiple tailoring jobs, the exact job must be selected. Before receipt, staff enter the finished item name, size and selling price.

Receipt generates a new short unique barcode for that finished customer garment and marks the job ready. The barcode belongs only to the stitched garment. Fabric that the customer bought on the same invoice is not converted into store-owned finished stock. Repeating the same receipt request reopens the recorded result instead of creating another garment.

This customer flow is separate from Owner production. Owner production still receives store-owned finished pieces through the Production ID workflow.

## Barcode printing

The label setup supports one-column thermal rolls, two-column thermal rolls and configurable sheet layouts. The application controls label dimensions, gaps, columns, rows and paper dimensions; the printer driver must use the matching media size, no browser margins and 100% scale. A physical test print is required whenever the roll or driver stock definition changes.

## Dashboard cleanup

- The empty internal Showroom parent is excluded from stock-by-location.
- The dashboard hides the legacy-only `Unresolved Legacy` and `Unreconciled Thaans` controls; their report data remains available for audit.
- Duplicate lower Counter and e-commerce sales cards were removed. The top sales KPIs and detailed sales breakdown remain authoritative.

## Database versions and verification

The current contract is implemented by Supabase migrations `20261016000100` through `20261016000400`, `20261017000100` and `20261017000200`, mirrored by Drizzle migrations `0057` through `0062`. These migrations add terminal administration and assignment, advances, price-free tailor work orders, customer-finished garment receipt and atomic multi-floor Counter billing.

The migrations were applied to the live database. Read-only live checks, transactional rollback checks, TypeScript, scoped ESLint and the production build passed. Physical printer alignment remains a device and media acceptance step.
