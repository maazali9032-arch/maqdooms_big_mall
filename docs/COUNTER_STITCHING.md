Counter tailoring now adds the entire job's stitching charge to its selected
fabric sale prices. Fabric remains priced per metre; finished products retain
their saved fixed SP. The Owner-approved example is 5 m × ₹100 = ₹500, and
4 m × ₹100 + ₹300 stitching = ₹700. The bill totals ₹1,200 and prints those
two combined main lines. A job containing multiple selected fabrics adds the
stitching charge once.

The draft total responds immediately to stitching input. Selected tailoring
must have its garment, delivery date, assignment, fabric quantities/prices and
stitching charge added as a job before completing the bill. Completion is
disabled while the form is pending, with an explanatory message. Editing a
job retains its charge; editing a grouped fabric price updates its bill line.
Paid/unpaid customer tailoring and required Salesperson attribution remain.

Forward 0054 / 20261015001200 computes the combined amount on the server from
exact integer millimetres, per-metre paise and a separate stitching_paise.
It records the original fabric SP and rounded line amounts in immutable,
permission-protected evidence, and snapshots fabric/stitching amounts into
the existing read-only receipt. The existing transaction, stock locking,
CP capture, payments, idempotent retry and access controls are retained.
Later extra fabric updates the original job's CP/margin without changing its
customer amount. Reports count the combined revenue once.

Existing saved bills and print records are never recalculated. Old missing
fabric/stitching breakdowns remain unknown. Exact saved requests still retry
unchanged; new requests from an outdated screen using the old ambiguous
whole-price payload are rejected with a refresh message. Refresh an already
open POS screen after deployment to use the new contract.

Verification passed: 2,280 cumulative database assertions across clean and
populated Supabase/Drizzle replay; 27 focused browser checks including the exact
₹1,200 example, saved/printed ₹500 and ₹700 lines, pending-form protection,
editing and 320/390/768/1440px layouts. Existing workflow, unified scanner and
barcode detail browser regressions passed 27, 28 and 18 checks respectively.
Database cases cover historical retries/receipts, additional-issue CP, exact
rounding, multi-fabric jobs, rejected inputs with full rollback, and permissions.
Browser/SQL fixtures are disposable; no live operational fixtures are created.
Physical-printer output has not been tested; the print document source is checked.

TypeScript, scoped ESLint and the isolated Vercel production build pass. The
live-schema dry-run matches the canonical current database before rollout.
