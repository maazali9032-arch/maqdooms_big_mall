# Approved Owner Production workflow revision

Implemented and migrated live on 11 October 2026. Master Plan Section 36 records
Owner's subsequent decisions. No later phase is started.

## Operation

Owner Production begins with the material source and existing Thaan barcode scan.
Scan shows fabric, batch, permanent barcode and actual available metres by location.
Select the internal Thaan and enter the required total metres; select Product,
Design, piece count, Factory/Section and one or more Tailors. Job creation, shared
assignments and initial exact material issue are atomic. Required fabric is not
multiplied by piece count; unallocated stock remains available. Additional materials
use Material Issues and the same Production ID while the job is open/in-progress.

All selected Tailors share the job without mandatory personal piece allocations.
They can view its materials/genealogy and, with the existing manage-jobs permission,
progress the whole job. Sharing does not expose other jobs of the first Tailor.
Old primary assignment remains an internal compatibility anchor, not a new lead role.
Existing one-Tailor jobs remain readable without inserting guessed shared links.

Complete the job, then Owner confirms all pieces and actual material use in Finished
Products. Existing receipt remains one full batch of the planned job count; partial
receipts and a different actual count are not introduced. Each piece receives its
own permanent PRD barcode and one physical stock unit into Workshop. Issued fabric
is not deducted again at receipt. Unallocated issued material remains in history;
no automatic waste, return or stock correction is inferred.

Production Costing retains Owner-confirmed actual billed material quantities/rates,
production/tailoring charges, retained Design/Embroidery basis and named other costs.
The total is divided equally across actual received identical pieces. Exact paise
allocations sum to the total and differ by at most one paise. Owner manually prices
one or all available pieces; no automatic margin, CP-derived SP or repricing.

Stock Entry/Exit staff use Stock Transfer for both fabric and Finished Products.
Scan an individual Product Barcode, select its active destination Showroom floor,
enter a reason and post. The recorded source is loaded from that exact piece.
Each piece moves whole, immediately, in one Workshop-to-floor movement; no receipt
or floor-user approval. Frozen actor-bound request retries cannot move stock twice.
Owner's broader adjacent movement/return paths remain available. Staff cannot
transfer from Showroom/floors or move fractional/sold/unavailable products.

Owner controls `stock.transfer_finished` independently of `stock.transfer`.
The transfer route accepts either permission for the Stock Entry role and shows
only the permitted operational component. Original barcode reprinting uses existing
`stock.print_barcode`. Transfer projections and labels contain no CP/SP/costs.
Counter sale retains Owner SP, exact physical piece selection and Salesperson credit.

Owner Finished Products and POS product scan show planned, actual produced, sold,
remaining canonical stock and, if present, archived totals for that Production ID.
Remaining is actual available one-piece ledger stock, not planned minus sold.
All Tailor names appear in production history, material panels and piece genealogy.

## Migration/schema/security record

- Canonical: `supabase/migrations/20261011000300_owner_production_workflow.sql`.
- Byte-identical mirror: `drizzle/migrations/0033_owner_production_workflow.sql`;
  journal append index 33. Apply canonical chain only.
- SHA256: `4d3094ce572b83ae665f43d16a7d9705b00605e4f88dcbb54a2c00c215089902`.
- New `production_job_tailors`: composite PK (production_job_id,
  tailor_assignment_id), three FKs to Production Jobs, Tailor Assignments and
  Profiles (recorded_by), recorded_at default now; reverse assignment/job index
  `production_shared_assignment_idx`. No existing column/ID/relationship rewritten.
- BEFORE INSERT `production_shared_insert_guard` validates an open job and a current
  active Tailor in its same Factory/Section. BEFORE UPDATE/DELETE
  `production_shared_immutable` preserves participation history.
- RLS/read: Owner and assigned Tailor can SELECT new links; additional job, status
  event and material-issue policies permit assigned shared-job reads. Existing
  requirements/line policies inherit those job/issue reads. No financial policy
  widened. Raw browser/anonymous writes/TRUNCATE revoked; service_role retained.
- Six new functions: guard_production_shared_assignment, owns_production_job,
  production_tailor_names, production_piece_summary, create_owner_production_shared,
  finished_product_transfer_scan. Names/summary/trigger helpers are private. The
  boolean participation helper is authenticated-only for RLS; checked creation
  requires Owner, checked operational scan requires Owner or permitted Stock Entry.
- Eleven existing functions replaced only through this new migration:
  progress_owner_production, owner_production_history, finished_product_catalog,
  material_issue_jobs, material_issue_history, post_inventory_transfer,
  guard_finished_product_transfer_path, transfer_finished_products,
  finished_product_inventory, finished_product_movement_history,
  finished_product_sale_scan. Fixed public search paths and prior checked API grants
  are preserved; sharing uses a job-specific helper, never broadens owns_tailor_assignment.
- New permission and Stock Entry default grant for stock.transfer_finished; existing
  metadata auditing records these additions. No staff roles, individual overrides,
  stock, costs, SP, finished pieces or historical assignments changed by deployment.
- No backfill/seed/manual data operation. Both migration ledgers contain the new hash;
  34 versions total. Existing applied SQL files are untouched.

## Verification and limitations

222 new disposable PostgreSQL checks pass across canonical demo, mirror demo and
clean replay: old business rows retained, same-barcode 50m -> 25m allocation with
25m remainder, shared Tailor history/status/issue access, unrelated job isolation,
additional material linkage, insufficient-stock rollback of job/links/requests/
movements, one full Workshop receipt, permanent unique product identities, no
second fabric debit, actual costing/equal allocation, Owner SP, direct staff floor
transfer/retry, permission revocation/generic API bypass denial, attributed POS sale,
Owner production totals and CP/RLS/anonymous denials.

28 actual-component browser checks pass: keyboard fabric scan/availability,
exact Thaan allocation, two Tailor selection, frozen exact creation/transfer retry,
same-barcode reprint preview, direct floor selection, no receiving call, denied
staff permission, Owner totals/names and no browser errors. Production/transfer
screens fit 320/390/768/1440px. 12 new transfer navigation checks and 10 previous
Salesperson navigation checks pass.

All 18 historical DB suites pass at their original business migration boundaries
(5,493 checks). Full current-chain Salesperson integration passes 153 checks; earlier
transfer/pricing suite passes 132 checks; transfer UI 15 and Phase 16 UI 24 pass.
Historical proof files were preserved; current results use OWNER_PRODUCTION_WORKFLOW
names. Old applied migrations were never edited to adapt a test.

Live connection first verified the previous cumulative catalog. New migration was
applied in one transaction with bounded locks, old-column row fingerprints and
old metadata row-set preservation, then cumulative catalog comparison of columns,
constraints, indexes, functions, triggers, RLS, policies and grants. Baseline was
80 public tables / 455 rows. New join table adds no live business rows. Ledger
verification timestamp is 2026-10-11 09:05:34.939 UTC / 14:35:34.939 IST. A subsequent
read-only schema recheck confirms owner_production_workflow_verified=true.
419 cumulative live security checks, 33 dedicated read-only live checks and 12 actual
anonymous PostgREST discovery/denial checks pass. No live test job or stock movement
was posted. Physical scanner/printer, real concurrent sessions and live populated
shared-Tailor business transactions remain untested; populated behavior is isolated.

TypeScript noEmit, scoped lint (zero errors) and final Vercel-preset build pass;
patched TanStack server-core 1.169.39 retained. No package/configuration/environment,
commit, push or publication change. Publish compatible frontend to make these
controls visible. Four earlier legacy job-domain/assignment decisions remain.
