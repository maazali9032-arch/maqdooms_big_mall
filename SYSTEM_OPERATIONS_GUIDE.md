# Maqdoom's Big Mall ERP — Complete System and Operations Guide

> **Implementation status reference:** 27 September 2026  
> **Scope:** the current staff ERP in this repository, including all migrations through
> `20260927000100_customer_multi_fabric_sale.sql`.  
> **Purpose:** document what the system actually does today. This is not a wish list and it does
> not describe the future public storefront as though it already exists.

## 1. What this application is

This repository contains the internal ERP and operations application for Maqdoom's Big Mall. It is
used by the Owner and staff to manage:

- staff accounts, roles and access;
- physical fabric rolls (`thaans`) and their barcodes;
- stock receiving and incomplete-stock correction;
- append-only stock movements;
- counter sales and multi-fabric bills;
- tailoring work orders and multi-fabric issues;
- customer records;
- internal e-commerce listing management;
- online-order, pick-task and hold foundations;
- WhatsApp message templates and receipt previews;
- reports and audit history.

This repository does **not** contain a public customer storefront. It also does not connect to a
payment gateway, shipping provider, accounting system or live WhatsApp provider.

## 2. Core business terms

### 2.1 Thaan

A **thaan** is one physical roll of fabric. Every physical roll is a separate database record with
its own unique barcode and movement history. Ten identical rolls are ten thaans, not a single item
with quantity `10`.

The barcode is only an identifier. It does not encode the current length, price, fabric or any
other mutable business information.

### 2.2 Laagat

**Laagat** is the internal cost price per metre. It is stored separately from the selling price and
is protected by database permissions and column-level grants. Counter and Tailor users do not
receive cost rows from the database.

### 2.3 Selling price

The physical/POS selling price per metre is stored on the thaan. The price used for a sale or a
tailoring issue is copied into the transaction as a snapshot, so later price changes do not rewrite
history.

### 2.4 Cut

A cut is a deduction of fabric length from a thaan. A physical deduction is represented by a
negative stock movement; React state is never the authoritative stock balance.

### 2.5 Ledger

The ledger is the append-only `stock_movements` history. Available length is calculated from the
sum of movements rather than stored as an editable `remaining_length` field.

### 2.6 Hold

A hold is a temporary online reservation against one thaan. Active, unexpired holds reduce what a
counter or online order is allowed to consume, but they do not themselves deduct the ledger.

### 2.7 Listing

A listing is an online product record managed inside the ERP. It can be unpublished or published,
but the actual public storefront is a separate future application.

### 2.8 Tailor account versus tailoring job

These are different things:

- A **Tailor account** is a staff login whose user has the `tailor` role.
- A **tailoring job** is one garment/work order, such as `TJ-EB397165 · Two-piece Suit`.
- Marking `tailor@example.com` as a Tailor makes that account available for assignment. It does not
  create a job and it does not make the email address itself appear as a job.
- A job is created separately and assigned to an active Tailor account.
- The POS tailoring dropdown lists eligible **jobs**, with the assigned Tailor shown in the label.
- **New job** means “create a new garment work order and assign it to a Tailor.” It does not mean
  “create a new Tailor account” or “mark a Tailor ready for today.”

The intended model is generally one job per garment/order. Multiple fabrics may be issued to that
job, either together or through additional issue sessions while the job remains eligible.

## 3. Technical architecture

### 3.1 Application stack

- React 19 and TypeScript
- TanStack Router/Start
- Vite and Tailwind CSS
- TanStack Query for server-state fetching and invalidation
- Supabase Auth
- Supabase/PostgreSQL
- PostgreSQL Row Level Security (RLS)
- Supabase Storage for listing images
- Drizzle migration mirror for Lovable/database tooling

### 3.2 Main source areas

- `src/app/access/modules.ts`: the shared sidebar and route-module access definition.
- `src/app/providers/session.tsx`: session, roles, effective permissions and deactivation checks.
- `src/routes/_authenticated/`: authenticated application pages.
- `src/features/`: domain queries and mutations.
- `src/shared/utils/units.ts`: canonical metre/mm and rupee/paise conversion.
- `supabase/migrations/`: canonical timestamped database migrations.
- `drizzle/migrations/`: Drizzle/Lovable mirror of the database migrations.
- `src/integrations/supabase/types.ts`: generated/maintained TypeScript database contract.

### 3.3 Source-of-truth boundaries

- The browser controls forms, staging and previews.
- PostgreSQL controls permissions, row visibility and authoritative mutations.
- Stock is authoritative only after a database transaction writes stock movements.
- Draft cuts staged in the browser do not change stock.
- RLS and security-definer functions protect operations even when someone bypasses the visible UI.

## 4. Canonical units and calculations

### 4.1 Length

- The UI accepts and displays metres.
- PostgreSQL and application APIs store/transmit integer millimetres.
- `1 m = 1000 mm`.
- `5.25 m = 5250 mm`.
- User input is converted with rounding to the nearest millimetre.
- Negative values and non-numeric input are rejected by input parsing.
- Authoritative cut functions also require a length greater than zero.
- Yards are not supported as an active unit.

### 4.2 Money

- The UI accepts/displays Indian rupees.
- PostgreSQL stores integer paise.
- The line amount is `length_mm / 1000 × price_paise_per_metre`, rounded to whole paise.
- Display normally rounds to whole rupees; a precise formatter is available for two-decimal display.

### 4.3 Available and sellable length

- `available_mm = SUM(stock_movements.delta_mm)` for one thaan.
- Active holds are calculated separately.
- Maximum currently consumable length is `available_mm - active_unexpired_holds_mm`.
- The UI often shows **Available** and **Held online** separately.
- A cut is rejected if it exceeds the net amount after holds.

## 5. Roles and fixed navigation

The sidebar and route guard use the same `ROLE_MODULES` source. Settings is always available to an
authenticated active staff profile, even if no recognized role is assigned.

| Role               | Sidebar modules and routes                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Owner              | Dashboard, Inventory, Counter / POS, Tailoring, Customers, E-commerce, WhatsApp, Reports, Audit trail, Manage Access, Settings |
| Stock Entry        | Inventory, Settings                                                                                                            |
| Counter            | Counter / POS, Settings                                                                                                        |
| E-commerce Manager | Inventory, E-commerce, WhatsApp, Settings                                                                                      |
| Tailor             | Counter / POS, Tailoring, Settings                                                                                             |

