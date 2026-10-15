# Showroom floor visibility and Owner Delete — 15 October 2026

The two recorded Velvet transfers originally targeted the general Showroom root,
not a physical floor. No floor was captured. The Owner explicitly selected
Showroom F3 in this conversation. A new posted transfer now moves exactly 10 m
each of AND-90955888f and AND-90955888i from Showroom to Showroom F3. The original
transfer remains unchanged. Per-item total stock and recorded CP were verified
unchanged within the posting transaction. See SHOWROOM_F3_ASSIGNMENT.json.

Locations & Floors now includes general Showroom, every defined floor, and
Workshop, with direct-location Thaan/metre/finished-piece counts. General
Showroom is labelled “floor not assigned” in administration, stock history and
operational selectors. This annotation describes the root location and does not
invent a historical floor. General Showroom and Workshop remain permanent roots.

Owner-only Delete controls are available for floors, product types and designs.
Deletion requires a confirmation and server-side Owner authorization, rejects
stale values, and supports exact request retries. A nonempty floor cannot be
deleted. Definitions are disabled and removed from administration/work pickers;
their identity rows, earlier jobs, stock, cost versions and audit references are
retained. A separate immutable deletion record and audit event capture who
deleted what and when. Previously used products/designs can be removed from
future work without breaking historical jobs. Earlier management APIs cannot
reactivate deleted definitions. Inactive and deleted remain distinct states.

Forward 0051 / 20261015000900 adds the removal records and read projections. It
does not move stock or delete existing definitions during deployment. The F3
assignment above was a separate, explicitly authorized operational transfer.
No real test floor/product/design is deleted as part of verification.

Verification evidence is recorded in DEFINITION_REMOVAL_DATABASE_VERIFICATION,
DEFINITION_REMOVAL_UI_VERIFICATION, DEFINITION_REMOVAL_BUILD,
DEFINITION_REMOVAL_ROLLOUT and DEFINITION_REMOVAL_LIVE_VERIFICATION JSON files.
The database suite replays clean/populated Supabase and Drizzle schemas and
checks authorization, retries, stocked/root restrictions, deletion visibility,
reactivation protection and retained production/cost evidence. Browser fixtures
exercise Delete/Cancel/error flows, Owner-only access and 320/390/768/1440 layouts.

Completed: 0051 applied with all rows in 96 pre-existing public tables preserved. Verification passed 1,971 cumulative database assertions, 16 browser checks and 88 read-only live checks across 97 current tables. Live acceptance confirms F3 has two Thaans / 20 m and general Showroom has no unassigned Thaans. Normal concurrent profiles.last_login updates are excluded from read-only acceptance fingerprints; migration preservation checks include every column. TypeScript, scoped ESLint and isolated Vercel build passed.

Published source commit 5f551efb46a66325f1a52be0d37840597c3dfa49 passed Vercel deployment. The live site serves the updated location summary, unassigned-floor labels and shared Owner deletion controls. Deployment and published bundle evidence is recorded in DEFINITION_REMOVAL_DEPLOYMENT.json.
