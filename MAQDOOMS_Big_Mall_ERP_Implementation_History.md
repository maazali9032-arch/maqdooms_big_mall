# MAQDOOM'S BIG MALL — ERP Implementation History

This is the permanent chronological record of work actually completed. The root `MAQDOOMS_Big_Mall_ERP_Implementation_Master_Plan.md` is the complete ERP source of truth. The operations guide describes the previous system; where they disagree, the master plan governs future work.

## Permanent recording and migration rules

- Append a dated entry for every future phase. Record phase, objective, files changed, database changes, migrations, business and technical decisions, permissions/RLS changes, tests, verification, limitations, and anything intentionally not changed. Distinguish implementation from proposals and verified results from assumptions.
- All future database changes MUST use new version-controlled repository migration files. Never perform undocumented manual database changes. Never delete, rewrite, or silently modify an already-applied migration. Record each new migration's filename, purpose, affected tables/schema, RLS, functions, indexes, and verification results here.
- Preserve existing applied migrations and historical data. Resolve discrepancies with subsequent migrations, not rewritten history. Preserve Lovable published Git history; do not force push or rewrite pushed commits.
- Follow master-plan Section 30 and report using Section 31. Work sequentially through Phases 0–16. The entry below authorizes no later phase.

## 2026-10-03 — PHASE 0 — Existing Codebase Audit + Freeze

### Objective, authority and scope

Audit the existing working repository against the complete master plan and freeze implementation at the Phase 0 boundary. **No implementation changes were made.** No application code, schema, migration, seed, configuration, or production data was changed. The only project file created by this audit is this history document. No migrations were run; no commits, pushes, deployment, database writes, login/bootstrap calls, or business transactions were performed.

The requested `systems_operations_guide.md` does not exist under that name. The actual root file is `SYSTEM_OPERATIONS_GUIDE.md` (singular SYSTEM), whose status reference is 27 September 2026. It was located and read; the master plan was read in full before auditing. The guide is evidence of previous behavior, not approval to retain business rules contradicted by the master plan.

Audit baseline: branch `main`, HEAD `821d4e6fae22830ed0795ccdc1ad3ab0c2550725`. The working tree was already dirty. Audit conclusions apply to the current working files, including those existing edits, rather than HEAD alone. SHA-256 fingerprints were captured for 178 existing tracked/nonignored untracked files before validation. Final freeze verification is recorded below.

Existing changes preserved:

```text
package-lock.json
package.json
src/app/layouts/AppShell.tsx
src/components/ui/button.tsx
src/components/ui/card.tsx
src/components/ui/checkbox.tsx
src/components/ui/dialog.tsx
src/components/ui/input.tsx
src/components/ui/select.tsx
src/components/ui/sheet.tsx
src/components/ui/table.tsx
src/components/ui/tabs.tsx
src/components/ui/textarea.tsx
src/routes/_authenticated/access.tsx
src/routes/_authenticated/inventory.index.tsx
src/routes/_authenticated/pos.tsx
src/routes/_authenticated/tailoring.tsx
src/routes/_authenticated/whatsapp.tsx
src/routes/auth.tsx
src/shared/components/page.tsx
src/styles.css
Untracked: MAQDOOMS_Big_Mall_ERP_Implementation_Master_Plan.md
```

### Inspection coverage and limits

Reviewed root instructions, package/build/type/lint configuration, operations guide, all ten ordered Supabase SQL migrations and their Drizzle mirrors/journal, the empty Drizzle schema, Supabase generated types and client/auth integration, router/generated route inventory, shared role-module guards, session provider, inventory/receiving/editor queries and screens, POS, customers, tailoring, materials, access management, reports/dashboard, audit, e-commerce/listing/holds, WhatsApp previews and Settings. Domain evidence is the cumulative migration chain, not the permissive original schema viewed in isolation.

The repository is React 19/TypeScript with TanStack Start/Router/Query, Vite/Tailwind, and Supabase Auth/Postgres/RLS. Domain mutations primarily call security-definer PostgreSQL RPCs or direct PostgREST writes; there is no separate ERP API implementing the missing domains. Lengths use integer mm and money integer paise.

**Live database state was not inspected or changed.** No applied-migration ledger, deployed grants/policies/functions, production records, Auth configuration, real role sessions, or browser workflows were verified. Repository SQL and documentation do not prove the deployed database matches them. No secrets were printed. `supabase/config.toml` identifies the linked project but is not evidence that migrations were applied. Future verification must distinguish repository replay from deployed-schema reconciliation.

### Classification key

Every feature/scope in the following register has exactly one classification:

- **ALREADY CORRECT**: the specific inspected behavior agrees with the plan; preserve it. This denotes source-level evidence, not a live acceptance-test pass.
- **NEEDS MODIFICATION**: useful existing functionality is incomplete or needs adaptation/hardening.
- **MISSING**: no implementation of that required capability was found.
- **CONFLICTING**: existing behavior directly contradicts a confirmed business/security requirement.
- **DEPRECATED**: a legacy representation/instruction is superseded for future use; historical records/files must still be preserved.

Subfeatures are separated where their classifications differ. A correct building block does not make its whole module compliant.

### Feature classification register

| ID | Feature/scope | Classification | Evidence and finding |
| --- | --- | --- | --- |
| A01 | Existing React/TanStack/Supabase architecture and feature separation | ALREADY CORRECT | `package.json`, `src/router.tsx`, `src/features/`; reusable platform, no requirement to rewrite it. |
| A02 | Integer mm/paise conversions and rounded sale line calculation | ALREADY CORRECT | `src/shared/utils/units.ts`, `complete_fabric_sale`; matches units without inventing yards or a new currency model. |
| A03 | Email/password and Google staff authentication | ALREADY CORRECT | `src/routes/auth.tsx`, Supabase/Lovable integration; authentication is present. Provider settings remain unverified. |
| A04 | Shared role navigation, authenticated route guard and receiving action guard | ALREADY CORRECT | `src/app/access/modules.ts`, `_authenticated/route.tsx`, AppShell; server data authorization is separate from UI navigation. |
| A05 | Owner, Stock Entry, Counter and Tailor role foundations | ALREADY CORRECT | Core role seeds and role labels; all four required roles already exist, and no Factory login role is created. |
| A06 | Active staff permission enforcement and client rechecks | NEEDS MODIFICATION | `has_perm`, `has_role`, session focus/60-second/Realtime checks exist, but assigned-job self-read clauses lack active-staff checks and some helpers bypass scoped reads; see security findings. |
| A07 | Multiple roles, permission overrides and effective permission bootstrap | NEEDS MODIFICATION | `role_permissions`, `user_permission_overrides`, `bootstrap_current_user`; reconcile union/override semantics with strict Owner-only finance and workflow-limited Stock Entry CP. |
| A08 | Owner role assignment and staff enable/disable UI | ALREADY CORRECT | Access screen and `src/features/access/index.ts`; present Owner management foundation. |
| A09 | Last active Owner protection | ALREADY CORRECT | September 26 hardening/completion triggers use advisory locks; preserve DB invariant and UI checks. |
| A10 | First-login role bootstrap and sign-up lifecycle | NEEDS MODIFICATION | New login automatically receives Counter and first bootstrap can become Owner; bootstrap has no serialization around initial Owner creation. Plan does not specify onboarding policy; do not silently invent one. |
| A11 | Browser query cache/session boundary | NEEDS MODIFICATION | Shared QueryClient, non-user-scoped query keys, session provider does not clear domain cache on logout/role change; verify/restrict stale protected-data display across account changes. |
| A12 | Separate cost storage and restricted cost snapshot columns | ALREADY CORRECT | `thaan_costs`, restricted SELECT grants on `stock_movements`, `tailoring_job_lines`, `materials`; useful backend financial separation, not only UI hiding. |
| A13 | Default Counter/Tailor CP retrieval restrictions | ALREADY CORRECT | Default roles lack `inventory.view_cost`/`tailoring.view_costs`; cost RPCs gate results and direct snapshot columns are revoked. This is source inspection only, subject to overrides and deployed state. |
| A14 | Stock Entry ongoing CP reads/history and unrestricted receiving-cost writes | CONFLICTING | Stock Entry inherits `inventory.view_cost`; cost read/write policies have no workflow/completion scope. `FOR ALL` cost-write policy also contributes SELECT access for `inventory.receive`. |
| A15 | Stock Entry SP editing/control | CONFLICTING | Receiving bulk/editor writes `thaans.price_paise`; DB edit policy permits any `inventory.edit_thaan` holder. Plan reserves SP control to Owner. |
| A16 | Owner SP management after complete stock entry | MISSING | No dedicated Owner scan/set-SP operation; incomplete correction rejects already-complete active rolls. Generic patch capability is not the required Owner pricing workflow/history. |
| I01 | Fabric and supplier catalogues, receiving batch records | NEEDS MODIFICATION | Existing `fabrics`, `suppliers`, `receiving_batches`, pick-or-type helpers are reusable; require mandatory fabric identity and Fabric + Batch stock identity semantics. Current batch is a receiving session potentially spanning fabrics. |
| I02 | Individual physical Than rows and variable original lengths | ALREADY CORRECT | `thaans.original_mm`, fabric/batch links; preserve physical row history internally. Its public barcode mapping is assessed separately. |
| I03 | Public unique barcode per physical roll | CONFLICTING | `thaans.barcode text unique not null`, receiving “One scan = one physical roll,” POS `lookupThaan`; same Fabric + Batch can have many TH barcodes. Required public identity is one Fabric + Batch barcode. |
| I04 | Fabric + Batch stock identity and aggregate barcode lookup | MISSING | No `fabric_stock`/equivalent identity table or unique Fabric + Batch barcode. Grouping reports by fabric name does not implement it. |
| I05 | Barcode as stable identifier without embedded prices | ALREADY CORRECT | Barcode text is independent of mutable CP/SP/length; no separate CP/SP barcodes exist. Preserve this principle while changing identity mapping. |
| I06 | Keyboard scanner/manual Enter input | NEEDS MODIFICATION | Receiving and POS inputs/refocus work on roll barcodes; adapt to Fabric Barcode identity and authorized aggregate/Than allocation behavior. No allocation rule is chosen during audit. |
| I07 | Fabric ID/barcode generation, Code 128 rendering and label printing | MISSING | Existing helpers generate fabric codes/batch codes, but raw roll barcode is entered/scanned externally. No barcode encoder/library or label/print workflow found. |
| I08 | Receiving activation requires SP and treats CP/fabric as optional | CONFLICTING | `commit_receiving_batch`, `correct_incomplete_thaan`, `v_thaan_overview`, `incompleteReasons`; length + SP determines completeness, contradicting CP entry and SP-later stock workflow. |
| I09 | Draft receiving, bulk edits and incomplete correction | NEEDS MODIFICATION | Preserve draft/commit/correction concepts and locked idempotent INWARD activation; change completeness, ownership, atomic editing and workflow scope. Bulk patch is not an atomic CP/stock/audit operation. |
| I10 | Fabric ledger balance derivation | ALREADY CORRECT | `SUM(stock_movements.delta_mm)`, overview/movement queries; not a destructively overwritten remaining length. |
| I11 | Atomic sale/multi-cut deduction and stock row locks | ALREADY CORRECT | `cut_thaan`, `complete_fabric_sale`, `issue_tailoring_fabrics` validate availability and perform transactional writes; multi-item operations order locks and roll back failures. Extend these patterns. |
| I12 | Inventory ledger schema and movement dimensions | NEEDS MODIFICATION | Ledger is Than-only, `delta_mm`; no source/destination/location/unit/general material/product linkage. Kind CHECK supports INWARD/SALE/TAILORING/RETURN/WASTAGE/ADJUSTMENT but not TRANSFER/MATERIAL_ISSUE/PRODUCTION. |
| I13 | Workshop, Showroom and dynamic Showroom sublocations | MISSING | Only free-text `thaans.rack`; no location hierarchy or inventory balances by location. A rack is not Workshop/Showroom stock. |
| I14 | Stock Transfers and transactional location balances | MISSING | No transfer tables/RPC/screens, from/to locations, paired ledger records or over-transfer validation. |
| I15 | Explicit adjustment/return/wastage ledger operations | NEEDS MODIFICATION | Owner `adjust_thaan` prevents negative ledger balance but needs event-linked material/job/location traceability, reason/quantity invariants and role refinement. |
| I16 | No automatic wastage | ALREADY CORRECT | Sale/tailoring RPCs deduct requested quantity only. WASTAGE is an explicit adjustment option; seed example has a damage reason, not automatic percentage deduction. |
| I17 | Depleted stock/history retained | ALREADY CORRECT | Depletion changes status; sale/issue operations do not hard-delete Thaans. |
| I18 | Constraints and concurrency coverage outside sale/cut | NEEDS MODIFICATION | Missing positive/nonnegative length/price/cost constraints; receiving/correction checks completeness by NULL only. `place_hold` lacks matching stock row lock; generic edits can change active stock metadata outside controlled ledger corrections. |
| S01 | Direct Fabric Sale uses database SP | ALREADY CORRECT | `complete_fabric_sale` calculates from current `thaans.price_paise`, never accepts browser cost/price as authority; keeps CP out of result. |
| S02 | Direct-sale workflow and source-location deduction | NEEDS MODIFICATION | Existing staged multi-fabric bill/customer/receipt is reusable; roll lookup and global balance must become Fabric Barcode and correct source-location stock. |
| S03 | Sale price/cost snapshots | ALREADY CORRECT | Sale items store SP; linked SALE movements preserve CP/SP at transaction time. Owner history access/UI still incomplete. |
| S04 | Complete Owner CP + SP order history and cancellation history | NEEDS MODIFICATION | `useRecentSales`, POS/report bills omit CP; movement log excludes CP for everyone, no Owner movement-cost reader found. No tailoring/product unified order history, location snapshot or cancellation/refund workflow. |
| C01 | Customer creation/selection and WhatsApp contact storage | ALREADY CORRECT | `find_or_create_customer`, `customers.whatsapp_phone`, POS new/existing sale customers; reuse contact normalization/deduplication and advisory-lock pattern. |
| C02 | Customer attachment and WhatsApp in tailoring creation flow | NEEDS MODIFICATION | Job RPC supports nullable customer, but POS new-job and Tailoring screen calls omit it; customer form is sale-oriented. Must implement the required customer-linked job flow. |
| T01 | Tailoring job IDs, statuses, real active Tailor assignments | ALREADY CORRECT | Job creation/assignment/status RPCs, `tailor_id` FK/index, eligibility trigger and assigned-job UI; preserve validated people/job distinction. |
| T02 | Job creation by Counter and selection of actionable jobs | ALREADY CORRECT | Latest multi-cut migration permits Owner/Counter creation; active-tailor and eligible-job RPCs exist. Hierarchy/pricing/customer additions are separate findings. |
| T03 | Factory → Section → Tailor entities and management | MISSING | Tailors are profiles with roles; no factory/section tables, assignments, IDs or dynamic management/filtering. |
| T04 | Assigned Tailor isolation in reads/aggregates | NEEDS MODIFICATION | Eligible-job RPC and issue trigger limit pure Tailor to own jobs, but `tailoring_job_totals` bypasses RLS and aggregates all jobs for issue/manage permissions; self-read predicates omit active state. |
| T05 | Customer Tailoring versus no-customer shop work separation | CONFLICTING | One `tailoring_jobs` model allows nullable customers; screen labels null-customer jobs “Shop stock.” Required Owner Production must be separate, not anonymous Customer Tailoring. |
| T06 | SP-based tailoring selling-value calculation/display | CONFLICTING | `issue_tailoring_fabrics` returns SP-derived `selling_value_paise`; POS staging and `lineValue` show selling values. Required final Customer Tailoring price uses CP + applicable Tailoring Charge, and Counter sees final price only. No completed charge-based billing exists. |
| T07 | Configurable Owner Tailoring Charges and secure final-price calculation | MISSING | No charge catalogue, charge selection/snapshot, CP-based final-price RPC or Customer Tailoring bill/order flow. Do not choose an undefined charge formula or default illustrative rupee value. |
| T08 | Atomic multi-fabric issue to same job | ALREADY CORRECT | Existing multi-cut RPC and repeated issue sessions link Than/job and retain requested quantity; reuse as transaction foundation. |
| T09 | Generic Issue Material to Job / Additional Material Issue | NEEDS MODIFICATION | Current RPC/input accepts only barcode + length cuts. Requires consumables, unit, customer, factory/section/tailor, source, issuer and explicit additional-issue event/context. |
| T10 | Legacy free-text tailor assignment as active authority | DEPRECATED | `tailor_name` retained for historical display; migration 0007/20260926000400 requires real active Tailor profile for new issues. Preserve old names but do not restore free-text eligibility. |
| M01 | Consumable catalogue and stored units | NEEDS MODIFICATION | `materials` and material-linked job lines exist; seeded padding/buttons/lining, no complete receipt/issue/return management or thread-specific workflow. |
| M02 | Consumable inventory ledger and atomic material issue | MISSING | `materials.qty_on_hand` is a stored numeric balance; stock ledger requires a Than FK. Seeded material job line does not deduct consumable stock. No production/general material issue transaction. |
| P01 | Separate Owner Production Job domain | MISSING | No product/design/quantity/factory/section/production-job model, routes or RPCs. Null-customer tailoring is not an implementation. |
| P02 | Configurable designs and Design/Embroidery Charges | MISSING | `fabrics.design` is free text, not a charge catalogue or production design relationship. |
| P03 | Production Materials Issued, status and completion | MISSING | No production material ledger linkage or completion transaction. |
| P04 | Individual Finished Products and unique Product Barcodes | MISSING | Listing variants/manual quantities do not represent physical produced pieces with unique IDs, job links and barcodes. |
| P05 | Finished Product genealogy and Owner barcode detail | MISSING | No chain from piece to Production Job/design/fabric quantities/materials/factory/section/tailor/history/cost/location. |
| P06 | Complete Production Cost and cost per piece | MISSING | No fabric + labor + design + buttons/thread/padding/other cost breakdown, total cost, quantity allocation or cost-change history. Existing tailoring material totals are not complete production cost. |
| P07 | Owner Finished Product SP and backend cost privacy | MISSING | No Finished Product financial model or role-safe scan/sales APIs. |
| P08 | Production completion returns Finished Products to Workshop first | MISSING | No required return destination, Workshop receipt or subsequent Showroom transfer sequence. |
| P09 | Finished Product Counter scan, counts and sales | MISSING | No physical piece scan/SP/location counts/identical-product availability/sale/order flow. |
| R01 | Owner dashboard and fabric/sales/tailoring reporting | NEEDS MODIFICATION | Existing dashboard/reports are reusable views, but globally aggregate old roll/SP model; limited recent-sale/movement queries (100 rows on reports) are not full history. |
| R02 | Location/transfer/factory/production/Finished Product reports | MISSING | Underlying transactional domains absent; build only after their transactions are reliable. |
| R03 | Audit table and Owner-gated audit viewing | ALREADY CORRECT | `audit_log`, `audit.view`, audit screen; no authenticated direct append/update/delete policy, useful history foundation. |
| R04 | Complete automatic action audit, financial before/after and immutable boundary | NEEDS MODIFICATION | Some RPCs audit atomically, but direct CP/SP writes have no automatic history trigger; access writes then log in separate requests; barcode creation is not logged; listing/order updates are incomplete. `log_audit` accepts caller-supplied detail from any active staff. |
| X01 | Internal e-commerce listings, images, variants and pick/hold foundations | NEEDS MODIFICATION | Existing extra module is outside core master-plan workflows; preserve pending explicit scope. Roll links/availability will need reconciliation with new identity; manual variants must not masquerade as Finished Products. |
| X02 | E-commerce Manager extra login role | NEEDS MODIFICATION | Fifth existing role is not a required core role; plan does not explicitly order its removal. Preserve it, assess access against protected fields, do not invent Factory role or delete staff assignments. |
| X03 | WhatsApp receipt/template preview foundation | ALREADY CORRECT | Preview explicitly says no provider configured; customer WhatsApp storage exists. Plan does not require a live sending provider in Phase 0. |
| X04 | Settings/account information and shared UI components | ALREADY CORRECT | Existing units/account/integration display and UI primitives can be reused. These do not implement business administration catalogues. |
| X05 | Approved terminology across operational screens | NEEDS MODIFICATION | “thaan,” “Counter / POS,” “Shop stock,” “selling value,” “laag at/Laagat” labels and roll-oriented navigation need approved Than/Counter/CP/Lagat/Customer Tailoring/Owner Production terms. |
| X06 | Old guide's roll-barcode/activation/CP rules as future specification | DEPRECATED | Guide principles 1 and 4 and ongoing Stock Entry cost permission are superseded by master plan. Preserve guide as historical reference; do not treat it as new ERP authority. |
| D01 | Version-controlled ordered SQL migration chain and mirror journal | ALREADY CORRECT | Ten Supabase migrations and ten ordered Drizzle files/journal entries; preserve applied history and add only new migrations in later authorized phases. |
| D02 | Drizzle schema/snapshots as full current schema contract | NEEDS MODIFICATION | `drizzle/schema.ts` is intentionally empty; snapshots stop at 0003 while journal reaches 0009. SQL is the actual available schema; do not generate a replacement initial schema that drops deployed objects. |
| D03 | Existing demo data compatibility with new ERP | NEEDS MODIFICATION | Demo migration seeds TH-0001–TH-0017 with multiple barcodes per Fabric + Batch, optional-cost model, unlinked free-text Tailors and shop-stock tailoring. No new-location/production/security acceptance fixtures. Do not edit/replay/delete old seed in Phase 0. |
| D04 | Demo versus real data provenance presentation | NEEDS MODIFICATION | Supplier/batch/customer notes mark examples, but not every fabric/material/listing/transaction visibly carries DEMO; live data provenance/counts unverified. Do not assume current production contains demo data. |
| D05 | Automated ERP/database/role acceptance tests | MISSING | No test script or test suite found; guide checklist is manual documentation, not executed tests. Need new-domain, concurrency and adversarial role tests in appropriate phases. |
| D06 | Confirmed deployed migration/schema parity | MISSING | No live schema/migration-application verification performed or retained in repository evidence; this audit cannot certify applied state. |

### Priority findings and business/security consequences

1. **Barcode identity conflict is structural.** Both UI and transactions address a single `thaans.barcode`; seed records TH-0001/2/3 share Fabric + Batch yet have separate barcodes. Preserve Than rows and original movement genealogy internally. A future Fabric + Batch identity must sit above them with one stable Fabric Barcode, and sales/issues must select internal stock without resurrecting public per-Than barcodes. No allocation/legacy-label transition rule was invented here.
2. **CP/SP workflow conflicts cross both UI and DB.** Stock Entry can edit SP and read all permitted CP indefinitely. `thaan_costs` has a SELECT policy for `inventory.view_cost` plus a permissive FOR ALL policy for `inventory.receive`; simply removing a sidebar/permission label would not fix reads. Correction/receiving also require SP to activate, while CP/fabric can be absent. Later migrations must enforce Owner SP and workflow-scoped CP writes without permitting CP history/reporting outside receiving.
3. **Cost separation is valuable but not strictly Owner-only.** Default Counter/Tailor CP denial is implemented in source; `tailoring_line_costs` and `material_costs` also authorize `inventory.view_cost` (Stock Entry), and Owner can grant overrides. Complete Production Cost is absent. A future security contract must cover tables, views, RPCs, history, exports and cached browser data, not just cost columns in one screen.
4. **Several authorization bypass surfaces need testing.** `v_thaan_stock` is a non-security-invoker view over all stock/holds with authenticated SELECT; `thaan_available_mm(uuid)` is security-definer without caller scoping/revocation in the migration chain. `tailoring_job_totals()` is security-definer and permits all-job aggregates rather than filtering to assigned Tailor. Job/line self-read predicates accept `tailor_id = auth.uid()` without checking active staff or current Tailor role. Treat these as source-detected gaps; actual exploitability/grants require deployed-role testing. The guide's blanket statement that inactive users lose all data is not fully supported by this SQL.
5. **Workshop/Showroom and hierarchy are absent.** Global roll balance and rack cannot express stock at multiple locations or a split Than's quantities. No stock-transfer safeguards, dynamic sublocations, Factory/Section management/filtering, or required production return routing exist.
6. **Customer Tailoring is not approved pricing/billing.** POS new-job creation does not link a customer, materials are fabric-only cuts, SP values are exposed/displayed, and no CP + configurable charge final-price/bill implementation exists. Additional fabric sessions are possible, but not the complete explicit Additional Material Issue workflow. Keep required quantity explicit; no automatic wastage found.
7. **Owner Production and Finished Products are absent.** A null-customer tailoring job and manual online listing are neither Production Job nor physical Finished Product. All designs/charges, bulk piece creation, unique Product Barcodes, genealogy, complete costing and location counts remain future work.
8. **Integrity/history coverage is uneven.** Atomic sale/cut locks and snapshots should be reused. Stock receiving/direct editing still allows weak NULL-only completeness, lacks DB numeric constraints, and can bypass controlled active-record correction/history. Hold placement lacks stock-row locking against concurrent holds/cuts. Some audit calls occur after separate writes or not at all; old financial values are not consistently preserved.

### Existing migrations inspected — not created or applied in Phase 0

This inventory records existing files, not newly completed work or proof of their application. For every row: replay/live verification **not run**; static SQL inspection performed; file left unchanged.

| Supabase filename | Drizzle mirror | Purpose / affected schema, permissions, functions and indexes |
| --- | --- | --- |
| `20260924000000_erp_core_schema.sql` | `0000_erp_core_schema.sql` | 26 domain/access/integration tables, role/permission seeds, unique Than barcode/FKs/indexes, RLS/grants, ledger views and stock/auth/audit RPCs. |
| `20260924000100_demo_seed_data.sql` | `0001_demo_seed_data.sql` | Inserts fictional catalogues, batches/Than costs, stock movements, sales/customers/jobs/material lines/listings/variants/orders/holds/templates/audit; no new schema. |
| `20260924000200_reporting_views.sql` | `0002_reporting_views.sql` | Security-invoker overview/movement/listing views, grants, dashboard and tailoring aggregate functions. |
| `20260926000000_role_access_hardening.sql` | `0003_role_access_hardening.sql` | Active-user helpers/bootstrap, role permission, last-Owner triggers, scoped reads, cost-column grants/RPCs, listing image constraint/storage policies. |
| `20260926000100_requirements_completion.sql` | `0004_requirements_completion.sql` | Effective permissions, serialized last-Owner and profile-activation triggers, role/RLS scoping, material cost RPC/grants, reporting/hold auth, linked-listing trigger and private image bucket. |
| `20260926000200_incomplete_stock_correction.sql` | `0005_incomplete_stock_correction.sql` | Locked incomplete-correction and receiving RPC replacements; idempotent INWARD/adjustment and audit, correction execution grants. |
| `20260926000300_pos_customer_details.sql` | `0006_pos_customer_details.sql` | Nullable customer name and WhatsApp column, contact-deduplication RPC/grants, job eligibility trigger on material lines. |
| `20260926000400_tailor_job_assignment.sql` | `0007_tailor_job_assignment.sql` | Valid Tailor profile FK/index and legacy invalid-assignee cleanup; creation/assignment/status/eligibility RPCs, scoped job/line RLS, direct job-write revocation and execution grants. |
| `20260927000000_tailoring_multi_cut.sql` | `0008_tailoring_multi_cut.sql` | Owner/Counter active-tailor/job creation plus transactional multi-fabric issue RPC, sorted locks via cut RPC, audit and execution grants. |
| `20260927000100_customer_multi_fabric_sale.sql` | `0009_customer_multi_fabric_sale.sql` | Atomic multi-line bill RPC; customer validation, invoice advisory lock, sorted stock locks, availability/hold checks, CP/SP snapshots, audit and grants. |

Mirror comparison: seven pairs match after CRLF normalization. Completion/correction mirrors differ only by a trailing blank line. The multi-fabric-sale mirror differs in comments/formatting; inspected function logic is equivalent. These differences were not rewritten. Journal contains all ten tags in order; generated snapshots exist only for 0000–0003. Historical migration application order and actual deployed definitions remain unverified.

### Dependencies identified — future work only

Follow the exact master-plan sequence, without advancing from this audit:

- Phase 1: sound domain relationships for Fabric + Batch → internal Thans; locations/sublocations, Factory → Section → Tailor, customers, distinct Customer Tailoring/Production Jobs, charges/designs, materials, Finished Products, genealogy/costs/orders/ledger/audit. Preserve existing IDs/transactions; any legacy data mapping needs explicit reconciliation, not guessed values.
- Phase 2: enforce Owner-only financial reads, workflow-scoped Stock Entry CP and Owner-controlled SP at all backend surfaces; verify active/assigned roles, overrides, views/RPCs and session-cache boundaries.
- Phases 3–6: location ledger, one Fabric Barcode entry/print/scan/SP workflow, transfers and direct SP sales, reusing correct stock locking/snapshot foundations.
- Phases 7–9: customer-linked tailoring, configurable charge/final-price billing, generic consumables/material issues, hierarchy management. Keep undefined tailoring-charge formula unspecified.
- Phases 10–14: separate Owner Production, piece records/Product Barcodes, genealogy, cost breakdown including Design/Embroidery, Workshop-first completion/transfer, Counter piece availability/sales.
- Phases 15–16: reliable reporting/audit/Owner controls, then UI/UX/performance polish. No later dependency was implemented during Phase 0.

### Execution loop and verification

Section 30 steps 1–4 were completed through document reading, source inspection, feature mapping and dependency identification. For Phase 0, step 5 means this audit/history only; step 6 excludes migrations and uses an isolated baseline build; steps 7–10 are read-only baseline checks and source-level rule/security/regression review. No write-based acceptance scenario was run because it would breach the explicit audit freeze. Steps 11–12 are the Section 31 report below and a complete stop for approval.

- TypeScript: `npm exec --no -- tsc --noEmit` **PASS**, exit 0, no diagnostics.
- ESLint: `npm run lint` **PASS with warnings**, exit 0, zero errors and eight `react-refresh/only-export-components` warnings (session provider, badge, button, form, sidebar, toggle). No fixes applied.
- Build: `npm run build` **PASS**, exit 0; client, SSR and Nitro production compilation completed in `C:/Users/maazl/AppData/Local/Temp/maqdooms-phase0-d060bbb84dfe490d903278715067f299`. The temporary source copy used a junction to existing dependencies; build caches under ignored `node_modules/.nitro` may be updated. No environment secret files were copied and no dependencies installed. Generated application/deployment output remained in the temporary copy. This is a compile baseline, not deployed runtime verification.
- Build warnings: existing tsconfig-paths plugin redundancy, ineffective dynamic Supabase import, client chunk above 500 kB (about 592 kB), plugin timing and ignored inlineDynamicImports option. No performance/configuration changes made.
- Freeze verification: SHA-256 comparison after the build found **zero changed/deleted files among all 178 baseline files**. Git status retained the same pre-existing edits and master-plan file, with only this history file added. No repository migration/configuration/source files were altered by validation.
- Static migration inspection/mirror comparison completed as recorded above; no SQL replay, schema push, Drizzle generation, DB reset or seed execution.
- Automated business/role tests: **NOT RUN**; no suite/test script exists. Plan's 100m receiving/30m transfer/4m sale, CP/SP role tests, tailoring final-price, ten-piece production and costing tests are future acceptance criteria, not Phase 0 passes.
- Regression review: reusable mm/paise, ledger deductions, no automatic wastage, transactional cut/sale and protected default role cost surfaces identified. Existing functionality was not exercised against production.
- Limitations: no browser visual/interaction validation, deployment check or live role/RLS verification. Static gaps must not be described as repaired.

### Section 31 — Phase report

PHASE:
0 — Existing Codebase Audit + Freeze (2026-10-03, Asia/Calcutta).