### 5.1 Multiple roles

Multiple roles are supported. The visible and allowed modules are the **union** of all assigned
roles. For example, Stock Entry + Counter receives Inventory, Counter / POS and Settings.

The initial landing page is the first allowed module in this order: Dashboard, Inventory, POS,
Tailoring, Customers, E-commerce, WhatsApp, Reports, Audit, Access, Settings.

### 5.2 Route-level enforcement

Access is not based only on hiding links:

1. The authenticated route loader verifies the Supabase user.
2. It calls `bootstrap_current_user()` for the current roles, effective permissions and active flag.
3. It compares the requested path against the role-module map.
4. An unauthorized path redirects to the user's first permitted module.
5. A client-side `RouteGuard` repeats the same check after the page has loaded.
6. PostgreSQL RLS and permission-checked functions independently protect the data and mutations.

`/inventory/receiving` has an extra nested check: the user must be Owner or have
`inventory.receive`, even if another role allows the Inventory module.

## 6. Permission catalogue and role assignments

The permission catalogue currently contains:

| Permission                       | Purpose                                                                 | Role assignment today                                    |
| -------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| `inventory.receive`              | Create batches, suppliers, fabrics and scanned thaans; commit receiving | Owner, Stock Entry                                       |
| `inventory.edit_thaan`           | Edit/correct thaan details                                              | Owner, Stock Entry                                       |
| `inventory.view_cost`            | Read thaan/material cost data                                           | Owner, Stock Entry                                       |
| `pos.sell`                       | Create customer sales and customer records                              | Owner, Counter                                           |
| `pos.override_price_or_discount` | Reserved price/discount override capability                             | Owner only; no dedicated UI yet                          |
| `pos.issue_to_tailoring`         | Scan and issue fabric to eligible tailoring jobs                        | Owner, Counter, Tailor                                   |
| `stock.adjust`                   | Append stock adjustment/return/wastage movements                        | Owner only                                               |
| `stock.return_from_tailor`       | Reserved granular return permission                                     | Owner only; current adjustment RPC checks `stock.adjust` |
| `tailoring.manage_jobs`          | Tailoring job visibility/management foundation                          | Owner, Tailor                                            |
| `tailoring.view_costs`           | Read tailoring cost snapshots                                           | Owner only                                               |
| `ecommerce.manage_listings`      | Listings, variants, orders, holds and listing images                    | Owner, E-commerce Manager                                |
| `ecommerce.link_stock`           | Read/link physical stock for linked listings                            | Owner, E-commerce Manager                                |
| `reports.view`                   | Cross-domain reporting access                                           | Owner only                                               |
| `audit.view`                     | Audit log access                                                        | Owner only                                               |
| `access.manage`                  | Staff activation and role management                                    | Owner only                                               |

The Owner role receives every permission.

### 6.1 Permission overrides

The inherited schema contains `user_permission_overrides` and `has_perm()` understands an override.
However, the current Manage Access screen deliberately supports **roles only**. There is no
supported UI for assigning individual permissions, as custom per-user permissions are deferred.

## 7. Authentication and staff account lifecycle

### 7.1 Sign-in methods

- Email/password sign-up and sign-in use Supabase Auth.
- Google OAuth is exposed through the Lovable auth integration.
- Passwords require at least six characters in the UI.
- Whether email confirmation is required is controlled by Supabase Auth settings.

### 7.2 First-login bootstrap

`bootstrap_current_user()` runs on authenticated entry and session refresh:

1. It reads the authenticated Supabase user ID and email.
2. It creates or updates the matching `public.profiles` row.
3. It updates `last_login`.
4. If the user has no role, it makes the first bootstrapped account Owner when no Owner role exists;
   otherwise it assigns Counter.
5. It returns the active flag, roles and effective permissions.

Because profile creation happens on bootstrap, an Auth user who has never entered the application
may not yet appear in Manage Access.

### 7.3 Email confirmation and email rate limits

- `Email not confirmed` means Supabase Auth has not confirmed that user's email. Confirm the user
  through the email link or the Supabase dashboard/configuration appropriate to the environment.
- `Email rate limit exceeded` is a Supabase email-delivery throttle, not an ERP role/RLS failure.
  Wait for the limit window, use a properly configured SMTP provider, or create/confirm the test
  user through the Supabase dashboard.
- Adding a row to `profiles` or `user_roles` does not confirm an Auth email and cannot by itself make
  an unconfirmed password account sign in.

### 7.4 Deactivation

Deactivation has two layers:

- Database: `has_perm()` and role checks require `profiles.active = true`, so an inactive user loses
  authorized data/actions immediately even if an Auth token still exists.
- Client: the app listens for the current profile's Realtime update and signs the user out when
  `active` becomes false. It also rechecks on window focus and every 60 seconds as a fallback.

The system does not use a service-role admin API to revoke every Auth refresh token. The database
denial is immediate; visible logout is Realtime-driven with focus/60-second fallback.

## 8. Manage Access

Only Owner has the Access module and `access.manage` permission.

The page supports:

- viewing profile name, email, active state and last login;
- assigning more than one role;
- removing roles;
- deactivating and reactivating staff;
- viewing the role-to-permission matrix.

### 8.1 Last Owner protection

The final active Owner cannot be demoted, have the Owner role removed, or be deactivated.

- The UI disables the applicable checkbox/button.
- Database triggers independently reject the operation.
- An advisory transaction lock serializes concurrent Owner changes so two requests cannot both
  believe another active Owner will remain.

When multiple active Owners exist, one of them can be demoted or deactivated as long as another
active Owner remains.

### 8.2 Access audit entries

Role grants/removals and activation changes call `log_audit()` with the affected user and change.
Direct database changes that bypass these application mutations may not create the same application
audit detail, although the last-Owner triggers still enforce the invariant.

## 9. Inventory model and status lifecycle

### 9.1 Thaan statuses

| Status     | Meaning                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| `draft`    | Scanned/entered but not activated as sellable stock                      |
| `active`   | Eligible physical stock, subject to completeness and availability checks |
| `depleted` | Ledger balance reached zero or less after an allowed movement            |
| `archived` | Historical/hidden operational record; not sellable                       |

