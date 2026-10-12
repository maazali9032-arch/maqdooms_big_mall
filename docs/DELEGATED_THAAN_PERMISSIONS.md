# Delegated Workshop Thaan access

For a Stock Entry user to complete or edit another person's Workshop Thaan, enable
**Edit Thaans registered by other staff** in Staff → Actions → Manage permissions.
The user's existing Receive stock, Edit thaan and measurement permissions still apply.
Already measured Workshop quantity corrections require Correct Workshop fabric balance.

CP stays separate:
- **View CP on Thaans registered by other staff** permits viewing their fabric CP.
- **Change CP on Thaans registered by other staff** also requires editing and CP-view
  access; prior CP values remain in history.

These actions have no staff defaults. No existing user's grants were changed by the
migration. Original registrants, barcodes and historical transactions remain permanent.

The popup reads defaults and current access from the database. Owner-only actions
show their restriction and cannot offer ineffective Allow selections. Stored older
ignored overrides are preserved and labelled as having no effect.

Applied migration: `20261013000000_delegated_thaan_permissions.sql`, identical mirror
`0037_delegated_thaan_permissions.sql`. Exact objects, SHA256 and actual verification
results are in the Implementation History and DELEGATED_THAAN verification JSON files.
Verification includes 444 disposable DB checks, 24 permission UI checks, 19 inventory
UI checks, 15 dedicated live checks, 423 live security checks and a production build.
No production fixtures, measurements or staff grants were written during validation.

## Current rule — 13 October 2026

The creator-specific controls described above are superseded by module/action access.
They are hidden; historical rows are retained. Stock staff use normal module permissions
for Owner-/peer-created records. See MODULE_ROLE_SCOPE.md and Master Plan Section 44.