STATUS:
Audit complete; implementation frozen. Stop for approval before Phase 1.

IMPLEMENTED:
- Audit documentation and permanent history record only. No ERP implementation changes were made.

MODIFIED:
- Created `MAQDOOMS_Big_Mall_ERP_Implementation_History.md` only; all existing working-tree edits retained.

REUSED:
- Identified existing auth/role guards, integer units, internal Than rows, cost separation, ledger/atomic deduction, snapshots, customer contacts, job assignment, last-Owner protection and UI foundations for preservation in later phases.

DATABASE CHANGES:
- None. No new or modified migrations, schema, grants, RLS, functions, indexes, seed or production changes; ten existing migration pairs inspected only.

SECURITY / PERMISSIONS:
- No changes. Findings include ongoing Stock Entry CP access/SP control, cost override scope, helper/aggregate/self-read authorization gaps and cache isolation; default Counter/Tailor CP exclusion exists in source but live permission tests are unverified.

TESTS:
- TypeScript passed; lint passed with eight existing warnings; static schema/migration/business-rule/security review completed. Database and business acceptance scenarios not executed.

BUILD:
- Passed client, SSR and Nitro compilation in a temporary copy; existing build warnings recorded above. No deployment or runtime acceptance claim.

BUSINESS RULES VERIFIED:
- Source-level: ledger-derived fabric balance, direct sale using SP, stable identifier independent of CP/SP, explicit-only wastage, stock deductions under transactional checks, individual Than history and default Counter/Tailor CP restrictions.
- Not compliant: public roll barcode identity, SP-required/CP-optional receiving, Stock Entry CP/SP permissions, SP-valued tailoring, nullable-customer shared shop-work jobs. Missing location/hierarchy/production/product/costing rules are registered above.

REMAINING:
- Approval for Phase 1; all required changes remain unimplemented. Live migration parity and role/database acceptance verification remain outstanding and must not be assumed.

NEXT PHASE:
- PHASE 1 — Database / Domain Model, only after explicit approval. Phase 1 has not started.

## 2026-10-03 — PHASE 1 — Database / Domain Model

### Authorization, objective and execution boundary

The user approved Phase 0 and explicitly authorized Phase 1 only. Re-read master-plan Phase 1, business rules, Sections 30/31 and relevant Phase 0 findings before edits. Objective: establish the required domain entities and sound relationships through additive, version-controlled SQL, preserving old application behavior/data and historical migration files. Phase 2 and all later phases have **not** been implemented.

**Implemented in repository and verified through disposable PostgreSQL replay; NOT applied to the linked/production database.** No live connection, manual database change, production seed, deployment, commit or push was performed. This entry supersedes the previous phase's stop status only for approved Phase 1 work; the Phase 0 entry itself remains unchanged.

### Files created and changed

Created:

- `supabase/migrations/20261003000000_phase1_domain_model.sql` — canonical additive Phase 1 migration.
- `drizzle/migrations/0010_phase1_domain_model.sql` — byte-identical Lovable/Drizzle execution-path mirror of the same logical migration.
- `scripts/phase1-schema-test.mjs` — repeatable disposable PostgreSQL replay/constraint/backfill/regression verification; reads no `.env` or live connection credentials.
- `docs/PHASE_1_DOMAIN_MODEL.md` — complete requirement-to-model map; all new tables/columns/relationships, existing-column changes, constraints, indexes, functions/triggers, RLS, backfill, testing and deployment/cutover limits.

Changed:

- `drizzle/migrations/meta/_journal.json` — appended entry 10, `0010_phase1_domain_model`, timestamp 1790985600000; previous entries unchanged.
- `supabase/migrations/README.md` — appended Phase 1 scope, mirror execution warning and contract/test reference; previous migration inventory retained.
- `MAQDOOMS_Big_Mall_ERP_Implementation_History.md` — appended this Phase 1 record.

All application/source files, dependency manifests/lockfiles, configuration, original SQL migrations and old snapshots were retained. All pre-existing uncommitted edits were preserved. `drizzle/schema.ts` remains intentionally empty; no destructive schema generation/push was used. Supabase legacy client types were not routed to sealed new APIs; generation/integration belongs to the later authorized API/workflow cutover.

### Migration record

| Field | Actual implementation |
| --- | --- |
| Canonical filename | `20261003000000_phase1_domain_model.sql` |
| Execution-path mirror | `0010_phase1_domain_model.sql` (one logical migration, not a second change to apply after the canonical file) |
| Purpose | Add Phase 1 domain relationships, guarded historical financial/transaction records and conservative legacy identity/reconciliation mapping. |
| SQL boundary | Explicit BEGIN/COMMIT; create new objects, add compatibility columns/constraints, perform documented backfill, seal new tables. Migration tracking must prevent a second execution. |
| New tables | 34 public tables, listed below. |
| Existing schema changes | `thaans.fabric_stock_id`, nullable legacy `thaans.barcode`, identity checks/composite FKs/unique pair/index; `materials.active`; Auth/profile FK and profile FKs for role/override assignments. |
| RLS/grants | RLS enabled on all new tables, no browser policies; revoke PUBLIC/anon/authenticated table access; service_role table privileges only. Existing table policies and role assignments unchanged. Trigger function direct browser execution revoked. |
| Functions/triggers | Six new invoker trigger functions guarding hierarchy, piece/job quantities/identity, cross-record links, stable identities and immutable history. No new business-operation RPC. |
| Indexes | Root singleton/current-assignment uniqueness, codes/barcodes/stock pair/revision/piece/composite FK keys; location, stock, job, issue/transfer/order, inventory item/location/time, cost, genealogy and audit lookup indexes; transfer/issue posting-reference partial uniqueness. Exact names/definitions in SQL and contract. |
| Backfill | Fabric + Batch grouping/parent links; new stable FAB identifiers; unanimous valid CP/SP snapshots only; reconciliation flags for missing/conflicting financial identity, physical locations, legacy job domain/assignment, consumable openings and Auth/profile/role orphans. No legacy values/ledger rows overwritten or deleted. |
| Verification | Both complete 11-file chains replayed independently; clean chain without demo also replayed; historical row preservation, relationship/constraint guards, sealed access and legacy RPC regressions verified. See exact validation results below. |
| Production status | Not applied. Actual deployed schema/grants/version/migration ledger and legacy data reconciliation remain unverified. |
| Final SQL SHA-256 | `3c7baf5f4d04a1189a88dfad857ba8b31d2e0a278bd739f918a1165096586116` for both copies. |

### Tables and domain relationships actually established

- **Locations:** `locations` with one Workshop and one Showroom root seeded from explicit requirements, arbitrary Showroom sublocations constrained to the Showroom. No floors or legacy physical placements invented.
- **Factory → Section → Tailor:** `tailoring_factories`, `tailoring_sections`, `tailors`, `tailor_assignments`. Real-name/code/active state and optional staff profile link; section belongs to its factory; history retains prior assignments. No Factory role added.
- **One Fabric + Batch identity:** `barcodes`, `fabric_stock`, `fabric_stock_costs`, `fabric_stock_prices`. Globally unique typed barcode registry, one Fabric Barcode per stock identity, internal matching Than links, optional SP, separate immutable CP/SP revisions. No new per-Than barcode requirement.
- **Reconciliation:** `domain_reconciliation` stores protected evidence and resolution fields; it may contain financial information and is not exposed to staff.
- **Charges, designs, products:** `tailoring_charges`, `tailoring_charge_versions`, `designs`, `design_charge_versions`, `products`. Configurable catalogues and immutable charge revisions, no business example values seeded.
- **Customer Tailoring:** `customer_tailoring_jobs`, `customer_tailoring_prices`. Mandatory customer and Tailor assignment, optional historical link, separate protected CP/charge snapshots; confirmed CP + charge formula is a generated value. Selected charge amount must match its version. No SP input, no invented charge calculation rule and no pricing/billing RPC.
- **Owner Production and pieces:** `production_jobs`, `finished_products`, `finished_product_prices`. Production has no customer, a single product/design, positive quantity and assignment. Each piece has its own unique Product Barcode, bounded piece number and same-job product/design genealogy; initial piece location must be Workshop. New design/product requires new Production Job.
- **Required and issued material:** `job_material_requirements`, `material_issues`, `material_issue_lines`. Exactly one customer OR production job; requirements are not deductions. Generic fabric/consumable quantities/units, matching stock/Than identity, assignment/source/issuer/time, required/additional issue type. Issue history is append-only.
- **Stock Transfers:** `stock_transfers`, `stock_transfer_lines`. Different source/destination, referenced internal Than/consumable/individual piece, positive quantity/unit and draft/posted/cancelled status model.
- **Orders:** `orders`, `order_items`, `order_item_financials`. Direct Fabric Sale, Customer Tailoring and Finished Product Sale are distinct kinds. Tailoring order customer/job must match; item kind/job must match header, and tailoring items cannot hold SP. CP/production-cost/charge history is separate from customer-facing fields.
- **General Stock Movement model:** `inventory_movements`, positive quantities with explicit source/destination/unit, item/job/order/issue/transfer/user/time/reference. Append-only; exact transfer/issue item and event relationships guarded; posting a transfer/issue line twice is constrained. No new ledger rows populated by migration and no balance API implemented.
- **Production Costs and genealogy:** `production_cost_versions`, `production_cost_lines`, `finished_product_materials`, `finished_product_cost_allocations`. Eight required cost categories, versioned quantity snapshot, design/fabric/material provenance, matching product/job/cost links, same-job issued-material quantities/units and no over-allocation of issued materials. Costs are component records; calculation/finalization/allocation operations remain Phase 12.
- **Audit:** `erp_audit_records` includes who/what/when/entity/previous/new/reference, append-only. Legacy `audit_log` unchanged; automatic audit coverage remains a later phase.
- **Reused existing entities:** Auth users/profiles/roles/permissions/overrides, fabrics, receiving batches, internal Thaans, materials as Consumables, customers/WhatsApp and all legacy transaction tables. Existing generated views and RPCs retained.

Exact new columns, defaults, CHECK/UNIQUE/FK relationships, category/status values and named indexes/functions/triggers are documented in `docs/PHASE_1_DOMAIN_MODEL.md` and the executable migration rather than hidden in an undocumented database edit.

### Business and technical decisions

1. **Additive compatibility transition.** Do not rename/drop legacy tables or repurpose nullable-customer jobs as Owner Production. New operational domains remain sealed. Current app authority stays with legacy `stock_movements`; Phase 3 must reconcile physical locations and define a single-authority ledger cutover before new transactions are enabled.
2. **Safe identity backfill.** Known non-null Fabric + Batch pairs get one `legacy_pending` parent. Existing Than barcodes, CP/SP and ledger remain unchanged. Generated parent FAB identifiers use UUIDs and contain no mutable price/quantity; independent fresh installs have different UUIDs but applied identities are stable.
3. **No price inference.** Parent financial snapshots are copied only if every member has the same non-null nonnegative value. Mixed/null/invalid values are flagged; no average, first-roll selection or fake zero price. All-null SP is allowed to remain unset. No cost/price history is discarded.
4. **No location or job inference.** Rack strings do not imply Workshop/Showroom. Existing jobs and consumable openings are flagged, not converted or assigned false factory/section/people. Old customer/WhatsApp values remain intact.
5. **Preserve orphan users/roles safely.** New FK writes enforce real user/profile relationships. Existing orphan references survive behind NOT VALID constraints and reconciliation records. A clean existing table has its corresponding constraint validated in the migration; unresolved orphans require later controlled reconciliation, not deletion.
6. **Use a minimum safe permission scaffold.** New browser tables are deny-by-default, including Owner sessions, pending Phase 2. Service role/migration administration is trusted. Existing CP/history/helper/session security findings remain unresolved rather than being silently reported as fixed.
7. **Store confirmed formula, defer workflows.** Customer Tailoring's generated CP + selected-charge value is a model invariant; actual CP retrieval, charge selection logic/final-price-only Counter API, billing, creation/completion services and material deductions are later phases. No automatic wastage or illustrative charge value was introduced.
8. **Schema guard versus workflow.** Piece bounds/initial Workshop, matching jobs/designs/units and append-only records are relational safeguards. No transaction RPC, scanner/print UI, stock balance, product creation/completion service, report or production-cost calculation service was implemented.

### Security / permissions changes

- New schema: RLS on all 34 tables; PUBLIC/anon/authenticated privileges revoked, no role policies yet; trusted service_role granted table access. Financial and reconciliation tables are equally sealed.
- Six trigger functions have invoker security and browser EXECUTE revoked. They are not security-definer entry points bypassing RLS.
- Existing Auth bootstrap, core role permissions/overrides, legacy cost SELECT/write policies, inactive/assigned-role helper behavior and application cache boundaries are unchanged. Phase 2 must implement/test their approved authorization contract.
- Schema tests prove new table grants/RLS scaffolding and denial of browser reads to new CP/production cost tables, not completion of a four-role matrix or deployed PostgREST security.

### Tests, verification and build

- Disposable runtime: external temporary `@electric-sql/pglite` 0.5.8, PostgreSQL 18.3; not added to app dependencies/lockfiles. Minimal Auth/storage schemas/roles were mocked; original business migrations were executed unmodified. No live database connection used.
- `node scripts/phase1-schema-test.mjs C:/Users/maazl/AppData/Local/Temp/maqdooms-phase1-pglite/node_modules/@electric-sql/pglite/dist/index.js`: **PASS — 278 checks**. Both canonical and Drizzle 11-file chains produce equal columns/constraints/indexes/triggers; new migration bytes match.
- Seeded replay preserves every original field/value in pre-migration public rows, with only intended new Than parent/material active additions. Tests add synthetic mixed-price/missing-identity/orphan fixtures only in disposable DB, verifying preserved values, no fabricated locations/job conversions and correct reconciliation flags.
- Clean replay skips historical optional demo seed, creates only two specified location roots, has empty Fabric Stock and reconciliation, and validates all three clean user-reference constraints.
- Relationship tests include dynamic five-floor creation, invalid roots/parents/factory sections, required customers, distinct job domains, wrong design charge, positive quantities, ten uniquely barcoded pieces and quantity bounds, Workshop first, immutable identities/financial/ledger/audit/issue records, selected charge snapshot/CP + charge, correct units, matching transfer/issue movements, duplicate posting rejection, genealogy over-allocation and same-job cost allocation.
- Cost fixture verifies all eight categories can be represented and a test SQL aggregation derives a per-piece value. This is not a deployed costing function or finalized-cost workflow.
- Regression: existing Owner bootstrap, legacy multi-fabric sale and assigned-job multi-cut issue still execute successfully after migration, deducting the old ledger once per issue/sale.
- TypeScript `npm exec --no -- tsc --noEmit`: **PASS**, exit 0.
- ESLint `npm run lint`: **PASS**, zero errors, eight pre-existing Fast Refresh warnings. No application warning fixes performed.
- Production build `npm run build`: **PASS**, exit 0, client/SSR/Nitro compilation completed in `C:/Users/maazl/AppData/Local/Temp/maqdooms-phase1-build-f1f1a43557ee4194b69bfaf69e26fbb7`. Temporary source copy used existing dependency junction; ignored dependency build caches may update. Generated application/deployment output remained outside project source. Existing warnings: tsconfig-paths plugin redundancy, ineffective dynamic import, client chunk >500 kB, plugin timing and ignored inlineDynamicImports. No application/configuration changes, deployment or runtime acceptance claim.
- Original-file SHA verification: all 20 historical SQL migration files and all pre-existing application/configuration/seed/lockfile contents remain unchanged. Only documented journal/README/history entries and the new files are Phase 1 changes.

### Limitations and intentionally not changed

- The migration is **not deployed**. Live migration ledger/schema/grants, hosted PostgreSQL version, PostgREST cache, storage/Auth provider behavior and production reconciliation counts were not inspected/verified. PGlite is single-connection; multi-client concurrency is not certified by replay tests.
- Existing old screens continue roll barcode and SP-required receiving workflows. Stock Entry's old ongoing CP/SP authority, shared legacy shop tailoring, helper/aggregate access and cache findings persist for their authorized phases.
- Existing records lacking verified locations/assignments and mixed financial values remain unresolved. Current `rack` and stored consumable opening quantities are historical evidence, not new location balances.
- New old-workflow receiving rows after migration are not automatically mapped to Fabric Stock; later receiving cutover must reconcile them. A linked Than cannot have its fabric/batch changed independently of its parent; future controlled correction must maintain identity coherently.
- No automatic opening ledger replication, operational negative-stock/over-transfer calculation, charge formula beyond the confirmed sum, complete cost finalization/allocation arithmetic, generic action audit triggers or browser API permissions were added.
- No frontend changes, schema-generation replacement, live data reset, charge/design/product demo seed or later-phase workflow implementation. New operational access is deliberately pending Phase 2 approval.

### Section 31 — Phase report

PHASE:
1 — Database / Domain Model (2026-10-03, Asia/Calcutta).

STATUS:
Repository implementation and local schema verification complete; not deployed. Stop at Phase 1 boundary.

IMPLEMENTED:
- All required Phase 1 entity relationships through 34 additive tables, compatibility columns/FKs, integrity/history guards and conservative legacy identity backfill/reconciliation.
- Executable schema replay tests and complete domain contract documentation.

MODIFIED:
- New migration and mirror, appended migration journal, migration README and this history entry. No application/old migration/seed/configuration changes.

REUSED:
- Existing users/roles/fabrics/batches/internal Thans/materials/customers, legacy ledger/history and operation RPCs.

DATABASE CHANGES:
- One logical migration: `20261003000000_phase1_domain_model.sql`, mirrored as `0010_phase1_domain_model.sql`; applied only to disposable test databases. Production unchanged.

SECURITY / PERMISSIONS:
- New tables sealed with RLS and browser grants revoked. Existing authorization unchanged; Phase 2 security matrix remains unimplemented.

TESTS:
- 278 local PostgreSQL replay/schema/backfill/constraint/regression checks passed; TypeScript passed; lint passed with eight existing warnings. Live/concurrent/role-workflow tests remain unverified.

BUILD:
- Passed production client/SSR/Nitro compilation in an isolated source copy, with existing warnings. No deployment performed.

BUSINESS RULES VERIFIED:
- Model-level Fabric + Batch identity, internal barcode-optional Thans/SP-optional stock, distinct customer/production jobs, valid hierarchy, CP + charge without SP, typed individual Product Barcodes, Workshop-first creation, versioned finance, same-job genealogy and traceable append-only records.
- Legacy business workflows intentionally not claimed compliant until their phases.

REMAINING:
- Live deployment/parity and legacy reconciliation; later operational authorization/ledger/API/UI/workflows. No Phase 2 or later work started.

NEXT PHASE:
- PHASE 2 — Authentication + Authorization, only after explicit approval. Stop and wait.

---

## 2026-10-03 — PHASE 2: Authentication + Authorization

### Authorization, objective and baseline

The user approved proceeding with “go ahead” after the Phase 1 report. Phase 2 was
announced explicitly before work. Re-read the master plan's roles/pricing rules,
Phase 2 requirements and Sections 30/31, and the relevant Phase 0 findings
(ongoing Stock Entry CP, financial overrides, Tailor aggregate/assignment leakage,
SP-based tailoring display and cache boundaries). Preserve the approved Phase 1
schema and all historical migrations. Implement only authorization and the minimum
workflow CP endpoints needed to exercise its required security matrix.

### Files actually changed/created in Phase 2

- `supabase/migrations/20261003000100_phase2_authorization.sql` — new canonical migration.
- `drizzle/migrations/0011_phase2_authorization.sql` — byte-identical execution-path mirror.
- `drizzle/migrations/meta/_journal.json` — appended index 11, tag `0011_phase2_authorization`;
  existing journal entries retained.
- `supabase/migrations/README.md` — Phase 2 migration/deployment documentation.
- `docs/PHASE_2_AUTHORIZATION.md` — complete role/policy/grant/function/trigger contract,
  workflow scope and explicit remaining dependencies.
- `scripts/phase2-security-test.mjs` — disposable actual-role PostgreSQL security/regression tests.
- `scripts/phase1-schema-test.mjs` — exclude later Phase 2 SQL from the Phase 1-only
  replay so its original sealed-schema regression remains meaningful; old assertions retained.
- `src/app/providers/session.tsx` — fail-closed bootstrap, stale-load protection,
  identity/access cache cancellation/clear, protected-subtree remount to discard
  sensitive local form state, full sign-out state reset, queued Auth event loads,
  stable callback dependencies, and removal of the bootstrap/profile-last_login
  realtime feedback loop. Existing focus/60-second access verification retained.
- `src/app/access/modules.ts` — Tailor home/navigation excludes Counter.
- `src/routes/_authenticated/route.tsx` — missing/inactive access payload fails closed.
- `src/integrations/supabase/types.ts` — client types for three added RPCs used by UI.
- `src/features/inventory/index.ts` — workflow-ID CP reads and scoped CP writes.
- `src/routes/_authenticated/inventory.receiving.tsx` — own draft batch selection for
  Stock Entry, workflow CP fields/queries, disable/skip non-Owner SP submission.
- `src/features/inventory/ThaanEditor.tsx` — disable/skip non-Owner SP changes.
- `src/features/tailoring/index.ts` — omit restricted legacy SP snapshot column;
  retrieve Owner-only SP via scoped RPC while retaining the existing CP RPC.
- `src/features/pos/index.ts` — remove SP-derived tailoring amounts from response contract.
- `src/routes/_authenticated/pos.tsx` — hide SP-derived prices/totals during Customer
  Tailoring staging; Direct Fabric Sale amounts remain visible.
- `src/routes/_authenticated/tailoring.tsx` — hide internal legacy SP-derived material
  values/aggregates from non-Owners.
- This history file — chronological Phase 2 implementation and verification record.

Pre-existing user edits were preserved, including package/configuration/UI changes.
No dependency installation or package/lockfile change was made for Phase 2.

### Migration ledger and database changes

| Migration | Purpose | Applied/verified |
| --- | --- | --- |
| `supabase/migrations/20261003000100_phase2_authorization.sql` | Active-role/assignment authorization; Owner financial boundaries; workflow CP endpoints; SP/receiving guards; restricted definer execution; safe stock view | Full canonical chain replay in disposable PostgreSQL; security matrix passed. Not applied to live Supabase |
| `drizzle/migrations/0011_phase2_authorization.sql` | Identical mirror for the existing Drizzle/Lovable path; journal index 11 | Full mirror chain replay passed; identical SHA256. Apply one chain only |

Both copies SHA256:
`f9e4f044abb0fe652a5ad533eac45d02d41fedee04e563555e9890f9e370a5ea`.

No tables/columns/relationships/constraints/indexes were added or changed. There
was no DML/backfill in the migration, creator reassignment, cost conversion, ledger
population or production-data operation. Test fixtures exist only in disposable
databases. Snapshot tests verify existing Than/CP/movement/domain-cost/role/override
rows are identical immediately before and after this migration.

New functions (9): `can_enter_legacy_cp`, `stock_entry_cp`, `stock_entry_set_cp`,
`guard_receiving_authorization`, `guard_legacy_cost_write`,
`owner_tailoring_line_prices`, `owns_tailor_assignment`, `domain_stock_entry_cp`,
`customer_tailoring_final_price`.

Replaced definitions (5), exclusively in this new migration: `has_perm`,
`bootstrap_current_user`, `tailoring_job_totals`, `issue_tailoring_fabrics`,
`thaan_available_mm` (active operational role or assigned Tailor material only;
existing balance calculation retained).
Their prior migration definitions/files remain intact.

New triggers (3): `phase2_receiving_auth` (batch INSERT/UPDATE), `phase2_thaan_auth`
(Than INSERT/UPDATE), `phase2_cost_auth` (legacy CP INSERT/UPDATE). These enforce
ownership/open workflow/SP restrictions inside SECURITY DEFINER RPCs as well as
direct writes; CP writes must be nonnegative. Existing sale exhaustion can change
only active→depleted status/updated_at through the narrow Counter exception.

`v_thaan_stock` now has `security_invoker=true`; no view columns were changed.
The contract document lists every signature, policy name, affected table, predicate
and explicit grant/revoke; it is part of this implementation record's evidence.

### Business/technical and permission decisions

- Owner financial/admin permissions and stock-adjustment/price-override permissions
  cannot be granted to other roles by overrides. Receiving/Than editing require
  Owner/Stock Entry; sale/issue require Owner/Counter. Existing role/override rows
  remain preserved; effective bootstrap reflects these ceilings.
- Legacy `thaan_costs` broad FOR ALL receiving policy replaced with Owner-only ALL.
  Stock Entry current CP is accessed through one-row RPCs, never a cost-history table.
- Stock Entry legacy scope: own Than + own batch, both draft. Creators are stamped
  on new Stock Entry writes; unowned/unattributed/committed legacy work is Owner-only.
  Batch ALL receiving policy replaced with Owner ALL and owned-draft Stock Entry
  INSERT/UPDATE; Stock Entry cannot delete batches or reopen closed work.
- New-domain CP scope: own existing `draft`/`correcting` stock identity, active
  Stock Entry role plus receiving permission. Lock before validating/writing;
  append new cost revision, return current CP only. No browser stock-state writes.
- Authenticated SELECT is granted on all 34 Phase 1 tables under active Owner RLS.
  Finance/history/audit/reconciliation tables have no non-Owner policy. New-table
  browser INSERT/UPDATE/DELETE stays sealed pending the relevant operational phase.
- Nonfinancial Counter catalogue/stock/SP/hierarchy/job reads and assigned Tailor
  jobs/hierarchy/material identities are authorized through explicit RLS. Legacy
  Tailor job/line/Than/movement reads require active role and assigned-job scope.
- Legacy tailoring SP snapshot column is no longer directly selectable by
  authenticated users; Owner RPC retains access. Non-Owner aggregate CP/SP totals
  are NULL, and SP-derived issue amounts are removed from browser response.
- Counter final-price RPC returns only latest stored CP + Tailoring Charge final
  customer price. Charge/CP breakdown rows stay Owner-only. It reads existing
  Phase 1 snapshots; no billing calculation/charge selection workflow was introduced.
- PUBLIC/anon cannot execute public SECURITY DEFINER functions. Required
  authenticated helpers and scoped RPCs retain explicit grants; guard functions
  are unavailable for direct browser invocation. Existing immutable guards retained.
- Bootstrap initial Owner/subsequent Counter convention and last-active-Owner
  protections are reused; initial role provisioning is serialized and requires an
  existing Auth user. No Factory login role or new role data was created.

### Tests and verification actually performed

- `scripts/phase2-security-test.mjs`: **164 checks passed**, replaying both complete
  12-migration chains under disposable PGlite/PostgreSQL and actual `authenticated`
  role/JWT-subject fixtures for Owner, Stock Entry, Counter, Tailor and another Tailor.
- Verified Owner CP; denied non-Owner raw CP/cost columns, material/job CP readers,
  revision history and production-cost rows; scoped Stock Entry CP read/edit,
  nonnegative CP, completed-work denial and inability to reopen domain stock;
  SP direct/RPC denial; blocked financial/admin overrides; effective Stock Entry
  bootstrap; last-active-Owner protection; assigned/unassigned/inactive Tailor;
  Counter final customer price without CP/charge/SP breakdown; no anonymous definer
  execution; existing data preservation; Direct Fabric Sale uses Owner SP and
  still depletes fully consumed stock without exposing CP; Tailor cannot issue stock.
- All eight production-cost component rows populated in test fixture: Owner reads
  all and total 8,000 paise; Counter/Stock Entry/Tailors receive zero component rows.
  No application production-cost calculation/finalization feature was implemented.
- Phase 1 regression: **278 checks passed** across both Phase 1 chains and clean
  install without demo data; domain schema/backfill/constraints/history guards remain.
- TypeScript compilation passed; lint passed with **8 existing Fast Refresh warnings**.
- Production client/SSR/Nitro build passed in an isolated source copy. No deployment.
- Initial parallel verification exhausted local Node memory; serial/reduced V8
  worker-pool reruns passed. This was not treated as a passing test until rerun.
- SHA256 comparison with retained Phase 1 workspace hashes confirmed every old SQL
  migration, including Phase 1 and its mirror, unchanged; unrelated existing edits,
  package/configuration/seed files preserved.

### Limitations and intentionally not changed

No live Supabase migration application/parity, PostgREST behavior, OAuth/browser
login/logout/cache rendering, realtime delivery or multi-connection race testing
was performed. PGlite uses one connection; locks are implemented, concurrent
correctness remains unverified. UI cache/session changes are compiled/reviewed,
not claimed browser-tested. Access display refreshes on focus/60-second verification;
database permission checks apply immediately. Live role-change realtime publication
configuration was not changed or assumed.

Legacy receiving retains SP-based activation until Phase 4. Stock Entry can enter
own draft CP but Owner must supply SP/complete legacy stock; committed/unattributed
legacy corrections are Owner-only. New-domain correcting CP authorization is ready;
creating/opening/closing that workflow and its UI belong to Phase 4. Legacy CP
overwrite behavior remains; new-domain CP revisions append. Automatic audit
completion remains Phase 15. Existing legacy anonymous-customer tailoring/roll
barcode/balance/history behavior is preserved for its scheduled implementation phase.

No Phase 3 ledger/balances/transfers, Phase 4 receiving/barcode cutover, Phase 7
billing, Phase 10 new hierarchy screens, Phase 11 production workflows, Phase 12
cost calculation or any other later-phase feature was implemented. No live writes,
manual database changes, old SQL rewrites, seed modifications, commits or pushes.

### Section 31 report

PHASE:
- PHASE 2 — Authentication + Authorization only.

STATUS:
- Implemented and locally verified; live application and browser validation pending.

IMPLEMENTED:
- Owner/Stock Entry/Counter/Tailor backend role/financial boundaries, scoped CP
  workflow authorization, assigned-job RLS, safe final-price reader and Auth/cache guards.

MODIFIED:
- New migration/mirror and appended journal; limited existing auth/receiving/tailoring
  access/display code; test/contract/history/README documentation.

REUSED:
- Existing Auth/profiles/roles/overrides, last-Owner protection, transaction RPCs,
  legacy data and all Phase 1 relationships/versioned financial tables.

DATABASE CHANGES:
- One new logical authorization migration with mirror; policies/grants/functions/
  triggers/view security only. Disposable test application; production unchanged.

SECURITY / PERMISSIONS:
- Owner finance; Stock Entry current CP of own open workflow only; no Counter/Tailor
  CP or production costs; assigned Tailor reads; Owner SP; anonymous definer denial.

TESTS:
- 164 database security checks and 278 Phase 1 regression checks passed; TypeScript
  and lint passed (8 existing warnings). Live/browser/concurrent tests pending.

BUILD:
- Production build passed in isolated source copy; not deployed.

BUSINESS RULES VERIFIED:
- All seven Phase 2 minimum security cases; SP controlled by Owner; scoped active
  roles/assignments; Counter final Customer Tailoring price without internal breakdown.

REMAINING:
- Live migration/PostgREST/browser/concurrency validation, legacy reconciliation,
  and explicitly deferred operational workflows; see limitations above.

NEXT PHASE:
- PHASE 3 — Locations + Inventory Ledger, only after approval. Stop and wait.

## 3 October 2026 — PHASE 3: Locations + Inventory Ledger

User authorized Phase 3 explicitly. Re-read the Master Plan, execution loop/report
requirements, operations guide and Phase 0–2 baseline. Objective: Workshop/Showroom
locations, dynamic Showroom children, canonical movement balances, transfers and history.
Only Phase 3 implemented; no live database application, deployment, commits or pushes.

### Files and migration record

- New `supabase/migrations/20261003000200_phase3_locations_ledger.sql`.
- Identical execution-path mirror `drizzle/migrations/0012_phase3_locations_ledger.sql`;
  appended journal index 12. Apply one chain only, never both copies.
