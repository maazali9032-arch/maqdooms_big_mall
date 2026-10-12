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

The popup now displays database-enforced defaults and Current access, with explicit
Owner-only/role restrictions. Stored role defaults are a catalogue; they do not bypass
these checks. See DELEGATED_THAAN_PERMISSIONS.md for separate Owner grants allowing
Stock Entry users to edit, view CP or change CP on another registrant's Workshop stock.

Staff permissions now apply to all authorised records in their module regardless of
creator. The old cross-registrant exception controls are retired. View fabric CP and
Fill missing fabric CP use module wording; see MODULE_ROLE_SCOPE.md for the current rule.
