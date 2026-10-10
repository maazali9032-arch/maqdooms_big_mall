# Immediate stock transfer and Counter fabric pricing — 11 October 2026

Stock Entry → Stock Transfer → scan original barcode → select metres and Showroom
floor → Post Stock Transfer. Workshop is selected automatically for Stock Entry;
the all-available shortcut supports full transfers. Both location balances update
immediately. No receipt acknowledgement exists. Reprint the original Code128
barcode on each outgoing piece. Location quantities remain visible under that code.

For a 50 m Than, sending 10 m to each of three floors leaves 20 m in Workshop and
10 m on each floor. Transfers do not create another barcode, fabric or Than, and
cannot exceed the source quantity. Authorized staff can move another staff member's
Workshop fabric. Owner retains the prior broader transfer controls.

At Counter, scan the code, choose source location, enter rupees per metre and metres.
The line and bill totals calculate automatically and display paise. Price becomes
an immutable sale snapshot; it is not saved as a fixed stock price. Payment must
be confirmed before the existing atomic paid-sale workflow deducts stock. Counter
users can choose any floor; there are no user-to-floor assignments. Workshop and
other location balances remain visible for availability information.

Manage Access now includes Individual user permissions. Owner can choose allow,
deny or inherited role default for each existing action. New independent keys are
stock.transfer, stock.print_barcode, inventory.fill_missing_cp and pos.enter_price.
Roles still define eligible workflows; internal CP and administration remain
Owner-only. Staff refresh access to update displayed controls; the database checks
current permissions on every write. Owner accounts retain full access.

## Migration

Live migration: `20261011000100_stock_transfer_counter_pricing.sql`.
Identical mirror: `0031_stock_transfer_counter_pricing.sql`.
SHA256: `2e6e6db128443d4ad4ff17dfbb53e278a8192b0fe6d33d1d91997ec17860937d`.

No tables, columns, relationships, indexes, constraints or triggers were added or
changed. Four permission rows and four default role grants were inserted; existing
audit triggers appended eight records. Existing metadata rows were compared in
full and retained. Complete fingerprints of the other public tables match exactly.
The pre-apply baseline was 79 public tables / 425 rows; the migration added only
the sixteen permission/default/audit rows. No stock or financial backfill or manual
database change occurred. Both migration ledgers record the new hash/version.

Functions changed: post_inventory_transfer now checks authorized staff plus
Workshop → active Showroom-floor/fabric restrictions for non-Owner callers;
stock_transfer_history returns staff's own documents through a checked definer.
New complete_counter_fabric_sale validates explicit exact per-metre prices and
uses existing immutable orders, CP snapshots, ledger, audit and exact retries.
New owner_set_user_permission manages audited overrides. Existing CP-fill logic
was renamed registration_fill_cp_internal and revoked from browser roles; its
public wrapper additionally checks inventory.fill_missing_cp. Public APIs remain
authenticated-only; Owner checks and private helper revocation are explicit.
No RLS policy or raw mutation grant was broadened. No floor-assignment schema exists.

## Verification and limits

132 new database assertions pass across both demo migration chains and a clean
replay, plus 15 actual-component browser assertions at 320/390/768/1440 widths.
All 18 prior cumulative database suites pass again, including 231 Stock Entry
checks; prior navigation, barcode decoding and 16 Stock Entry browser checks pass.
TypeScript, scoped lint and Vercel-preset build pass. Evidence is in the separate
STOCK_TRANSFER_PRICING_* JSON files; prior verification evidence remains intact.

The live verifier was corrected to check the eighteen fixture authorities against
their immutable fixture manifest instead of counting all inventory as fixtures.
Two legitimate registered stock authorities already existed before this rollout.
It also checks explicit opening-adjustment or inward-receipt provenance, or an
explicitly documented zero fixture. All 389 live security checks and six live API
checks pass. Initial verification attempts stopped at the obsolete count and an
incorrect opening-kind assumption; no database data was adjusted for those checks.

No application push/deployment or live business fixture was performed. Actual
staff login, printer/scanner acceptance, large-history and multi-connection race
tests remain. Four earlier legacy Owner decisions remain. Finished Product fixed
pricing, Customer Tailoring costing and older compatibility sale APIs are unchanged.