- Both SQL files SHA-256:
  `a63886220f64c5d2844d0d4df1d44bf209b10fe7020fd90e3537981923e0181c`.
- New `src/features/inventory/LocationLedger.tsx` and `ledger-quantity.ts`;
  new `scripts/phase3-ledger-test.mjs` and `docs/PHASE_3_LOCATIONS_LEDGER.md`.
- Modified `src/routes/_authenticated/inventory.index.tsx` (Locations & transfers tab),
  `src/features/tailoring/index.ts` (canonical consumable quantity reader),
  `src/integrations/supabase/types.ts` (nine RPC typings),
  `scripts/phase1-schema-test.mjs` (bounded Phase 1 replay),
  `scripts/phase2-security-test.mjs` (optional full Phase 3 security replay),
  migration README and this history. Existing unrelated working changes preserved.

### Schema, relationships, constraints, indexes and data

New immutable `inventory_items` establishes one authority per individual Than,
consumable or Finished Product: exactly one unique FK, required unit, nonnegative
legacy quantity snapshot, reconciliation actor/time/reason. Added movement authority
FK and `movement_authority_required` constraint, conditionally validated when no
unlinked historical rows exist. Historical unlinked rows remain preserved and excluded
from new balances; their items cannot be reconciled silently.
Added movement item/time/id index. Transfer headers gain unique nullable request UUID,
payload and posted timestamp; legacy header values remain NULL.

Migration performs no business-data DML/backfill or stock/location guessing.
Owner's explicit reconciliation RPC locks an item, verifies legacy quantity and
identity/holds, and atomically records exact positive location allocations as opening
ADJUSTMENT events plus audit. Zero stock creates authority without fabricated movements.
Unreconciled items retain legacy quantity/history; reconciled items use only the new
ledger. No old migration, seed, configuration, financial data or historical event rewritten.

### Functions, triggers, views and decisions

14 new functions: `inventory_balance`, `guard_location_operations`,
`manage_showroom_location`, `guard_inventory_movement`, `guard_legacy_inventory_authority`,
`reconcile_inventory_item`, `post_inventory_transfer`, `record_inventory_correction`,
`guard_posted_transfer_history`, `inventory_catalog`, `inventory_locations`,
`inventory_location_balances`, `inventory_movement_history`, `material_available_qty`.
Replaced `thaan_available_mm` to read canonical quantity after reconciliation.
New security-invoker `v_inventory_location_balances`; replaced security-invoker
`v_thaan_stock` while preserving columns.

10 new triggers: `inventory_item_history_immutable`, `locations_operation_guard`,
`inventory_movement_balance_guard`, `legacy_movement_authority`, `legacy_hold_authority`,
`legacy_thaan_identity`, `legacy_material_authority`, `finished_product_location_authority`,
`transfer_history_guard`, `transfer_line_history_guard`.

Transfers lock items/locations in stable order, conserve global quantities, validate
each source balance, and post all lines/events/audit atomically. Request UUID/payload
enforces safe same-payload retry and rejects conflicting reuse. Posted history is immutable.
Ledger guards reject missing authority, inconsistent item/unit, actor/reason/direction,
negative stock and fractional/duplicate Finished Products. Product location/status follows
piece movements; entry returns to Workshop except explicitly reconciled existing stock.
SALE events require matching existing order lines; no sales workflow/API was implemented.
Owner corrections support explicit ADJUSTMENT/RETURN/WASTAGE; wastage is never automatic.
Dynamic Showroom children can be created/renamed and deactivated when empty; root
locations are protected. Fabric metres convert exactly to integer mm; consumables retain
their own units/precision, and Finished Products retain individual genealogy.

### Security / permissions

Owner alone manages locations, reconciles stock, transfers and corrects quantities.
No raw authenticated ledger writes; guarded RPCs enforce active-role checks.
Operational catalog/balance/history reads contain no CP, SP or production costs.
Assigned Tailors retain scoped material quantities; global balance views exclude partial
Tailor ledger reads. Anonymous execution and browser execution of private helpers revoked.
Existing Phase 2 financial restrictions remain intact; no role/permission seed changes.

### Tests and verification

Disposable PGlite 0.5.8/PostgreSQL 18.3, Supabase auth/storage shim and real authenticated
role/JWT fixtures; no live credentials used. Both full 13-migration paths and clean
no-demo replay tested. `phase3-ledger-test.mjs`: **230 checks passed**. Includes exact
100m Workshop → transfer 30m → 70/30m, test-only order-linked sale 4m → Showroom 26m /
global 96m, idempotency, whole-transfer rollback after late line failure, negative stock,
immutable history, holds/cutover, consumables, piece location/count/return, protected
locations, permission failures, CP/cost isolation and actual unit-conversion helpers.
`phase2-security-test.mjs --include-phase3`: **164 checks passed** against full schema.
Bounded Phase 1 schema regression: **278 checks passed**.
TypeScript `tsc --noEmit` passed; lint passed with eight existing Fast Refresh warnings.
Final production build passed in isolated source copy; generated build artifacts stayed
outside the repository. Existing build warnings remain; nothing deployed.
Migration mirrors match byte-for-byte; baseline hashes verify prior SQL unchanged.

### Limitations and intentionally pending work

Live Supabase migration/parity, PostgREST/browser/realtime and multi-connection races
remain unverified. Single-connection tests verify transactional rollback, not concurrent
races; locks are implemented and inspected. Physical location reconciliation remains an
explicit Owner operation. Historical unlinked domain rows need documented future migration
resolution where present. No automatic rollout/cutover performed.

Converted items reject legacy unlocated sale/receiving/hold writes until their scheduled
location-aware workflows arrive; UI warns before reconciliation. Unconverted legacy stock
continues on its original authority. Corrections lack transfer-style request keys; UI
does not automatically retry them; inspect history before repeating an uncertain correction.
Test-only sales/product fixtures verify relationships without implementing future workflows.
Phase 4 receiving/barcode/SP, Phase 5 sales and later reservations/material issues/production/
costing remain intentionally unimplemented. Stop after Phase 3 for user approval.

### Section 31 report

PHASE:
- PHASE 3 — Locations + Inventory Ledger only.

STATUS:
- Implemented and locally verified; live rollout remains pending.

IMPLEMENTED:
- Locations, explicit stock reconciliation, canonical balances, atomic transfers,
  corrections, history and operational inventory controls.

MODIFIED:
- New migration/mirror, appended journal, inventory tab, consumable quantity reader,
  RPC types, validation scripts and documentation/history.

REUSED:
- Phase 1 identities/locations/transfers, Phase 2 authorization, existing Auth and legacy history.

DATABASE CHANGES:
- One new logical migration with identical mirror; table/columns/index/constraints,
  functions/triggers/views/RLS/grants as recorded above. No production/manual changes.

SECURITY / PERMISSIONS:
- Owner mutations; scoped operational reads; CP/production costs remain protected.

TESTS:
- 230 Phase 3, 164 security and 278 Phase 1 checks passed; TypeScript/lint passed.

BUILD:
- Production build passed in isolated source copy; not deployed.

BUSINESS RULES VERIFIED:
- Exact location/global arithmetic, no negative stock/automatic wastage, atomic transfers,
  immutable traceable history, unit/piece integrity and financial access boundaries.

REMAINING:
- Live/browser/concurrency verification, explicit reconciliation and deferred workflow cutovers.

NEXT PHASE:
- PHASE 4 only after approval. Stopped; no Phase 4 implementation.

## 3 October 2026 — PHASE 4: Fabric Stock Entry + One Barcode

### Objective, authority and baseline

User explicitly approved starting Phase 4. Re-read Phase 4, terminology/roles,
CP/SP/barcode/stock rules, integrity and Sections 30–31 in the Master Plan, the
operations guide, Phase 0 receiving/barcode/pricing findings and Phase 1–3 contracts
and history. The verified schema already had one Fabric + Batch identity, internal
Than relationships, append-only prices/costs, authorization and location ledger.
Legacy receiving UI still created one roll barcode per Than and required SP before
activation. Implemented only the Phase 4 replacement entry/label/scan/pricing flow.

### Files changed

- New canonical migration `supabase/migrations/20261003000300_phase4_fabric_receiving_barcode.sql`.
- Identical mirror `drizzle/migrations/0013_phase4_fabric_receiving_barcode.sql`;
  appended `drizzle/migrations/meta/_journal.json` index 13; prior entries retained.
- New `src/features/inventory/FabricStock.tsx`, `fabric-label.ts`, `fabric-entry-input.ts`.
- Replaced receiving route's deprecated per-roll entry UI in
  `src/routes/_authenticated/inventory.receiving.tsx`; modified Inventory route
  to default to Fabric Stock/scan and retain historical rows separately;
  `src/routes/_authenticated/pos.tsx` adds authorized Fabric Barcode lookup only.
- `src/integrations/supabase/types.ts`: seven new API definitions and existing scoped
  domain CP API typing. No fabricated generated table contract.
- New `scripts/phase4-fabric-test.mjs`, `scripts/phase4-label-test.mjs`.
  Phase 1 script bounds its replay; Phase 2/3 scripts accept `--include-phase4`.
- `package.json` / lockfile: local JsBarcode 3.12.3 dependency; retained pre-existing
  package/configuration edits. No barcode SaaS or runtime network generator.
- New `docs/PHASE_4_FABRIC_RECEIVING_BARCODE.md`; migration README and this history.
  No other source/config/seed changes intended; unrelated existing work preserved.

### Migration, schema and data operations

One logical migration, two identical execution-path files; apply one chain only.
Both SHA-256: `5efc287ff1d1781858415ad68ab24dd110eaae1a995ad1c63a397ae225acd23b`.
No prior migration renamed, edited, deleted, squashed or rewritten.
New `fabric_entry_requests`: request UUID primary key, unique Fabric Stock FK,
required creator/profile FK, private JSON payload and timestamp. PK/unique indexes
support idempotent creation and one request per stock; no other explicit indexes or
existing-table columns added. CP-bearing request data stays separate from public stock.

No business-data DML/backfill occurs during migration. Existing Fabric IDs, pairs,
labels, lengths, CP/SP snapshots, locations, historical movements and seeds preserved.
Runtime authorized draft creation transaction creates one Fabric Stock and stable
fabric-kind barcode, positive variable-length internal Thans with NULL roll labels,
CP revision, private retry record and audit. Draft updates validate every existing
row and append CP, with full rollback on failure; no row deletion or count rewriting.
Completion atomically creates one inventory authority and Workshop INWARD event per
Than, activates stock and closes scoped CP entry; SP remains optional. It creates no
legacy ledger events and no WASTAGE. Repeated completion does not duplicate stock.
Multi-fabric batches close only after remaining drafts are completed.

### Functions, triggers, views and decisions

Nine new functions: `can_receive_fabric`, `create_fabric_entry`, `update_fabric_entry`,
`complete_fabric_entry`, `open_fabric_cp_correction`, `owner_set_fabric_sp`,
`fabric_stock_catalog`, `fabric_stock_history`, `guard_phase4_fabric_identity`.
Three new triggers: `fabric_entry_request_immutable`, `phase4_stock_identity`,
`phase4_than_identity`. Replaced security-invoker `v_thaan_overview` preserves columns,
uses canonical Phase 3 quantity/holds and old/new timestamps, and excludes optional SP
from internal-Than incompleteness. Existing dashboard quantity sums therefore count receipts.
Existing Phase 2 `domain_stock_entry_cp` reused unchanged for current CP and append-only
workflow corrections. Full function contracts are in the Phase 4 documentation.

Code 128 uses stable `FAB-` plus stock UUID identifier; no CP/SP/quantity embedded.
Fabric catalogue ID/code and Batch retained; each physical Than has internal UUID only.
Owner SP revisions lock stock, append actor/time/reason/audit and preserve barcode.
Legacy prices/labels are not rewritten or automatically relabeled. Backend rejects
new authenticated per-Than label creation and new-model per-Than SP copies; old rows
stay usable in their legacy workflows. New receipt ownership and identity are protected.

Owner alone opens completed CP correction; only Owner/original authorized Stock Entry
can use the open workflow. Closing correction posts no extra receipt or quantity change.
Creation retries require same creator/UUID/payload; mismatches rejected. UI retains
retry UUID within the form, not across reloads. Saved draft edits and completion are
separate transactions: a failed receipt may retain a valid saved draft/CP revision but
never partial inward events. Existing physical lengths cannot change after receipt.

### Permissions / RLS and UI

Owner-only SELECT RLS for CP-bearing request payload; no authenticated raw writes.
New definer APIs independently check active operational/receiving roles and ownership;
PUBLIC/anon execution revoked. Private role predicate/trigger browser execution revoked.
Existing financial/history RLS and role/permission seeds unchanged. Safe catalogue,
exact barcode lookup and invoker movement history return no CP or production costs.
Counter scans same barcode and sees latest SP, available quantity and locations.
Closed Stock Entry CP reads/edits remain rejected; no ongoing CP history or reporting.

Receiving inputs Fabric/Batch, individual lengths, CP; generates draft label and completes
Workshop receipt without SP. Inventory groups by Fabric Stock and offers Owner pricing.
Counter route reuses the lookup without adding sales/transfer workflows or module access.
Print frame contains only the identity label, with Code 128 quiet zones, no financial
fields. Manual input and keyboard-wedge scanners supported; camera capture not implemented.
Metres convert exactly to mm; money validates exact two-decimal/safe integer paise.
Phase 2 session/cache isolation retained; completion clears local/scoped CP state,
mutations refresh server data. UI compilation is verified; live/browser behavior is not.

### Validation and results

- `phase4-fabric-test.mjs`: **228 checks passed**, both full 14-migration chains and
  clean no-demo replay in disposable PGlite 0.5.8/PostgreSQL 18.3. Actual authenticated
  roles/JWT identities verify variable Than lengths, exact totals, optional SP, Workshop
  receipts, no double-counting, idempotency, duplicate-pair/request rejection, late-row
  entry/edit/completion rollback, batch closure, closed CP/correction scope, private
  payload, unchanged barcode, price history, Counter CP denial, inactive/Tailor/anon
  denial, per-roll creation rejection and post-transfer catalogue/location totals.
- `phase4-label-test.mjs`: **25 checks passed**. Actual UI encoder decoded by independent
  ZXing 0.23.0 Code128Reader for short/new UUID/historical UUID identifiers at three
  module scales, plus exact money input checks. Decoder installed only in temporary
  test runtime; app dependency is JsBarcode 3.12.3 (MIT).
- Full Phase 4 schema: **164 Phase 2 security** and **230 Phase 3 ledger** checks passed.
  Bounded Phase 1 regression: **278 checks passed**. No application .env/live DB used.
- TypeScript `tsc --noEmit` passed; lint passed with eight existing Fast Refresh warnings.
  Production build passed in isolated source copy; build artifacts remain outside repo,
  existing build warnings retained; nothing deployed.
- New migration mirrors match; baseline comparison verifies old SQL, master plan,
  operations guide and unrelated source/configuration unchanged. No live/manual database
  operations, deployment, seed changes, Git commits/pushes or published-history rewrites.

### Remaining / intentionally not changed

Live Supabase/PostgREST/Auth/browser validation, physical printer/scanner verification,
realtime and multi-connection lock races remain unverified. Disposable single-connection
tests verify atomic rollback/authorization and symbol decoding, not physical hardware.
Existing unknown locations, missing identities and conflicting legacy CP/SP remain explicit
reconciliation tasks; no guessed migration repair. Historical unlinked receipts after
Phase 1 need documented resolution where present. Draft Than count is fixed at creation;
length corrections preserve rows, no deletion/replacement workflow invented.

New Fabric Barcode enables scan/price/availability; it cannot use legacy per-roll sale
RPCs. Location-aware sales are Phase 6, not this phase. Existing legacy price snapshots
remain until that scheduled cutover; Owner Fabric Stock SP does not silently overwrite
legacy roll SP. Phase 5 transfer refinements and all later tailoring, materials,
production, costing, reservations, reporting and audit expansion remain unimplemented.
Stopped after Phase 4; wait for approval.

Phase-number clarification: earlier Phase 3 notes referred to a future sale cutover
as Phase 5. The Master Plan specifies Phase 5 Workshop ↔ Showroom Transfer and
Phase 6 Direct Fabric Sale. This entry uses those authoritative phase numbers;
no sales phase was implemented by that earlier shorthand or by Phase 4.

### Section 31 report

PHASE:
- PHASE 4 — Fabric Stock Entry + One Barcode only.

STATUS:
- Implemented and locally verified; live rollout pending.

IMPLEMENTED:
- Fabric/Batch internal Than receiving, CP workflow, stable single barcode, label,
  scanning, SP-optional Workshop receipt and Owner SP revisions.

MODIFIED:
- Receiving/Inventory/Counter lookup UI, API types, new migration/mirror/journal,
  barcode dependency, validation scripts and documentation/history.

REUSED:
- Existing catalogue/batches, domain identities/financial versions, Auth/RLS, scoped
  CP endpoint, Phase 3 ledger and session isolation.

DATABASE CHANGES:
- One new logical migration; private request table/keys/RLS, nine functions,
  three triggers and canonical overview replacement. No migration backfill/live writes.

SECURITY / PERMISSIONS:
- Active Owner/Stock Entry receiving scope, closed CP denial, Owner SP/correction
  opening, Counter safe scan, CP-bearing retry payload restricted, anon APIs revoked.

TESTS:
- 228 Phase 4, 25 barcode/money, 164 security, 230 ledger and 278 schema checks passed;
  TypeScript/lint passed (eight existing warnings).

BUILD:
- Production build passed in isolated copy; not deployed.

BUSINESS RULES VERIFIED:
- Stock Entry creates one barcode; Workshop receipt can omit SP; Owner sets SP;
  Counter scans same unchanged barcode, sees SP and cannot retrieve CP.

REMAINING:
- Live/browser/hardware/concurrency validation and explicit legacy reconciliation;
  scheduled location-aware sales remain pending.

NEXT PHASE:
- PHASE 5 — Workshop ↔ Showroom Transfer, only after approval. Stopped.

## 3 October 2026 — PHASE 5: Workshop ↔ Showroom Transfer

### Objective, authority and verified baseline

User explicitly approved Phase 5. Re-read its source/destination/quantity/transfer/
history/resulting-balance requirements, one Fabric + Batch barcode rule, movement
integrity and Sections 30–31; inspected Phase 0 findings and Phase 3–4 implementation
records, transfer guards/RLS and current screens. Phase 3 already correctly implements
atomic posting, stable locks, source balance/units, idempotency, immutable ledger and
posted transfers. Phase 4 provides received internal Thans and one Fabric Barcode.
Reused those correct operations unchanged; added the missing business-facing Fabric
Barcode transfer flow, grouped transfer documents and Fabric Stock cache refreshes.
Only Phase 5 implemented; no Phase 6 sale/order/deduction workflow.

### Files changed

- New `supabase/migrations/20261003000400_phase5_transfer_history.sql` and identical
  `drizzle/migrations/0014_phase5_transfer_history.sql`; journal index 14 appended.
- New `src/features/inventory/FabricTransfer.tsx` and `fabric-transfer.ts` helper.
- `src/features/inventory/LocationLedger.tsx`: integrates Owner Fabric Stock transfers;
  retains existing generic forms; refreshes Fabric Stock and document caches on settling,
  including uncertain failures. Existing generic success toast retained.
- `src/integrations/supabase/types.ts`: one transfer-history RPC definition.
- New `scripts/phase5-transfer-test.mjs`; Phase 1 replay remains bounded, Phase 2–4
  scripts accept optional `--include-phase5` full-chain regression.
- New `docs/PHASE_5_STOCK_TRANSFERS.md`; migration README and this permanent history.
  No package, configuration, role navigation, receiving, sale or financial source changes.

### Migration, schema, permissions and preservation

One logical migration, two execution-path copies; apply one chain only. Both SHA-256:
`76edaf7ba87880d4fb7dc87599ec1509e354192fe9d2ca403cfc42294aa48a72`.
New `stock_transfer_history(uuid DEFAULT NULL,integer DEFAULT 50)` is STABLE,
SECURITY INVOKER with fixed search path and explicit active Owner requirement. It
returns posted document references, named locations, actor/time/reason and original
lines including Fabric + Batch barcode, internal Than/item, quantity/unit and movement
ID/actor/time. Optional stock filter selects matching documents with all original lines;
limit clamps to 1–200. Authenticated execution granted; PUBLIC/anon revoked.
Existing table RLS applies. No financial table joined or CP/SP/cost field returned.

No new/altered tables, columns, relationships, constraints, indexes, views, triggers,
role/policy seeds or data/backfill. Existing `post_inventory_transfer`, lock/negative-
stock guards, balance view, posted-history guards and financial policies unchanged.
Existing item/transfer/movement relationships are reused. No live migration, manual
database writes, guessed locations, ledger duplication, historical data/labels or
CP/SP overwrite. Prior migration SQL byte-for-byte preservation and identical new
mirrors verified against beginning-of-phase fingerprints.

### Business / technical decisions and resulting behavior

Owner selects/scans one Fabric Barcode, active source/destination (Workshop, Showroom
or dynamic Showroom child), explicit internal Than quantities and reason/reference.
Individual source quantities, total transfer and prospective resulting balances are
shown. No unspecified automatic physical-roll allocation rule invented; blank/zero
inputs skip rows. Unlocated items require existing explicit reconciliation. Backend
checks balances under existing locks and posts all header/lines/events/audit together.
Equal subtraction/addition conserves global quantity; no automatic WASTAGE.

The actual UI helper validates exact integer mm, authority, duplicate/overdraw choices
and deterministic inventory-ID ordering. Unchanged failed/uncertain request retains
its UUID; retry can submit its original payload even if it already depleted the source,
because backend detects existing posted request before another deduction. This exception
only skips the frontend preview balance check for that same pending payload; backend
checks remain unchanged. Altered payload uses a new request. No automatic retry/reload
persistence: history must be checked after an uncertain submission across reloads.

After success, transfer ID/quantity/direction and refreshed current balances/history
are visible. Displayed balances are current ledger reads, not invented historical
snapshots. Refresh covers location ledger, Fabric Stock, its movement history, transfer
documents, Than overview and dashboard; Phase 2 session boundaries remain intact.
Mutation/document reader remain Owner-only; operational nonfinancial ledger readers
and existing generic item transfers retained. No extra Counter/Stock Entry/Tailor/
E-commerce transfer authority or financial permission inferred.

### Tests, build and verification

- **171 Phase 5 checks passed**, actual Phase 4 receipt → Phase 5 transfer flow across
  both full 15-migration paths and clean no-demo chain. Disposable PGlite 0.5.8 /
  PostgreSQL 18.3, actual authenticated role/JWT fixtures; no .env/live connection.
- 100m Workshop → transfer 30m → 70m Workshop / 30m Showroom; reverse 12m → 82m/18m;
  5m dynamic-floor transfer and return → 87m Workshop / 13m Showroom / 0m floor.
  Total and one Fabric Barcode remain unchanged; each Than/event/user/time traceable.
- Same request/payload posts one document, one event per line and one audit; conflicting
  retry rejected. Full-source transfer followed by same request succeeds idempotently.
  Same-location, zero/fractional/overdraw/duplicate/unknown item, missing reason and
  inactive location rejected. Forced test-only failure on later line verifies rollback
  of earlier line, header, movements and audit. Test trigger exists only in disposable DB.
- Document stock filter/limits, no financial fields, immutable posted header/lines,
  unauthorized/inactive/anonymous API denial and CP restrictions verified. Actual UI
  planning helper tested for exact units, stable payload ordering and uncertain retry.
- Full Phase 5 schema regression: **164 Phase 2 security**, **230 Phase 3 ledger** and
  **228 Phase 4 receiving** checks passed. **278 bounded Phase 1 schema** checks passed.
- TypeScript `tsc --noEmit` passed; lint passed with eight existing Fast Refresh warnings.
  Production build passed in isolated source copy; build artifacts stay outside repo;
  existing build warnings remain. No deployment, Git commits/pushes or history rewriting.
- Baseline hashes verify old migrations, packages/configuration, Master Plan, operations
  guide and unrelated source unchanged. Existing working changes retained.

### Limitations / intentionally pending

Live Supabase/PostgREST, actual authenticated browser rendering/cache behavior, hardware
scan, realtime and multi-connection races remain unverified. Single-connection tests
verify transactional rollback and access; existing locks inspected, not race-tested.
Legacy physical location/identity/CP-SP reconciliation remains explicit. New UI history
shows latest 50 documents; API bounded to 200, no unrequested reporting/pagination added.
No historical balance snapshots invented. No future location-aware sales/Orders,
Customer Tailoring, material issues, production, costing or reservations implemented.
Stopped after Phase 5; wait for approval before Phase 6.

### Section 31 report

PHASE:
- PHASE 5 — Workshop ↔ Showroom Transfer only.

STATUS:
- Implemented and locally verified; live rollout pending.

IMPLEMENTED:
- Fabric Barcode transfer flow, explicit internal Than quantities, named directions,
  balance preview/refreshed results, safe retries and grouped transfer-document history.

MODIFIED:
- Location Ledger UI/cache refresh, API type, new history migration/mirror/journal,
  acceptance/regression scripts and documentation/history.

REUSED:
- Existing Phase 3 atomic posting/ledger/guards and Phase 4 Fabric + Batch receiving identity.

DATABASE CHANGES:
- One new logical migration adding Owner-guarded invoker history reader and EXECUTE
  privileges only; no schema/data backfill, old SQL rewrite or live/manual DB changes.

SECURITY / PERMISSIONS:
- Owner mutation/document access, existing operational reads, CP/SP/cost boundaries retained.

TESTS:
- 171 Phase 5, 164 security, 230 ledger, 228 receiving and 278 schema checks passed;
  TypeScript/lint passed (eight existing warnings).

BUILD:
- Production build passed in isolated copy; not deployed.

BUSINESS RULES VERIFIED:
- Workshop ↔ Showroom/sublocation transfers, exact balances/conserved total,
  no negative stock/automatic wastage, atomic rollback/idempotency and immutable traceability.

REMAINING:
- Live/browser/hardware/concurrency verification and explicit legacy reconciliation.

NEXT PHASE:
- PHASE 6 — Direct Fabric Sale, only after approval. Stopped.

## 2026-10-03 — PHASE 6: Direct Fabric Sale

### Authorization, objective and verified baseline

User approved starting Phase 6. Re-read the operations guide, authoritative Master
Plan Phase 6 and relevant sale/history/security/execution/report requirements and
Phase 0–5 findings before implementation. Implemented **Phase 6 only**: Fabric
Barcode scan, SP retrieval, customer sale, quantity deduction, Order, Order History
and Owner-only CP visibility. No Phase 7 implementation, deployment or live DB write.

Baseline: canonical Fabric + Batch barcode, internal Than rows, Owner SP revisions,
scoped receiving CP and located stock existed. Legacy Counter sold per-roll stock
through the old ledger; it could not sell reconciled stock. Phase 1 Order tables had
no location-aware Counter checkout/history. Reused those tables and Phase 3 movement
guards instead of creating another inventory authority or dual-writing legacy sales.
Requirement mapping and full schema/API contract: `docs/PHASE_6_DIRECT_FABRIC_SALE.md`.

### Files actually changed / created

- New canonical SQL `supabase/migrations/20261003000500_phase6_direct_fabric_sale.sql`.
- New identical mirror `drizzle/migrations/0015_phase6_direct_fabric_sale.sql` and
  appended index 15 in `drizzle/migrations/meta/_journal.json`.
- New `src/features/pos/DirectFabricSale.tsx`: scan, current SP, per-location internal
  Than cuts, multi-fabric cart, existing-customer/walk-in selection, received-payment
  confirmation, atomic checkout, unchanged uncertain retries, receipt/order history
  and Owner-only historical CP query.
- New `src/features/pos/fabric-sale-input.ts`: exact quantity validation and BigInt
  price rounding matching PostgreSQL, safe amount limits.
- `src/routes/_authenticated/pos.tsx`: attach new flow, update Counter description,
  label preserved legacy lookup separately, autofocus new Fabric Barcode scan.
- `src/integrations/supabase/types.ts`: four new typed RPC contracts.
- New `scripts/phase6-sale-test.mjs`; Phase 1 test excludes Phase 6 to retain its
  historical bounded scope. Phase 2–5 scripts add opt-in full-chain `--include-phase6`.
- New `docs/PHASE_6_DIRECT_FABRIC_SALE.md`, updated migration README, this appended record.
- No packages/configuration, seeds, old SQL, roles, Master Plan, operations guide,
  session boundary code or unrelated source changed. Existing dirty work preserved.

### Migration record — database changes actually made in source

Filename/purpose: `20261003000500_phase6_direct_fabric_sale.sql` adds canonical direct
sale checkout and protected historical Orders. Mirror `0015_phase6_direct_fabric_sale.sql`.
Both SHA-256: `8652e05d27628b7c8456823d76aec0a2edbf948814763218f166292afba1d56f`.
Journal: index 15, version 7, `when=1790985900000`, breakpoints true. Apply one chain.

- `orders`: new nullable `sale_request_id uuid UNIQUE`, `sale_request_payload jsonb`,
  `customer_snapshot jsonb`, `completed_at timestamptz`, `payment_confirmed_at timestamptz`.
  Existing rows get NULL; previous values/relationships remain intact.
- Indexes: partial `phase6_sale_history_idx` on new Order creation time/ID;
  partial `phase6_sale_movement_idx` on SALE order item. Nonunique movement index
  preserves unknown existing history; new duplicate SALE events are guarded under lock.
- Existing customer/location/Order/item/Than/Fabric Stock/financial/event FKs,
  quantity/unit and nonnegative-price constraints reused. No new table/FK needed.
- New guarded SECURITY DEFINER APIs (fixed public search path):
  `direct_fabric_sale_catalog(text)` returns safe identity/SP/revision/located cuts;
  `complete_direct_fabric_sale(uuid,uuid,jsonb,uuid,boolean,text)` posts atomically;
  `direct_fabric_order_history(uuid,integer)` returns safe completed documents,
  default 50/max 200. History intentionally uses a safe definer projection so Counter
  batch-name access does not require broader legacy receiving-batch RLS.
- New `owner_direct_fabric_order_costs(uuid)` is Owner-checked SECURITY INVOKER,
  returning saved CP-per-metre under existing financial RLS.
- New private `guard_phase6_order_history()` and `guard_phase6_sale_movement()`;
  three new triggers protect completed headers/items and reject duplicate/closed-order
  SALE posting. Existing append-only financial and ledger guards remain unchanged.
- Replaced `guard_phase4_fabric_identity()` **in the new migration only**. All original
  ownership/barcode/SP/permanent-row checks retained; narrowly allows Counter
  active → depleted with otherwise unchanged Than fields and zero global ledger stock.
- Two Counter SELECT policies on completed direct-sale Orders/items. No new raw write
  grants or cost-read policy. Owner financial RLS and role/permission ceilings retained.
  Public/anonymous EXECUTE revoked; authenticated EXECUTE checked inside all APIs;
  trigger helpers private. No privilege for Stock Entry, Tailor or E-commerce Manager.
- Data/backfill: **none**. All new Order/item/snapshot/event/audit writes occur only
  through authorized checkout, not migration DML. No manual/live DB operation.
- Verification: both full 16-file migration chains apply in disposable PostgreSQL;
  clean no-demo chain also applies. Snapshot tests preserve existing Than/Fabric Stock,
  old/new movements, financial and audit rows across the new migration. Historical
  migration files and unrelated files match start-of-phase SHA-256 fingerprints.

### Business / technical decisions and resulting behavior