Thaans are not hard-deleted when depleted. Their sales, tailoring lines, movements and audit history
remain connected.

### 9.2 Required and optional stock information

The activation/sellability requirements are:

- original length: required;
- physical/POS selling price: required;
- laagat/cost: optional;
- fabric name: optional for activation;
- width: optional;
- rack: optional.

A record missing original length or selling price is `Incomplete`. The UI explains the reason as
`Missing length`, `Missing selling price`, or both.

## 10. Stock receiving workflow

Path: `/inventory/receiving`  
Authorized roles: Owner and Stock Entry.

### 10.1 Step 1 — receiving batch and supplier

- The user may select an existing draft batch or start a new one.
- A new batch receives an `RB-......` code generated from the current timestamp suffix.
- Supplier is a pick-or-type field.
- Typing an existing name performs a case-insensitive exact-name lookup and reuses that supplier.
- Typing a new nonblank name creates a supplier and makes it available in future selections.
- Blank supplier is permitted and produces a batch without a supplier.
- Bill number is optional at database level.
- Only a user with `inventory.receive` can insert a supplier or receiving batch.
- New supplier creation is audit logged.

The supplier helper does not delete or replace existing suppliers.

### 10.2 Step 2 — barcode scanning

- The scan field accepts a hardware scanner as keyboard input or manual typing followed by Enter.
- One successful scan immediately inserts one draft thaan and refreshes Scanned Records.
- The input is cleared and refocused for rapid consecutive scanning.
- Only the barcode is required at scan time.
- Duplicate barcodes are checked in the UI and also protected by the database unique constraint.
- A duplicate is rejected rather than creating a second physical record.
- The barcode remains an identifier only; length and prices stay in database fields.

### 10.3 Step 3 — bulk edit

The user can select one, several, or all scanned records in the selected batch and apply:

- fabric;
- original length;
- width;
- physical/POS selling price per metre;
- laagat per metre.

Only nonblank bulk fields are applied. Existing values for blank fields are left unchanged.

Fabric is also a pick-or-type field:

- an existing fabric name is reused case-insensitively;
- a new name creates a `fabrics` record with a generated `FB-...` code;
- it appears in future selection lists;
- creation requires `inventory.receive` and is audit logged.

### 10.4 Individual editing during receiving

Every scanned row has an **Edit** action. The dialog can update fabric, length, width, selling price
and, when permitted, laagat. It edits the existing thaan; it does not create a second barcode or
movement.

### 10.5 Commit

Before commit, every scanned thaan remains a draft and cannot be sold.

`commit_receiving_batch()`:

1. requires `inventory.receive`;
2. locks and verifies the draft batch;
3. identifies complete and incomplete records;
4. inserts one positive `INWARD` movement for each complete thaan that does not already have one;
5. changes complete thaans to `active`;
6. leaves incomplete thaans as drafts;
7. marks the batch `committed`;
8. records activated/incomplete counts in the audit log.

Committing the same batch twice is rejected. Duplicate `INWARD` entries are explicitly avoided.

## 11. Inventory page and incomplete-stock correction

Path: `/inventory`  
Roles: Owner, Stock Entry and E-commerce Manager, with capabilities filtered by permissions.

### 11.1 What the page shows

- active thaan count;
- total available ledger length;
- incomplete count;
- depleted count;
- searchable thaan table;
- available versus original length;
- active online holds;
- selling price;
- laagat only when `inventory.view_cost` is granted;
- status and incomplete reasons;
- depleted/archived history.

Search covers barcode, fabric, colour, rack and batch code.

Stock Entry/Owner additionally receive stock movement and receiving-batch tabs. E-commerce Manager
uses Inventory as a stock reference view but does not receive receiving, cost, correction or ledger
history controls.

### 11.2 Incomplete-only filter

The `Incomplete only` control appears only to users who have both `inventory.receive` and
`inventory.edit_thaan`.

When enabled:

- only incomplete records matching the search are shown;
- each row explains which required field is missing;
- the user can edit the existing record;
- after a successful correction/activation, it disappears from this filtered view.

### 11.3 Correcting committed incomplete stock

`correct_incomplete_thaan()` edits the existing thaan under a row lock and revalidates the same
required fields used by commit.

- It accepts only draft or incomplete-active records.
- A complete active record is rejected by this correction path.
- If its batch is already committed and the thaan becomes complete, the function creates the one
  missing `INWARD` movement and activates it.
- If an old incomplete-active record already has an inward movement, a second inward movement is
  not created.
- If that legacy record's original length changes, the difference is appended as an `ADJUSTMENT`
  movement, preserving history rather than rewriting the ledger.
- Cost is upserted only when a permitted cost value is supplied.
- The correction and result are audit logged.

If a draft is corrected while its batch is still draft, it remains draft until batch commit.

## 12. Stock movement ledger and adjustments

Movement kinds are:

- `INWARD`: stock received;
- `SALE`: customer-sale deduction;
- `TAILORING`: fabric issued to tailoring;
- `RETURN`: positive return from tailoring;
- `WASTAGE`: negative loss/waste;
- `ADJUSTMENT`: explicit correction, normally positive in the current UI.

Each movement can retain the thaan, signed millimetres, purpose, reference, sale/job reference,
cost snapshot, selling-price snapshot, reason, staff user and timestamp.

### 12.1 Manual adjustment handling

The **Adjust** action is available only with `stock.adjust` (currently Owner).

- Adjustment adds the entered amount.
- Return from tailor adds the entered amount.
- Wastage deducts the entered amount.
- The database rejects any operation that would make stock negative.
- A positive movement can reactivate a depleted thaan.
- A zero/non-numeric UI length is rejected.
- The movement and reason are appended; old movements are not edited.
- The action is audit logged.

The separate catalogue permission `stock.return_from_tailor` exists for future granularity, but the
current adjustment function is authorized through `stock.adjust`.

## 13. Counter/POS shared scan behaviour

Path: `/pos`  
Roles: Owner, Counter and Tailor. The actions shown depend on effective permissions.

After barcode lookup, the page shows:

- barcode and fabric;
- original length;
- ledger-available length;
- active held length;
- physical selling price per metre;
- active/incomplete status;
- length input and calculated line value.

