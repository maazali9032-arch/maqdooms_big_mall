# Staff permissions

In Users & Permissions, the Assigned roles checkboxes choose each staff member's
normal access. Open that person's Actions menu → Manage permissions to make a
personal exception.

The popup shows their name, email and roles. Search by action/module or browse the
module groups. Use role default follows their roles; Allow/Deny applies only to
that person. Each change saves automatically. Done closes the popup after saving.
Owners retain full control; protected-data and role-eligibility restrictions apply.
Staff should refresh access after the Owner changes it.

No database migration or live permission changes were made for this UI revision.
Verification uses the actual page, hooks and popup with synthetic transport: 22
passing browser checks, no runtime errors, responsive screenshots, TypeScript,
scoped lint and isolated Vercel-preset production build.

Evidence: ACCESS_PERMISSIONS_UI_VERIFICATION.json and
ACCESS_PERMISSIONS_BUILD_VERIFICATION.json. The build proof confirms a local
build only, not hosting deployment.