One Fabric + Batch barcode remains stable; actual Than cuts are explicit. One source
per sale may be Workshop, Showroom or active dynamic Showroom sublocation. Unlocated
legacy stock must first use existing explicit Owner reconciliation. Sales deduct only
the selected source; transfers conserve stock; global zero marks the Than depleted.
No negative stock, automatic WASTAGE, invented roll allocation or duplicate authority.

Server locks request → sorted Fabric Stock parents → sorted inventory IDs → location.
Parent locks also serialize Owner price revisions. Each quoted SP version must match
the latest Owner revision at checkout; missing/stale SP rejects the entire transaction.
Explicit zero SP is allowed. Line amount is rounded integer paise from exact mm ×
SP/metre; order total sums rounded lines. The real UI helper uses matching BigInt
half-up rounding. No float-based inventory calculation or client price override.

Current CP and SP are saved separately per Order item. Counter receives SP/final
amounts only; CP never enters safe catalogue/history/request/receipt JSON. Owner sees
both. Missing legacy CP remains NULL/Unknown, not SP or zero. Later CP/SP revisions
cannot rewrite snapshots. Existing-customer contact is snapshotted; walk-in remains
supported by the existing optional-customer direct-sale model. Customer management
and Customer Tailoring are deferred to Phase 7.

Payment is an explicit operator attestation that the customer paid, timestamped in
Order; no payment gateway/accounting ledger invented. Transaction creates draft
Order → items/private financials/SALE events → completes Order → audit, all atomic.
It does not also create legacy sales or stock_movements and deduct twice.
Completed new Order headers/items, private financials and movements are permanent.

Exact creator/payload/request retry returns the original completed Order before
stock/SP validation, including after full-location/global depletion or later price
revision. Different payload/Counter is rejected; Owner may retrieve a matching
posted request. An uncertain browser response retains UUID and freezes cart edits;
explicit DB rejection unlocks editing. No automatic retry or cross-reload persistence:
keep page open to resolve, or inspect Order History before submitting again after reload.
Refreshing a changed SP does not silently reprice staged cuts: remove/re-add and review.

Settlement invalidates new sale, Fabric Stock/history, location ledger, Than/movement,
dashboard-metrics and customer queries. Existing identity/role cache clearing remains
in force. Legacy POS/tailoring stays available separately; no future-phase rewrite.

### Tests, verification, build and limitations

- **238 Phase 6 acceptance checks passed**, across canonical/mirror demo chains and
  canonical clean chain: actual authenticated/JWT Owner/Counter/Stock Entry/Tailor/
  E-commerce Manager fixtures in PGlite 0.5.8/PostgreSQL 18.3. No .env/live credentials.
- 100m Workshop receipt → 30m Showroom transfer → 4m sale gives 70m Workshop,
  26m Showroom, 96m global. Stable Fabric Barcode and exact Order/event identity verified.
- Multi-Than checkout, atomic late-line rejection, source overdraw, missing customer/
  source/payment/SP, stale SP, invalid/fractional/zero/duplicate cuts rejected. Full
  location/global depletion retries return the same document without double deduction.
- Explicit zero SP, database/UI half-paise rounding, dynamic Showroom sale, inactive
  source rejection, reconciled legacy CP Unknown, saved CP/SP after revision verified.
- Counter safe history and raw financial denial, private helper denial, unauthorized/
  inactive/anonymous API denial, cross-Counter retry denial, one audit after retries,
  completed header/item/financial immutability and duplicate SALE rejection verified.
- Final full-chain regressions: **164 Phase 2 security**, **230 Phase 3 ledger**,
  **228 Phase 4 receiving**, **171 Phase 5 transfer** checks passed. **278 bounded
  Phase 1 schema checks** passed. Total 1,309 checks across these suites.
- TypeScript `tsc --noEmit` passed; lint passed with eight existing Fast Refresh warnings.
  Production build passed in isolated source copy; generated artifacts remain outside
  repository. Existing build warnings remain; no deployment/commit/push/history rewrite.
- Live Supabase/PostgREST, actual authenticated browser/cache rendering, scanner hardware,
  realtime and multi-connection races remain unverified. Locks inspected; isolated
  single-connection tests verify transactions and authorization, not concurrent scheduling.
- UI shows latest 50 completed new direct-sale Orders; API capped at 200. Full reporting,
  invoices/exports, payment integrations, cancellations/returns and Phase 7+ remain pending.

### Section 31 report

PHASE:
- PHASE 6 — Direct Fabric Sale only.

STATUS:
- Implemented and locally verified; live rollout pending.

IMPLEMENTED:
- Fabric Barcode scan, current SP, explicit located Than cuts, customer sale,
  atomic Order/SALE posting, safe retries/history and Owner CP snapshots.

MODIFIED:
- Counter route, RPC types, new migration/mirror/journal, regression scripts and documentation.

REUSED:
- Phase 1 Order tables, Phase 2 roles/RLS, Phase 3 ledger/locations and Phase 4 barcode/prices.

DATABASE CHANGES:
- One new logical migration, five Order columns, unique request identity, two indexes,
  guarded APIs/history triggers and two Counter read policies; no data backfill/live change.

SECURITY / PERMISSIONS:
- Owner/authorized Counter checkout; CP history Owner-only, all other roles denied.

TESTS:
- 238 Phase 6 plus 1,071 regression/schema checks passed; TypeScript/lint passed.

BUILD:
- Production build passed in isolated copy; not deployed.

BUSINESS RULES VERIFIED:
- One Fabric + Batch barcode, exact location deductions/SP prices, no negative stock,
  automatic wastage or double posting, permanent CP/SP snapshots and role boundaries.

REMAINING:
- Live/browser/hardware/concurrency validation and explicit legacy reconciliation.

NEXT PHASE:
- PHASE 7 — Customer + Customer Tailoring, only after approval. Stopped after Phase 6.

## 2026-10-03 — PHASE 7: Customer + Customer Tailoring

### Authorization, objective and baseline

User approved starting Phase 7. Reviewed the operations guide, authoritative Master Plan
Phase 7, sections 10–13/23/27/30/31, relevant Phase 0 findings and Phase 1–6 history,
and inspected current migrations, roles/RLS, customers, hierarchy, prices, ledger,
Orders and legacy Counter/Tailoring screens. Implemented **Phase 7 only**.

Customer creation/WhatsApp and ledger authorization were reusable. Phase 1 business
hierarchy, job/charge/requirements/issues/Order tables existed, but existing UI used
legacy jobs and lacked a canonical CP-plus-charge booking flow. Counter had no
canonical customer job creation, required located issue, bill or safe cost-derived price.
Requirement mapping and full contract: `docs/PHASE_7_CUSTOMER_TAILORING.md`.

### Files actually created / changed

- New canonical migration `supabase/migrations/20261003000600_phase7_customer_tailoring.sql`.
- Identical new mirror `drizzle/migrations/0016_phase7_customer_tailoring.sql`; journal
  index 16 appended in `drizzle/migrations/meta/_journal.json`.
- New `src/features/tailoring/CustomerTailoring.tsx`: safe catalogue, Fabric Barcode
  scan, source/internal Than cuts, customer and Factory → Section → Tailor selection,
  applicable charge, final quote, atomic booking/retries, existing-job/history selection,
  audited statuses, bill printing and conditional Owner historical-cost query.
- New `CustomerTailoringCustomer.tsx`: existing-customer selector and reusable
  deduplicating customer/contact creation, including WhatsApp number.
- New `CustomerTailoringSetup.tsx`: minimum Owner business-assignment bootstrap and
  configurable charge revisions; no hardcoded charge or separate Factory login role.
- New `customer-tailoring-input.ts`: exact mm validation and deterministic retry cuts.
- New `customer-tailoring-bill.ts`: escaped explicit customer-safe HTML projection,
  exact integer-paise display and native bill print window; Owner cost data excluded.
- `src/routes/_authenticated/pos.tsx` and `tailoring.tsx`: attach new workflow to Counter
  and Owner/assigned-Tailor screens, update descriptions and label legacy jobs/stats.
- `src/integrations/supabase/types.ts`: eight new public RPC contracts.
- New `scripts/phase7-tailoring-test.mjs`; Phase 1 test excludes Phase 7 to retain
  bounded historical scope; Phase 2–6 scripts support full-chain `--include-phase7`.
- New `docs/PHASE_7_CUSTOMER_TAILORING.md`, migration README update, this appended record.
- Existing customer RPC/hooks, legacy job/stock code, Phase 6 checkout, session/role
  boundaries, packages/configuration, seeds, Master Plan, operations guide and unrelated
  dirty work preserved. All older migration files match start-of-phase fingerprints.

### Migration record — schema / constraints / relationships / indexes

Migration purpose: private CP-plus-charge quotes and guarded canonical customer-job
booking, required fabric issues, Orders/bills/history and assigned job statuses.
Canonical `20261003000600_phase7_customer_tailoring.sql`; identical mirror
`0016_phase7_customer_tailoring.sql`. Both SHA-256:
`ce8a20195a72705974de8fdb2fdf3f60ad0cfe78651f5a818cf858e08ddb5722`.
Journal: index 16, version 7, `when=1790985960000`, breakpoints true. Apply one chain.

- New `customer_tailoring_quotes`: UUID PK; profile/source location/charge-version FKs;
  array-only cuts JSON; nonnegative BIGINT fabric CP total and applicable charge;
  generated final price = sum; creator/time. Private cuts save inventory/Than/stock IDs,
  exact quantity, CP revision ID/unit value/rounded amount. JSON references are guarded
  RPC-derived values, not new relational FKs. Quotes are immutable and Owner-only.
- `customer_tailoring_jobs`: new nullable unique request UUID, request payload JSON
  and unique quote UUID FK. Payload contains quote/customer/assignment/garment/notes,
  never CP. Existing rows get NULL without rewriting prior values.
- `orders`: new nullable unique tailoring request UUID; reuse customer_snapshot and
  completed_at from Phase 6. Existing customer/job/source FKs and identity checks retained.
- New partial indexes: `phase7_jobs_history_idx` (new job creation time/ID) and
  `phase7_issue_movement_idx` (Material Issue line references). Unique indexes are also
  generated by the three new unique column constraints. No uniqueness backfill against
  unknown old movement history; duplicate new issue events are rejected under item lock.
- Reused requirements, material issues/lines, Order items/private financials, generated
  customer price and inventory movement tables/constraints/FKs. Tailoring Order item
  is one job, SP NULL. Its CP snapshot is aggregate job fabric cost; quote cuts hold
  per-metre CP. Applicable charge snapshot is the exact selected version amount.
- Data/backfill: **none**. No migration DML, automatic legacy conversion, manual/live
  database change, old SQL rewrite, schema deletion or seed/config modification.

### Functions / triggers / permissions

Eight new public APIs, all active-role checked with PUBLIC/anon execution revoked
and authenticated execution granted. Definers use fixed public search path:

- `setup_customer_tailoring_assignment(text,text,text,text,text,text,uuid)`: Owner;
  create/reuse matching active Factory, optional Section, real Tailor/current assignment.
  Optional profile must be an active Tailor login. Same setup returns same assignment;
  identity mismatch/reassignment rejected; creation audited.
- `set_customer_tailoring_charge(text,text,bigint)`: Owner; configure applicable named
  amount through append-only versions/audit; identical current amount returns same revision.
- `customer_tailoring_catalog()`: Owner/Counter; operational located Fabric Stock,
  filtered active hierarchy and charge names/version IDs. No CP/SP in output; applicable
  charge amount appears only for Owner. Reuses safe operational barcode catalogue.
- `quote_customer_tailoring(uuid,jsonb,uuid)`: Owner/Counter + `pos.issue_to_tailoring`;
  creates immutable private quote from current CP and charge; returns quote ID and
  final customer price only. No reservation or movement is made by quoting.
- `create_customer_tailoring(uuid,uuid,uuid,uuid,text,text)`: same authorization;
  validates owned/unbooked quote, current CP/charge, customer, active assignment/hierarchy,
  exact cuts and source; atomically writes job/price/requirements/required issue/events/
  Order/private financials/audit. Returns job ID only.
- `set_customer_tailoring_status(uuid,text)`: Owner/Counter with job/operational permission,
  or assigned Tailor with job permission. Reuses existing operational status values
  open/in_progress/ready/delivered/cancelled without an unspecified transition graph.
  Audited; status does not automatically return material, issue more stock or reprice.
- `customer_tailoring_history(uuid,integer)`: safe definer projection; Owner/Counter
  new jobs, Tailor only assigned jobs. Final price only for Owner/Counter; NULL for
  Tailor. Returns contact snapshot, status, assignment/source/quantity, issue and event
  references, actor/time/order. Default 50/max 200.
- `owner_customer_tailoring_costs(uuid)`: Owner-checked SECURITY INVOKER, protected by
  financial/quote RLS; returns original CP/charge/version/cut breakdown for booked job.

Two private new functions: `guard_phase7_history()` and `guard_phase7_issue_once()`.
Six triggers total: immutable quote; booked job/header/item safeguards; requirement
must match quote exactly once and cannot later be rewritten; duplicate issue-line
posting rejected under the same authority lock. Existing append-only issue, price,
financial and movement guards and Phase 6 Counter-depletion safeguard reused unchanged.

New quote RLS: Owner SELECT only, authenticated SELECT with RLS, service-role ALL;
no authenticated raw mutation grants. Two Counter SELECT policies on completed new
tailoring Orders/items. Existing job/requirements/assigned-issue RLS and Owner financial
policies retained. No role/permission seeds, cost override delegation or Factory login.
Stock Entry/E-commerce Manager cannot quote/book/read new customer job history/costs.

### Business / technical decisions and boundaries

Counter scans one Fabric + Batch barcode and selects physical internal Than cuts at
one active Workshop/Showroom/dynamic Showroom sublocation. Required quantities are
explicit integer mm; multiple stock groups retain their own CP rates. Customer/contact
creation and deduplication reuse existing code; WhatsApp is captured when provided,
without inventing a mandatory-number rule or sending messages. Order snapshots contact.

Final price = sum rounded exact-mm fabric CP amounts + exactly the selected Owner
applicable charge amount. No SP, charge multiplier by metres/pieces, discount, tax,
automatic wastage or unspecified fee. Missing SP is allowed; missing CP blocks quote.
Zero configured values are valid. Price/cost safe-integer limits and server calculations
apply; Counter cannot alter quote financials or fetch raw CP/charge breakdown.

Booking advisory request lock → private quote → customer → active assignment/business
entities → charge → sorted Fabric Stock parents/inventory IDs → source lock. Quote
creation locks charge/stock/items/source. Parent locks serialize CP/SP edits; booking
rechecks current CP/charge and actual availability. Changed costs/charge require a new
reviewed final quote; changes to SP have no effect. A later-line failure rolls back
job, requirements, price, issues/movements, Order, private financials and audit.

One quote can book once. Exact creator/request/payload retry returns the original job
before stock/current-price checks, including after depletion or later revisions. Another
Counter or changed payload is rejected; Owner may administer matching requests/quotes.
Uncertain UI response keeps UUID and freezes edits; known SQL rejection clears quote
for review. No automatic retries or persistence across reloads: resolve while page is
open, or inspect history before submitting again after reload.

Job starts open after required fabric issue; actual tailoring status is changed explicitly.
Existing status semantics are reused, including audited cancellation/reopening. A status
change does **not** reverse issue history, create returns/wastage or rewrite booked prices.
Order completed means booked with its required fabric issued, not that tailoring was
delivered or payment collected. No tailoring payment-received claim/gateway was added.
Actual returns/repricing need a later explicit controlled workflow.

Customer bill only prints contact, garment, location/date, Fabric/Batch quantities and
final price. Escaped fixed projection excludes Owner costs even when printed by Owner.
Role/session cache clearing retained; booking settlement refreshes jobs, direct-sale
availability, stock/history, ledger/Than/movement, dashboard and customer queries.
Old jobs/stock/screens remain separately labelled; no dual ledger writes.

Minimum later structural dependencies were necessary for Section 10's Phase 7 flow:
Owner hierarchy bootstrap and **required fabric** Material Issue. These do not implement
general consumables, Additional Material Issue or full Factory/Section/Tailor management.
No Phase 8 consumables/general-issue UI or Phase 9 edit/reassign/disable management,
Owner Production, finished products, production costing or later work was implemented.

### Tests, schema verification, build and limitations

- **290 Phase 7 checks passed**, both complete 17-file migration paths plus no-demo
  canonical chain; actual authenticated/JWT fixtures in PGlite 0.5.8/PostgreSQL 18.3.
- Migration snapshots compare **every pre-existing public table and its old columns**;
  all old values remain unchanged. New table/columns/FKs/unique requests/guards apply
  in both chains. No live credentials, .env connection or manual production test used.
- CP 10000 + applicable charge 25000 → final 35000 with no SP; setting SP 999999
  leaves final price unchanged. Mixed batches with CP 12000 and 20000 plus charge 30000
  → 62000. These amounts exist only in disposable fixtures, never production seeds/UI.
- Customer/WhatsApp deduplication/snapshot; hierarchy/no-section/business-Tailor cases;
  active-login validation; exact quantities and source deductions; required issue/Order
  identity and saved CP/charge after revisions verified. Missing CP despite legacy SP,
  stale CP/charge, unknown customer/assignment/garment and inactive hierarchy rejected.
- Quote ownership, one booking per quote, changed/cross-Counter retry rejection,
  same/full-source/global-depletion retries, stock moved after quote and forced late-line
  failure verified. The forced trigger exists only in disposable DB and is removed;
  rollback preserves every old table value and leaves no failed request/job.
- Counter final-only catalogue/quote/history/bill, raw private quote/price denial, Owner
  original breakdown, assigned Tailor read/status scope and unrelated Tailor denial,
  inactive/unauthorized/anonymous API denial and private history immutability verified.
- Cancellation/reopening preserve stock and booked price; no automatic return/WASTAGE,
  no tailoring fabric SALE/SP snapshot, and unknown statuses rejected. Bills escape
  untrusted text and exclude injected Owner cost fields; real input/bill helpers tested.
- Final full-chain regressions: **164 security**, **230 ledger**, **228 receiving**,
  **171 transfers**, **238 direct sales**. Bounded Phase 1: **278 schema checks**.
  Total **1,599 checks** across these suites. TypeScript passed; lint passed with eight
  existing Fast Refresh warnings. Production build passed in isolated source copy;
  generated artifacts remain outside repo. Existing build warnings remain.
- Baseline hashes verify all prior migrations, packages/configuration, Master Plan,
  operations guide and unrelated files unchanged. No commit, push, deployment or Git
  history rewrite. Implementation History was appended, not replaced.
- Live Supabase/PostgREST, actual browser/cache rendering, scanner/printer, realtime
  and multi-connection races remain unverified. Locks inspected; single-connection
  tests verify authorization/transactions, not concurrent scheduling.
- UI latest 50/API maximum 200; no reporting/export/WhatsApp-provider integration.
  Legacy location/CP reconciliation stays explicit. General additional issues, actual
  returns/repricing and full hierarchy management remain in later controlled phases.

### Section 31 report

PHASE:
- PHASE 7 — Customer + Customer Tailoring only.

STATUS:
- Implemented and locally verified; live rollout pending.

IMPLEMENTED:
- Customer/WhatsApp selection/creation, Customer Tailoring Job, Factory/Section/Tailor,
  required fabric quantities/issues, applicable charge, CP-plus-charge final price,
  audited status, Order/history and safe printable bill.

MODIFIED:
- Counter/Tailoring routes, RPC types, migration/mirror/journal, tests and documentation.

REUSED:
- Customer RPCs, Phase 1 domain/assignments/prices, Phase 2 roles/RLS/session isolation,
  canonical ledger/barcode identity and existing job-status semantics.

DATABASE CHANGES:
- One new logical migration: private quote table, four nullable existing-table columns,
  three unique constraints, two indexes, eight public/two private functions, six triggers
  and scoped RLS/read policies. No backfill or live/manual database change.

SECURITY / PERMISSIONS:
- Owner configuration/costs; authorized Counter final-price-only booking/bills;
  Tailor assigned work/statuses only. Financial permissions remain server-enforced.

TESTS:
- 290 Phase 7 plus 1,309 regression/schema checks; TypeScript/lint passed.

BUILD:
- Production build passed in isolated copy; not deployed.

BUSINESS RULES VERIFIED:
- CP + applicable charge, no SP pricing/leaks, stable Fabric Barcode, exact required
  source deductions, atomic/idempotent posting, permanent costs/issues/Orders and roles.

REMAINING:
- Live/browser/hardware/concurrency validation, explicit legacy reconciliation and
  future general issues/returns/repricing/full hierarchy management.

NEXT PHASE:
- PHASE 8 — Consumables + Material Issues, only after approval. Stopped after Phase 7.

## 2026-10-03 — Phase 1–7 live rollout: initial connection attempt

- Objective: connect to the configured actual database, inspect live migration/schema
  state, reconcile any partial Phase 1 state without losing data, and apply/verify
  Phase 1–7 sequentially. This entry records an attempted connection, not a rollout.
- Used `LOVABLE_DB_MIGRATION_URL` from the ignored local `.env`; no credentials
  were printed, committed, or copied into this record.
- Configured database host: `db.tattausfxmlrmxxrheeb.supabase.co`, port 5432.
  Both application Supabase URL variables refer to the same project. The repository's
  `supabase/config.toml` still names `kyxxgacekzljqibhbbmq`; this difference is recorded
  for deployment provenance. Configuration was not modified.
- Initial PostgreSQL connection failed with `ENOTFOUND`. DNS inspection confirmed
  no IPv4 A record and an IPv6 AAAA record. A direct connection to that resolved
  IPv6 address failed with `ENETUNREACH`, establishing that this machine cannot
  reach the configured direct database endpoint.
- Requested the project's IPv4-compatible Supabase Session Pooler connection
  string in the local environment. No permission request or database password
  disclosure is required; credentials remain local.
- Verified all seven canonical migration files remain byte-identical to their
  Drizzle execution-path mirrors. No historical migration file was modified.
- Database changes/migrations applied: **none**. No reset, drop, delete, overwrite,
  backfill, grant/RLS change, or manual SQL mutation was executed against the live DB.
- Live schema, migration ledger, partial Phase 1 state, row preservation, deployed
  security, and Phase 1–7 execution remain **unverified** because no connection was
  established. Previously recorded disposable local tests do not verify this DB.
- Files changed in this attempt: this Implementation History only. No application
  implementation changes; no new migration; no build/deployment; no Phase 8 work.
- Next step: connect using the reachable pooler endpoint, inspect live state first,
  then record actual reconciliation, per-file execution and per-phase verification
  in subsequent chronological entries. Do not infer successful deployment from
  this connection-attempt entry.

## 2026-10-03 — Phase 1–7 live rollout: Session Pooler authentication attempt

- Retested the updated `LOVABLE_DB_MIGRATION_URL` from the ignored local `.env`.
  The endpoint `aws-0-ap-south-1.pooler.supabase.com:5432` is reachable.
- Pooler username `postgres.tattausfxmlrmxxrheeb` matches the project in the
  application Supabase URLs; database path is `/postgres`. Password is present,
  not a recognized placeholder, has valid percent encoding, and the connection
  URL contains no unexpected fragment. No password/connection string was logged.
- Initial connection and explicit TLS (`ssl: require`) retry both failed with
  PostgreSQL `28P01`: password authentication failed for user "postgres".
  A reachable endpoint does not establish an authenticated database connection.
- Requested correction of the existing project's database password in the local
  environment; no password reset or infrastructure change was performed.
- Migrations executed/database changes: **none**. No reset, deletion, overwrite,
  schema mutation, permission/RLS change, or live data operation occurred.
- Live schema/migration inspection and partial Phase 1 reconciliation remain
  pending authentication; no deployed phase is claimed verified by this attempt.
- Files changed: Implementation History only. Historical migrations and application
  code remain unchanged. No build, deployment, or Phase 8 implementation.
- Next step: authenticate successfully, inspect current live state, then reconcile
  and apply/verify Phase 1–7 sequentially with actual results recorded here.

## 2026-10-03 — Phase 1–7 actual live database rollout completed

### Objective, connection and verified baseline

- User explicitly authorized connection, safe partial Phase 1 reconciliation and
  sequential Phase 1–7 rollout, preserving existing data and migration files.
- Authenticated to PostgreSQL 17.6, database/user `postgres`, project
  `tattausfxmlrmxxrheeb`, via Session Pooler
  `aws-0-ap-south-1.pooler.supabase.com:5432` with TLS required. Credentials remained
  in ignored `.env` and were not printed or committed. The older project reference
  in `supabase/config.toml` was recorded, not changed.
- Neither Supabase nor Drizzle migration tracking existed. The live Phase 1 schema
  and backfill were already present: all columns/nullability, 352 non-NOT-NULL
  constraints, indexes, triggers and policies matched canonical disposable replay.
  Existing function bodies matched after whitespace normalization except the missing
  historical `complete_fabric_sale` function. PostgreSQL 17/18 NOT NULL catalog
  differences were handled by comparing column nullability separately.
- Existing 17 Thaans already mapped to 11 Fabric + Batch stock/barcode identities;
  10 CP and 10 SP snapshots and 26 reconciliation records were preserved. Canonical
  Workshop/Showroom roots were present. No backfill was replayed or regenerated.
- Existing baseline was adopted after verification, explicitly distinguished from
  actual execution. Historical execution dates are unknown. Demo seed was recorded
  as skipped to prevent replay into the existing database.

### Migrations and actual application order

Each executed file committed in its own transaction with migration provenance.
Schema/permission verification ran inside each Phase transaction before commit;
pre-existing public row fingerprints were checked after every committed file.

| Actual order | Canonical filename | Actual result / purpose |
| --- | --- | --- |
| 1 | `20261003000700_live_migration_tracking.sql` | NEW, applied/verified. Restricted administrative migration ledger; records adopted baseline and skipped seed; removes surplus anonymous table and authenticated TRUNCATE/REFERENCES/TRIGGER grants and future direct browser table defaults. |
| 2 | `20260927000100_customer_multi_fabric_sale.sql` | Existing unchanged migration, applied/verified. Restores missing historical sale RPC/grants without executing any sale; completes verified Phase 1 prerequisite parity. |
| 3 | `20261003000800_live_function_grants_reconciliation.sql` | NEW, applied/verified. Removes surplus direct browser grants on three legacy trigger helpers and future public function defaults. |
| 4 | `20261003000100_phase2_authorization.sql` | Applied/verified after one rolled-back verification failure. Active-role ceilings, Owner CP/cost access, owned receiving CP scope, domain read RLS and protected RPCs. |
| 5 | `20261003000200_phase3_locations_ledger.sql` | Applied/verified. Canonical inventory items, movement identities/constraints, location ledger/balances and atomic transfers/corrections; no opening stock invented. |
| 6 | `20261003000300_phase4_fabric_receiving_barcode.sql` | Applied/verified. Private receiving request identity, draft/completion/Workshop inward, one Fabric + Batch barcode, CP/SP revisions and safe readers/guards. |
| 7 | `20261003000400_phase5_transfer_history.sql` | Applied/verified. Owner transfer document reader and execution permissions; reuses existing Phase 3 transfer posting. |
| 8 | `20261003000500_phase6_direct_fabric_sale.sql` | Applied/verified. Order sale/request/customer/payment columns and indexes, atomic SP sale RPC, append-only order/ledger guards and safe/customer versus Owner financial readers. |
| 9 | `20261003000600_phase7_customer_tailoring.sql` | Applied/verified. Private CP-plus-charge quotes; job/order request identity columns, unique constraints/indexes; booking, required fabric issues, status/history/cost APIs, guards and scoped RLS. |

- `20261003000000_phase1_domain_model.sql`: **adopted existing verified schema**;
  original SQL was not rerun. Its 34 domain tables, relationships, guards and
  conservative backfill were already installed and preserved.
- Eight earlier schema migrations through `20260927000000_tailoring_multi_cut.sql`
  are recorded as adopted existing cumulative schema. The demo migration
  `20260924000100_demo_seed_data.sql` is recorded as `skipped_demo_seed`, never as
  applied. Restored migration `20260927000100...` is recorded as actually applied.
- All 19 repository versions now have filename/hash/mode provenance. Repair
  timestamps sort after Phase 7 but the deliberate prerequisite execution order is
  documented above. The Supabase ledger tracks individual versions. No existing
  migration was edited, deleted, renamed, squashed or rewritten.
- New byte-identical mirrors: `drizzle/migrations/0017_live_migration_tracking.sql`
  and `0018_live_function_grants_reconciliation.sql`; journal entries 17/18 appended.
  Do not blindly run Drizzle migrations against this live database: its separate
  ledger does not exist and would attempt to replay historical schema. The live
  Supabase ledger is authoritative for this rollout.

### New repair migration schema / permission scope

- `...00700...`: creates schema `supabase_migrations` and standard table
  `schema_migrations(version text PRIMARY KEY, statements text[], name text)`.
  Creates `erp_execution_history` with `version` primary key/FK to that ledger,
  filename, SHA256, applied/adopted/skipped mode, recorded timestamp and JSON
  verification; hash-format/mode CHECK constraints and primary-key indexes.
  Baseline records are migration metadata only, not business-data backfills.
- Denies PUBLIC/anon/authenticated access to administrative schema/tables. These
  are restricted metadata objects, not browser application RLS tables. Removes
  anon table/view grants and authenticated TRUNCATE/REFERENCES/TRIGGER privileges
  on public tables/views. Revokes future postgres-owned public table defaults for
  anon/authenticated so phase files grant only their documented access.
- `...00800...`: grant/default-privilege repair only. Removes anon/authenticated
  direct grants from `protect_last_owner_profile`, `protect_last_owner_role`, and
  `protect_profile_activation`; removes future direct browser function defaults
  for postgres-owned public functions. No function bodies, business tables,
  relationships, indexes, triggers or rows are changed by this repair.
- Approved Phase 2–7 schema/RLS/function/index changes are exactly the unchanged
  SQL already described in this history's corresponding phase entries and contracts.
  No additional business rules were introduced for deployment.

### Errors, recovery and preservation

- One fresh connection attempt transiently returned `28P01`; a subsequent fresh
  attempt connected. No failed authentication attempt changed the DB.
- Initial Phase 2 verification detected authenticated EXECUTE on three internal
  trigger helpers after PUBLIC revocation due to Supabase's direct default grants.
  Entire Phase 2 transaction rolled back, including DDL; later phases did not start.
  Added new repair `...00800...`, then retried the unchanged Phase 2 file successfully.
  Failed execution was not entered as an applied migration.
- All **60 pre-existing public tables / 276 rows** have unchanged count and sorted
  original-column row digests across successful rollout. Existing customer, stock,
  labels/IDs, CP/SP, roles, genealogy, sale/job and audit rows were retained.
- No reset, data drop/delete/overwrite, seed replay, guessed balance/location/CP,
  fabricated hierarchy/charge, production transaction or live test fixture occurred.
  Operational RPC definitions were installed but no sale, receipt, transfer or
  tailoring booking was executed against live stock.
- Database mutations were version-controlled migration SQL plus documented
  transactional migration-ledger/provenance inserts; no undocumented manual schema
  or data edits. No app implementation, deployment, commit/push or Git history rewrite.

### Verification and tests actually run

- Every phase's cumulative columns, nullability, constraints, indexes, function
  bodies and browser execution grants, triggers, policies, RLS and browser CRUD
  table grants matched a canonical disposable PostgreSQL replay before the next phase.
  Final cumulative Phase 7 inspection passed again after rollout.
- **42 read-only live checks passed**, using existing active profiles and
  transaction-local authenticated/anonymous role/JWT contexts. Owner sees 10 Fabric
  Stock and 16 legacy CP rows; Counter, Tailor and Stock Entry see zero general CP
  rows. Non-Owners' Owner-cost APIs reject access; Stock Entry committed legacy CP
  access is rejected. Quote/ledger raw inserts and stock TRUNCATE privileges denied.
  Anonymous stock table, Phase 7 API and migration metadata access denied.
