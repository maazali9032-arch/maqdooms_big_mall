The compact POS stock summary uses only the selected physical Thaan's current
location balances. It no longer sums sibling variants. Showroom combines the
same Thaan's Showroom floors, Workshop shows only that Thaan's Workshop balance,
and the existing variant count and expanded batch/type/variant tree are retained.
Choosing one physical cut from a shared old barcode also keeps the summary
scoped to that selected cut. The selected-floor Available quantity is unchanged.

Salesperson options display recorded names without appending database UUIDs.
The original account UUID remains the option value submitted for attribution.
Contact entry strips nondigits, requests a numeric keyboard and preserves
leading zeros; the optional field has no new arbitrary length restriction.

Forward 0053 / 20261015001100 adds a prospective INSERT guard on Counter bill
payloads. New nonempty contacts must contain ASCII digits only. A rejected bill
rolls back its customer, stock, costs and audit together. Existing contact data,
printed receipts and exact historical bill retries remain intact. No existing
record is normalized or rewritten during migration.

Validation includes the user's exact 9 m Showroom / 0 m Workshop / 10-variant
example, a second variant with a different balance, the unchanged expanded tree,
name-only Salesperson text with original account attribution, typed/pasted
contact input and mobile widths. Database replay covers legacy retries,
optional/numeric contacts, leading zeros, saved-contact reuse, rejected input,
full rollback and permissions.

Validation passed: 2,148 cumulative database assertions across clean/populated Supabase and Drizzle replay; 18 focused detail browser checks; 28 unified-scanner and 27 combined-workflow regression checks; TypeScript, scoped ESLint and isolated Vercel production build. Live schema dry-run matches the canonical existing schema.
