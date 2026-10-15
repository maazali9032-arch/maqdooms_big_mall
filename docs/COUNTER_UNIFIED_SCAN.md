Counter's sidebar and standalone page access now consist of Counter / POS and
Account. Owner, Tailor, Production and combined roles retain their respective
workspaces. The Counter page uses its existing BarcodeEntry once after a
physical Showroom floor is selected; the manual New bill / Extra fabric / Find
bill mode tabs are removed.

Exact item codes start a sale. Customer bill or job codes load their recorded
tailoring jobs and original receipt. More than one job requires explicit
selection. Production IDs load the existing production document. A subsequent
Thaan scan stages extra fabric against that loaded job from the chosen floor.
Posting uses the existing permission-checked, idempotent additional-issue RPCs;
customer price and printed bill contents are unchanged, while the existing
recorded-material cost handling remains authoritative.

The resolver reuses existing read-only RPCs, rejects unknown or conflicting
identities, and propagates authorization/load failures without guessing an
operation. Scanning never posts stock. Finished pieces cannot become a sale
while an issue document is selected. Pending retail rows are retained if another
document is scanned. Closed jobs are read-only, and an uncertain issue freezes
the scanner, floor and document until the same request is retried.

No new database migration, permission grant or production data change is needed.
Validation covers one-field routing, multiple jobs, floor linkage, unchanged
customer totals, excess quantities, closed jobs, ambiguous/unknown codes,
stale scanned fabric, retry identity, mobile layout and preserved role access.

Verification passed: 28 unified-scanner browser checks, 27 combined workflow browser checks, 35 role-workspace browser checks, 14 read-only live acceptance checks, TypeScript, scoped ESLint and an isolated Vercel build. No real bills, issues or stock fixtures were posted during validation.