- Owner/Counter direct-sale and customer-tailoring catalogs/history execute live;
  Tailor scoped tailoring history executes. The existing Counter profile also has
  Tailor; the separate Tailor profile has no Counter/Owner role. No synthetic staff
  or permissions were introduced to claim a pure-role fixture matrix.
- **1,599 disposable regression checks passed** after adding deployment repair
  files: Phase 1 278; Phase 2 164; Phase 3 230; Phase 4 228; Phase 5 171;
  Phase 6 238; Phase 7 290. Both migration mirrors/business chains and clean/no-demo
  paths passed. Phase test file selection excludes deployment-only `_live_` repairs;
  the controlled rollout runner independently replayed both repairs locally before
  live application. No regression fixture was run against live DB.
- Repeated controlled `--apply` run after completion verified Phase 7 and all
  recorded file hashes, skipped all nine previously applied files, and made no new
  migration/data changes. This verifies resumability/idempotent migration selection.
- Build not rerun: no app source/config/package changes in this database-only task.
  Earlier Phase 7 build results remain historical evidence, not a new deployment.

### Files changed and evidence

- Added two canonical repair SQL files and two identical Drizzle mirrors; appended
  journal entries. Existing SQL files preserved.
- Added `scripts/live-db-rollout.mjs` (transactional, credential-redacted, cumulative
  schema/hash verification and data fingerprinting) and `scripts/live-db-verify.mjs`
  (read-only existing-user security/RPC verification).
- Updated all seven existing Phase test selectors to exclude deployment-only repair
  files; their original business migration chains/assertions remain unchanged.
- Added `docs/LIVE_PHASE_1_7_ROLLOUT.md`,
  `docs/LIVE_PHASE_1_7_ROLLOUT_VERIFICATION.json` and
  `docs/LIVE_PHASE_1_7_SECURITY_VERIFICATION.json`; updated migration README and
  appended this history. JSON evidence contains schema metadata, hashes/counts and
  role summaries only; no connection strings, passwords or business row contents.
- Rollout JSON captures final resumed execution (repair 00800 plus Phases 2–7);
  earlier two applied files are separately recorded in the actual execution order
  above and in the full 19-version live ledger/security evidence.

### Remaining / intentionally unchanged

- **26 legacy reconciliation records remain unchanged**: 17 Than locations, four
  material opening-stock locations, four job domains/assignments and one Fabric Stock
  CP issue. `inventory_items` remains empty. Owner must explicitly reconcile true
  opening quantities/locations before legacy items can use the new operational ledger.
  Schema deployment does not supply missing business facts.
- No live mutation fixtures, inactive-user fixtures, multi-connection business races,
  browser/PostgREST authenticated session, realtime, scanner or printer verification.
  No application deployment or Phase 8 implementation. These are not claimed verified.

### Section 31 report

PHASE:
- Authorized Phase 1–7 live database rollout and safe existing-state reconciliation.

STATUS:
- Completed. Phase 1 adopted/verified; missing prerequisite restored; Phases 2–7
  applied sequentially and verified against the canonical reference.

IMPLEMENTED:
- Live approved domain/workflow schema through Phase 7, restricted migration ledger
  and documented Supabase deployment-grant reconciliation.

MODIFIED:
- New repair migrations/mirrors, appended journal, deployment scripts, test selectors,
  rollout evidence/docs, migration README and Implementation History.

REUSED:
- Existing Phase 1 schema/backfill/business records and unchanged historical/Phase
  2–7 SQL; actual existing user identities for read-only role verification.

DATABASE CHANGES:
- Nine files actually applied (two new repairs, one historical missing prerequisite,
  six Phase 2–7 migrations). Phase 1 not replayed; demo seed skipped. No data reset.

SECURITY / PERMISSIONS:
- Canonical RLS/grants verified; default browser grants corrected; live Owner CP
  access and non-Owner/anonymous restrictions verified.

TESTS:
- 42 read-only live checks, per-phase cumulative schema/permission gates, 60-table
  row preservation, repeat rollout skips, and 1,599 disposable regression checks passed.

BUILD:
- No new build/deployment; database-only rollout.

BUSINESS RULES VERIFIED:
- Deployed canonical barcode, ledger, SP-sale and CP-plus-charge schema/functions
  match approved migrations; existing data preserved and CP role checks pass.
  Production business mutation acceptance tests were not executed live.

REMAINING:
- Explicit Owner legacy reconciliation and browser/hardware/concurrency verification.

NEXT PHASE:
- Stopped after authorized Phase 1–7 rollout. No Phase 8 work without approval.

## 2026-10-03 — Complete legacy reconciliation analysis and safe targeted migration

### Objective and full analysis before changes

- User authorized detailed review of all 26 remaining legacy issues, followed only
  by objectively determined reconciliations in a new version-controlled migration.
  Unknown stock quantities/locations/CP/SP/assignments must not be guessed. Phase 8
  remains outside scope. No database/file changes were made until the complete
  26-record analysis had been performed.
- Reconnected to actual PostgreSQL through the configured TLS Session Pooler.
  Reviewed all reconciliation records, all 17 Thaans and their Fabric + Batch/CP
  identities, 28 legacy stock movements, receiving batches, sale linkage, holds,
  four jobs/seven job lines, four materials, audit evidence, canonical location and
  hierarchy tables, Phase 1–7 SQL/contracts and the Master Plan.
- Source evidence: old rack text has no canonical Workshop/Showroom mapping;
  inventory items/movements/transfers and factory/section/business Tailor/assignment
  tables are empty. No stored invoice-line CP exists for the missing-cost batch.
  Existing seed labels remain historical/demo evidence, not authority to invent
  a physical location, vendor price or business assignment.
- Full per-record analysis is in `docs/LEGACY_RECONCILIATION_ANALYSIS.json` and
  `docs/LEGACY_RECONCILIATION_OWNER_DECISIONS.md`, including exact original record
  IDs, issue IDs, known facts, partial facts and explicit missing Owner decisions.

### Analysis outcome for every category

| Original category | Reviewed | Safely closed | Still needs Owner facts |
| --- | --- | --- | --- |
| Than location | 17 | 1 | 16 |
| Material opening location | 4 | 0 | 4 |
| Job domain/assignment | 4 | 0 | 4 |
| Fabric Stock CP | 1 | 0 | 1 |
| Total | 26 | 1 | 25 |

- **TH-0003**, Than `d7bc14e3-a672-4277-8b88-be1d751b767b`, issue
  `5b35b172-0d1a-4ca3-834a-c3f61279b4fe`: status depleted; exactly one 26,000 mm
  INWARD and one -26,000 mm SALE linked to the matching 26,000 mm sale-item bill;
  net ledger stock zero; no active unlocated holds or existing domain stock records.
  Thus no positive current-stock quantity needs a location allocation. Close this
  current-stock issue only. **Historical physical location remains unknown**;
  original rack A-02 and all historical rows are retained. Do not manufacture a
  Workshop allocation, zero-valued movement, inventory authority switch or Owner actor.
- **13 positive-stock Thaans** require exact location allocations summing to their
  existing ledger quantities: TH-0001 23,500 mm; TH-0002 25,750; TH-0004 21,500;
  TH-0005 29,250; TH-0006 16,500; TH-0007 25,800; TH-0008 36,000; TH-0009 18,000;
  TH-0010 16,500; TH-0011 18,500; TH-0012 26,600; TH-0013 27,000; TH-0014 30,500.
  Source locations/splits are absent, so no automatic opening balances. TH-0007's
  +300 mm physical-count adjustment is recorded/audited; do not clamp to original length.
- **TH-0015, TH-0016, TH-0017** are draft/uncommitted with no INWARD. Zero recognized
  ledger stock does not prove zero physical stock; recorded original lengths are
  not confirmed opening balances. Owner must identify receipt disposition and actual
  physical location. Future receipts enter Workshop, but that rule cannot retroactively
  prove an old draft's current location. These three issues are not falsely closed.
- **Materials:** Canvas Padding 42 m, Suit Lining Silk 80 m, Horn Buttons 60 sets,
  Shoulder Pads 35 pairs. Current `qty_on_hand` is the approved Phase 3 snapshot
  source; no location is recorded. Canvas's historical 1.5 m job line is not evidence
  to subtract again or overwrite the present quantity. Owner must provide exact
  location splits or separately evidenced physical-count corrections.
- **TJ-1041 / TJ-1042:** Customer Tailoring is established by their actual customer
  links; this component does not need Owner classification. Factory/optional Section/
  real business Tailor assignment and historical billing/charge/import disposition
  remain absent. TJ-1042 has legacy name Rafiq but no staff assignment. Existing
  generic staff labels do not identify verified factory genealogy.
- **TJ-1043:** no customer; note `Shop stock` indicates internal production intent,
  but product/design/quantity and factory genealogy are absent. Owner must confirm
  intended domain and facts or retention as legacy. **TJ-EB397165:** no customer and
  no unambiguous domain evidence; Owner must choose domain and supply correct customer
  if applicable plus hierarchy facts. Never reprice old jobs or reissue/deduct existing
  consumed material. Later 1 October staff assignments on TJ-1041/TJ-1043 cannot be
  silently backdated into their earlier material-issue genealogy.
- **CP:** Wine Velvet / RB-2603 / TH-0017, Fabric Stock
  `a1919ba4-31d9-4091-b249-c6545a82ffaf`, issue
  `799885f3-f620-4bfa-b2f3-658cb8a10946`: no legacy CP, cost snapshot or batch-line
  price evidence. Invoice reference BL-9032 alone supplies no price. Owner must supply
  documented CP/metre. Do not copy another batch's cost, derive CP from SP/demo
  percentage, or use zero. Missing SP is allowed at receiving and was not fabricated.

### New migration: schema, metadata and application

- Created and actually applied
  `supabase/migrations/20261003000900_live_legacy_reconciliation.sql`.
- Identical execution-path mirror:
  `drizzle/migrations/0019_live_legacy_reconciliation.sql`; journal index 19 appended.
- SHA256: `16ce4859a561ed6182be6fcda654d52d13dabe52254bbd6eec6c5782e58478bf`.
  All historical SQL files remain unchanged; no rename/delete/rewrite/squash.
- Adds administrative table
  `supabase_migrations.erp_legacy_reconciliation_assessments`: new metadata-only
  UUID primary key, original reconciliation-ID FK, migration filename, outcome,
  JSON evidence, Owner-decision text, analysis-completion timestamp and recorded
  timestamp. UNIQUE(reconciliation_id,migration_filename) provides the relationship
  index; CHECK constraints enforce two outcomes and decision text for pending cases.
- Appends 26 assessments referencing every original reconciliation issue. Reuses
  existing `reject_domain_history_rewrite()` through one new immutable-history trigger;
  assessments cannot be updated/deleted. No new application function or workflow.
- Explicitly denies PUBLIC/anon/authenticated table access; existing restricted
  administrative schema also denies browser USAGE. No application role/RLS expansion,
  Owner CP exposure change or new endpoint. No Phase 8 consumables workflow.
- Acquires short transaction locks on reconciliation/stock/sale/hold/domain-stock
  source tables and checks the full original 26-record unresolved set and exact
  TH-0003 receipt/sale/balance/status/hold facts. Any changed evidence aborts atomically.
- Updates only TH-0003 issue's resolution fields. Original issue ID, source IDs,
  issue text, details and created_at are preserved. `resolved_by` is NULL deliberately:
  an automated database migration does not impersonate an Owner's application identity.
- Appends one `erp_audit_records` event with NULL actor, original/new issue snapshots
  and migration filename. No historical audit record was edited. Existing business
  rows, barcodes, stock IDs, quantities, CP/SP, jobs, customers and assignments unchanged.
- Recorded migration SQL/hash and verification in the actual live Supabase ledger
  transactionally. All 20 repository migration versions now match live provenance.
  No undocumented manual SQL or data operation; no inventory/backfill/receipt/transfer.

### Tests and verification actually completed

- **207 new disposable checks passed**: canonical/mirror equality; full 26 assessments;
  exactly one closure/25 pending; original issue fields and remaining complete rows
  retained; Thaans and legacy movements unchanged; no inventory items/movements;
  truthful automated audit; assessment immutability and browser denial.
- Negative tests prove rollback/no metadata or issue changes when depleted status,
  ledger quantity, active hold, billed-sale quantity or full issue set differs.
  Fixtures were created only in disposable PostgreSQL, never in production.
- **1,599 Phase 1–7 regression checks passed again** (278 + 164 + 230 + 228 + 171
  + 238 + 290), both business migration chains and clean/no-demo paths.
  Combined disposable total: **1,806 checks**.
- Live apply transaction checked all existing public-row count/sorted row digests,
  excluding only the intentionally changed issue row and the explicitly appended
  audit event. The target issue's original identity/details/date fields were checked
  individually; all other existing rows matched exactly before commit.
- **62 live read-only checks passed**, including all 20 migration hashes plus existing
  role/CP restrictions and operational reader RPCs. Owner sees 10 Fabric Stock/16 legacy
  CP rows; Counter/Tailor/Stock Entry see no general CP rows. Anonymous restrictions
  and raw quote/ledger write/stock TRUNCATE denial remain intact.
- Additional read-only catalog checks confirm 26 assessment rows, 25 pending decision
  texts, immutable trigger present, and no authenticated/anon assessment access.
- Final cumulative Phase 7 schema/permissions still match canonical replay.
  Re-running the targeted migration runner skips the recorded matching hash and
  reports one resolved/25 pending without new changes.
- New script syntax checks passed. No app source change, new build or deployment.

### Changed files / evidence / limitations

- New migration/mirror; appended Drizzle journal; new
  `scripts/legacy-reconciliation-test.mjs` and
  `scripts/live-legacy-reconciliation.mjs`; updated `scripts/live-db-verify.mjs`
  to verify all repository hashes and count genuinely unresolved rows.
- Added `docs/LEGACY_RECONCILIATION_ANALYSIS.json`,
  `docs/LEGACY_RECONCILIATION_OWNER_DECISIONS.md`,
  `docs/LEGACY_RECONCILIATION_VERIFICATION.json`,
  `docs/LEGACY_RECONCILIATION_SECURITY_VERIFICATION.json`; updated migration README
  and appended this permanent history. Reports contain required legacy IDs/evidence,
  no credentials or customer phone/email records.
- Stopped for the exact Owner business decisions identified for 25 records. No
  historical quantity, location, cost/price, assignment or production genealogy guessed.
  No stock authority switch. Future stock returns on depleted TH-0003 still require
  explicit location reconciliation; this closure does not establish its old location.
- Live destructive/mutation fixtures, browser, printer/scanner and concurrency testing
  remain outside this targeted data analysis/migration. No Phase 8 implementation.

### Section 31 report

PHASE:
- Post-Phase 7 legacy reconciliation only.

STATUS:
- All 26 analyzed; one objectively resolved; 25 explicitly pending Owner facts.

IMPLEMENTED:
- Immutable complete-set assessments, guarded depleted-stock issue closure and audit.

MODIFIED:
- New migration/mirror/journal, verification/test scripts, analysis/decision/evidence
  documents, migration README and Implementation History.

REUSED:
- Canonical ledger/sale evidence, existing issue IDs, append-only history helper,
  actual live migration ledger and unchanged Phase 1–7 role/model rules.

DATABASE CHANGES:
- One metadata table/relationship/index/immutable trigger; 26 append-only assessments;
  one issue resolution; one appended audit event. No stock/price/job/hierarchy backfill.

SECURITY / PERMISSIONS:
- Administrative analysis stays browser-inaccessible; role/RLS ceilings unchanged;
  automated attribution uses NULL actor rather than impersonating an Owner.

TESTS:
- 1,806 disposable checks, 62 live read-only checks, exact preservation checks,
  Phase 7 schema comparison and matching-hash retry skip passed.

BUILD:
- Not required/rerun; no app changes/deployment.

BUSINESS RULES VERIFIED:
- No stock allocation for depleted zero balance; no rack/location or CP/SP guesses;
  draft absence from ledger is not proof of physical absence; existing deductions
  and genealogy/prices retained without double issues or repricing.

REMAINING:
- Owner inputs for 16 Than locations/receipt dispositions, four material allocations,
  four job hierarchy/domain/disposition decisions and one documented batch CP.

NEXT PHASE:
- Stopped for Owner facts; no Phase 8 work.

## 2026-10-03 — Owner-authorized test-stock scenario distribution

### Authorization and scope clarification

- User clarified that the reviewed stock details are purely testing data and may
  deliberately be distributed across different scenarios. This explicitly authorizes
  synthetic test-location allocations; earlier unknown historical locations are not
  asserted to have been discovered. Original source history remains preserved.
- Actual reviewed set: 21 unique stock records (17 Thaans and four materials),
  plus a separate CP issue on TH-0017. The user's reference to 24 did not lead to
  inventing three extra stock records or silently including tailoring jobs.
- Asked whether the four job issues also concern test fixtures. No answer had
  arrived during this stock implementation; jobs were kept unchanged. No Owner
  decision is now requested for the explicitly authorized stock fixture scenarios.
- Scope: existing Phase 1–7 stock/location model, test commissioning/provenance and
  issue disposition only. No Phase 8 material-issue workflow or later production work.

### Actual fixture setup

- Created named dynamic Showroom sublocations `TEST-DISPLAY-A` / Test Display A
  and `TEST-DISPLAY-B` / Test Display B under the existing Showroom. Workshop and
  Showroom root IDs/rows remain unchanged. No fixed real floor layout was invented.
- Commissioned 18 canonical inventory items: 13 active fabric Thaans, one already
  depleted Than with zero balance, and four consumables. Added 27 exact positive
  opening ADJUSTMENT events with `OPENING:<inventory-item-id>` references.
- All existing recorded totals conserved: **315,400 mm fabric**, **122 m materials**,
  **60 button sets**, **35 shoulder-pad pairs**. Legacy ledger quantities are snapshots,
  not added to openings a second time. Original material `qty_on_hand` remains unchanged.
- Scenario matrix:

| Stock record | Deliberate allocation/scenario |
| --- | --- |
| TH-0001 | Workshop 23,500 mm |
| TH-0002 | Showroom 25,750 mm; same Fabric + Batch barcode as TH-0001, separate internal Than |
| TH-0003 | Depleted zero quantity, no movement/location allocation |
| TH-0004 | Workshop 11,500 mm + Showroom 10,000 mm |
| TH-0005 | Test Display A 29,250 mm |
| TH-0006 | Workshop 16,500 mm |
| TH-0007 | Workshop 15,800 mm + Showroom 10,000 mm; audited +300 mm remains included |
| TH-0008 | Workshop 16,000 mm + Showroom 10,000 mm + Test Display B 10,000 mm |
| TH-0009 | Showroom 18,000 mm |
| TH-0010 | Test Display A 16,500 mm |
| TH-0011 | Workshop 18,500 mm |
| TH-0012 | Test Display B 26,600 mm |
| TH-0013 | Workshop 17,000 mm + Test Display A 10,000 mm |
| TH-0014 | Workshop 30,500 mm |
| TH-0015 / TH-0016 | Deliberately unreceived legacy draft fixtures; no opening stock |
| TH-0017 | Deliberately unreceived draft with missing CP/SP for negative validation; no opening/price |
| Canvas Padding | Workshop 30 m + Showroom 12 m |
| Suit Lining Silk | Workshop 50 m + Test Display B 30 m |
| Horn Buttons (set) | Workshop 40 sets + Test Display A 20 sets |
| Shoulder Pads | Workshop 20 pairs + Showroom 10 pairs + Test Display B 5 pairs |

- Three draft rows retain their original lengths/status and are not admitted as stock.
  No receipt or CP/SP was fabricated. The missing CP issue is dispositioned as an
  intentional incomplete test fixture, not claimed to have a known/resolved production CP.
- All 21 previously unresolved stock-related issues now have explicit test dispositions.
  Original issue IDs/details are retained; TH-0003's prior resolution was not rewritten.
  Four job issues remain unresolved: TJ-1041, TJ-1042, TJ-1043, TJ-EB397165.
- No new sale, transfer document, receipt, material issue, job, assignment, charge,
  product or production genealogy was fabricated. Allocations are initial test
  commissioning events, not a reconstructed transfer history.

### New version-controlled migration and schema decisions

- Created/applied `supabase/migrations/20261003001000_live_test_stock_scenarios.sql`.
- Identical mirror `drizzle/migrations/0020_live_test_stock_scenarios.sql`; appended
  journal index 20. Existing migration files untouched; apply the canonical chain once.
- Applied SHA256:
  `6b11bcc9b7c0f5c8cacec3bbef913261db5bba055a191a9677e004304af3e1ff`.
- Added nullable `inventory_items.fixture_migration_version`, deferred FK to the
  authoritative migration ledger. Relaxed `reconciled_by` NOT NULL only with a new
  CHECK requiring either a real profile and no fixture version, or NULL profile plus
  exactly this approved migration version. Existing Owner RPCs still supply their
  real profile. Browser raw inventory writes remain denied.
- This minimum provenance addition avoids falsely attributing automatic fixture
  commissioning to an existing staff member. Immutable inventory rows permanently
  retain the migration origin; all automatic audit/movement actors are NULL.
- Added restricted administrative table `supabase_migrations.erp_test_stock_fixtures`:
  legacy ID primary key; legacy table/label/scenario; nonnegative recorded quantity,
  unit and allocation JSON; unique optional FK to canonical inventory item; deferred
  migration-version FK and created timestamp. CHECK constraints enforce valid legacy
  table, array allocations and no inventory item for deliberately unreceived drafts.
  Primary/unique keys provide indexes. Adds 21 immutable manifest records and one
  immutable-history trigger reusing the existing rejection function.
- Replaced only `guard_inventory_movement()` via the new migration to add a narrow
  automated opening exception: postgres session, no application identity, approved
  fixture version, inward ADJUSTMENT/OPENING identity, capped conserved opening total,
  and migration version **not yet recorded**. Every existing identity/unit/location,
  nonnegative-source, sale/transfer linkage and actor-caller rule remains intact.
  Recording the migration closes this actorless movement exception at commit;
  subsequent operations require normal actors. No role/RLS/financial access expansion.
- Transaction locks and source guards abort if original quantities/status/identity,
  active holds, already-commissioned stock or test-location baseline differ. Source
  evidence was verified before live apply; no existing stock was overwritten.
- Appended exactly 42 audit events: two locations, 18 openings, 21 stock issue
  dispositions and one summary. Existing audit/history rows retained. All database
  mutations came from the version-controlled migration plus transactional ledger inserts.
- All 21 repository migration versions now match live file hashes/provenance.

### Actual validation, preservation and limits

- **96 new disposable tests passed**, covering conserved totals and per-location
  balances, draft exclusion, metadata provenance/immutability, original stock/price
  history retained, normal Owner reconciliation, actorless ordinary-row rejection,
  and closure of the actorless opening exception after the ledger record.
  The exception test first frees capacity locally, proving rejection comes from
  the recorded-version gate rather than merely exceeding the opening balance.
- Changed quantity, active hold and newly supplied missing CP each abort the entire
  local transaction, rolling back locations, inventory rows and schema DDL.
  Pre-apply local testing exposed SQL-generation/alias and actor-guard dependencies;
  corrected the new, still-unapplied SQL before successful tests/live execution.
  No applied migration was edited to repair a test failure.
- **1,599 existing Phase 1–7 checks passed again**, both chains and clean/no-demo
  paths. Combined local total for this task: **1,695 checks**.
- **63 live read-only checks passed**, including all 21 migration file hashes;
  Owner sees the same 10 Fabric Stock/16 legacy CP rows; Counter/Tailor/Stock Entry
  remain unable to read general CP. Operational catalog/history APIs execute.
- Live transaction checked all original public-row fingerprints, excluding only
  the documented appended rows and changed stock issue resolution fields. Original
  domain issue identity/details/dates matched, prior resolutions and entire four
  job issue rows matched exactly; all original stock, ledger, material, CP/SP, barcode,
  customer, job, staff, root-location and history rows remained unchanged.
- Every fixture's canonical total and location allocation matched the authorized
  plan in the live transaction before commit. 18 items, 27 openings, 21 fixture records,
  21 stock issue dispositions and four pending jobs verified.
- Updated cumulative schema verifier to replay the approved provenance/guard schema
  overlay only in the disposable reference when its live manifest is present.
  Phase 7 plus the approved fixture overlay matches the actual live schema/RLS/functions.
- Repeated fixture runner verified all balances/hash and skipped the recorded file
  without duplicating openings, locations or issue resolutions. Syntax and final
  canonical/mirror/applied-hash checks passed.
- No app source/package/config change, new build/deployment or Git history rewrite.
  No browser/scanner/printer or concurrent business acceptance run is claimed.

### Changed files / evidence

- New canonical migration/mirror; appended journal entry.
- New `scripts/test-stock-scenarios-test.mjs` and
  `scripts/live-test-stock-scenarios.mjs`; updated cumulative live-schema and security
  verifiers for approved fixture provenance/current item counts and all migration hashes.
- Added `docs/TEST_STOCK_SCENARIOS.json`, `docs/TEST_STOCK_SCENARIOS.md`,
  `docs/TEST_STOCK_SCENARIOS_VERIFICATION.json`,
  `docs/TEST_STOCK_SCENARIOS_SECURITY_VERIFICATION.json`; updated migration README
  and appended this history. No credentials included.

### Section 31 report

PHASE:
- Post-Phase 7, Owner-authorized test-stock scenario setup only.

STATUS:
- Implemented/live verified. All stock issues dispositioned as explicit test fixtures.

IMPLEMENTED:
- Multi-location/sublocation/split-Than/material-unit/depleted/incomplete receipt scenarios.

MODIFIED:
- New migration/mirror/journal, minimum automated provenance/guard overlay, scripts,
  scenario/evidence documents, migration README and Implementation History.

REUSED:
- Original stock IDs/CP/SP/barcodes, exact recorded quantities, canonical ledger and roles.

DATABASE CHANGES:
- 18 canonical items, 27 opening allocations, two named test locations, 21 immutable
  fixture records, 21 issue dispositions, 42 append-only audit events; narrow provenance
  column/FK/CHECK/guard changes. No original stock or historical ledger mutation.

SECURITY / PERMISSIONS:
- Role/RLS/CP ceilings preserved. Automated provenance avoids staff impersonation;
  actorless opening exception is closed by the recorded migration version.

TESTS:
- 1,695 local checks, 63 live checks, exact preservation/balance checks, cumulative
  schema comparison and repeat migration skip passed.

BUILD:
- No app build/deployment; database-only test setup.

BUSINESS RULES VERIFIED:
- Exact quantity conservation, single inventory authority, one Fabric + Batch barcode,
  separate internal Thaans, actor/CP protection, no double openings or fake receipt/price.

REMAINING:
- Four tailoring jobs unchanged pending confirmation that jobs are also testing data.
  Draft fixtures intentionally remain unreceived/missing CP where specified.

NEXT PHASE:
- Stopped after test-stock setup; no Phase 8 work.

---

## 2026-10-04 — PHASE 8: Consumables + Material Issues

### Authority, objective and verified baseline

- Owner explicitly authorized Phase 8 and instructed continuation. Re-read the
  Master Plan Phase 8 and Sections 10–14/30/31, Phase 0 findings and chronological
  Phase 1–7/live/test-stock history before implementation. Phase 8 only.
- `systems_operations_guide.md` is absent from the current checkout after a file
  search; the Master Plan and this history supplied the project's current rules.
- First tested the real pooler connection and compared the cumulative live schema
  to canonical Phase 7 plus the approved test-stock provenance overlay. It matched.
- Reused the existing consumable catalogue, immutable issues/lines, job/assignment
  hierarchy, native units, exactly-once issue guard, ledger/source balance locks,
  permissions, RLS, customer booking/pricing snapshots and approved fixture items.

### Actually implemented

- Consumable inventory for buttons, thread, padding and other materials. Dedicated
  Inventory → Consumables tab shows native-unit balances per location, explicit
  unreconciled openings and Owner classification/activation controls.
- Owner/authorized Stock Entry receiving: explicit quantity, destination, receipt
  CP/unit and reason; atomic catalogue/item creation when new, immutable receipt,
  private CP record, one INWARD ledger event and audit. Existing catalogue CP/SP
  and legacy `qty_on_hand` remain unchanged during restocking.
- Counter/POS and Tailoring Material Issues: required consumables or explicit
  additional consumables/fabric linked to canonical Customer Tailoring or existing
  Production Job, its original Tailor assignment, Factory/optional Section and
  source. Actual quantities only; no automatic wastage/buffer/price adjustment.
- Required declarations are recorded against the matching posted issue line;
  customer quoted required fabric cannot be issued again as a required issue.
  Additional issues require explicit quantities/reason and do not alter the booked
  price, charge, order, quote or required fabric.
- History records issue/line/movement IDs, material/fabric, Fabric + Batch barcode,
  internal Than, quantity/unit, source, job, genealogy, issuer and timestamp.
  Tailor sees assigned jobs/history only. Counter/Tailor have no CP projection.
- Receipt/issue request UUID + payload guarantee retry without duplicate entries;
  changed actor/payload is rejected. Forms retain/freeze uncertain submissions and
  retry the same request. Confirmed SQL rejection permits corrected submission.
- Only the minimal existing Production Job linkage is exposed. No production
  creation, full hierarchy management, finished products or later phase implemented.

### Migration, schema and database changes

New canonical migration:
`supabase/migrations/20261003001100_phase8_consumables_material_issues.sql`.
Byte-identical mirror: `drizzle/migrations/0021_phase8_consumables_material_issues.sql`.
Journal entry 21 appended; no previous journal entry or SQL file rewritten.
SHA256: `6dc6283c4a8a623b14c8773d17c9ef6e54abc36549c0ad982e3da2f45aeaba37`.

- `materials.category`: required text/default `other`, CHECK for the four supported
  categories. This default metadata applies to the four legacy materials; no
  inferred classification or original-column value changed.
- New immutable `consumable_receipts`: PK UUID, unique request ID, private JSON
  payload, material/item/destination/receiver FKs, exact positive numeric(18,3)
  quantity, unit, nonblank reason/time. Material/time/ID index.
- New immutable `consumable_receipt_costs`: receipt FK/PK and explicitly entered
  unit CP bigint, nonnegative supported-paise CHECK; no assumed cost allocation.
- `material_issues`: nullable unique request UUID/payload; assignment/time/ID index.
  `material_issue_lines`: material/issue index. Existing historical identities,
  job XOR/assignment FKs, append-only protections and rows unchanged.
- `inventory_movements.consumable_receipt_id`: nullable unique receipt FK;
  `guard_consumable_receipt_link`/trigger validates exact INWARD identity, destination,
  quantity/unit/actor, no conflicting references, and one movement per receipt.
- `job_material_requirements.material_issue_line_id`: nullable unique FK. New
  `guard_phase8_requirement`/trigger verifies required issue, posted movement, same
  job/material/fabric/quantity/unit and permanent issued requirements.
- `guard_phase7_history` replaced **inside this new migration**, narrowly allowing
  INSERT of linked consumable requirements. Existing fabric quote equality/once,
  requirement immutability, booked identity/order/price protections retained.
- Seven RPCs: `receive_consumable`, `manage_consumable`, `consumable_catalog`,
  `consumable_receipt_history`, `material_issue_jobs`, `post_material_issue`,
  `material_issue_history`. Two private trigger helpers above. Fixed search path,
  stable request advisory locks, job/material/item/location lock order.
- PostgREST schema reload notification included in the versioned migration.
- No stock/data backfill, manual schema change, reset/delete, historical-ID change,
  new live business fixture, inferred opening quantity, price or location. All 366
  rows in the 63 pre-existing public tables, projected onto their original columns,
  fingerprinted unchanged before/inside/after application.

