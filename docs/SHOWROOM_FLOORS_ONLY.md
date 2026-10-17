General Showroom is removed from current location lists, administration and new
stock movements. Staff select an Owner-defined Showroom floor. Workshop remains
available to roles whose existing permissions allow it. The internal Showroom
parent stays active so floor creation and parent validation keep working, and
old movements and references remain unchanged.

Forward migration 0052 / 20261015001000 filters the invoker/RLS location projection,
hides the internal parent from the Owner summary, rejects general Showroom in
the ledger for all movement kinds, and rejects it in Counter barcode scanning.
The Owner can return a finished piece directly from a floor to Workshop;
Stock Entry's existing Workshop-to-floor transfer restriction stays enforced.
The UI uses the physical-floor projection without requiring a visible parent.

Deployment requires general Showroom to contain no inventory or available
finished products. The cumulative rollout checks this inside its locked
transaction and verifies all pre-existing public rows and canonical permissions.
No stock is moved, no real definitions are deleted, and no history is rewritten.
The previously authorized transfer of the two Velvet Thaans to F3 remains intact.

Validation passed: 2,073 cumulative database assertions across clean/populated Supabase and Drizzle replay, 32 actual-component browser checks at 320/390/768/1440 widths, TypeScript, scoped ESLint and an isolated Vercel production build. Live rollout dry-run confirms the current canonical schema matches before migration.

Completed: 0052 applied with all rows in 97 existing public tables preserved. All 98 read-only live checks passed, including role-filtered location choices, the ledger guard, historical references and current floor totals. Deployment ad546c339b05bba4448ed6482f4d3f09555e7248 is successful and the updated production bundle was verified. Live summary checks use current ledger values so later sales remain reflected. Applied migration SHA256: 71f5d292c0572eef215696abb9d7dbff9da8aff105cfa0ef195b4cea23ea8a06.

## Current POS behavior

Stock transfers still require an explicit destination floor. Counter billing no
longer asks for one floor for the whole bill. The scanned item's current physical
floor is attached to its bill line, so a single invoice can safely include stock
from several floors. The internal Showroom parent remains hidden and cannot be
used as a sale source.
