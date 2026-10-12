# Module-based access

Staff access follows roles and permitted actions, regardless of who created a record.
Owner has all modules and administration without requiring extra staff roles.

Stock Entry staff can see and complete authorised Owner/peer-created stock, extend
batches, see transfer history and view fabric CP. Missing CP, measurement, stock
metadata edits, completed CP correction and Workshop quantity correction remain
separate actions. Existing per-user denies still apply across all records.

E-commerce staff can work with authorised listings/online orders created by the
Owner or another E-commerce user. Stock/POS/Tailor/Salesperson do not receive these
E-commerce workflows from their own roles. POS and E-commerce retain necessary
read-only stock availability, without internal CP or stock-edit rights.

Tailor job assignment and Salesperson attribution still determine assigned work;
they are independent of who created the business record. Creator IDs and actors
remain in audit history. Exact request retries stay actor-bound for accountability.

Creator-specific permissions introduced previously are superseded and hidden in the
Owner UI. Their historical rows are preserved. Use **View fabric CP**, **Fill missing
fabric CP**, **Edit thaan** and normal correction permissions instead.

Applied migration: `20261013000100_module_role_scope.sql`, identical mirror
`0038_module_role_scope.sql`. No tables/columns or actual user grants changed.
567 disposable DB checks, 26 permission UI checks, 36 inventory UI checks, 42 sidebar
checks, 27 dedicated live checks, 424 live security checks and production build pass.
See MODULE_ROLE_SCOPE verification JSON files and the Implementation History for
exact objects, migration hash, live preservation results and limitations.
