# Counter unified scan

Counter's sidebar and standalone page access consist of Counter / POS and Account. Owner, Tailor, Production and combined roles retain their respective workspaces. The Counter page uses one BarcodeEntry. The old bill-level Showroom floor selector and the manual New bill / Extra fabric / Find bill mode tabs are removed.

Exact item codes start or extend a sale. Customer bill or job codes load their recorded tailoring jobs and original receipt. More than one job requires explicit selection. Production IDs load the existing production document. A subsequent Thaan scan stages extra fabric against that loaded job from the scanned item's recorded physical floor. Posting uses permission-checked, idempotent additional-issue RPCs; the existing recorded-material cost handling remains authoritative.

The resolver reuses read-only RPCs, rejects unknown or conflicting identities and propagates authorization/load failures without guessing an operation. Scanning never posts stock. Finished pieces cannot become a sale while an issue document is selected. Pending retail rows are retained if another document is scanned. Closed jobs are read-only, and an uncertain issue freezes the scanner and document until the same request is retried.

The 17 October 2026 multi-floor contract allows one bill to contain items from different physical floors. Every bill line records and atomically debits its own source location. POS terminal assignment, advances and the customer-finished garment receipt are documented in `docs/POS_TERMINALS_MULTI_FLOOR_AND_CUSTOMER_FINISHING.md`.

Earlier verification covered one-field routing, multiple jobs, floor linkage, unchanged customer totals, excess quantities, closed jobs, ambiguous or unknown codes, stale scanned fabric, retry identity, mobile layout and preserved role access. The multi-floor transaction was subsequently verified with rollback coverage and live read-only checks.