The database rejects:

- an unknown barcode;
- a draft, depleted or archived thaan;
- a thaan missing length or selling price;
- zero or negative cuts;
- a cut greater than available length after active holds;
- an unauthorized purpose.

The UI performs early checks for clearer feedback, but the database repeats authoritative checks
while holding row locks.

## 14. Customer sale workflow, including multiple fabrics

Available to Owner and Counter through `pos.sell`.

### 14.1 Customer selection

One sale can use:

- an existing customer;
- a newly entered customer;
- no customer (`Walk-in`).

New-customer fields are all optional:

- name;
- contact number;
- WhatsApp number.

If all fields are blank, the sale remains walk-in and no customer row is created.

### 14.2 Customer deduplication

`find_or_create_customer()` normalizes phone/WhatsApp values to digits for matching.

- A phone or WhatsApp match reuses the existing customer.
- If neither number is supplied, a case-insensitive name match is reused.
- Advisory locks serialize matching identifiers to reduce concurrent duplicate creation.
- Existing non-null fields are retained; missing fields may be filled from the new input.
- WhatsApp is stored on the customer for later message integration.

The standalone Customers page currently requires a name and offers name/phone entry. The richer
optional name/contact/WhatsApp entry exists in POS.

### 14.3 Staging multiple fabrics

1. Scan or type the first thaan barcode.
2. Enter the length.
3. Choose/select customer details as needed.
4. Click **Add to sale**.
5. The item appears in **Items ready to bill**; stock is not yet deducted.
6. Scan the next thaan and repeat.
7. Remove a staged line if necessary.
8. Review item count, total metres and total amount.
9. Click **Complete sale & cut**.

The same thaan cannot be staged twice in one sale; enter the combined desired length for that thaan.
One sale accepts up to 50 distinct staged cuts at the database boundary.

Staging is browser memory only. Refreshing/navigating away before final completion discards the
staged list and does not change stock.

### 14.4 Atomic completion

`complete_fabric_sale()` performs the final operation:

1. requires `pos.sell`;
2. validates the customer if present;
3. validates the JSON item list, maximum count and duplicate barcodes;
4. allocates one daily invoice number while holding an advisory lock;
5. creates one `sales` row;
6. locks thaans in deterministic barcode order to avoid deadlocks;
7. recalculates ledger availability and active holds for every line;
8. inserts one `sale_items` row and one negative `SALE` movement per thaan;
9. snapshots cost and selling price per line;
10. marks a fully consumed thaan depleted;
11. updates the one bill total;
12. writes per-cut and overall sale audit entries;
13. commits everything together.

If any line fails, PostgreSQL rolls back the entire bill, every sale item and every stock movement.
There is no partial multi-fabric sale.

The current UI-generated multi-item invoice format is `INV-YYMMDD-NNNN`.

### 14.5 Receipt and recent bills

After success, POS shows an itemized WhatsApp-style preview with every fabric/barcode, length, line
amount, total and remaining amount on each thaan. It is a preview only; nothing is sent.

Recent bills show the bill number, customer/Walk-in, time and total.

### 14.6 Customer-creation failure edge case

When entering a new customer, customer creation occurs before the final batch-sale RPC. If the
subsequent sale fails, the customer may remain saved without a bill. A retry reuses that customer
through the deduplication rules rather than intentionally creating another one.

## 15. Tailoring job model and lifecycle

### 15.1 What a job represents

A job is a real work order for a garment, not a daily Tailor attendance/availability marker. It
contains:

- generated job code (`TJ-` plus an identifier);
- garment description;
- assigned Tailor profile and historical display name;
- optional customer relationship at database/API level;
- optional notes/instructions;
- creator and creation time;
- status;
- consumed fabric/material lines.

The current Tailoring and POS create-job forms collect garment, assigned Tailor and optional notes.
They do not currently expose customer selection even though the database function supports an
optional customer ID.

### 15.2 Statuses

| Status        | Intended meaning                              | Eligible for new POS fabric issue? |
| ------------- | --------------------------------------------- | ---------------------------------- |
| `open`        | Work order created/awaiting or beginning work | Yes                                |
| `in_progress` | Tailor is working on it                       | Yes                                |
| `ready`       | Garment work complete/ready                   | No                                 |
| `delivered`   | Handed over/completed                         | No                                 |
| `cancelled`   | Cancelled work order                          | No                                 |

Issuing fabric does not automatically change job status. The assigned Tailor or Owner updates the
status explicitly.

### 15.3 Assignment rules

- The assignee must be an active profile with the Tailor role.
- Removing/deactivating the Tailor or changing the job out of open/in-progress makes it ineligible
  for further POS issues.
- Historical `tailor_name` text is preserved, but a legacy text-only assignment is not enough for
  new issues; a real active Tailor profile link is required.
- Owner can reassign a job from the Tailoring page.
- Only Owner or the currently assigned Tailor can change job status at the database boundary.

### 15.4 Who sees which jobs

- Owner and Counter-role users can retrieve all jobs needed by their operational flows.
- A pure Tailor sees only jobs assigned to their own user ID and only their corresponding lines.
- The POS eligible-job function shows Owner/Counter all eligible assigned jobs.
- A pure Tailor sees only their own eligible open/in-progress jobs.
- A user with both Counter and Tailor is not restricted to self for the counter eligibility list,
  but status changes are still limited to Owner or the actual assignee.

## 16. Creating a new tailoring job

### 16.1 From Tailoring

- Only Owner sees the Tailoring-page create form.
- Owner enters garment, chooses an active Tailor and optionally enters notes.
- The database revalidates that the assignee is active and still has the Tailor role.

### 16.2 From POS

- Owner or Counter may click **New job** while Purpose is Tailoring.
- The dialog retrieves only active Tailor-role accounts.
- After successful creation, the job is automatically selected for the pending issue.
- Pure Tailor users do not see New job; they receive work assigned by Owner/Counter.
- The control is disabled while cuts are staged so a staged issue cannot silently switch jobs.

Creating a job does not consume fabric. It only creates/selects the work order.

## 17. Tailoring fabric issue, including multiple fabrics

### 17.1 Eligible-job dropdown

The dropdown contains database jobs only. There is no manual job-ID entry and no fabricated/demo
option generated in the UI.