### Permissions / RLS

- No new role, permission key, assignment or hierarchy backfill. Receiving requires
  active Owner or Stock Entry + `inventory.receive`; issues require active Owner
  or Counter + `pos.issue_to_tailoring`; catalogue management is Owner only.
- New receipt tables enable RLS. Owner reads operational receipts/CP. Stock Entry
  reads own operational receipts only; submitted CP has no Stock Entry read policy.
  Browser column grants exclude receipt JSON retry payload (which contains CP).
- Authenticated EXECUTE granted only on checked workflow/read RPCs. Anonymous and
  PUBLIC execution denied; private trigger helpers also deny authenticated EXECUTE.
  Browser raw writes on new tables denied; trusted service-role grants retained.
- Read APIs project operational fields only, never CP/SP/internal financial data.
  Tailor jobs/issue history scope to assigned jobs. Existing CP and role ceilings,
  raw ledger restrictions and fixture actor/provenance closure remain intact.

### Tests, build and actual live verification

- Phase 8: **369** disposable PostgreSQL/frontend-input checks, canonical/mirror
  demo replay and clean canonical replay. Covers receipt/issue exactly-once and
  changed retries, each category/native unit, exact quantities/paise, invalid
  inputs, source shortage, late failure rollback, job/genealogy/actor history,
  additional fabric with frozen booked price, immutable/linked requirements,
  existing Production Job linkage, raw writes, CP secrecy, assigned Tailor scope,
  revoked permissions, inactive staff and anonymous denial.
- Earlier regressions: Phase 1 278 (bounded schema baseline), Phase 2 164,
  Phase 3 230, Phase 4 228, Phase 5 171, Phase 6 238, Phase 7 290. Phases 2–7
  loaded Phase 8. Phase 3 legacy snapshot projects out the new category metadata;
  independent Phase 8/live checks compare every original column across all tables.
- Existing reconciliation suite 207 and approved test-stock suite 96 passed with
  Phase 8 loaded. **2,271 total local checks**, none executed against live data.
- TypeScript passed. Isolated production client + server build passed, with the
  existing tsconfig-path plugin and mixed Supabase import warnings. No deployment.
- Application and all Phase 8 affected-script lint passed with zero errors/eight
  existing fast-refresh warnings. Full repository lint still reports **217
  pre-existing prettier-only errors** in four untouched reconciliation scripts;
  exact filenames/counts are recorded in `docs/PHASE8_VERIFICATION.json`. Their
  business/provenance tests pass; unrelated formatting was intentionally unchanged.
- Applied **only** the new migration to the configured real database. Existing
  applied files were hash-checked/skipped. Schema/permission comparison and complete
  existing-row preservation checks ran inside the migration transaction before
  its Supabase/private execution-ledger entries committed together.
- Cumulative Phase 8 schema verified: columns, constraints, indexes, functions/
  EXECUTE, triggers, policies and table RLS/browser CRUD. **92 live read-only
  security/hash/state checks** pass using existing Owner/Counter/Tailor/Stock Entry.
  Owner sees original 10 fabric CP/16 Than CP records; other roles see zero.
- Three actual PostgREST RPC calls verify registered new APIs and anonymous
  401/42501 denial. Rerun verifies Phase 8, matching migration hash and skips it
  without replay. All **22** repository migrations now recorded live.

### Files changed / evidence

- New canonical migration/mirror; appended Drizzle journal and migration README.
- New `src/features/inventory/Consumables.tsx`, `consumable-input.ts`,
  `src/features/tailoring/MaterialIssues.tsx`; typed RPC declarations in
  `src/integrations/supabase/types.ts`.
- Inventory, POS and Tailoring routes embed the screens. CustomerTailoring adds
  Material Issues cache invalidation after job creation/status changes.
- New `scripts/phase8-material-test.mjs`; updated Phase 1–7 test migration selection
  and affected snapshots; updated live rollout/security scripts for the Phase 8
  reference following the already-approved provenance overlay. Changed scripts
  formatted; no functional edit to the four pre-existing reconciliation scripts.
- New `docs/PHASE8_CONSUMABLES_MATERIAL_ISSUES.md`, `PHASE8_VERIFICATION.json`,
  `PHASE8_LIVE_VERIFICATION.json`, `PHASE8_SECURITY_VERIFICATION.json`,
  `PHASE8_API_VERIFICATION.json`; appended this history. No credentials recorded.

### Limitations and intentionally unchanged

- No authenticated browser click/scanner/printer acceptance or multi-connection
  race test claimed. SQL operational fixtures ran only in disposable databases;
  live verification did not create staff, jobs, issues, receipts or sales.
- Four unresolved historical tailoring jobs retained pending the earlier Owner
  decision. Original test stock, CP/SP, quantities, locations and migration history
  preserved. Incomplete/draft fabric fixtures intentionally remain incomplete.
- Receipt CP retained per submission; no invented FIFO/LIFO/weighted valuation,
  automatic material-cost allocation or complete production costing (Phase 12).
- No Phase 9+, package/config change, commit/push/deployment or Git history rewrite.

### Section 31 report

PHASE:
- 8 — Consumables + Material Issues.

STATUS:
- Implemented and live verified; phase boundary reached.

IMPLEMENTED:
- Consumable receiving/inventory, required/additional job issues and linked history.

MODIFIED:
- New migration/mirror/journal, screens/routes/types/cache integration, verification
  scripts, migration README, detailed evidence and Implementation History.

REUSED:
- Existing materials, native units, location ledger, canonical jobs/assignments,
  Fabric + Batch barcode/internal Thans, booking/pricing snapshots and role ceilings.

DATABASE CHANGES:
- `20261003001100_phase8_consumables_material_issues.sql` applied; immutable
  receipts/private CP, category metadata, request/receipt/requirement references,
  indexes, checked RPCs/guards/RLS. All existing original columns/rows preserved.

SECURITY / PERMISSIONS:
- Owner/authorized Stock Entry receiving; Owner/authorized Counter issuing;
  assigned Tailor history; CP Owner only after receipt posting; raw writes denied.

TESTS:
- 2,271 local checks, 92 live checks, PostgREST registration/anonymous denial,
  cumulative schema/preservation/hash checks and recorded-migration retry passed.

BUILD:
- TypeScript, scoped lint and isolated production build passed. Eight existing
  fast-refresh warnings; 217 untouched repository script-formatting errors remain.

BUSINESS RULES VERIFIED:
- Explicit actual quantities, same-job genealogy, no negative stock/double posting,
  one Fabric + Batch barcode, no automatic wastage or booked-order repricing, CP secrecy.

REMAINING:
- Browser/concurrency acceptance, pre-existing formatting debt and four historical
  job decisions. Later production creation/valuation remain in their planned phases.

NEXT PHASE:
- Stopped after Phase 8. Await Owner approval before Phase 9.

### 2026-10-04 — Phase 8 final review: repeat-required guard

This same-phase final review supersedes the main rollout checkpoint's final totals
above. Before moving to any later phase, review identified that a fresh request
UUID could label a later quantity of an already-declared job material as required.
The Master Plan requires genuine later quantities to use Additional Material Issue.

- Created/applied a **second new migration**, preserving the applied main file:
  `supabase/migrations/20261003001200_phase8_required_issue_guard.sql`, byte-identical
  mirror `drizzle/migrations/0022_phase8_required_issue_guard.sql`, appended journal
  entry 22. SHA256:
  `980f9df5c08e6c3ef36c3411935274ed988788ffdc4ea77dc9ff32c151fcadf5`.
- Added private fixed-search-path `guard_phase8_required_repeat()` and BEFORE INSERT
  `phase8_required_issue_once` on `material_issue_lines`. An existing requirement
  for the same canonical job/material or Fabric + Batch requires an additional
  issue. Initial production issues may include multiple internal Thans from the
  same stock within one issue. Phase 7 request-less booking/quoted fabric is exempt
  from this new declaration check and retains its existing exact-quantity guards.
- No table/column/FK/index/backfill/data/price/role change in this follow-up. Private
  trigger EXECUTE denied to PUBLIC/anon/authenticated. Included PostgREST reload.
- Job-level posting lock serializes competing new requests; old issued quantities,
  IDs, assignments, requirements, receipts and booked prices remain unchanged.
- Local Phase 8 suite now **372** checks including a fresh-request repeated-required
  rejection. Late-failure retry tests now explicitly request additional quantities.
  Re-ran Phase 2–7 regressions and both reconciliation/provenance suites with both
  Phase 8 files loaded. All passed. Phase 1's prior 278 checks remain applicable.
  Final local total **2,274**. Final affected-source/script lint still zero errors/
  eight pre-existing warnings; database-only follow-up requires no new app build.
- Actual live application verified cumulative schema/grants/RLS and fingerprints
  for all **65 now-existing public tables / 366 rows** inside/after its transaction,
  then recorded its filename/hash/verification in both migration ledgers. All
  **23** repository migration versions now recorded. Live security total **93**.
  Rerun verifies the complete schema and skips both recorded Phase 8 files.
- Journal order validated. Both new files and all Phase 1 onward mirrors are byte
  identical. Three historical pre-Phase-1 mirror files retain their pre-existing
  formatting/comment differences; they were not edited, and canonical/mirror
  migration replay/regression tests pass.
- Updated Phase 8 evidence/summary/README with both migration results. Retained
  main rollout evidence and appended the follow-up report in the verification JSON.
  All earlier limitations and intentionally unchanged items still apply.

Final Section 31 update:

PHASE:
- 8 — Consumables + Material Issues (including final-review guard).

STATUS:
- Implemented and live verified.

IMPLEMENTED:
- Receiving, consumable inventory, explicit required/additional issues and history;
  later quantities of declared materials require Additional Material Issue.

MODIFIED:
- New guard migration/mirror/journal and final verification/evidence; main applied
  Phase 8 migration preserved.

REUSED:
- Phase 8 workflow, existing job/item/location locks and immutable requirements.

DATABASE CHANGES:
- Both `20261003001100_phase8_consumables_material_issues.sql` and
  `20261003001200_phase8_required_issue_guard.sql` applied and recorded; no existing
  original-column value or row changed.

SECURITY / PERMISSIONS:
- Existing checked RPCs/CP ceilings preserved; new guard helper is private.

TESTS:
- 2,274 local checks and 93 live checks passed; cumulative schema, preservation,
  recorded-hash retry and new API registration/anonymous denial verified.

BUILD:
- Production build/TypeScript/scoped lint passed; unchanged full-repository
  formatting debt and existing warnings remain as recorded above.

BUSINESS RULES VERIFIED:
- Exact actual quantities, Additional Material Issue for later quantities, one
  debit per line, genealogy, cost secrecy, no automatic wastage or order repricing.

REMAINING:
- Browser/concurrency acceptance, existing formatting debt and four historical jobs.

NEXT PHASE:
- Stopped at Phase 8. Await approval for Phase 9.

---

## 2026-10-04 — PHASE 9: Factory / Section / Tailor Management

### Objective and verified baseline

- Owner authorized Phase 9. Re-read Master Plan Sections 13, 26/Phase 9 and relevant
  Phase 0–8 findings/history; followed Sections 30/31. Scope is hierarchy management,
  assignment/filtering and preservation of existing job/material history only.
- Inspected Phase 1 hierarchy/assignment constraints, Phase 2 roles/RLS, minimal
  Phase 7 setup/booking and Phase 8 Material Issue guards/screens. Tested the actual
  pooler connection and verified the live cumulative Phase 8 schema before rollout.
- `systems_operations_guide.md` remains absent as recorded in Phase 8. The Master
  Plan and permanent history remain the business/current-state authority.

### Actually implemented / decisions

- Owner management for independent Factories, their Sections and business Tailors:
  explicit code/Tailor ID, name/real name, active/disabled state, optional active
  Tailor login, Factory and optional Section assignment. No Factory login role,
  automatically created staff/profile or hard-coded hierarchy/floor count.
- Owner may rename/deactivate/reactivate records. Business codes and Section parent
  IDs remain permanent; a different Section/Factory identity requires a new record.
  Disabling a parent filters its descendants from operational choices without
  changing child flags, jobs, assignments, statuses, quantities or prices.
- Tailor moves close the previous assignment and create a new row with a matching
  effective-time boundary. Current uniqueness and composite Section/Factory FK are
  reused. Old assignment identities cannot be rewritten/deleted/reopened.
- Existing jobs/issues preserve their original assignment ID and genealogy; new
  bookings require the current active assignment. Phase 8 issue validation was
  minimally extended so an existing job can receive explicit additional materials
  using its retained older assignment after reassignment, provided its business
  Tailor/Factory/Section remain active. No job move, stock transfer or repricing.
- An initially unlinked business Tailor can explicitly receive a valid Tailor
  login. An established non-null login with assignment history cannot be swapped/
  removed, protecting historical job access; disabling the Tailor remains available.
  Existing profiles/roles are never changed by hierarchy management.
- Names shown in history remain current entity labels. Rename audit retains the
  previous/new values; no immutable name snapshots are falsely claimed. Historical
  IDs, relationships and posted job/order/issue values remain unchanged.
- Owner mutations require reasons and actor-bound immutable request/payload/result
  records. Same request retries return the same result; changed actor/payload is
  rejected. Reassignment also checks the expected current assignment, rejecting a
  stale screen. Retry of an earlier move after another move does not move anyone back.
  Late failures roll back assignment closure/new row/request/audit together.
- New Owner screen replaces the minimal Phase 7 create-only setup form in existing
  Owner POS/Tailoring setup. Existing applicable-charge configuration is retained;
  older setup RPC remains compatible. Current/past assignment IDs and effective
  dates are displayed; loading/error/empty/pending/retry states are handled.
- Counter obtains current active options, filters Factory → relevant Section →
  Tailor, supports no Section and clears stale Tailor selection when options refresh.
  Backend booking/assignment checks remain authoritative. Tailor options expose only
  their own eligible assignment; Owner hierarchy/profile catalogue is Owner only.

### Database migration and exact scope

New canonical migration:
`supabase/migrations/20261004000000_phase9_tailoring_management.sql`.
Byte-identical mirror: `drizzle/migrations/0023_phase9_tailoring_management.sql`.
Appended journal entry 23. SHA256:
`f786c1e1120fba624e3dee00f7b3dde4b2d66330ac3f13d17858c793a9d3678e`.
No already-applied migration or prior journal entry modified/deleted/renamed.

- New immutable `tailoring_management_requests`: request UUID PK, actor/profile FK,
  JSON payload, result UUID, recorded timestamp and actor/time index. The generic
  result UUID represents one of multiple entity/assignment tables; checked RPCs
  produce it, without an invented polymorphic FK. UPDATE/DELETE is append-only.
- New private `guard_phase9_hierarchy()` and UPDATE/DELETE triggers on
  `tailoring_factories`, `tailoring_sections`, `tailors`, `tailor_assignments`:
  no deletes, permanent business codes/Section Factory/established login identity,
  permanently closed assignment history, no future closure. Existing immutable
  assignment identity, positive interval, one-current-assignment index and FKs reused.
- New `manage_tailoring_entity()` Owner create/edit/enable/disable RPC; required
  identity/state/reason and applicable relationship validation; request/audit atomic.
- New `assign_tailor()` Owner RPC; validates active parents/Tailor/optional login,
  matching Section Factory, request retry/expected assignment; closes prior row once,
  inserts new assignment and immutable request/audit together.
- New `owner_tailoring_hierarchy()` Owner read catalogue/history/profile names/IDs;
  new `tailoring_assignment_options()` role-scoped active/current/effective options
  with explicit Factory/Section/no-Section filtering. No financial projection.
- `post_material_issue()` replaced **in this new migration only**: copied Phase 8
  function with only its existing-job assignment-current predicate relaxed. Active
  hierarchy, job identity/status, exact units/quantities, role ceiling, required vs
  additional, source/actor/link/once-only/ledger/retry/immutability protections retained.
- Fixed public search paths, request advisory locks, shared Phase 7 hierarchy
  advisory lock and entity/assignment row locking; existing booking/ledger locks reused.
- PostgREST schema reload notification in migration. No hierarchy, job, profile,
  assignment, stock or financial backfill; no inferred legacy mapping/data correction.

### Permissions / RLS

- Active Owner required for both mutations and full hierarchy/history/profile read.
  No new permission key or role; no new raw hierarchy write privileges.
- New request table enables RLS: Owner SELECT only, authenticated SELECT grant,
  no authenticated mutations, trusted service-role administrative grant. Private
  trigger helper denies PUBLIC/anon/authenticated EXECUTE.
- Four checked RPCs grant authenticated EXECUTE, deny PUBLIC/anon. Options permit
  active Owner/Counter, or Tailor constrained to own assignment. Stock Entry and
  Ecommerce cannot retrieve management/options through the new APIs.
- Existing role ceilings, CP/receipt-cost protection, Tailor history scope and
  ledger/provenance security remain intact; no profile/role/RLS history rewritten.

### Tests, build, live execution and verification

- **297 Phase 9 checks**: canonical/mirror demo and clean canonical chains; all
  existing original columns/rows preserved; dynamic creation/updates, optional
  Section/login, Factory-scoped Section codes, relevant filtering, identity/parent/
  login protection, disable/re-enable, one current assignment/effective boundary,
  repeated/changed/stale requests, old retry after later move, late-failure rollback
  and successful retry, old-job/new-issue genealogy and unchanged final price, new
  booking rejection for closed assignment, retained history, Owner ceiling, Tailor
  scope, raw writes, inactive Owner, CP and anonymous denial.
- Earlier tests with Phase 9 loaded: Phase 2 164, Phase 3 230, Phase 4 228,
  Phase 5 171, Phase 6 238, Phase 7 290, Phase 8 372; bounded Phase 1 278.
  Existing legacy reconciliation 207 and test-stock provenance 96 also passed.
  **2,571 total local checks**, all fixtures only in disposable PostgreSQL.
- TypeScript and affected-source/script lint pass: zero errors/eight existing
  fast-refresh warnings. Full repository lint remains 217 pre-existing prettier-only
  errors in the same four unchanged reconciliation scripts, whose tests pass.
- Isolated production client/server build passed; existing tsconfig-path/mixed
  Supabase-import notices remain. No production application deployment claimed.
- Applied only this new migration to the configured real database. Existing files
  hash-checked/skipped. Columns, constraints, indexes, functions/EXECUTE, triggers,
  policies, RLS/browser CRUD matched the cumulative canonical reference, including
  the approved fixture provenance, inside the application transaction.
- All **366 rows / 65 pre-existing public tables** fingerprinted unchanged on
  original columns before/inside/after application. New request table starts empty;
  no real Factory, Section, Tailor, profile, assignment, job, issue, receipt or sale
  created by rollout. Actual filename/hash/applied mode/schema verification recorded
  atomically in Supabase/private execution ledgers; **24 SQL versions** now recorded.
- **115 live read-only security/hash/state checks** pass using existing active staff.
  Owner retains 10 original fabric CP/16 Than CP rows; other tested roles see zero.
  New Owner/role APIs, request RLS and raw-write denial verified. Actual PostgREST
  calls show both new read RPCs registered and anonymous requests denied 401/42501.
- Repeat rollout verifies complete Phase 9 schema/hash, skips the recorded file
  without duplicating changes, and preserves existing rows again. New mirror/journal
  order verified; historical SQL/comment/format differences left untouched.

### Files changed / evidence

- New canonical migration/mirror; appended journal entry and migration README.
- New `src/features/tailoring/HierarchyManagement.tsx`, `hierarchy-options.ts`;
  updated CustomerTailoringSetup/CustomerTailoring and typed RPC declarations.
  Existing POS/Tailoring routes reuse these components; no navigation/module grants.
- New `scripts/phase9-hierarchy-test.mjs`; updated Phase 1–8 test phase selection,
  live rollout canonical ordering/checkpoint and live security verifier. Four legacy
  reconciliation scripts remain unchanged.
- Added `docs/PHASE9_TAILORING_MANAGEMENT.md`, `PHASE9_VERIFICATION.json`,
  `PHASE9_LIVE_VERIFICATION.json`, `PHASE9_SECURITY_VERIFICATION.json`,
  `PHASE9_API_VERIFICATION.json`; appended this permanent history. No credentials.

### Limitations / intentionally not changed

- No authenticated browser click acceptance or live multi-connection race test.
  Operational tests use disposable PostgreSQL; live checks are read-only except
  the versioned schema migration and its private migration-ledger records.
- Four legacy tailoring-job reconciliation issues remain unchanged pending the
  prior Owner decisions. No guessed hierarchy/job migration, location/quantity/
  price, opening balance, invoice or stock transfer. Original test fixtures retained.
- No Phase 10+ production creation, finished products, costing, deployment, package/
  configuration edit, commit/push or Git history rewrite. Stopped after Phase 9.

### Section 31 report

PHASE:
- 9 — Factory / Section / Tailor Management.

STATUS:
- Implemented and live verified.

IMPLEMENTED:
- Dynamic Owner hierarchy management, active/disabled states, optional login/Section,
  assignment/reassignment history and relevant Counter/assigned Tailor filtering.

MODIFIED:
- New migration/mirror/journal, hierarchy/setup/booking integration/types, verification
  scripts, migration README, exact evidence and Implementation History.

REUSED:
- Existing domain IDs/FKs/current uniqueness, booking/pricing/ledger/roles/RLS/audit.

DATABASE CHANGES:
- `20261004000000_phase9_tailoring_management.sql` applied; immutable request registry,
  hierarchy history guards, checked management/filtering RPCs and minimal existing-job
  Material Issue predicate extension; all existing original columns/rows preserved.

SECURITY / PERMISSIONS:
- Owner mutations/full catalogue; relevant Counter/own Tailor options; private
  request RLS/helpers; no new role/raw-write/financial privilege.

TESTS:
- 2,571 local checks, 115 live checks, schema/data/hash/retry verification and real
  PostgREST registration/anonymous denial passed.

BUILD:
- TypeScript/scoped lint/production client-server build passed; eight existing
  warnings and unrelated 217 script-formatting errors remain documented.

BUSINESS RULES VERIFIED:
- Dynamic matching hierarchy, one current assignment, retained job/issue genealogy,
  active filtering, explicit Owner changes, no repricing/stock guesses/Factory role.

REMAINING:
- Browser/concurrency acceptance, existing formatting debt and four legacy job decisions.

NEXT PHASE:
- Stopped at Phase 9. Await Owner approval before Phase 10.

## Phase 10 — Owner Production — 4 October 2026 (Asia/Calcutta)

### Authorization, baseline and objective

User explicitly authorized Phase 10. Re-read the Master Plan's Phase 10,
Sections 15–16 and 30–31, Phase 0 T05/P01 findings and Phase 9 history. Implement
separate Owner Production with Product, Design, identical-piece Quantity, actual
Fabric/Materials, Factory → optional Section → Tailor, material issuance,
production status and job completion. The operations guide remains absent as
previously documented. No Phase 11 or later workflow was implemented.

### What actually changed

Added separate `OwnerProduction.tsx` panel on the existing Tailoring route. Owner
configures Product/Design codes/names/active states and optional explicit Design /
Embroidery charge versions. Owner creates one Production Job for one Product and
one Design with positive whole piece count and current hierarchy. Different Design
requires a new job. At least one fabric line and explicit total quantities are
required; native units/whole millimetres are preserved with no multiplication,
wastage or buffer. Creation posts the initial required Material Issue atomically.
Counter's existing Material Issues panel supports explicit subsequent issues;
Owner or assigned Tailor starts/completes jobs with expected-state checks, reason,
actor/time history and immutable retries. No customer or Customer Tailoring bill
is involved. Requests with uncertain outcomes retain the same UUID/payload for retry.

Files created: canonical migration and mirror below; `src/features/tailoring/OwnerProduction.tsx`;
`scripts/phase10-production-test.mjs`; `docs/PHASE10_OWNER_PRODUCTION.md`,
`docs/PHASE10_VERIFICATION.json`, `docs/PHASE10_LIVE_VERIFICATION.json`,
`docs/PHASE10_SECURITY_VERIFICATION.json`, `docs/PHASE10_API_VERIFICATION.json`.
Files modified: `drizzle/migrations/meta/_journal.json` (append index 24 only),
`src/routes/_authenticated/tailoring.tsx`, `src/features/tailoring/MaterialIssues.tsx`
(production query invalidation), `src/integrations/supabase/types.ts`,
`scripts/phase1-schema-test.mjs` (retain Phase 1 boundary), Phase 2–9 database
suite runners (opt-in Phase 10 cumulative chain), `scripts/live-db-rollout.mjs`,
`scripts/live-db-verify.mjs`, `supabase/migrations/README.md`, this history.
No package/configuration/seed changes were made during Phase 10; prior dirty work
and historical SQL were preserved. No commit, push or app deployment performed.

### Migration, database and security record

- New canonical `supabase/migrations/20261004000100_phase10_owner_production.sql`;
  byte-identical `drizzle/migrations/0024_phase10_owner_production.sql`.
  SHA256 `85ad3f59045bf4670b9b29cd042edb1b0159b8335bff4a37a7527ce9d008cd30`.
  Purpose: checked Owner Production configuration/atomic issuance/status workflow.
- New `production_requests`: request UUID PK, actor profile FK, exact JSON payload,
  result UUID and timestamp; actor/time index. Generic result UUID checked by RPC,
  not an invented polymorphic FK. Owner-only SELECT under RLS; financial payload
  unavailable to other roles. New `production_status_events`: UUID PK, Production
  Job FK, UNIQUE request FK, checked old/new statuses, actor profile FK, nonblank
  reason and timestamp; job/time index. Owner or assigned Tailor SELECT under RLS.
  Both immutable; no authenticated raw INSERT/UPDATE/DELETE/TRUNCATE; service_role
  table privileges explicitly retained.
- Reused original Product/Design/charge version/Production Job, requirement,
  material issue/line, movement and audit tables/FKs/checks/unique constraints.
  No existing columns, relationships or indexes changed; no data backfill/seed.
- Added private `guard_phase10_production`, `phase10_history_guard` on Product,
  Design and Production Job. Blocks deletion, code changes and issued-job identity,
  quantity, assignment, notes/creator/time/charge snapshot rewrites. Job progresses
  open → in_progress → completed only with posted required fabric. Request/event
  `phase10_immutable` triggers reuse `reject_domain_history_rewrite`.
- Added `manage_production_catalog`, `create_owner_production`,
  `progress_owner_production`, `owner_production_catalog`,
  `owner_production_history`. Full table/column/function/trigger/index/permission
  descriptions in `docs/PHASE10_OWNER_PRODUCTION.md`. New functions are SECURITY
  DEFINER with fixed public search_path and active-role/assignment guards. Only
  authenticated/service_role can execute the browser RPCs; no PUBLIC/anon execution.
  Trigger helper private. No new role/module/raw-write/financial privilege.
- Owner alone configures/creates and retrieves current Design charge; existing
  Design-charge RLS remains Owner-only. Owner/assigned Tailor reads operational
  production history without CP/charge/cost/SP. Assigned Tailor with manage_jobs
  may progress only their own jobs; Counter can issue via existing checked API.
  Live Counter test account also holds Tailor; effective-role union grants its
  assigned-job view, never financial catalogue or creation rights.
- Creation snapshots latest actual Design charge version when present; absence
  remains NULL, never guessed zero. Blank configuration charge preserves existing
  value; explicit zero adds a real zero version. Full costing remains Phase 12.
- Live connection tested using configured Supabase Session Pooler. Current Phase 9
  schema verified before mutation. Only the new file was applied, in a transaction,
  with cumulative reference schema comparison and old-row fingerprints before
  commit. Applied historical files were hash-checked/skipped. Both Supabase/private
  ledgers record filename/purpose/hash/verification; all 25 repository SQL versions
  match. PostgREST reload is migration-controlled. No manual undocumented DB change.
- All 66 pre-existing public tables / 366 rows retained exactly across original
  columns. Two new empty tables added, giving 68 public tables. No live Product,
  Design, Production Job, material issue, business fixture, customer/order or stock
  movement was created by deployment. Read-only recheck verifies live Phase 10.

### Tests, verification and actual limitations

- 399 new Phase 10 assertions across canonical demo, mirror demo and clean replay:
  ten-piece identical job, separate Design/new job, exact total material/fabric
  consumption, version snapshot retained after later charge update, absent charge,
  code/job immutability, active catalogue/current hierarchy, old assignment genealogy,
  duplicate/changed/late retries, invalid source/stock/quantity/items, atomic job and
  status late-failure rollback, expected-state progression, terminal completion,
  assigned/unassigned/Owner/Counter/Stock Entry/ecommerce/anonymous/inactive denials,
  private payload/Design-charge RLS and zero customer/order/finished/cost/SP effects.
- Existing Phase 1–9 and reconciliation suites passed with Phase 10: 2,571 earlier
  assertions; plus 25 barcode decoding/exact money input assertions. Total local
  validation: 2,995 assertions (2,970 business/database + 25 barcode/money).
- Production client/server build and TypeScript passed. Scoped ESLint: zero errors,
  eight existing Fast Refresh warnings. Full repo: unchanged 217 formatting errors
  in four previously documented, unmodified legacy/test-stock scripts.
- 157 read-only live role/RLS/API/grant/hash checks passed. Five actual PostgREST
  RPCs registered and deny anonymous requests with 401 / 42501. Live schema matches
  cumulative reference constraints/indexes/functions/triggers/policies/RLS/grants.
  Exact deployment/security/API results stored in the Phase 10 evidence JSON files.
- Initial parallel regression execution exhausted local memory; sequential reruns
  passed. Initial live verifier incorrectly assumed Counter's real account had no
  Tailor role; corrected test expectation to the actual existing role union, then
  all checks passed. Neither event required an application/schema/data workaround.
- Browser click-through acceptance, live transaction fixtures and real concurrent
  connection races not run. Live catalogue/jobs remain empty awaiting explicit
  Owner setup. Four legacy job domain/assignment decisions remain unchanged.
- Completion records whole-job status/events only. Individual Finished Products,
  unique Product Barcodes, Workshop return stock/genealogy are Phase 11. Complete
  Production Cost and Finished Product SP are Phase 12. No stock is automatically
  returned or moved to Showroom, no cost/price/quantity/location guessed.
- Legacy screens, seed history, existing tests' business assertions and unrelated
  dirty files intentionally preserved. No Phase 11–16 implementation.

### Section 31 report

PHASE:
- 10 — Owner Production.

STATUS:
- Implemented and live verified.

IMPLEMENTED:
- Separate Product/Design/Quantity Production Job, exact required Fabric/Materials,
  dynamic hierarchy, atomic issue, assigned status/work/completion and retained history.

MODIFIED:
- New migration/mirror, append-only journal, separate production UI/route/types,
  issue invalidation, current/old verification runners, README/docs and permanent history.

REUSED:
- Phase 1 production domain, Phase 8 requirements/issues/ledger, Phase 9 hierarchy,
  existing roles/RLS/audit, exact quantities and immutable Design charge versions.

DATABASE CHANGES:
- `20261004000100_phase10_owner_production.sql` applied/verified; two immutable
  request/status tables, history guards, five checked RPCs; all existing data preserved.

SECURITY / PERMISSIONS:
- Owner catalogue/create/internal charge; Owner/assigned Tailor operational history
  and work; existing Counter issue controls; raw writes/anon/financial leakage denied.

TESTS:
- 2,995 local assertions, 157 live checks, five PostgREST registration/anon denials,
  schema/hash/mirror/old-row preservation and rollback verification passed.

BUILD:
- TypeScript, scoped lint and production build passed. Existing eight warnings and
  217 unrelated formatting errors remain documented.

BUSINESS RULES VERIFIED:
- No customer; one Product/Design per job; explicit total quantities; separate Designs;
  exact issued genealogy; retained charge/assignment; assigned work; terminal completion.

