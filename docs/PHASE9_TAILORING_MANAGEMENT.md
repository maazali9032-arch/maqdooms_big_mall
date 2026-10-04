# Phase 9 — Factory / Section / Tailor Management

Implemented and live verified on 2026-10-04 (Asia/Calcutta), following the Master
Plan Sections 13, 26/Phase 9, 30 and 31 and verified Phase 0–8 history.

## Behavior

- Owner can create/edit names and explicitly enable/disable Factories, Sections
  and Tailors, manage optional active Tailor login linkage and assign/reassign
  Tailors through the existing POS/Tailoring Owner setup area. Tailor code is the
  business Tailor ID; real name, active state, Factory and optional Section are
  explicit. No Factory login role, automatic staff accounts or preset hierarchy.
- Business codes/IDs are retained. A Section's Factory identity is retained; create
  another Section to represent a different Factory. Once a non-null Tailor login
  has assignments it cannot be swapped or removed, protecting historical job access;
  an initially unlinked business Tailor can explicitly receive a Tailor login.
  Owner can disable the business Tailor without altering the staff account.
- Reassignment closes the old row once and inserts a new assignment. Existing jobs
  and issues keep the original assignment ID and genealogy. New bookings require
  the current active assignment. Explicit additional issues on an existing job may
  continue using its old assignment after reassignment, provided its business
  Tailor/Factory/Section remain active. No job reassignment, location transfer,
  status change or repricing is inferred from a Tailor move.
- Disabling a parent removes its descendants from operational choices, without
  changing child flags, assignments or jobs. Re-enabling restores eligible choices.
  No deletion/reopening/rewrite of assignment history. Names are current labels;
  rename audit records retain the previous and new values, rather than silently
  claiming names are immutable job snapshots.
- Counter Factory choices expose only relevant active Sections/Tailors. Both
  server-filtered options and frontend filtering support optional/no Section.
  Stale selections clear when options refresh; booking validates activity/current
  assignment again in the existing locked server transaction. Tailor options show
  only the caller's own eligible assignment. CP/pricing protections are unchanged.
- Owner mutations use explicit reasons, immutable request UUID/payload/result
  records and actor-bound retries. Changed payloads/actors are rejected. Reassignment
  also compares the current assignment with the Owner's expected ID, rejecting
  stale changes. Retrying an earlier committed move returns its original result
  and does not move the Tailor back after a subsequent change. An uncertain UI
  result freezes the submitted form and retries the same request.
- Assignment history shows Tailor ID/name, Factory/Section, effective start/end
  and assignment UUID. Owner setup retains existing charge configuration; it now
  uses the Phase 9 hierarchy screen instead of the minimal Phase 7 create-only form.
  The older setup RPC remains compatible for previously authorized callers.

## Migration and security

Canonical: `supabase/migrations/20261004000000_phase9_tailoring_management.sql`.
Byte-identical mirror: `drizzle/migrations/0023_phase9_tailoring_management.sql`.
Appended journal entry 23. SHA256:
`f786c1e1120fba624e3dee00f7b3dde4b2d66330ac3f13d17858c793a9d3678e`.

| Object | Change |
| --- | --- |
| `tailoring_management_requests` | New immutable request UUID PK, actor/profile FK, JSON payload, result UUID and timestamp; actor/time index; Owner-only SELECT RLS, authenticated read grant, no browser writes, trusted service-role grant. Generic result UUID represents the entity/assignment created or updated by checked RPCs, rather than a polymorphic FK. |
| `guard_phase9_hierarchy()` | Private security-definer trigger helper; UPDATE/DELETE triggers on Factories, Sections, Tailors and assignments enforce retained identity, Section parent, established login identity, no deletes and permanently closed assignments. Existing assignment identity/current uniqueness/FKs remain authoritative. |
| `manage_tailoring_entity()` | Owner-only create/edit/enable/disable; checks kind/relationships/names/active state and explicit reason; active linked login must have Tailor role. Atomically records request result and previous/new audit values. |
| `assign_tailor()` | Owner-only, validates active Factory, matching optional Section and active business Tailor/optional login. Expected-assignment comparison, closure/new row and audit/request record commit together. |
| `owner_tailoring_hierarchy()` | Owner-only operational hierarchy, full assignment history and eligible Tailor login names/IDs. No cost data. |
| `tailoring_assignment_options()` | Active Owner/Counter/Tailor; current/effective/active hierarchy, optional Factory/Section/no-Section filtering; Tailor restricted to own assignment; no costs/profile list. |
| `post_material_issue()` | Replacement in this new migration copies Phase 8 behavior and relaxes only the requirement that an existing job's assignment be current. Existing job identity, active hierarchy, exact quantity, source/actor/ledger/link/once-only/required-vs-additional controls are retained. |

Mutating RPCs check active Owner before processing the request. New public RPCs
grant authenticated EXECUTE and deny PUBLIC/anon; private helper denies all three.
No new permission keys/roles or grant of raw hierarchy mutation. Request IDs use
transaction advisory locks; hierarchy mutations share Phase 7's existing hierarchy
advisory lock and lock entity/assignment rows. Existing booking and ledger locks
remain in use; deadlock/concurrent operational acceptance is not claimed.

There is no hierarchy/job/profile/stock backfill or guessed mapping. All 366 rows
in all 65 pre-existing public tables and all original columns fingerprint unchanged
before, inside and after live application. The new request table starts empty.
Applied SQL files are unchanged; the live Supabase/private ledgers record this
new filename/hash/purpose/verification. All 24 repository versions are recorded.
Migration includes a PostgREST schema-reload notification. Do not initialize/replay
the older Drizzle migration ledger against this already-migrated live database.

## Verification

- 297 Phase 9 checks across canonical/mirror demo and clean canonical chains:
  create/edit/disable/enable, optional login/Section, Factory-scoped Section codes,
  filtering, identity/parent/login protection, current assignment uniqueness,
  matching effective boundary, repeated/changed/stale request handling, old retry
  after a later move, late failure rollback and successful retry, old job/issue
  genealogy/frozen price, new booking rejection on a closed assignment, retained
  history, Owner ceiling, Tailor scope, raw writes, inactive staff, CP and anon.
- All earlier regressions and reconciliation/provenance checks pass with Phase 9
  loaded (Phase 1 uses its bounded baseline). Total local checks: **2,571**.
- **115** live read-only security/hash/state checks pass. Cumulative schema matches
  columns, constraints, indexes, functions/EXECUTE, triggers, policies and browser
  table privileges/RLS. Retry skips the recorded migration/hash. Two PostgREST RPC
  calls confirm registration and anonymous 401/42501 denial.
- TypeScript, scoped source/script lint and isolated production client/server build
  pass. Eight existing fast-refresh warnings and existing build notices remain.
  Full repository lint has the same 217 pre-existing formatting-only errors in
  four unchanged reconciliation scripts; exact counts are in verification JSON.

No authenticated browser click acceptance or live multi-connection race tests.
All operational fixtures ran only in disposable PostgreSQL; real verification
created no Factory, Section, Tailor, profile, assignment, job, receipt, issue or sale.
Four legacy tailoring-job reconciliation decisions remain untouched. No production
creation, costing, finished products, other later phase, deployment or Git history
rewrite. Stopped after Phase 9; await approval for Phase 10.

Evidence: `PHASE9_VERIFICATION.json`, `PHASE9_LIVE_VERIFICATION.json`,
`PHASE9_SECURITY_VERIFICATION.json`, `PHASE9_API_VERIFICATION.json`.