For a job to appear it must:

- exist in `tailoring_jobs`;
- be `open` or `in_progress`;
- reference an active profile;
- have that profile currently assigned the Tailor role;
- belong to the current user when the current user is a pure Tailor.

If no job is eligible, the UI shows an empty-state message.

### 17.2 Staging several cuts

1. Set Purpose to Tailoring.
2. Select an eligible job, or Owner/Counter creates one.
3. Scan a thaan and enter length.
4. Click **Add cut**.
5. Scan another thaan/fabric and add another cut.
6. Review or remove staged lines.
7. Click **Issue to tailoring** once.

The selected job and purpose are locked while cuts are staged. Remove every staged cut to choose a
different job or purpose.

Staged cuts are browser memory only, and stock is unchanged until the final issue.

### 17.3 Atomic issue

`issue_tailoring_fabrics()`:

- requires `pos.issue_to_tailoring`;
- requires one job and at least one line;
- limits a group to 50 distinct thaans;
- rejects duplicate barcodes;
- processes in deterministic barcode order;
- calls the authoritative `cut_thaan()` operation for every line inside one PostgreSQL transaction;
- creates a `tailoring_job_lines` record and a negative `TAILORING` movement per cut;
- snapshots cost and selling price;
- defaults the current UI category to `outer fabric`;
- records a group audit event.

The job-eligibility trigger rechecks the job for every inserted line. If any thaan lacks stock, any
hold blocks it, or the job became ineligible, the entire transaction rolls back. No earlier line is
left partially issued.

Tailoring consumption does not create a customer sale or invoice. The selling value shown is an
internal reference/potential value, while cost is visible only to cost-authorized roles.

### 17.4 Additional issue sessions

An eligible job can receive more fabric later through another issue session. Each session appends
new job lines and ledger movements. Previous lines are not overwritten.

## 18. Tailoring page

The Tailoring page shows:

- job code, garment, assignee, customer/shop-stock label and created time;
- job status and status control;
- Owner reassignment control;
- each thaan/material line, category and quantity;
- selling value per line and job;
- cost per line/job only for authorized roles;
- overall jobs and active-job counts;
- non-fabric material on-hand references.

Current non-fabric materials are displayed as reference data. This UI does not yet contain a
complete issue/return workflow for buttons, padding or other material quantities.

## 19. Customer module

The Owner-only Customers route provides:

- manual name/phone creation;
- customer list;
- total spend calculated from linked sales;
- bill count;
- tailoring job count.

The richer WhatsApp field is stored and used by POS foundations but is not currently displayed in
the standalone customer list. Detailed measurements, CRM, loyalty and tailoring billing are not
implemented.

## 20. E-commerce listing system

Path: `/ecommerce`  
Roles: Owner and E-commerce Manager.

This is an internal listing-management screen, not the storefront.

### 20.1 Listing fields

The editor supports:

- online product name;
- description;
- online price;
- optional online sale price;
- category;
- collection;
- comma-separated tags;
- SEO title and description;
- images;
- manual sizes/variants and quantities where applicable.

Editing these fields never writes thaan selling price, POS price or laagat.

### 20.2 Stock modes

| Mode        | Meaning                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `linked`    | Fabric listing linked to one or more physical thaans; availability derives from the ledger and holds |
| `manual`    | Online-only ready-made/size product with explicit variant quantities                                 |
| `untracked` | Online-only showcase or enquiry product without tracked quantity                                     |

The **New online-only product** dialog deliberately offers only `manual` and `untracked`. It does
not create physical inventory. A database trigger also rejects attempts to attach a physical thaan
to a non-`linked` listing.

The current UI displays existing linked-thaan relationships but does not expose a full link/unlink
selector. Link rows can only belong to listings whose `stock_mode` is `linked`.

### 20.3 Independent pricing

Online `price_paise` and `sale_price_paise` live on `listings`. Physical/POS price lives on each
thaan. Changing one does not update the other, and neither changes `thaan_costs`.

Example:

- POS price: ₹950/m;
- online listing price: ₹999/m;
- changing ₹999 does not modify ₹950 or laagat.

### 20.4 Manual variants

- Each variant has a label/size and nonnegative integer quantity.
- Decimal/negative quantities are normalized to a nonnegative whole number on save.
- Existing variants can be updated or removed.
- Variant persistence is used only for `manual` listings.

### 20.5 Publish state

- New online-only products are created unpublished.
- Saving edits preserves the existing published/unpublished flag.
- Publish/Unpublish is a separate explicit action.
- Inventory never automatically becomes published.

Because the public storefront is not part of this repository, `published = true` is currently a
database/internal management state rather than proof that a live public page exists.

## 21. Listing images

- Maximum: 6 images per listing in both UI and a database check constraint.
- Maximum file size: 10 MB per image.
- Accepted types: JPEG, PNG, WebP and GIF.
- New files receive local previews before saving.
- Existing and newly selected images can be removed.
- Replacement is performed by removing an old image and adding another.
- Files are stored in the private `listing-images` Supabase Storage bucket.
- Listing rows store storage paths, not image binaries.
- Internal previews resolve storage paths to time-limited signed URLs.
- Upload/update/delete requires `ecommerce.manage_listings`.
- Reading listing images requires e-commerce-management or report access.
- Images are not required for physical inventory and do not alter thaans.

Failure handling:

- If a new upload/update sequence fails, files uploaded during that attempt are removed.
- If it was a newly created listing, the incomplete new listing row is also removed.
- Old file deletion occurs after listing save; if cleanup fails, the listing remains saved and the
  user receives a specific cleanup error.

## 22. Online availability and holds

For a linked fabric listing, orderable length is the **largest currently available individual
thaan after active holds**, not the total of all linked thaans.

Example:

- TH-0004: 21.50 m;
- TH-0005: 29.25 m;
- TH-0014: 30.50 m;
- online availability: 30.50 m, not 81.25 m.

The database view calculates:

- `largest_piece_mm = MAX(available_mm - held_mm)`;
- `total_linked_mm = SUM(available_mm)` for internal reference;
- linked-thaan count.

Total linked stock is explicitly labelled not orderable.

### 22.1 Hold rules