REMAINING:
- Browser/concurrent acceptance and four existing legacy job decisions. Finished
  pieces/barcodes/Workshop returns and costing/SP remain their approved future phases.

NEXT PHASE:
- Phase 11 — Finished Products + Product Barcodes. Stopped; await Owner approval.

## Phase 11 — Finished Products + Product Barcodes — 4 October 2026 (Asia/Calcutta)

### Authorization, objective and verified baseline

User explicitly authorized Phase 11. Re-read Master Plan Phase 11, Sections 17–18,
30–31 and the Phase 10 implementation/history. Phase 10 records whole-job completion;
Phase 1 already supplied physical-piece/barcode/material relationships and Phase 3
supplied the ledger. Objective: implement individual Finished Products, unique
Product Barcodes, genealogy, current location/status and the exact ten-piece bulk
acceptance case. Phase 12 onward was not implemented. The previously absent
operations guide remains absent; Master Plan/history govern this work.

### What was actually implemented

Owner confirms a completed job's full physical piece set and actual per-piece
usage from its posted material issue lines. The form is a named material/Batch/Than
quantity grid; no internal UUID entry is required from the user. Each piece must
have positive actual fabric usage. Explicit fabric metres convert to whole mm;
other material quantities retain their native unit/three-decimal precision. No
per-piece quantity is inferred by division, multiplication, copying or waste.
Unallocated issued material stays in history and is not automatically consumed,
returned, costed or deleted.

One atomic receipt creates numbered pieces 1..Job Quantity, individual permanent
Product/Design/Production Job relationships, independent `PRD-` UUID Product
Barcodes, immutable material usage rows, one zero-initialized inventory item and
one 1-pc PRODUCTION movement into Workshop per piece, plus receipt/audit history.
There is no second material debit. Actor/request payload retries return the same
result; changed retries, duplicate/new receipts and pre-existing partial pieces
are rejected without overwrite. The job was already completed in Phase 10; receipt
records actual Workshop arrival. No direct Showroom receipt or opening-stock guess.

Owner/Counter scan individual Product Barcodes; assigned active Tailors see only
their jobs' pieces. Lookup links Product/Design/Job/piece, actual materials with
Fabric + Batch barcode/internal Than, Factory/Section/Tailor/historical assignment,
production/receipt history, location, status and current ledger availability.
Fabric barcodes cannot resolve to Finished Products. Printable Code 128 labels
contain product/design/piece/job identity and barcode only. Existing SP read for
Owner/Counter is supported through the original version table; no absent price is
filled and no internal cost/charge is projected. Costing/SP setup remains Phase 12.
Existing generic Phase 3 ledger operations remain unchanged; lookup reflects their
current location/status. No dedicated Phase 13/14 transfer/sale UI/RPC was authored.

### Files changed and retained

Created: `supabase/migrations/20261004000200_phase11_finished_products.sql`,
`drizzle/migrations/0025_phase11_finished_products.sql`,
`src/features/tailoring/FinishedProducts.tsx`, `scripts/phase11-products-test.mjs`,
`scripts/phase11-label-test.mjs`, `docs/PHASE11_FINISHED_PRODUCTS.md`,
`docs/PHASE11_VERIFICATION.json`, `docs/PHASE11_LIVE_VERIFICATION.json`,
`docs/PHASE11_SECURITY_VERIFICATION.json`, `docs/PHASE11_API_VERIFICATION.json`.
Modified: `drizzle/migrations/meta/_journal.json` (append index 25),
`src/routes/_authenticated/tailoring.tsx`, `src/routes/_authenticated/pos.tsx`,
`src/features/inventory/fabric-label.ts` (optional print frame title; Fabric default
unchanged), `src/integrations/supabase/types.ts`, Phase 1–10 database test runners
(historical boundary or opt-in Phase 11), `scripts/live-db-rollout.mjs`,
`scripts/live-db-verify.mjs`, `supabase/migrations/README.md`, this permanent history.
No application configuration/package/seed changes. Prior dirty files and all
historical migrations retained; no commit, push or application deployment.

### Migration and database changes

- New `20261004000200_phase11_finished_products.sql`, byte-identical mirror
  `0025_phase11_finished_products.sql`, SHA256
  `60d13e54d09816b654486dd35ed51218ffce0314f81c6db9f182746d00bf49af`.
  Purpose: checked physical-piece manufacture receipt, actual genealogy, unique
  barcodes, ledger entry and scan workflow. No existing migration edited/deleted/
  renamed/replayed, no data backfill or manual undocumented database change.
- `finished_product_receipts`: request UUID PK, UNIQUE Production Job FK, actor
  profile FK, Workshop location FK, exact JSONB payload, nonblank reason, timestamp;
  actor/time index. One receipt confirms the whole completed job.
- `finished_product_receipt_pieces`: Finished Product FK/PK, required request FK,
  request index. RPC/movement guard verify piece and receipt share the same job.
- New partial UNIQUE `phase11_piece_production_event_idx` on movement finished
  product ID for kind PRODUCTION prevents a second manufacture event per piece.
- No existing columns/FKs altered. Existing physical-piece uniqueness, composite
  Product/Design/Job and barcode-kind FKs, material/job/unit/sum guards, inventory
  identity/balance/location authority and audit are reused.
- New private `guard_phase11_identity` and barcode/piece history triggers retain
  barcode, piece number/job/Product/Design, created timestamp and IDs; no deletion.
  New PRODUCTION movement guard requires completed receipt, actor, Workshop,
  matching job/piece/reference, exactly 1 pc. Existing ledger guards remain active.
  New registry immutability triggers reuse reject_domain_history_rewrite.
- New `receive_finished_products` Owner-only SECURITY DEFINER RPC uses fixed public
  search_path, actor-bound UUID/payload, job/issued-line locks, actual whole piece
  set, exact allocations and one transaction for receipt/products/barcodes/materials/
  stock/audit. No partial recreation or quantity/location guesses.
- New `finished_product_catalog` SECURITY DEFINER RPC checks active Owner/Counter
  or assigned Tailor, bounds results to 100, supports barcode/job filters, returns
  operational genealogy/history/current stock with only permitted SP read.
- Both new tables enable RLS, authenticated Owner-only SELECT; raw writes/TRUNCATE
  revoked from PUBLIC/anon/authenticated; service_role privileges retained. Browser
  RPCs allow authenticated/service_role execution with role/assignment checks;
  PUBLIC/anon execution revoked, helper private. No new role/module privilege or
  financial RLS relaxation. PostgREST reload is migration-controlled NOTIFY.

### Actual execution and verification

Tested configured live Session Pooler connection and matched live cumulative
Phase 10 schema before applying anything. Applied only the new migration in a
transaction, comparing cumulative schema/functions/triggers/constraints/indexes/
RLS/policies/browser privileges and all old-row fingerprints before commit.
68 existing public tables / 366 old rows are unchanged across original columns.
Two new empty tables give 70 public tables. Both existing Supabase/private ledgers
record the actual filename/hash/application verification. All 26 SQL versions
match repository hashes. Subsequent read-only Phase 11 schema recheck passed.
No live transaction, Finished Product, barcode, price, cost or stock fixture was
created. Test receipt/piece data existed only in disposable databases.

- 351 new Phase 11 database assertions passed across canonical demo, mirror demo
  and clean replay: one job → ten pieces → ten unique barcodes, numbered identities,
  1 pc Workshop stock each, exact actual material usage and Fabric + Batch/Than
  provenance, hierarchy/history, open/in-progress refusal, wrong-job/overallocated/
  missing/duplicate/fractional/negative usage, tenth-piece late-failure rollback,
  actor-bound retry/new-request duplicate prevention, immutable IDs/usage/barcodes,
  role/RLS/assigned/anonymous/inactive denials, no cost/SP/sale invention, and current
  scan location following an existing generic Phase 3 transfer in disposable tests.
- 15 independent Code 128 Product Barcode decoding assertions at three scales with
  actual label quiet zones. Prior 2,995 checks passed with the new migration;
  3,361 local assertions total (3,321 business/database + 40 barcode/money).
- TypeScript and production client/server build passed. Scoped lint zero errors,
  eight existing Fast Refresh warnings. Full repo still has the same 217 formatting
  errors in four unchanged legacy/test-stock scripts; no new lint debt.
- 188 read-only live role/RLS/raw-write/API/hash checks passed; actual existing
  multi-role accounts tested using their effective role union. Two real PostgREST
  RPC registration/anonymous 401/42501 checks passed. Exact evidence is in the
  Phase 11 verification JSON files; migration mirror is byte-identical.

### Limitations and intentionally unchanged items

No browser click-through/physical printer/scanner acceptance or actual concurrent
connection race test was run. Lookup displays at most 100 recent pieces or one
scanned code; broad pagination/polish remains future work. Four existing legacy
job domain/assignment decisions remain untouched. Live canonical catalogue/jobs/
pieces remain empty awaiting explicit Owner setup. Owner-entered allocations are
retained permanently; no material-use correction workflow or implicit leftovers/
waste return was invented. Production Cost/SP setup remains Phase 12; dedicated
Finished Product transfer and sale workflows remain Phases 13/14. Existing legacy
screens, business records, seed history, financial tables/rules and unrelated dirty
work were preserved. Stop at Phase 11; no Phase 12–16 implementation.

### Section 31 report

PHASE:
- 11 — Finished Products + Product Barcodes.

STATUS:
- Implemented and live verified.

IMPLEMENTED:
- Individual numbered pieces, unique Product Barcodes, explicit material genealogy,
  completed-job Workshop receipt/stock, current location/status, role-filtered scan
  and printable labels. One-job/ten-piece/ten-barcode bulk test passed.

MODIFIED:
- New migration/mirror/journal entry, Finished Products UI/route/types, optional print
  title, new/regression/live verification runners, README/docs and permanent history.

REUSED:
- Existing piece/barcode/material FKs, Production Job/hierarchy/history, material
  issues, immutable quantity guards, ledger authority, roles/RLS/audit and Code 128.

DATABASE CHANGES:
- `20261004000200_phase11_finished_products.sql` applied/verified: two immutable
  receipt tables, unique production-event index, identity/receipt guards and two
  checked RPCs. All 68 old tables / 366 rows preserved; no seed/backfill.

SECURITY / PERMISSIONS:
- Owner confirms receipt; Owner/Counter scan; Tailor assigned-only; internal cost
  hidden, permitted existing SP read only. Raw writes/anon/private payload denied.

TESTS:
- 3,361 local assertions, 188 live checks and two PostgREST registration/anonymous
  denial checks passed; schema/data/hash/mirror and late-failure atomicity verified.

BUILD:
- TypeScript, scoped lint and production build passed. Existing eight warnings and
  217 unrelated formatting errors remain documented.

BUSINESS RULES VERIFIED:
- One barcode per physical piece, exact actual usage, retained job/material/hierarchy
  genealogy, Workshop first, one stock event per piece, immutable duplicate-safe receipt,
  no price/cost/waste/location guesses or customer tailoring coupling.

REMAINING:
- Browser/printer/concurrency acceptance, four legacy job decisions and later-phase
  costing/SP configuration, dedicated transfers/sales.

NEXT PHASE:
- Phase 12 — Production Costing. Stopped; await explicit Owner approval.

## Phase 12 — Production Costing + Owner Finished Product SP — 4 October 2026 (Asia/Calcutta)

### Authorization, objective and dependencies

User explicitly authorized Phase 12 and then requested continuation. Re-read
Master Plan Phase 12, Sections 16/19/20 and 30/31, current schema and Phase 11
history. Implement complete cost components, total/per-piece cost including
Design/Embroidery, and Owner-controlled SP after review. Phase 1 supplied immutable
cost/version/allocation/price tables; Phase 8 supplied consumable receipt CP; Phase
10 supplied retained Design charge/issued quantities; Phase 11 supplied actual
piece usage and completed-job Workshop receipts. Operations guide remains absent
as previously documented. No Phase 13 onward workflow was implemented.

### Actual implementation and business/technical decisions

New Owner-only Production Costing panel selects completed jobs with every physical
piece received. Owner begins a cost revision, retaining the expected current
version for stale/concurrent revision detection. Every actual issue line is costed
once with an explicit billed quantity covering allocated piece usage and bounded
by issued quantity. No division, wastage, unused-material cost or FIFO is inferred.
Unused issued material may be explicitly billed at zero quantity/cost where actual
usage is zero. Fabric retains exact whole-mm conversion; consumables native units
and up to three decimal places.

Fabric cost derives from the actual Fabric + Batch CP version explicitly selected
by Owner. Consumable cost derives from a matching native-unit receipt CP explicitly
selected by Owner, or an explicit actual total amount when no receipt basis is
selected. This supports legacy material without inventing unit cost or receipt
provenance. Receipt CP is an Owner-confirmed costing basis, not a guessed physical
FIFO/lot assignment. Owner confirms buttons/thread/padding/other-consumables category;
no legacy name is automatically classified. Owner enters total job tailoring/
production charge and named applicable other costs, including explicit zero/none.

Design/Embroidery uses the immutable job charge snapshot. Owner explicitly chooses
whether it applies once to the job or per piece; the Master Plan does not specify
that frequency. A present snapshot cannot be omitted. An absent snapshot requires
an explicit not-applicable confirmation and recorded zero Design component; no
missing charge is guessed or current charge substituted into the historical job.

Source-based components round once to whole paise using positive half-up rounding.
Total is the sum of immutable component rows. Average is Total / Production Quantity;
whole-paise allocations use floor plus one paise on the first remainder pieces in
piece-number order, preserving the exact total without an invented charge. Owner
sees the average and exact allocations. Quantity/genealogy/stock are unchanged.

Owner reviews the latest recorded complete cost, then explicitly sets SP on one
available piece or all available job pieces. Each new SP version links to that
reviewed cost version and reason. No markup/minimum-margin/automatic SP rule; zero
SP requires explicit Owner input. New cost revisions do not change previous SP;
older review links remain and the Owner can see when a price used an earlier cost.
Both costing/pricing retain actor-bound UUID/payload retries and immutable history.

Owner Product Barcode scan now includes current per-piece internal cost/version.
Counter still gets SP without internal cost/CP/charge/version keys; Tailor gets only
assigned operational genealogy and no SP value. Existing session cache clearing
on identity/access change is reused. Direct financial RPC calls are Owner-only.

### Files changed

Created: `supabase/migrations/20261004000300_phase12_production_costing.sql`,
`drizzle/migrations/0026_phase12_production_costing.sql`,
`src/features/tailoring/ProductionCosting.tsx`, `scripts/phase12-costing-test.mjs`,
`docs/PHASE12_PRODUCTION_COSTING.md`, `docs/PHASE12_VERIFICATION.json`,
`docs/PHASE12_LIVE_VERIFICATION.json`, `docs/PHASE12_SECURITY_VERIFICATION.json`,
`docs/PHASE12_API_VERIFICATION.json`.
Modified: `drizzle/migrations/meta/_journal.json` (append index 26),
`src/routes/_authenticated/tailoring.tsx`, `src/features/tailoring/FinishedProducts.tsx`,
`src/integrations/supabase/types.ts`, Phase 1–11 database test runners (historical
boundary / opt-in Phase 12; Owner scan assertion permits absent/null unfinalized
cost while non-Owner financial assertions remain), `scripts/live-db-rollout.mjs`,
`scripts/live-db-verify.mjs`, `supabase/migrations/README.md`, this history.
No package/configuration/seed changes. Old SQL, unrelated dirty work, business IDs,
quantities/locations and prior pricing/cost histories retained. No commit/push/app
application deployment.

### Migration, tables/columns/relationships and security

New canonical `20261004000300_phase12_production_costing.sql`; byte-identical mirror
`0026_phase12_production_costing.sql`; appended journal index 26. Purpose: checked
complete cost revisions/allocations, provenance and Owner-reviewed SP. SHA256
`c1b51c07c181a9bcc36c3b90f93296807c16397849cdca0204b9ad56163e2d49`.
No existing migration modified/deleted/renamed/replayed; no undocumented manual
DDL/data operation, no seed/backfill.

- `production_cost_requests`: UUID request PK; required actor/profile and job FKs,
  exact JSONB payload/result UUID/time, job/time index. Generic result validated
  by RPC (cost version or pricing job) rather than polymorphic FK.
- `production_cost_inputs`: cost-line FK/PK; optional nonnegative numeric(18,3)
  billed quantity and unit together; optional consumable receipt FK; checked Design
  basis job_total/per_piece/not_applicable. RPC enforces actual issue/job/unit/source
  matching and usage bounds. Original cost lines retain Fabric CP/Design/issue FKs.
- `finished_product_price_reviews`: price-version FK/PK, required cost-version FK,
  request FK DEFERRABLE INITIALLY DEFERRED for atomic price/request posting,
  nonblank reason; cost-version index. Actor/time come from original price/request;
  RPC checks cost review and same job/piece allocation.
- All three enable Owner-only authenticated SELECT under RLS; no PUBLIC/anon/browser
  raw writes/TRUNCATE; service_role privileges explicitly retained. New immutable
  triggers reuse reject_domain_history_rewrite. Existing financial version/component/
  allocation/price history triggers, constraints/FKs/uniqueness/RLS remain unchanged.
- Added fixed-search-path SECURITY DEFINER financial RPCs `finalize_production_cost`,
  `set_finished_product_sp`, `owner_production_costs`: active Owner guards, expected
  latest-version checks, explicit input/source/Design validation, job/issued-line
  locks, atomic components/allocations/prices/reviews/request/audit, permanent history.
  Browser EXECUTE allowlist authenticated/service_role only, PUBLIC/anon revoked.
- Existing `finished_product_catalog` replaced solely by this new migration to
  expose latest cost/version only to Owner and accurate price state, preserving
  operational scope and SP role ceiling. No non-Owner internal cost keys or new
  role/module access grant. Financial RLS/raw-write ceilings remain intact.
- No existing columns/indexes/FKs removed/rewritten. Full function/table/index/
  trigger/permission details are in `docs/PHASE12_PRODUCTION_COSTING.md`.
  PostgREST reload is a version-controlled migration NOTIFY.

### Actual database execution and verification

Connected using configured Session Pooler; verified cumulative Phase 11 baseline
before any mutation. Applied only the new file in a transaction with cumulative
schema/functions/triggers/constraints/indexes/policies/RLS/browser privilege checks
and fingerprints of all 70 old public tables / 366 rows before commit. All original
column values match. Three new empty tables give 73 public tables. Both existing
Supabase/private ledgers record the actual filename/hash/verification; all 27 SQL
versions match repository hashes. Subsequent read-only Phase 12 schema recheck
passed. No real job cost/price/stock/customer/order or fixture was created live by
rollout; actual costing/pricing tests used disposable PostgreSQL only.

- 516 new Phase 12 assertions passed on canonical demo, mirror demo and clean
  replay. Verified full component sum, retained Design included once/job or per
  piece per explicit basis, absent snapshot explicit NA, native fractional receipt
  CP half-up rounding, exact average/conserved allocations/remainder, matching CP/
  receipt units, manual actual consumable cost, omitted/duplicate/foreign/under/
  over/fractional/negative inputs, stale/changed/historical retries, immutable
  costing, reviewed SP/zero SP/no automatic SP change, reviewed-cost provenance,
  late cost/price failure rollback, inactive/Owner/Counter/Tailor/Stock Entry/
  ecommerce/anonymous denials, populated financial-table RLS/raw-write protection,
  Owner cost scan and Counter SP with no cost keys.
- Earlier suites passed with Phase 12, plus 40 independent barcode/money assertions.
  Total local checks: 3,877 (3,837 database/business + 40 barcode/money).
- TypeScript, scoped ESLint (zero errors/eight existing warnings) and isolated
  production client/server build passed. Full repo retains the same 217 formatting
  errors across four unchanged legacy/test-stock scripts; no new errors.
- 232 read-only live role/RLS/raw-write/API/hash checks and three real PostgREST
  registration/anonymous 401/42501 denial checks passed. Exact deployment/security/
  API/build/regression evidence is recorded in Phase 12 JSON files. Migration
  canonical/mirror byte equality and recorded hash verified.

### Limitations and intentionally unchanged work

No browser acceptance or real multi-connection race test. Live canonical jobs/
pieces remain empty awaiting actual Owner setup; financial calculations were not
run as production-data fixtures. Four existing legacy job domain/assignment issues
remain untouched. During actual use Owner must confirm billable quantities, real
cost/receipt sources, missing legacy actual costs and Design basis; no unknown
history was reconstructed. No automatic FIFO/receipt allocation, wastage, leftovers
return, markup or SP recalculation. Dedicated Finished Product transfer and sale
workflows remain Phases 13/14; stock/location, old orders/costs/prices, Customer
Tailoring and unrelated dirty files intentionally unchanged. Stop at Phase 12;
no Phase 13–16 implementation.

### Section 31 report

PHASE:
- 12 — Production Costing + Owner Finished Product SP.

STATUS:
- Implemented and live verified.

IMPLEMENTED:
- Complete fabric/tailoring/Design/consumable/other cost components, immutable totals/
  exact per-piece allocations, explicit sources/basis, reviewed Owner SP and history.

MODIFIED:
- New migration/mirror/journal entry, costing/Owner scan UI/types, verification
  runners, migration README, evidence/documentation and permanent history.

REUSED:
- Immutable cost/component/allocation/price domain, job Design snapshot, receipt CP,
  material issue/piece genealogy, original financial RLS/audit/session cache clearing.

DATABASE CHANGES:
- `20261004000300_phase12_production_costing.sql` applied/verified: three provenance/
  request/review tables, indexes/immutable triggers, three checked financial RPCs and
  Owner-only scan extension; all 70 old tables / 366 rows preserved, no backfill.

SECURITY / PERMISSIONS:
- Owner alone costs/reviews/prices; Counter SP only; assigned Tailor operational
  only; CP/internal cost/financial history/raw writes/anonymous access protected.

TESTS:
- 3,877 local assertions, 232 live checks and three PostgREST registration/anonymous
  denial checks passed; exact sums/Design/remainders/rollback/history/security verified.

BUILD:
- TypeScript, scoped lint and production build passed; existing eight warnings and
  217 unrelated formatting errors remain documented.

BUSINESS RULES VERIFIED:
- Design charge included, total/quantity average, exact conserved allocations,
  explicit real cost sources/quantities, immutable revisions and reviewed SP,
  no automatic markup/repricing/stock changes or customer-tailoring coupling.

REMAINING:
- Browser/concurrency acceptance, four legacy job decisions, actual Owner cost
  confirmations during use; dedicated Finished Product transfers/sales remain later.

NEXT PHASE:
- Phase 13 — Finished Product Inventory + Transfer. Stopped; await Owner approval.

## 2026-10-04 — Phase 13: Finished Product Inventory + Transfer

**Authorization / objective:** Owner explicitly approved Phase 13. Re-read Master
Plan Sections 8, 21, Phase 13, execution loop and report format, and the Phase 12
implemented/verified baseline. Implement individual Finished Product inventory
through Workshop → Showroom → dynamically configured sublocation with immutable
movement history. Phase 14 and all later phases remain out of scope.

**Existing implementation mapped / reused:** Phase 11 actual piece receipt,
unique ProductBarcode, material genealogy and Workshop-first stock; Phase 3
inventory-item authority, append-only ledger, exact balances, active location
configuration, stable locks, posted transfer/header/line guards, audit and generic
Owner transfer; Phase 5 history structure; Phase 12 immutable cost/SP records,
original financial RLS and session cache clearing. No new locations or guessed
opening balances were necessary.

**Migration actually created and applied:**

- `supabase/migrations/20261004000400_phase13_finished_product_inventory.sql`.
- Byte-identical mirror `drizzle/migrations/0027_phase13_finished_product_inventory.sql`,
  appended Drizzle journal entry 27 (`when: 1791072240000`).
- SHA256 `11a6648c6bd8c9871ae4657f7f9ea9e35eaaac2218a4bdb25517eb7332a60d35`.
- Purpose: whole-piece Finished Product inventory, actor-bound atomic transfers,
  checked adjacent location path and operational piece movement history.
- New `finished_product_transfer_requests`: request_id UUID primary key;
  required actor_id → profiles and UNIQUE transfer_id → stock_transfers foreign
  keys; required payload JSONB and recorded_at timestamp DEFAULT now(). New
  `(actor_id, recorded_at)` index. New partial inventory_movements index on
  `(finished_product_id, occurred_at DESC, id)` for non-null Product IDs.
- New `guard_finished_product_transfer_path()` / inventory_movements BEFORE
  INSERT trigger: active adjacent Workshop/Showroom/parent-child sublocation,
  available piece, matching current/source location and exactly one pc. This
  also prevents generic Owner transfers from bypassing the Finished Product path;
  no existing function definition or Fabric/consumable movement rule is rewritten.
- New `transfer_finished_products(request, source, destination, pieces JSONB,
  reason)` checked Owner RPC: 1–200 distinct explicit piece IDs, canonicalized
  order and actor-bound payload, same stable inventory lock order, canonical
  stock_transfer posting, request registry insertion in the same transaction.
  Retry returns original transfer; changed payload/actor and collision with an
  already-used generic transfer request are rejected.
- New Owner-only `finished_product_inventory(after UUID, limit)` with UUID
  keyset pagination (1–200 rows); ProductBarcode, Product/Design/job/piece,
  current location/status and canonical quantity/availability. New Owner-only
  `finished_product_movement_history(piece UUID, limit)` with latest 1–200
  receipt/transfer/correction events, actor/time, source/destination, quantities,
  reason/reference and posted header/line/request linkage. Neither returns CP,
  SP or internal costs. Both use fixed search_path and checked SECURITY DEFINER.
- Request table RLS enabled with active Owner SELECT only; browser raw writes/
  TRUNCATE and PUBLIC/anonymous privileges revoked. service_role table privileges
  retained, immutable update/delete trigger installed. APIs grant authenticated
  EXECUTE with runtime active Owner checks; PUBLIC/anonymous execution revoked.
  Transfer trigger function has no browser execution grant. Existing cost/RLS/
  Counter/Tailor permissions unchanged. PostgREST schema reload notified.
- **No backfill, seed, manual business-data adjustment or stock/price change.**
  All earlier applied migration files preserved; only the new file was applied.

**Business / technical decisions:** Newly manufactured pieces still receive into
Workshop through Phase 11; no direct factory-to-Showroom path. Transfers take
adjacent hierarchy steps. Explicit Owner returns follow those steps in reverse,
preserving the prior return capability; moves between sublocations pass through
Showroom. No floors/counts are hard-coded. Each selected piece always moves one
whole pc. One invalid/stale/unavailable piece rolls back the entire batch. Transfers
conserve global quantity and retain Product IDs, barcodes, job/material genealogy,
availability status, costs/allocations and SP unchanged. No sale/order, markup,
repricing, automatic correction or production usage inference is added.

**Application / files changed in this phase:**

- New `src/features/inventory/FinishedProductInventory.tsx`: Owner operational
  listing with keyset load-more, explicit loaded-row filtering, source/destination
  and piece selection, reason, selected quantity, posted confirmation, frozen same
  payload retry after uncertain network response, recent global/per-piece history.
- `src/routes/_authenticated/inventory.index.tsx`,
  `src/routes/_authenticated/tailoring.tsx`: Owner inventory tab/panel integration.
- `src/integrations/supabase/types.ts`: three new typed RPC declarations.
- `src/features/tailoring/FinishedProducts.tsx`,
  `src/features/inventory/LocationLedger.tsx`: receipt, location and existing ledger
  actions refresh new inventory/history caches. New transfer refreshes previous
  catalogue/ledger/transfer caches as well.
- New `scripts/phase13-inventory-test.mjs`; existing Phase 1–12 test runners add
  explicit Phase 13 cumulative selection/count boundaries, retaining assertions.
- `scripts/live-db-rollout.mjs`, `scripts/live-db-verify.mjs`: sequential Phase 13
  reference/application and new read-only live API/RLS/permission verification.
- Migration/mirror/journal above, `supabase/migrations/README.md`, this history,
  `docs/PHASE13_FINISHED_PRODUCT_INVENTORY.md`, `PHASE13_VERIFICATION.json`,
  `PHASE13_LIVE_VERIFICATION.json`, `PHASE13_SECURITY_VERIFICATION.json`,
  `PHASE13_API_VERIFICATION.json`.

**Tests / verification actually completed:**

- 309 new Phase 13 assertions in canonical demo, mirrored demo and clean
  disposable PostgreSQL. Ten Workshop pieces → three Showroom → two sublocation;
  balances 7/1/2, global ten. Exact/order-independent retry, changed actor/payload,
  stale source/mixed batch, active/path checks including generic bypass, duplicate/
  missing IDs, fractional pieces, pagination, linked history, reverse returns,
  forced late failure complete rollback, immutable request/browser write guards,
  anonymous/inactive/non-Owner denial and populated cost/SP/genealogy preservation.
- All previous phase suites plus legacy reconciliation and approved test-stock
  fixtures pass cumulatively: 4,146 database assertions. Independent Fabric/Product
  Barcode decoding/exact money input add 40 checks: **4,186 local assertions**.
- TypeScript noEmit, scoped ESLint and final isolated production build pass.
  Full ESLint remains at the same 217 existing formatting errors in four legacy
  scripts and eight existing React fast-refresh warnings; no new lint errors.
- Live Session Pooler connection succeeded; baseline catalog matched Phase 12.
  On 2026-10-04 at 05:56 UTC the new migration applied transactionally and matched
  cumulative schema, constraints, indexes, functions, triggers, RLS and privileges.
  Existing 73 public tables / 366 rows retained all original-column fingerprints.
  New request table is empty live; no manufactured piece or transfer fixture was
  posted. Prior migrations were hash-checked/skipped, not replayed. All **28**
  repository migration versions are recorded with matching execution hashes.
- **257 live read-only checks** passed for actual Owner, Counter, assigned Tailor
  and StockEntry accounts, original financial protections, new Owner APIs/request
  RLS/raw-write protection, anonymous denial, ledger/hash checks and existing
  fixture integrity. Three new PostgREST registrations return expected anonymous
  401 / 42501. Subsequent read-only rollout confirms cumulative **Phase 13**.

**Limits / intentionally unchanged:** Browser acceptance and actual live
multi-connection race tests remain unverified. Populated Finished Product behavior
was tested in disposable databases; live canonical manufacturing/piece tables are
empty. Recent movement UI is bounded to 200 events; full immutable ledger remains
stored. Four previous legacy job domain/assignment Owner decisions remain untouched.
No guessed quantities/locations/costs/prices, no existing business record deleted or
overwritten, no configuration/environment/production seed changes, no deployment,
commit or push. Phase 14 Counter sale/order/location-count workflow is not started.

### Section 31 report

PHASE:
- 13 — Finished Product Inventory + Transfer.

STATUS:
- Implemented and applied/verified live.

IMPLEMENTED:
- Whole-piece Owner inventory/transfers through Workshop/Showroom/sublocation,
  actor-bound retry, checked hierarchy and linked immutable movement history.

MODIFIED:
- New migration/mirror/journal; Owner UI/routes/RPC types/cache refresh;
  cumulative tests/live verification; migration README, evidence and history.

REUSED:
- Workshop receipt/ProductBarcode, canonical ledger/locks/transfer documents,
  location hierarchy, audit, immutable genealogy and existing financial RLS.

DATABASE CHANGES:
- `20261004000400_phase13_finished_product_inventory.sql`: one request table,
  two indexes, immutable/path triggers and three checked operational RPCs;
  all 73 old tables / 366 rows preserved; no backfill.

SECURITY / PERMISSIONS:
- Active Owner only new APIs; anonymous/non-Owner denied, browser raw writes
  sealed, no CP/SP/cost projection or existing role-permission expansion.

TESTS:
- 4,186 local assertions, 257 live read-only checks and three API checks passed.