- Only E-commerce Manager/Owner can create or release holds through protected functions.
- Hold length must be greater than zero.
- A hold is rejected when it exceeds ledger availability minus other active holds.
- Duration is a function parameter with a 30-minute default, not a final hardcoded business rule.
- Expired holds are ignored by availability even if their stored status remains `active`.
- Released, consumed or expired statuses are non-active for availability.
- Counter and tailoring cuts also respect active unexpired holds.

The current Holds tab is a view; it does not expose every hold-management function as a button.

## 23. Online orders and pick tasks

Online order statuses are:

- `new`;
- `picking`;
- `picked`;
- `fulfilled`;
- `cancelled`.

The ERP displays order number, customer name, listing, requested length/quantity, amount and status.
The Pick Tasks tab shows `new` and `picking` orders and supports:

- `new` → **Start picking** → `picking`;
- `picking` → **Mark picked** → `picked`.

Changing pick status does **not** deduct physical stock. The stated operational rule is to scan and
cut the thaan through the normal POS/ledger path. The current UI does not yet automatically attach a
POS sale/cut to an online order, consume its hold, or complete payment/shipping. That remains a
manual coordination/integration foundation rather than a second inventory algorithm.

## 24. WhatsApp foundation

Path: `/whatsapp` for Owner and E-commerce Manager.

The module currently provides:

- stored message templates and trigger-event labels;
- latest-sale receipt preview when the current user is also allowed to read sales;
- multi-line bill rendering;
- database foundation for message log statuses: preview, queued, sent and failed.

No WhatsApp provider or credentials are configured. No message is actually sent. E-commerce
Manager normally cannot read counter sales, so their WhatsApp page may show templates without a
latest-sale receipt. POS also shows a post-sale receipt preview.

## 25. Dashboard

The Dashboard is Owner-only by fixed navigation/route policy. It displays permission-aware data
including:

- active and depleted thaans;
- ledger-derived available fabric;
- today's sales and bill count;
- open/in-progress tailoring jobs;
- online orders and live listings;
- low-stock count and smallest active pieces;
- incomplete stock;
- active holds;
- recent movements;
- recent sales;
- tailoring cost versus selling value when permitted;
- recent audit actions.

Low stock currently means an active thaan with less than 3.00 m ledger balance.

## 26. Reports

Reports is Owner-only in the fixed module map and uses ledger/transaction data rather than separate
editable totals.

Current report foundations include:

- available metres and active thaan count by fabric;
- sales totals by day from recent bill data;
- rolling 7-day and 30-day sales metrics;
- recent movement count;
- tailoring consumption by job;
- cost-to-selling comparison when cost permission is available.

Advanced valuation, employee performance, export and accounting reports are not implemented yet.

## 27. Audit trail and traceability

Audit Trail is Owner-only and requires `audit.view`. It is searchable across actor, action, entity,
record reference and JSON detail.

Implemented application/database audit events include, among others:

- access role grants/removals;
- user activation/deactivation;
- supplier creation;
- fabric creation;
- receiving-batch commit;
- incomplete-thaan correction;
- stock adjustment;
- each physical cut;
- complete multi-fabric sale summary;
- multi-fabric tailoring issue summary;
- customer creation;
- tailoring job creation;
- tailoring reassignment;
- tailoring status change.

The stock ledger is also a detailed immutable operational history with user/time/reference. Not
every direct RLS-authorized listing edit, publish toggle or online-order status update currently
writes a separate `audit_log` row; this is a known difference between ledger-critical actions and
some management CRUD actions.

## 28. Cost confidentiality

Cost protection is not only visual:

- thaan costs are stored in the separate `thaan_costs` table;
- RLS permits those rows only with `inventory.view_cost`;
- cost snapshot columns are removed from general authenticated column grants;
- tailoring/material cost RPCs return rows only when the caller has `tailoring.view_costs` or
  `inventory.view_cost`;
- Counter, Tailor and E-commerce Manager UIs receive no cost rows;
- sale/tailoring functions can snapshot cost internally without exposing it to the caller.

## 29. Current data-access boundaries

The following summarizes effective business reads after the latest migrations.

| Role               | Main data available                                                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner              | All operational data, costs, reports, audit and access administration                                                                                                                                                                    |
| Stock Entry        | Fabrics, all thaans including drafts, suppliers, receiving batches, holds, stock movements and thaan/material cost data relevant to receiving; no sales/customer/e-commerce modules                                                      |
| Counter            | Non-draft thaans, holds and movement primitives needed for POS; sales and sale items; customers; eligible/all counter tailoring jobs and lines; non-cost materials; online-order/WhatsApp foundations needed by counter flows; no laagat |
| Tailor             | Non-draft stock primitives needed for issue validation; own assigned tailoring jobs/lines; related customers; non-cost materials; no sales, general customers, listings or laagat                                                        |
| E-commerce Manager | Non-draft thaans, holds/movements needed for availability, listings, variants, thaan links, orders and WhatsApp templates/log foundation; no sales, general customers, tailoring jobs or laagat                                          |

Profiles are generally self-readable; the staff directory and role/permission catalogue require
`access.manage`. Owner/Counter receive the minimal active-Tailor fields through a protected RPC when
creating POS jobs.

## 30. Database entity guide

### Access and identity

- `profiles`: ERP staff profile, active state and last login keyed to Auth user ID.
- `roles`: role catalogue.
- `permissions`: permission catalogue.
- `role_permissions`: role-to-permission mapping.
- `user_roles`: supports several roles per user.
- `user_permission_overrides`: schema foundation for per-user overrides; no management UI yet.

### Inventory

- `fabrics`: fabric catalogue and descriptive defaults.
- `suppliers`: supplier catalogue.
- `receiving_batches`: draft/committed receiving sessions.
- `thaans`: physical roll identity and descriptive data; no mutable remaining balance.
- `thaan_costs`: separately protected cost per metre.
- `stock_movements`: authoritative signed ledger.
- `holds`: temporary online reservations.

### Sales and customers

- `customers`: optional name, phone, WhatsApp and notes.
- `sales`: one bill header, customer, staff, total, payment mode and time.
- `sale_items`: one or more thaan cuts with price/amount snapshots under the bill.

The current POS defaults `payment_mode` to `cash`; no payment-mode selector or payment gateway is
implemented.

### Tailoring

- `tailoring_jobs`: garment work order and real Tailor-profile assignment.
- `tailoring_job_lines`: thaan or material consumption with snapshots.
- `materials`: non-fabric material reference/quantity foundation.

### E-commerce and messaging

- `listings`: online-only or linked product fields and publish state.
- `listing_thaan_links`: many-to-many links allowed only for linked listings.
- `listing_variants`: manual size/quantity rows.
- `online_orders`: ERP order/pick foundation.
- `whatsapp_templates`: message templates.
- `whatsapp_messages`: future provider message log foundation.
- Storage bucket `listing-images`: private listing image files.

### Audit

- `audit_log`: actor, action, entity, record reference, JSON detail and timestamp.

## 31. Derived views and protected functions

### Views

- `v_thaan_stock`: ledger balance and active holds per thaan.
- `v_thaan_overview`: thaan, fabric, batch, supplier, balance, holds, incomplete flag and latest
  movement time.
- `v_movement_log`: movement with barcode, fabric and staff display name.
- `v_listing_availability`: linked count, largest net piece and internal total linked stock.

These views use invoker security so underlying RLS still applies.

### Important functions

- `bootstrap_current_user()`: profile/role bootstrap and effective access result.
- `has_perm()`, `has_any_perm()`, `has_role()`, `has_any_role()`: active-aware authorization.
- `commit_receiving_batch()`: activate complete received stock atomically.
- `correct_incomplete_thaan()`: in-place correction and safe ledger activation.
- `cut_thaan()`: locked authoritative single-thaan sale/tailoring operation retained for core reuse.
- `complete_fabric_sale()`: one atomic multi-thaan customer bill.
- `issue_tailoring_fabrics()`: one atomic multi-thaan tailoring issue.
- `adjust_thaan()`: append validated stock corrections.
- `find_or_create_customer()`: optional/deduplicated POS customer capture.
- `active_tailors()`: minimal active assignee list for Owner/Counter.
- `eligible_tailoring_jobs()`: validated POS job list with pure-Tailor self-scoping.
- `create_tailoring_job()`, `assign_tailoring_job()`, `update_tailoring_job_status()`.
- `place_hold()`, `release_hold()`.
- `dashboard_metrics()`: permission-filtered aggregate metrics.
- `tailoring_line_costs()`, `material_costs()`: protected cost reads.
- `log_audit()`: attributable audit insertion for active staff.

Security-definer entry points revoke anonymous/public execution and explicitly grant authenticated
execution where appropriate.

## 32. Concurrency and edge-case handling

### 32.1 Concurrent cuts

Cut functions use `SELECT ... FOR UPDATE` on the thaan. If two counters request more than the same
remaining fabric can support, the first transaction may succeed and the second recalculates after
the lock, then fails with insufficient stock. Negative stock is not allowed.

Multi-item operations lock in sorted barcode order to reduce deadlock risk.

### 32.2 Atomic groups

- Multi-fabric sale: all bill lines succeed or all roll back.
- Multi-fabric tailoring issue: all issue lines succeed or all roll back.
- Receiving commit: its inward movements/status update/batch commit form one transaction.

### 32.3 Holds changing during checkout

The final database call recalculates active holds while the thaan is locked. A value displayed
earlier is only a preview; stale stock is rejected safely at final commit.

### 32.4 Duplicate identifiers

- Thaan barcode has a unique constraint and pre-insert check.
- Bill number has a unique constraint; batch sale allocation is serialized per day.
- Job code and listing slug are unique.
- One thaan cannot appear twice in the same staged sale/issue payload.
- User-role assignment is unique per user/role.

### 32.5 Incomplete and stale records

- Draft/incomplete stock is never sellable.
- A stale job selection is rechecked and cleared by the UI when no longer returned.
- The database trigger independently refuses an inactive/unassigned/closed job.
- A selected customer deleted before checkout is rejected.
- An old active but incomplete thaan is still rejected by POS and can be corrected in place.

### 32.6 Browser refresh during staging

Sale and tailoring staged lines are intentionally not database reservations. Refreshing the page
loses them, but it also guarantees no invisible draft has deducted stock. Active online holds are
the separate mechanism for reservation.

### 32.7 Error reporting

POS extracts the `message` from both native errors and Supabase structured errors, so database
rejections should identify the real issue rather than only a generic failure message.

## 33. Operational setup and migration procedure

### 33.1 Environment variables