BUILD:
- TypeScript, scoped lint and production build passed; unchanged baseline lint
  debt of 217 errors / eight warnings documented.

BUSINESS RULES VERIFIED:
- Workshop-first receipt, dynamic sublocations, exact piece balances/stock
  conservation, safe atomic retries/rollback, traceable locations/user/time,
  unchanged ProductBarcode/genealogy/cost/SP.

REMAINING:
- Browser/concurrency acceptance and four legacy job decisions; Phase 14 sales.

NEXT PHASE:
- Phase 14 — Finished Product Counter + Sales. Stopped; await Owner approval.

## 2026-10-04 — Phase 14: Finished Product Counter + Sales

**Authorization / objective:** Owner explicitly approved Phase 14. Re-read Master
Plan Sections 17–23, 29–31, Phase 14 and the verified Phase 13 baseline. Implement
ProductBarcode scan, SP, availability/location/identical counts, controlled sales,
order history and Owner-only internal production costs. No Phase 15 or later work.

**Existing implementation mapped / dependencies reused:** Phase 11 unique piece
barcodes and actual Workshop receipt/genealogy, Phase 12 actual finalized cost/
per-piece allocation and Owner-reviewed SP, Phase 13 piece locations/transfers,
canonical inventory ledger/locks, existing orders/items/private financials, Phase 6
completed-sale immutability/sale-once guards, customers, audit and session cache
clearing. No new opening stock, prices, permissions or locations were invented.

**Migration actually created / applied:**

- `supabase/migrations/20261004000500_phase14_finished_product_sales.sql`.
- Byte-identical `drizzle/migrations/0028_phase14_finished_product_sales.sql`;
  appended journal entry 28 (`when: 1791072300000`). Apply one chain only.
- SHA256 `0773ddb494867d6e1e86b844bd4be00fa69199f8f4540c7ad64d49267dc4b83c`.
- Purpose: Counter/Owner scan/counts, atomic paid whole-piece sales, immutable
  sale-time item/financial evidence and authorized completed-order history.
- New `finished_product_sale_snapshots`: order_item_id UUID PK/FK order_items;
  required price_version_id FK finished_product_prices; required cost_version_id
  and reviewed_cost_version_id FKs production_cost_versions; required JSONB
  cost_evidence and item_snapshot; recorded_at timestamp DEFAULT now().
  Cost evidence stores job quantity, total and actual component rows; item evidence
  stores barcode/Product/Design/job/piece/source/actor labels at transaction time.
- New `(cost_version_id)` index and unique partial inventory_movements
  `(order_item_id)` index for Finished Product SALE rows. Existing Phase 6 posting
  guard also prevents duplicate sale-line debits. New snapshot UPDATE/DELETE
  immutable trigger reuses reject_domain_history_rewrite; no trigger-function
  replacement or existing table column change.
- New checked SECURITY DEFINER / fixed-search_path RPCs:
  `finished_product_sale_scan(text)`,
  `complete_finished_product_sale(uuid,uuid,jsonb,uuid,boolean,text DEFAULT NULL)`,
  `finished_product_order_history(uuid DEFAULT NULL,integer DEFAULT 50)`.
- New table RLS enabled; authenticated SELECT active Owner only. Browser raw
  INSERT/UPDATE/DELETE/TRUNCATE, PUBLIC/anonymous access revoked; service_role
  administrative table privileges retained. Three APIs grant authenticated
  EXECUTE with active Owner/Counter runtime checks; checkout also requires
  pos.sell. PUBLIC/anonymous EXECUTE revoked. Original raw orders/financial RLS
  remains unchanged; Counter history is a whitelisted RPC projection. PostgREST
  schema reload notified.
- **No backfill, seed, manual reconciliation or business-data edit in migration.**
  Existing migration files were hash checked/skipped, never rewritten or replayed.

**Business / technical decisions:**

- Identical counts refer to the same bulk Production Job, never unrelated jobs
  sharing a Product/Design name but potentially different fabric/genealogy. Only
  actual available pieces with one ledger pc at their current location count;
  planned production quantity and sold/archived/unreconciled rows do not count.
- Dynamic location rows return direct quantity and subtree quantity. Showroom
  total includes its sublocations, direct Showroom balance is separately labeled;
  global total sums each physical piece once. Inactive locations remain visible
  for traceability but cannot be checkout sources.
- Each physical barcode must be selected explicitly. Orders contain 1–50 distinct
  one-pc pieces from one active source; caller may supply only piece IDs and
  expected SP version IDs, never quantities/costs/overrides/extra fields. Existing
  customer selection or walk-in and optional customer reference are supported.
  Received payment must be explicitly confirmed for the exact total.
- Final customer line price equals current Owner SP and total is the exact sum;
  additional sales charges zero. No unrequested discount, surcharge, automatic
  markup or fabricated cost/price. Zero Owner SP remains explicit and valid.
  Missing/unreviewed SP/cost blocks checkout; a changed SP requires cart review.
  Totals exceeding the established safe exact paise range roll back entirely.
- Job locks serialize Owner cost/SP revisions; stable inventory/location locks
  serialize source availability and transfers. Order/items/private cost evidence,
  one-pc SALE movements, sold status, payment/completion markers, total and audit
  commit together. One bad/stale piece or late failure rolls back every effect.
- Request UUID shares existing sale namespace; actor/source/exact items/price
  versions/customer/payment/reference are bound. Exact retry returns the original
  order; changed actor/payload/kind is rejected. UI freezes uncertain requests and
  retries the same payload; definite rejection permits correction/new request.
- Latest actually finalized production cost/allocation at sale is retained along
  with selected SP version and its originally reviewed cost version. A later
  actual cost revision does not silently reprice existing SP. Owner sees complete
  sale-time cost evidence; Counter sees SP/final price and operational fields only.
  Product/customer/location labels and costs are snapshotted; subsequent revisions
  do not rewrite completed history. Piece IDs/barcodes/genealogy/last location are
  retained; status becomes sold and ledger quantity decreases by exactly one.

**Files changed in this phase:**

- New `src/features/pos/FinishedProductSale.tsx`: scan/counts, exact physical cart,
  customer/walk-in/reference/payment confirmation, posted result/safe retry,
  completed-order history and Owner-only cost details.
- `src/routes/_authenticated/pos.tsx`: new panel on existing Counter/Owner route.
- `src/integrations/supabase/types.ts`: three new RPC declarations.
- `src/features/tailoring/FinishedProducts.tsx`,
  `src/features/tailoring/ProductionCosting.tsx`,
  `src/features/inventory/FinishedProductInventory.tsx`,
  `src/features/inventory/LocationLedger.tsx`: receipt/cost/SP/transfer/correction
  actions invalidate new scan cache; checkout invalidates related stock/history.
- New `scripts/phase14-sales-test.mjs`. Cumulative phase selection/count boundaries
  added to existing scripts: phase1-schema-test.mjs, phase2-security-test.mjs,
  phase3-ledger-test.mjs, phase4-fabric-test.mjs, phase5-transfer-test.mjs,
  phase6-sale-test.mjs, phase7-tailoring-test.mjs, phase8-material-test.mjs,
  phase9-hierarchy-test.mjs, phase10-production-test.mjs, phase11-products-test.mjs,
  phase12-costing-test.mjs, phase13-inventory-test.mjs; original assertions retained.
- `scripts/live-db-rollout.mjs`, `scripts/live-db-verify.mjs`: Phase 14 reference/
  sequential migration and read-only live security/integrity verification.
- Migration/mirror/journal above, `supabase/migrations/README.md`, this history,
  `docs/PHASE14_FINISHED_PRODUCT_SALES.md`, `PHASE14_VERIFICATION.json`,
  `PHASE14_LIVE_VERIFICATION.json`, `PHASE14_SECURITY_VERIFICATION.json`,
  `PHASE14_API_VERIFICATION.json`.

**Tests / verification actually completed:**

- **435 new assertions** across canonical demo, mirrored demo and clean disposable
  PostgreSQL: Workshop/Showroom/Display 7/1/2 direct counts, Showroom subtree 3,
  total ten; unrelated job exclusion; exact paid Counter/Owner sales, two-piece
  691356-paise total, linked one-pc debits and sold scans/count decrements; no double
  sale/changed actor/payload; missing/stale/zero SP; invalid/duplicate/missing pieces,
  wrong/inactive source, missing customer/unpaid/oversized/quantity-override denial;
  forced final audit failure complete rollback; money-total overflow rollback;
  completed history immutable even privileged; original customer/Product/location/
  cost snapshots survive revisions; SP remains unchanged after costing revision;
  latest cost and original SP review versions retained separately; Owner financial
  visibility and populated Counter/non-Owner RLS/raw-write/inactive/anonymous denial.
- All previous business phase/reconciliation suites pass cumulatively: **4,581
  database assertions** plus 40 independent Fabric/Product Barcode/exact-money
  assertions = **4,621 local assertions**. TypeScript noEmit, scoped ESLint and
  isolated production build pass. Full lint retains the same 217 pre-existing
  formatting errors in four legacy scripts / eight existing fast-refresh warnings;
  no new lint errors.
- Live Session Pooler connection succeeded and catalog matched Phase 13 before
  rollout. New migration applied transactionally at approximately 06:15 UTC on
  2026-10-04. Cumulative schema, constraints, indexes, functions, triggers, RLS and
  privileges match the disposable reference. All **74 pre-existing public tables /
  366 rows** retain original-column fingerprints. New snapshot table empty live;
  no customer sale, fixture, receipt, price or transfer executed live. All **29**
  repository migration versions have recorded matching hashes.
- **280 live read-only security/integrity checks** pass for actual Owner, Counter,
  Tailor and StockEntry accounts, original CP protections, new authorized API and
  private snapshot protections, anonymous/raw-write denial, migration hashes and
  approved fixture integrity. Three new PostgREST APIs are registered and deny
  anonymous access with 401 / 42501. Subsequent read-only rollout verifies Phase 14.

**Limits / intentionally unchanged:** Browser acceptance and real multi-connection
race tests remain unverified; populated sales verified in disposable databases
because live canonical Finished Product tables remain empty. UI shows latest 50
orders (RPC supports 200); immutable complete database history remains stored.
Four prior legacy job domain/assignment Owner decisions remain untouched. No new
refund/discount/credit workflow or automated identical-piece allocation. No
generalized Phase 15 reports or Phase 16 polish, no reset/delete/seed/backfill,
configuration/environment changes, deployment, commit or push. Stopped at Phase 14.

### Section 31 report

PHASE:
- 14 — Finished Product Counter + Sales.

STATUS:
- Implemented and applied/verified live.

IMPLEMENTED:
- ProductBarcode/SP/availability, direct/subtree/identical counts, atomic paid
  physical-piece sales and immutable authorized order history with Owner costs.

MODIFIED:
- New migration/mirror/journal, Counter UI/types/cache refresh, cumulative tests/
  live checks, migration README, evidence and permanent Implementation History.

REUSED:
- Piece genealogy/Workshop receipt, Owner cost/SP review, canonical stock ledger,
  transfer locks, existing orders/private financials, customers, audit/history guards.

DATABASE CHANGES:
- `20261004000500_phase14_finished_product_sales.sql`: private immutable sale
  snapshot table, two indexes and three checked APIs; 74 old tables / 366 rows
  preserved, no backfill or historical migration edits.

SECURITY / PERMISSIONS:
- Active Owner/Counter APIs; checkout also pos.sell. Counter no internal costs;
  snapshot RLS Owner-only, raw writes/anonymous access sealed, no existing RLS change.

TESTS:
- 4,621 local assertions, 280 live checks and three API checks passed.

BUILD:
- TypeScript, scoped lint and production build pass; unchanged 217 baseline lint
  errors / eight warnings remain documented.

BUSINESS RULES VERIFIED:
- Exact current Owner SP/whole-piece stock deduction, no oversell/double post,
  dynamic direct/subtree counts, conserved history, original price/customer/
  item/location/cost evidence and Owner-only internal financial access.

REMAINING:
- Browser/concurrency acceptance, four legacy job decisions; Phase 15 reporting.

NEXT PHASE:
- Phase 15 — Reporting + Audit + Owner Controls. Stopped; await Owner approval.

## 2026-10-04 — Phase 15: Reporting + Audit + Owner Controls

**Authorization / objective:** Owner approved Phase 15. Re-read Master Plan Phase
15 and Sections 24–25, 29–31, relevant Phase 0 findings and verified Phase 14
history/current reporting, audit, access and transaction dependencies. Implement
reporting/history after correct transactions; stop before Phase 16.

**Actually implemented:** 24 checked Owner report datasets on existing Reports /
Audit routes, full-count keyset pagination, record search, India date boundaries,
canonical current stock grouped by location/unit, paid direct Fabric/Finished
Product totals, separately labelled Customer Tailoring booked prices and separate
legacy sales/tailoring/movement history. Factory/Section/Tailor assignments,
charges, consumables/receipts, Material Issues versus recorded Finished Product
usage, Owner Production, cost components/input evidence/revisions/allocations,
Finished Product SP/location/cost, transfers, orders/private snapshots, production
history, access, audit and exact Owner review records are available. Unknown
quantities/costs/prices remain unknown. No historic stock valuation or collected
tailoring revenue is guessed. Current snapshots ignore transaction date windows.

**Database migration:** new version-controlled
`supabase/migrations/20261004000600_phase15_owner_reporting_audit.sql`, byte-identical
`drizzle/migrations/0029_phase15_owner_reporting_audit.sql`, appended journal index
29. SHA256 `479aa0ad31bc4e041476e0d0b62b1b35434750692056dfe4b236be0a2b72b2b8`.

- No tables/columns/relationships/FK/check constraints or business data/backfill
  changes. Two indexes: `phase15_audit_time_idx` on ERP audit occurred_at/id;
  `phase15_order_kind_time_idx` on orders kind/status/completed_at/id.
- New SECURITY DEFINER fixed-search-path functions: `owner_erp_report`,
  `owner_erp_overview`, `capture_owner_domain_audit`. Reports use a fixed dataset
  whitelist with bound parameters and active Owner gate, not caller SQL.
- 52 `phase15_row_audit` AFTER INSERT/UPDATE/DELETE triggers; full exact table list
  in `docs/PHASE15_REPORTING_AUDIT.md`. Financial version tables capture actual
  preceding revisions by parent/revision. Actual OLD/NEW, actor, timestamp,
  record identity and reference are captured atomically for future changes.
  Composite permission records retain real keys with deterministic audit-only ID;
  administrative sessions without a user retain NULL actor. No-op/profile-login
  noise excluded. Existing workflow audit entries preserved as complementary
  events; no past evidence reconstructed and no recursive audit trigger.
- `phase15_legacy_audit_immutable` uses existing history guard to reject legacy
  audit UPDATE/DELETE. Browser INSERT/UPDATE/DELETE/TRUNCATE revoked; checked
  definer logging still works. PUBLIC/anon execute denied on report APIs; browser
  execute denied on capture function. Existing Owner audit/private-cost RLS and
  business roles/permissions remain unchanged. All non-Owner report retrieval is
  rejected before protected reads; existing session cache-clearing reused.
- Owner review counters/records are read-only; existing inventory, tailoring,
  access and audit workflows are linked for controlled actions. No unrestricted
  reconciliation/correction action introduced.

**Files changed:** new `src/features/reports/OwnerReports.tsx` and `report-value.ts`;
existing `src/routes/_authenticated/reports.tsx` / `audit.tsx` now use checked
reports; `src/integrations/supabase/types.ts` adds two RPC declarations. New
`scripts/phase15-reporting-test.mjs`, `phase15-report-value-test.mjs`,
`phase15-api-verification.mjs`. Existing Phase 1–14 scripts retain original
assertions and add cumulative Phase 15 file selection/count boundaries.
`scripts/live-db-rollout.mjs` extends reference/apply verification through Phase
15; `scripts/live-db-verify.mjs` adds report/role/audit checks and accurately labels
four remaining legacy job decisions. New migration/mirror/journal above,
`supabase/migrations/README.md`, this history, `docs/PHASE15_REPORTING_AUDIT.md`,
`PHASE15_VERIFICATION.json`, `PHASE15_LIVE_VERIFICATION.json`,
`PHASE15_SECURITY_VERIFICATION.json`, `PHASE15_API_VERIFICATION.json`.

**Tests / verification actually completed:**

- 681 new populated database assertions across canonical demo, mirrored demo and
  clean disposable PostgreSQL. All datasets, exact CP/SP/cost/sale snapshots,
  canonical stock and paid-sale summaries, usage distinctions, date boundaries,
  full keyset and newest-first combined audit pagination, initial/changed SP and
  CP evidence, actual location before/after, roles/overrides, barcode/ledger/job/
  cost/receipt/order audit, read-only reports, invalid inputs, inactive/anonymous
  denial, all non-Owner dataset denials and immutable audit verified.
- Complete cumulative Phase 1–15/reconciliation suite: **5,262 database
  assertions**, plus 40 Fabric/Product Barcode/money and nine exact aggregate
  money/quantity/India-date assertions = **5,311 local assertions passed**.
- TypeScript noEmit, scoped ESLint and isolated production build pass. Full lint
  retains identical 217 prior formatting errors in four legacy scripts and eight
  prior fast-refresh warnings; no new errors.
- Live Session Pooler connected and Phase 14 baseline catalog matched the
  disposable reference before applying the new migration. Only Phase 15 applied
  transactionally at approximately **06:38 UTC on 2026-10-04**, with execution
  metadata and schema/RLS/grants verification. All **75 old public tables / 366
  rows** preserve original-column fingerprints; no business transaction/fixture,
  stock correction, cost/SP update or backfill posted live. All **30 repository
  migration versions** have matching recorded hashes; old migrations skipped.
  Subsequent read-only rollout verifies the cumulative Phase 15 schema.
- **331 live read-only security/integrity checks** pass for actual Owner, Counter,
  Tailor and StockEntry accounts; Owner can execute all reports, non-Owner CP/cost
  access remains blocked, anonymous and raw audit writes denied, migration hashes
  and approved test-stock intact. Both new PostgREST APIs are registered and deny
  anonymous requests with **401 / 42501**.

**Limits / intentionally unchanged:** Browser acceptance and real concurrent-user
pagination/race tests remain unverified. Populated production/sale evidence is
tested in disposable databases; live canonical production/Finished Products remain
empty. Reports are not frozen exports while other users transact. Four earlier
`job_domain_and_assignment_unverified` Owner decisions remain untouched. No guessed
stock/usage/cost/price, legacy correction, historical reconstruction, existing
migration rewrite, configuration/environment change, deployment, commit/push or
Phase 16 dashboard/navigation/performance/polish work. Stopped after Phase 15.

### Section 31 report

PHASE:
- 15 — Reporting + Audit + Owner Controls.

STATUS:
- Implemented and applied/verified live.

IMPLEMENTED:
- 24 Owner datasets, canonical totals, complete paginated audit with prospective
  before/after evidence, and exact read-only Owner review records.

MODIFIED:
- Reports/Audit routes, RPC types, cumulative tests/live checks, migration
  mirror/journal/README, verification evidence and permanent history.

REUSED:
- Canonical transactions/ledger, genealogy/cost/price versions, immutable order
  snapshots, active Owner checks, private RLS and controlled administration.

DATABASE CHANGES:
- `20261004000600_phase15_owner_reporting_audit.sql`: three functions, two
  indexes, 52 domain audit triggers and legacy audit guard/grants; no data backfill.

SECURITY / PERMISSIONS:
- Active Owner-only reports; non-Owner financial protections and immutable
  history retained; browser raw audit writes and anonymous APIs denied.

TESTS:
- 5,311 local assertions, 331 live checks and two API checks passed.

BUILD:
- TypeScript, scoped lint and production build pass; unchanged full-lint
  baseline of 217 formatting errors / eight warnings documented.

BUSINESS RULES VERIFIED:
- Exact canonical stock/paid sales, separately labelled tailoring bookings and
  legacy history, issued-versus-recorded usage, all cost revisions, protected CP/SP
  evidence and conserved records.

REMAINING:
- Browser/concurrency acceptance and four prior legacy job Owner decisions.

NEXT PHASE:
- Phase 16 — UI / UX / Performance / Final Polish. Await Owner approval.

## 2026-10-04 — Phase 16: UI / UX / Performance / Final Polish

**Authorization / objective:** Owner approved Phase 16 and instructed continuation.
Re-read Master Plan and Phase 15 history, relevant audit findings, existing routes,
dashboard/navigation, scan/print/forms, shared UI and query dependencies. Checked
the historical `SYSTEM_OPERATIONS_GUIDE.md`; Master Plan overrides superseded
roll barcode/pricing descriptions. Refine presentation and performance while
preserving verified transactions and database authorization. Final phase only.

**Actually implemented / business and technical decisions:**

- Owner dashboard now uses the existing checked canonical overview RPC, current
  ledger stock by location/unit, India-date payment-confirmed sales, exception
  counts and controlled workflow links. Removed misleading legacy metric/usage
  aggregation from this dashboard. Legacy records remain accessible separately.
  Error/retry feedback does not show failed reads as zero stock or sales.
- Keyboard-accessible Counter/Tailoring workflow tabs load components on first
  visit and keep visited panels mounted/hidden, preserving carts, drafts and
  uncertain transaction retries. Customer Tailoring, Owner Production and two
  sales flows remain separate. Owner cost/inventory tabs gated; legacy screens
  preserved in explicit Legacy Records tabs. Existing inventory tabs reused.
- Canonical report/dashboard queries invalidate after successful mutations via
  a shared QueryClient factory. Existing transaction-specific invalidation retained.
  Dashboard stale interval 30 seconds with explicit refresh; no optimistic stock/
  price or cost mutation. Inactive visited workflows may retain their read queries
  deliberately to preserve state; no promise that all background activity stops.
- Sidebar aria-current, keyboard skip link/main target and Escape module search.
  Former inactive bell replaced by actual refresh action with feedback. Existing
  success/error toasts reused; no invented notification event feed.
- Reports/Audit summarize at most eight columns with every original field retained
  in expandable complete evidence. Memoized rows/columns, sticky table headers,
  internal scrolling/live counts, Clear Filters, retry controls and explicit
  invalid-date validation. All matching rows retain existing keyset pagination.
- Scanner fields select old text on focus, disable spelling/autocomplete and reuse
  Enter scanning; Fabric/physical Product instructions improved. Existing backend
  scan/financial authorization and pending-operation freezes unchanged.
- Shared card/panel min-width correction fixes 320px overflow; hints wrap, report/
  sale actions wrap, controls bounded, reduced-motion supported. Existing form
  validation, hierarchy filtering, loading and empty states reused.
- Barcode print frame title/accessibility/crisp SVG/page breaks improved; bill
  mobile/print layout refined without changing safe customer projection. General
  print hides workspace chrome/actions and preserves panel titles. Barcode identity,
  financial calculations and printer/scanner technology remain unchanged.

**Files actually changed:** new `src/features/reports/OwnerDashboard.tsx`,
`src/shared/components/workflow-tabs.tsx`, `query-state.tsx`,
`src/app/providers/query-client.ts`. Modified `src/router.tsx`,
`src/app/layouts/AppShell.tsx`, `src/shared/components/page.tsx`, `src/styles.css`,
`src/routes/_authenticated/dashboard.tsx`, `pos.tsx`, `tailoring.tsx`,
`src/features/reports/OwnerReports.tsx`, `src/features/pos/DirectFabricSale.tsx`,
`FinishedProductSale.tsx`, `src/features/inventory/FabricStock.tsx`,
`fabric-label.ts`, `src/features/tailoring/customer-tailoring-bill.ts`.
New `scripts/phase16-ui-test.mjs`, fixture `scripts/fixtures/phase16/index.html`,
`main.tsx`, `client.ts`, `session.tsx`, `docs/PHASE16_UI_UX.md`,
`PHASE16_VERIFICATION.json`, `PHASE16_UI_VERIFICATION.json`,
`PHASE16_LIVE_VERIFICATION.json`, `PHASE16_SECURITY_VERIFICATION.json`, this history.
Pre-existing dirty workspace changes were preserved, not credited to this phase.

**Database changes / migrations / permissions:** **None.** No Phase 16 migration
is necessary. No table/column/relationship/constraint/index/function/trigger/RLS/
grant, seed, backfill, opening balance, cost/SP or live business record change.
Historical migration files/mirrors/journal remain unchanged. Existing active Owner
checks/private financial RLS remain authoritative; frontend presentation adds no
business permission. Both old and canonical history remain intact.

**Tests / verification actually completed:**

- **24 headless Edge browser fixture checks** with actual React components and
  synthetic reads: exact dashboard money/stock units, lazy first mount and retained
  hidden drafts, bounded report columns/full evidence, search/empty/clear states,
  invalid dates, failures/recovery, successful mutation invalidation, no document
  overflow at 320/390/768/1440px, customer bill exclusion of extra Owner CP,
  isolated label frame/title, access loss and no runtime errors. Fixture mobile/
  desktop screenshots inspected; a real 320px shared-card overflow was identified,
  fixed and retested. Fixtures never authenticate to/write live ERP data.
- All cumulative Phase 1–15/reconciliation suites pass again: **5,262 database
  assertions**, 40 Fabric/Product Barcode/money checks, nine report exact-value/
  India-date checks, plus 24 UI checks = **5,335 local assertions**.
- TypeScript noEmit, scoped ESLint including fixtures and isolated production
  build pass. Full lint retains identical 217 baseline formatting errors in four
  legacy scripts / eight baseline fast-refresh warnings; no new errors.
- Dashboard initial data hooks reduced from seven legacy reads to one canonical
  overview. Client route chunk measured **6.80 kB → 3.42 kB**, gzip **2.17 kB →
  1.56 kB**, compared with Phase 15 build. This is route-chunk evidence, not total
  app transfer, measured production latency or a Core Web Vitals guarantee. Existing
  >500 kB shared-chunk warning remains.
- Read-only live Session Pooler connection verifies cumulative Phase 15 catalog
  and all **30 migration hashes**. All **75 public table / 366 row fingerprints**
  equal the preserved Phase 15 result. **331 live security/integrity checks** pass
  for actual Owner, Counter, Tailor and StockEntry, CP/cost protections and prior
  approved test-stock. No migration or business fixture applied live.

**Limitations / intentionally unchanged:** Authenticated real staff browser
acceptance, deployed-network/Core Web Vitals, real multi-user concurrency and
physical scanner/printer acceptance remain unverified. Populated business/role
tests use disposable PostgreSQL, browser data is synthetic. Four earlier legacy
job domain/assignment Owner decisions remain untouched. No unapproved legacy
correction, guessed data, historical migration rewrite, dependency/environment/
deployment configuration change, deployment, commit, push or git history rewrite.
This is the last specified implementation phase. Stop for Owner acceptance.

### Section 31 report

PHASE:
- 16 — UI / UX / Performance / Final Polish.

STATUS:
- Implemented; local UI/build/regressions verified; live database verified read-only.

IMPLEMENTED:
- Canonical dashboard, retained/lazy workflow tabs, report/filter/retry refinement,
  scanner/print/mobile/accessibility feedback and report refresh after writes.

MODIFIED:
- Dashboard/Counter/Tailoring routes, shared shell/UI/query client, Reports/Audit,
  scan/print styling, browser fixtures, evidence and permanent history.

REUSED:
- Existing transactions, financial math, role checks/RLS, canonical overview,
  ledger/genealogy, forms, validation, pagination and safe print projection.

DATABASE CHANGES:
- None; no new migration. All 30 prior migration hashes and business rows intact.

SECURITY / PERMISSIONS:
- No broadened access; active Owner reporting and private CP/cost RLS retained.

TESTS:
- 5,335 local assertions including 24 browser fixture checks; 331 live checks pass.

BUILD:
- TypeScript, scoped lint and production build pass; documented unchanged lint
  baseline / large shared-chunk warning.

BUSINESS RULES VERIFIED:
- Canonical quantities/paid totals, separate workflows, retained drafts/retries,
  protected financial data, stable barcodes and customer-safe print content.

REMAINING:
- Real staff/hardware/concurrency/deployed acceptance; four legacy Owner decisions.

NEXT PHASE:
- None in the 16-phase plan. Stopped; await Owner acceptance/deployment instructions.

## 2026-10-10 — Post-Phase 16 maintenance: Vercel TanStack Start security block

**Authorization / objective:** Owner supplied Vercel's failed install log and
authorized fixing CVE-2026-102989 / GHSA-qx66-fv34-fjm8. Vercel rejected the
locked `@tanstack/react-start@1.168.32` and transitive
`@tanstack/start-server-core@1.169.17` before compiling the application. Verified
the [official advisory](https://github.com/TanStack/router/security/advisories/GHSA-qx66-fv34-fjm8)
and npm package manifests before changing dependencies. This is maintenance of
the completed phases, not a new ERP business phase.

**Actually changed:**

- `package.json`, `package-lock.json`: pin Start **1.168.60**, React Router
  **1.170.41**, Router Plugin **1.168.42**. Router/plugin versions align with
  patched Start's own dependency graph; no forced incompatible override. Every
  locked/installed server-core copy resolves to patched **1.169.39**. npm ls
  confirms router/start/plugin/core dependencies deduplicate. Existing unrelated
  dirty lockfile metadata for fast-deep-equal was preserved.
- `src/routes/__root.tsx`: use patched Router's `ErrorComponentProps` (error is
  unknown). Preserve real Error messages; safely display fallback text for other
  thrown values. Existing telemetry/retry behavior remains.
- New `scripts/verify-tanstack-security-build.mjs`: reproducible disposable fresh
  npm ci / Vercel-preset build with patched-core verification. Copies no private
  .env files, writes only whitelisted public frontend configuration into the
  disposable build and clears DB migration URL. Checks install/build exits and
  Vercel output config. Optional reuse uses only the named disposable prefix.
- New `docs/TANSTACK_START_SECURITY_BUILD.json` and
  `docs/TANSTACK_START_SECURITY_UI_VERIFICATION.json`; this permanent history.
  Earlier Phase 16 verification evidence was preserved as historical evidence.

**Database / business / permissions:** No database changes or migrations. No
schema, RLS, grant, seed/backfill, live data, costing/pricing, inventory or other
ERP business rule change. No manual database operation. No applied migration,
deployment configuration or environment file was rewritten. The unsafe Vercel
`DANGEROUSLY_DEPLOY_VULNERABLE_TANSTACK_START_XSS` bypass was not enabled.

**Verification actually completed:**

- npm install regenerated the lockfile; npm ls and inspection of all lock entries
  confirm patched Start/server-core and aligned, deduplicated Router/plugin.
- Fresh isolated **npm ci passes** (442 packages). Standard production build
  passes; updated source rebuilt from that clean installation with
  **NITRO_PRESET=vercel passes**, generating `.vercel/output/config.json` and
  server/static output. Preset used only in the verifier's subprocess environment;
  no deployment or persistent hosting configuration change.
- TypeScript noEmit and scoped ESLint pass, with eight existing fast-refresh
  warnings. Compatibility type failure was fixed before reporting success.
- **24 actual-component browser fixture checks** and **nine exact report money/
  quantity/India-date checks** pass with the patched dependencies. Browser reads
  are synthetic; no live transaction/authentication fixture executed.
- git diff --check passes. Existing package-lock edit preserved. No commit/push
  or published git history rewrite performed.

**Limitations / remaining:** Actual Vercel redeployment is not performed; updated
source/lockfile must reach the deployed branch. npm audit still reports six
separate advisories: four moderate through Drizzle Kit/esbuild, one high in
source-map-js and one critical in shell-quote. The targeted TanStack advisory is
no longer present. Unrelated dependency migrations/downgrades and npm audit
fix --force were intentionally not applied. Prior four legacy Owner decisions,
staff/hardware/concurrency acceptance and other Phase 16 limits remain unchanged.