The application expects:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Server-side fallbacks are `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.

Never put a Supabase service-role/secret key into client-exposed `VITE_*` variables. `.env` is
ignored; `.env.example` contains placeholders.

### 33.2 Migration order

Run timestamped files in `supabase/migrations/` in filename order. Current order:

1. `20260924000000_erp_core_schema.sql`
2. `20260924000100_demo_seed_data.sql` — optional for production
3. `20260924000200_reporting_views.sql`
4. `20260926000000_role_access_hardening.sql`
5. `20260926000100_requirements_completion.sql`
6. `20260926000200_incomplete_stock_correction.sql`
7. `20260926000300_pos_customer_details.sql`
8. `20260926000400_tailor_job_assignment.sql`
9. `20260927000000_tailoring_multi_cut.sql`
10. `20260927000100_customer_multi_fabric_sale.sql`

The last two migrations are required for the current POS multi-fabric tailoring and customer-sale
buttons. If the UI is updated but an RPC migration is missing, staging still works locally but the
final action fails because Supabase cannot find the function.

After manually creating/replacing RPCs in SQL Editor, PostgREST normally refreshes automatically.
If necessary:

```sql
notify pgrst, 'reload schema';
```

Do not edit old migrations after deployment. Add a later migration for future changes. Keep the
corresponding Drizzle migration/journal entry aligned.

### 33.3 Local development

```sh
npm install
npm run dev
```

Common validation commands:

```sh
npx tsc --noEmit
npm run lint
npm run build
```

On a low-memory Windows machine, running lint and build sequentially is more reliable. A bounded
Node heap can be used, for example:

```sh
node --max-old-space-size=512 ./node_modules/vite/bin/vite.js build
```

## 34. Troubleshooting guide

### Tailor account does not appear in the New job assignee list

Check all of the following:

1. The Auth user has bootstrapped a matching `profiles` row.
2. The profile is active.
3. `user_roles` contains `role_key = 'tailor'` for that exact profile UUID.
4. The logged-in job creator is Owner or Counter.
5. The latest tailoring migrations are applied.

### Tailor account exists but POS job dropdown is empty

This is normally correct when no job exists. The dropdown shows jobs, not staff accounts. Create a
New job and assign it to that Tailor. The job then appears while it is open/in-progress and the
assignee remains active with the Tailor role.

### Tailoring issue says the RPC/function is missing

Apply `20260927000000_tailoring_multi_cut.sql`, reload PostgREST schema if necessary, then reload the
application.

### Multi-fabric customer completion says the RPC/function is missing

Apply `20260927000100_customer_multi_fabric_sale.sql`, reload PostgREST schema if necessary, then
reload the application.

### `Email not confirmed`

Confirm the Supabase Auth email. Profile/Owner SQL does not replace Auth confirmation.

### `Email rate limit exceeded`

This is the Supabase email throttle. Wait, configure SMTP, or use the dashboard's controlled user
creation/confirmation tools.

### User appears in Auth but not Manage Access

Manage Access reads `public.profiles`, not the raw Auth directory. Have the user complete a first
authenticated bootstrap/login, or deliberately provision the matching profile and role through a
trusted administrative database process.

### User has a role but receives no data

Check `profiles.active`. All permission/role helpers require an active profile. Also confirm the
frontend environment points to the same Supabase project where migrations and role rows were
applied.

### Sale/tailoring item becomes insufficient after it was staged

Another counter transaction or a new hold may have changed availability. Staging is only a preview;
the final transaction correctly recalculates and rejects stale stock without partial deduction.

### A committed incomplete thaan is stuck

Use Inventory → Incomplete only → Edit. Enter missing original length and/or selling price and save.
The correction function creates the missing inward movement at most once and activates the same
record when complete.

### Counter can see price but not laagat

That is intentional. Selling price is operational POS information. Laagat is permission-gated and
is not returned to Counter/Tailor/E-commerce Manager.

## 35. Deliberately not implemented/current limitations

The following are not present as complete features:

- public e-commerce storefront/customer authentication;
- live WhatsApp sending/provider integration;
- payment gateway, shipping and fulfilment integrations;
- GST finalization or accounting system;
- per-user permission assignment UI;
- new/custom roles beyond the fixed five;
- a different inventory allocation algorithm;
- automatic online-order-to-POS cut/hold consumption;
- full linked-thaan selection management in the listing editor;
- complete non-fabric tailoring material issue/return UI;
- tailoring measurements and detailed tailoring billing;
- discounts/price override UI despite the reserved permission;
- sale cancellation/refund workflow;
- advanced CRM, loyalty, marketing or multi-branch features;
- automatic cleanup that changes an expired hold's stored status;
- comprehensive audit entries for every listing/order CRUD change.

These limitations must not be confused with broken stock rules. Ledger deductions, holds,
role-based routes, RLS, cost separation, batch receiving, multi-fabric sale and multi-fabric
tailoring issue are implemented as described above.

## 36. Regression checklist

After future changes, verify at minimum:

### Access

- Owner sees all modules.
- Stock Entry sees Inventory + Settings.
- Counter sees Counter/POS + Settings.
- E-commerce Manager sees Inventory + E-commerce + WhatsApp + Settings.
- Tailor sees Counter/POS + Tailoring + Settings.
- Multi-role users see the union.
- Typed unauthorized URLs redirect.
- The last active Owner cannot be demoted or deactivated in UI or SQL.
- Deactivated users immediately lose database permission and are signed out by the client checks.

### Receiving and inventory

- Existing/new suppliers and fabrics work without duplicates from case differences.
- Scans appear immediately as draft rows.
- Duplicate barcode is rejected.
- Bulk and individual edits both work.
- Commit activates only records with length + selling price.
- Incomplete correction updates the same thaan and does not duplicate `INWARD`.
- Incomplete-only corrected rows disappear after activation.
- Counter/Tailor/E-commerce users never receive laagat.

### POS sale

- One or multiple distinct thaans can be staged.
- Removing a staged item does not affect stock.
- Final completion creates one bill with multiple sale items/movements.
- New customer details are optional and duplicate contact numbers reuse a customer.
- WhatsApp number persists.
- Holds and concurrent cuts are respected.
- Any failed line rolls back the whole sale.
- Receipt preview and recent bill total match database results.

### Tailoring

- Only real active Tailor-role profiles can be assigned.
- Job dropdown contains eligible job IDs, not arbitrary people/manual values.
- Pure Tailor sees/issues only own jobs.
- Owner/Counter can create a New job at POS.
- Several fabrics can be staged for one job.
- Any failed line rolls back the whole issue.
- No customer sale is created for tailoring consumption.
- Owner/assigned Tailor status rules remain enforced.

### E-commerce

- Listing edits never change POS price or laagat.
- New online-only products do not create/link physical inventory.
- Manual sizes/quantities persist.
- Maximum six valid images upload and preview.
- Publish state is preserved on edit and changes only through Publish/Unpublish.
- Linked availability remains the largest net individual thaan, not the sum.
- Pick status changes do not silently deduct stock.

### Build health

- TypeScript typecheck succeeds.
- ESLint has no errors.
- Production client, SSR and Nitro builds complete.

## 37. Final operating principles

1. One physical roll is one thaan and one unique barcode.
2. Available stock comes from movements, never a manually overwritten balance.
3. Draft/incomplete stock cannot be sold.
4. Required activation fields are original length and physical selling price; cost is optional.
5. Holds reduce sellable capacity without becoming ledger deductions.
6. Every physical sale/tailoring deduction is validated under database locks.
7. Multi-item POS operations commit all-or-nothing.
8. Historical cost and selling prices are snapshots.
9. Online price is separate from physical/POS price and laagat.
10. A Tailor account is a person; a tailoring job is a garment work order.
11. Multiple roles combine; unauthorized routes and database actions remain blocked.
12. Depleted/incomplete records are corrected or archived, not duplicated/deleted to hide history.
13. Publishing is explicit; inventory never becomes public automatically.
14. WhatsApp, storefront, payments and fulfilment integrations must not be represented as live until
    real providers/workflows are connected.
