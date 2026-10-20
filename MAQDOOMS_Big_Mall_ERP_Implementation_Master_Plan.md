# MAQDOOM'S BIG MALL — ERP IMPLEMENTATION MASTER PLAN

## Purpose

This is the implementation source of truth for the complete MAQDOOM'S Big Mall ERP.

> **Current approved implementation status — 20 October 2026, including Section 72:** Migrations 0065–0070 are now applied live after explicit user authorization, successful rollback dry run and post-commit verification. The hosted POS serves matching frontend code markers from the current implementation. Section 72 supersedes prior pending-migration statements. No live customer test bill was posted; authenticated checkout and physical printer/scanner acceptance remain separate milestones. See the matching dated history entry.

Codex must implement the software **phase by phase, in the exact dependency order below**. Do not build the whole ERP in one uncontrolled pass.

The six-page owner-facing workflow document is a visual explanation of major workflows. This document covers the **entire software**, including backend rules, inventory, security, barcode behavior, tailoring, production, genealogy, history, and reporting.

---

# 1. NON-NEGOTIABLE CODEX RULES

1. **Inspect before changing.** Review the existing repository, database/schema, migrations, routes, auth, roles, inventory logic, existing screens, seed data, and barcode logic.
2. **Reuse correct existing functionality.** Do not rewrite working functionality unnecessarily.
3. **Do not invent business rules.** If a requirement is not defined, use the least-assumptive technical implementation. Ask only when the missing decision materially changes business behavior.
4. **Implement sequentially.** Do not jump to later phases.
5. **Test every phase before proceeding.**
6. **Do not rely on frontend hiding for security.** Protected fields must be protected at the backend/database authorization layer.
7. **Use ledger/history-based inventory.** Do not rely only on destructive quantity overwrites.
8. **Do not introduce separate CP/SP barcodes.**
9. **Do not introduce automatic wastage.** Wastage is only recorded when an actual business event requires it.
10. **Do not change approved terminology without a reason.**

At the end of every phase, report what was implemented, modified, reused, tested, remaining, and what the next phase is.

---

# 2. BUSINESS TERMINOLOGY

- Godown → **Workshop**
- Shop → **Showroom**
- Floors/subareas → **Showroom Locations / Sublocations**
- Counter/POS → **Counter**
- Tailoring Factory → **Tailoring Factory**
- Factory subsection → **Tailoring Section**
- Tailor person → **Tailor**
- Thaan/Than → **Than**
- Fabric stock → **Fabric Stock**
- Cost/Lagat → **CP / Lagat**
- Selling Price → **SP / Selling Price**
- Customer tailoring → **Customer Tailoring**
- Customer tailoring order → **Customer Tailoring Job**
- Owner-made products → **Owner Production**
- Production order → **Production Job**
- Ready garment/outfit → **Finished Product**
- Buttons/thread/padding → **Consumables**
- Fabric barcode → **Fabric Barcode**
- Finished-product barcode → **Product Barcode**
- Movement between locations → **Stock Transfer**
- Material given to tailor → **Material Issue**
- Production-specific issue → **Production Materials Issued**
- Customer-job issue → **Issue Material to Job / Job Material**

---

# 3. BUSINESS STRUCTURE

## Workshop

There is one central Workshop. It is the central raw-stock point and receives completed Finished Products before they move to the Showroom.

## Showroom

There is one Showroom with dynamically configurable sublocations/floors such as Floor 1, Floor 2, Floor 3. Do not hard-code the number of floors.

## Tailoring Factories

Factories are dynamic. The Owner can create, rename, disable, and manage them and assign Tailors.

Example:

```text
Factory A
  ├── T-001 Ali
  └── T-002 Khaja

Factory B
  └── T-003 Imran
```

## Tailoring Sections

The actual software structure is:

```text
Tailoring Factory
    ↓
Tailoring Section
    ↓
Tailor
```

Tailoring Sections are part of the software even though they were intentionally omitted from the owner-facing six-page visual document.

---

# 4. CORE ROLES

## OWNER

Full access, including:

- CP/Lagat
- SP
- Complete Production Cost
- all stock
- stock by location
- Customer Tailoring
- Owner Production
- Finished Products
- factories/sections/tailors
- tailoring charges
- designs/design charges
- consumables
- material movement
- stock movement
- order history
- CP + SP in order history
- user/access management

## STOCK_ENTRY

Primarily enters new raw fabric stock:

- Fabric
- Batch
- Thans
- Than lengths
- CP/Lagat

Stock Entry can enter and edit CP/Lagat only within the active stock-entry workflow (while creating/correcting a stock record). Stock Entry does not have ongoing CP view, CP history, or CP reporting access once stock entry is complete, and does not control SP.

## COUNTER

Can:

- scan Fabric Barcodes
- perform Direct Fabric Sale
- create/select customers
- create/select Customer Tailoring Jobs
- select Factory → Section → Tailor
- issue material to jobs
- see SP for direct sales
- see only final customer price for Customer Tailoring
- scan Product Barcodes
- see Finished Product SP
- see availability/counts

Counter must not see:

- CP/Lagat
- Complete Production Cost
- internal cost breakdown
- other Owner-only financial information

## TAILOR

Can see/work on assigned Customer Tailoring and Owner Production Jobs and receive required materials.

Tailor must not see CP/Lagat or internal production cost.

Do not automatically create a separate login role called Factory merely because factories are business entities.

---

# 5. PRICING RULES

## CP / Lagat

Internal cost of fabric.

Entered when fabric enters Workshop.

Owner-only.

Never exposed to customer, Counter, Tailor, or unauthorized staff.

## SP / Selling Price

Customer-facing selling price.

Controlled by Owner.

SP may be empty when Stock Entry first creates the stock.

Owner can later scan the same Fabric Barcode and set/update SP.

Changing SP does **not** require a new barcode.

---

# 6. ONE FABRIC BARCODE

This is a confirmed requirement.

## Rule

Use **one barcode per Fabric + Batch stock identity**, not separate CP and SP barcodes.

Example:

```text
FAB-000184
```

The barcode is only an identifier. It does not need to encode CP, SP, quantity, or all stock details.

## Stock Entry

```text
Enter Fabric
→ Enter Batch
→ Enter Thans
→ Enter Length
→ Enter CP/Lagat
→ Generate Fabric ID
→ Generate Fabric Barcode
→ Print
→ Paste on stock
```

SP can be added later by Owner.

## Owner scans

Owner can see/edit permitted owner data, including:

- Fabric
- Batch
- quantity
- CP/Lagat
- SP
- location
- history

## Staff scans

Counter/staff using the same barcode sees only authorized information, such as:

- Fabric
- Batch
- available quantity
- SP

CP must not be accessible.

## Security

Do not merely hide CP in the UI.

Backend/database authorization must prevent unauthorized roles from retrieving CP.

The same rule applies to Complete Production Cost and other protected financial data.

---

# 7. RAW FABRIC STOCK

When fabric enters Workshop, record:

- Fabric Name / Fabric ID
- Batch
- Number of Thans
- Length per Than where applicable
- Total Length
- CP/Lagat per meter
- Fabric Barcode

Individual Than rows may be maintained internally because Than lengths can differ.

Business-facing rule remains:

> One Fabric Barcode identifies the Fabric + Batch stock record.

Do not revert to a workflow where every Than has a separate barcode.

---

# 8. INVENTORY / STOCK MOVEMENT

Workshop is central.

Example:

```text
Workshop = 100m

Transfer 30m

Workshop = 70m
Showroom = 30m
```

Then:

```text
Sell 4m from Showroom

Workshop = 70m
Showroom = 26m
Total = 96m
```

Every movement must be traceable with, where applicable:

- item
- quantity
- unit
- source
- destination
- movement type
- reason/reference
- related order/job
- user
- timestamp

Possible movement types:

- INWARD
- SALE
- TRANSFER
- MATERIAL_ISSUE
- PRODUCTION
- TAILORING
- WASTAGE
- ADJUSTMENT

Do not automatically create WASTAGE.

---

# 9. DIRECT FABRIC SALE

Flow:

```text
Customer wants fabric
→ Counter scans Fabric Barcode
→ Select Direct Fabric Sale
→ Retrieve current SP
→ Counter sees SP
→ Customer pays
→ Deduct sold quantity from correct stock/location
→ Create Order
→ Record Sale
```

Direct Fabric Sale uses **SP**.

Counter never sees CP.

Owner can see CP and SP in order history.

---

# 10. CUSTOMER TAILORING

Customer Tailoring is separate from Direct Fabric Sale and separate from Owner Production.

Flow:

```text
Scan Fabric Barcode
→ Select Customer Tailoring
→ Select/Create Customer
→ Customer WhatsApp Number
→ Create/Select Customer Tailoring Job
→ Select Tailoring Factory
→ Select Tailoring Section
→ Select Tailor
→ Enter Required Fabric Quantity
→ Select Applicable Tailoring Charge
→ Calculate Final Customer Price
→ Issue Material to Job
→ Tailoring Begins
→ Record Order / Generate Bill
```

## Pricing

Confirmed formula:

```text
Fabric CP/Lagat
+
Applicable Tailoring Charge
=
Final Customer Price
```

Customer Tailoring does **not** use fabric SP.

Counter sees only the final customer price.

Customer never sees CP/Lagat.

Do not invent a more specific Tailoring Charge formula until defined by the Owner.

---

# 11. CUSTOMER TAILORING MATERIAL ISSUES

Use:

**Issue Material to Job**

not a hard-coded “Issue Fabric to Job” workflow.

Track, where applicable:

- material
- quantity
- unit
- Customer Tailoring Job
- customer
- factory
- section
- tailor
- source location
- issued by
- date/time

## Additional Material

Do not assume automatic wastage.

Normal workflow issues the required quantity.

If additional material is genuinely required, Counter can make an explicit:

**Additional Material Issue**

against the same job.

---

# 12. TAILORING CHARGES

Owner controls Tailoring Charges.

Charges must be configurable.

Do not hard-code example values such as ₹800 or ₹1,000.

---

# 13. FACTORY / SECTION / TAILOR MANAGEMENT

Owner can manage:

```text
Factory
→ Sections
→ Tailors
```

Tailor should support:

- Tailor ID
- real name
- factory assignment
- section assignment where applicable
- active/disabled state

When Counter selects a Factory, only its relevant Sections/Tailors should be shown.

---

# 14. CONSUMABLES

Track:

- Buttons
- Thread
- Padding
- Other Materials

Materials can be received/stored and issued.

Material Issues must be traceable to:

- Tailor
- Customer Tailoring Job OR Production Job
- quantity
- material
- factory
- section
- issued by
- date/time
- source location where applicable

---

# 15. OWNER PRODUCTION

Owner Production is completely separate from Customer Tailoring.

There is no customer.

It is for showroom/showcase/internal manufacturing.

A Production Job can create one or many identical products.

Example:

```text
Production Job PJ-00045
Product: Kurta Pajama
Design: Design X
Quantity: 10
```

Different design = different Production Job even if the base product is the same.

## Production Job

Contains:

- Product
- Design
- Quantity
- Fabric
- required Fabric Quantity
- Other Materials
- Tailoring Factory
- Tailoring Section
- Tailor

Flow:

```text
Owner
→ Create Production Job
→ Product
→ Design
→ Quantity
→ Fabric
→ Materials
→ Factory
→ Section
→ Tailor
→ Production Materials Issued
→ Production
→ Finished Products
→ Return to Workshop
```

Finished Products return to Workshop first. They do not go directly from factory to Showroom.

---

# 16. DESIGN / EMBROIDERY CHARGES

Design is selected from a configurable list.

A Design can have an associated Design/Embroidery Charge.

Example values such as ₹300, ₹500, ₹600, ₹800 are illustrative only.

Owner must be able to configure the charge.

The charge must be included in Complete Production Cost.

---

# 17. FINISHED PRODUCTS + PRODUCT BARCODE

Every individual Finished Product gets a unique Product Barcode.

For a Production Job of 10 identical pieces:

```text
PJ-00045

KP-PJ45-01
KP-PJ45-02
...
KP-PJ45-10
```

All belong to the same Production Job, but each physical piece has its own Product Barcode.

The Product Barcode identifies the product; it does not need to literally encode all genealogy/cost data.

Scanning it must retrieve/link:

- Product
- Production Job
- piece number
- Design
- Fabric
- fabric quantity used
- other materials
- Factory
- Section
- Tailor
- production history
- Complete Production Cost
- SP
- current location
- status

---

# 18. PRODUCTION GENEALOGY

Finished Product scan should provide the Owner with the complete chain:

```text
Product Barcode
→ Finished Product
→ Production Job
→ Design
→ Fabric
→ Fabric Quantity
→ Materials
→ Factory
→ Section
→ Tailor
→ Production History
→ Production Cost
→ SP
→ Current Location
```

Non-owner roles see only permitted fields.

---

# 19. COMPLETE PRODUCTION COST

Owner must be able to determine/record Complete Production Cost:

```text
Fabric
+
Tailoring / Production Cost
+
Design / Embroidery Charge
+
Buttons
+
Thread
+
Padding
+
Other Consumables
+
Other Applicable Production Costs
=
Complete Production Cost
```

For bulk production:

```text
Total Production Cost
÷
Production Quantity
=
Cost Per Finished Product
```

Example only:

```text
₹20,000 ÷ 10 = ₹2,000/piece
```

Owner sees complete cost.

Counter, Tailor, and Customer do not.

---

# 20. FINISHED PRODUCT SP

After reviewing production cost, Owner sets/updates Finished Product SP.

Counter can see SP.

Counter cannot see:

- Complete Production Cost
- internal production-cost breakdown
- CP where applicable

---

# 21. FINISHED PRODUCT INVENTORY

Finished Products return:

```text
Tailor
→ Factory
→ Workshop
```

Then:

```text
Workshop
→ Showroom
→ Showroom Sublocation
```

Location must be tracked.

---

# 22. COUNTER — FINISHED PRODUCT VIEW

Counter scans Product Barcode.

Show:

- Product
- Product Barcode
- SP
- availability
- location
- number of identical Finished Products available

Example:

```text
SP: ₹3,500

Showroom: 3
Workshop: 7
Total: 10
```

Do not expose Complete Production Cost or internal costing.

---

# 23. ORDER HISTORY

Owner order history should preserve:

- order
- customer
- item
- quantity
- CP/Lagat where applicable
- SP
- final customer price
- relevant charges
- date/time
- user
- location
- reference

Non-owner users see only authorized fields.

Confirmed rule:

> Only Owner can see CP and SP together in order history when CP is an internal cost.

---

# 24. AUDIT / TRACEABILITY

Important actions must preserve history:

- CP creation/change
- SP creation/change
- stock adjustment
- stock transfer
- material issue
- production completion
- production-cost change
- user/role change
- barcode creation
- order creation/cancellation
- location change

Audit should capture, where applicable:

```text
Who
What
When
Record
Previous Value
New Value
Reference
```

Do not silently overwrite important financial or inventory history.

---

# 25. OWNER REPORTING / CONTROL

Eventually provide:

- Workshop stock
- Showroom stock
- stock by location
- Fabric stock
- batches
- Than quantities
- CP/Lagat
- SP
- direct fabric sales
- Customer Tailoring Jobs
- factories
- sections
- tailors
- Tailoring Charges
- consumables
- Material Issues
- Owner Production Jobs
- Finished Products
- Complete Production Cost
- Finished Product SP
- Stock Transfers
- stock movement history
- material movement history
- order history
- tailor usage
- production history

Build reports after the underlying transactions are reliable.

---

# 26. MANDATORY IMPLEMENTATION SEQUENCE

## PHASE 0 — Existing Codebase Audit + Freeze

Inspect:

- repository
- schema
- migrations
- routes
- authentication
- roles
- inventory
- current screens
- barcode functionality
- seed/test data

Classify existing functionality:

```text
ALREADY CORRECT
NEEDS MODIFICATION
MISSING
CONFLICTING
DEPRECATED
```

Do not rewrite correct functionality.

---

## PHASE 1 — Database / Domain Model

Establish or verify the model for:

- users
- roles
- locations
- showroom sublocations
- factories
- sections
- tailors
- fabrics
- batches
- thans
- fabric stock
- CP
- SP
- fabric barcodes
- consumables
- customers
- Customer Tailoring Jobs
- Tailoring Charges
- designs
- design charges
- Production Jobs
- Finished Products
- Product Barcodes
- Material Issues
- Stock Transfers
- Stock Movements
- Orders
- Order Items
- Production Costs
- Production Genealogy
- Audit Records

Do not proceed until relationships are sound.

---

## PHASE 2 — Authentication + Authorization

Implement and test:

- Owner
- Stock Entry
- Counter
- Tailor

Verify protected fields at backend/database level.

Minimum security tests:

```text
Owner → CP visible
Counter → CP inaccessible
Tailor → CP inaccessible
Stock Entry → can enter and edit CP within the stock-entry workflow
Stock Entry → cannot access CP management/history/reporting outside the stock-entry workflow
Owner → Complete Production Cost visible
Counter → Complete Production Cost inaccessible
```

---

## PHASE 3 — Locations + Inventory Ledger

Implement:

- Workshop
- Showroom
- dynamic Showroom Locations
- movement ledger
- transfer logic
- stock balance calculation
- history

---

## PHASE 4 — Fabric Stock Entry + One Barcode

Implement:

- Fabric
- Batch
- Thans
- quantities
- CP
- Fabric ID
- one Fabric Barcode
- barcode generation
- printable label
- barcode scanning
- Owner SP update

Verify:

```text
Stock Entry creates barcode.
Owner scans it.
Owner sets SP.
Counter scans same barcode.
Counter sees SP.
Counter cannot retrieve CP.
```

---

## PHASE 5 — Workshop ↔ Showroom Transfer

Implement:

- source
- destination
- quantity
- transfer
- movement history
- resulting balances

---

## PHASE 6 — Direct Fabric Sale

Implement:

- Counter scan
- Direct Fabric Sale
- SP retrieval
- customer sale
- quantity deduction
- Order
- Order History
- Owner-only CP visibility

---

## PHASE 7 — Customer + Customer Tailoring

Implement:

- customer creation/selection
- WhatsApp number
- Customer Tailoring Job
- Factory
- Section
- Tailor
- required quantity
- applicable Tailoring Charge
- CP + Tailoring Charge pricing
- final customer price
- job status
- bill/order

Verify SP is not used for Customer Tailoring pricing.

---

## PHASE 8 — Consumables + Material Issues

Implement:

- consumable inventory
- buttons
- thread
- padding
- other materials
- Material Issue
- job linkage
- tailor linkage
- factory/section linkage
- history

Do not implement automatic wastage.

---

## PHASE 9 — Factory / Section / Tailor Management

Implement dynamic:

```text
Factory
→ Section
→ Tailor
```

assignment and filtering.

---

## PHASE 10 — Owner Production

Implement:

- Production Job
- Product
- Design
- Quantity
- Fabric
- Materials
- Factory
- Section
- Tailor
- Production Materials Issued
- production status
- completion

Keep separate from Customer Tailoring.

---

## PHASE 11 — Finished Products + Product Barcodes

Implement:

- individual Finished Product records
- unique Product Barcode per physical piece
- Production Job relationship
- genealogy
- location
- status

Bulk test:

```text
1 Production Job
10 Finished Products
10 unique Product Barcodes
```

---

## PHASE 12 — Production Costing

Implement:

- fabric cost
- production/tailoring cost
- design/embroidery
- buttons
- thread
- padding
- other materials
- other applicable costs
- total cost
- per-piece cost

Then Owner sets Finished Product SP.

Verify Design/Embroidery Charge is included.

---

## PHASE 13 — Finished Product Inventory + Transfer

Implement:

```text
Finished Product
→ Workshop
→ Showroom
→ Sublocation
```

with movement history.

---

## PHASE 14 — Finished Product Counter + Sales

Implement:

- Product Barcode scan
- SP
- availability
- location counts
- identical product count
- sale
- order history
- Owner-only internal-cost visibility

---

## PHASE 15 — Reporting + Audit + Owner Controls

Implement reporting/history only after transactions are correct.

---

## PHASE 16 — UI / UX / Performance / Final Polish

Refine:

- dashboard
- navigation
- tables
- forms
- filters
- search
- barcode scanner UX
- print UX
- responsive layouts
- loading states
- empty states
- validation
- error states
- notifications
- performance

Do not let UI polish interrupt core business logic.

---

# 27. TESTING STRATEGY

Every phase must be tested before moving on.

## Fabric test

```text
Create Fabric
→ Batch
→ 10 Thans × 10m
→ 100m
→ CP ₹500
→ Barcode generated
→ Owner sets SP ₹850
→ Counter scans
→ SP visible
→ CP inaccessible
```

## Transfer test

```text
100m Workshop
→ transfer 30m
→ Workshop 70m
→ Showroom 30m
```

## Direct sale test

```text
Showroom 30m
→ sell 4m
→ Showroom 26m
→ Order created
→ Owner sees CP + SP
→ Counter cannot access CP
```

## Customer Tailoring test

Verify:

```text
Fabric CP/Lagat
+
Applicable Tailoring Charge
=
Final Customer Price
```

and verify Counter sees only the final price.

## Production test

```text
Production Job quantity = 10
→ 10 Finished Products
→ 10 unique Product Barcodes
→ all linked to the same Production Job
```

## Costing test

Verify:

```text
Total Production Cost ÷ Production Quantity
=
Per-piece cost
```

and verify Design/Embroidery Charge is included.

## Permission test

For every protected field:

```text
Owner → visible
Counter → inaccessible
Tailor → inaccessible
Stock Entry → only where authorized
```

---

# 28. BARCODE TECHNICAL DIRECTION

Use a free/open barcode format/library where practical, such as Code 128.

No paid barcode SaaS/API is required.

Fabric barcode example:

```text
FAB-000184
```

The barcode remains stable when SP changes.

Finished Product barcodes use stable unique product identifiers.

Exact visual barcode format is an implementation detail.

---

# 29. DATA INTEGRITY

Prevent, unless an explicit controlled workflow allows it:

- negative stock
- transfer greater than available stock
- sale greater than available stock
- duplicate Fabric Barcode
- duplicate Product Barcode
- Finished Product without required Production Job genealogy
- unauthorized CP access
- unauthorized production-cost access

Use database constraints and transactions where appropriate.

---

# 30. CODEX EXECUTION LOOP

For every phase:

```text
1. READ THIS DOCUMENT
2. INSPECT CURRENT CODE
3. MAP EXISTING IMPLEMENTATION
4. IDENTIFY DEPENDENCIES
5. IMPLEMENT CURRENT PHASE
6. RUN MIGRATIONS / BUILD
7. RUN TESTS
8. VERIFY BUSINESS RULES
9. VERIFY ROLE SECURITY
10. CHECK REGRESSIONS
11. REPORT RESULTS
12. STOP AT PHASE BOUNDARY
```

Do not silently implement future phases.

If a later dependency is structurally required, implement only the minimum required dependency and report it.

---

# 31. CODEX REPORT FORMAT

After every phase:

```text
PHASE:
STATUS:

IMPLEMENTED:
- ...

MODIFIED:
- ...

REUSED:
- ...

DATABASE CHANGES:
- ...

SECURITY / PERMISSIONS:
- ...

TESTS:
- ...

BUILD:
- ...

BUSINESS RULES VERIFIED:
- ...

REMAINING:
- ...

NEXT PHASE:
- ...
```

---

# 32. FINAL SYSTEM PRINCIPLES

The completed ERP must preserve these principles:

1. **One Fabric Barcode with role-based visibility.**
2. **CP/Lagat is internal and Owner-only.**
3. **SP is Owner-controlled and customer-facing.**
4. **Direct Fabric Sale uses SP.**
5. **Customer Tailoring uses CP/Lagat + applicable Tailoring Charge.**
6. **Owner Production is separate from Customer Tailoring.**
7. **Each Finished Product has a unique Product Barcode.**
8. **Finished Products return to Workshop before Showroom transfer.**
9. **Inventory is traceable through movements.**
10. **Production genealogy is traceable.**
11. **Owner controls internal costs and selling prices.**
12. **Unauthorized roles must not retrieve protected financial data.**
13. **Do not invent business rules.**
14. **Implement in dependency order.**
15. **Do not proceed to the next phase until the current phase is verified.**
16. **The owner-facing PDF is not the complete software specification; this document includes the complete software requirements.**

# 33. OWNER-APPROVED STOCK ENTRY REVISION — 11 OCTOBER 2026

The Owner's later instructions in this conversation supersede Sections 4–7 only
for new Stock Entry registrations as follows. Existing IDs, barcodes and completed
financial/inventory history remain preserved; earlier migration files are not rewritten.

- Authorized Stock Entry staff have a dedicated **Stock Entry** sidebar option.
- Each provider delivery creates a unique batch ID/code. Provider names can repeat;
  select a provider from history or type a new name without reusing the delivery.
- Hierarchy: **Provider / Delivery Batch → Fabric Type → coded physical Than
  variants**. In this revised workflow each suffix entry is one physical Than,
  not a colour grouping containing multiple Thans. Colour is not required.
- Provider prefix is uppercase first letter + last two letters of the first word:
  Raymonds → RDS, Arvind → AND. A new Fabric Type in any batch receives a fresh,
  random, collision-checked numeric code. Current implementation uses eight digits.
- Physical Than suffixes automatically increase a…z, aa, ab… and start with a even
  when only one Than exists. Adding more Thans to an existing Fabric Type retains
  its numeric code and continues suffixes; new batches/types receive new identities.
- Every full physical Than code is its permanent printed/scanned barcode. Each
  Than records its own positive length. Existing shared Fabric + Batch barcodes
  remain valid for their earlier stock; they are not replaced or backfilled.
- CP / Lagat per metre is optional during registration and remains unknown when
  omitted. Authorized Stock Entry can fill missing CP on their own newly registered
  Than by scanning that exact barcode after receipt. This does not authorize ongoing
  CP reporting, reading other staff's costs or overwriting an already recorded CP.
  Owner cost/SP controls and protected historical financial snapshots remain.
- Known physical quantities enter the existing Workshop ledger exactly once;
  Godown in the Owner's sketches refers to the existing central Workshop here.
  Separate Godown/factory locations and two-stage transfer receipts were discussed
  but are not authorized by this Stock Entry change.
- One submission processes at most 500 Thans; further submissions append more.
  This technical request limit is not a small fixed total variant limit.

Implementation uses additive version-controlled migrations and records actual
changes, verification and limits in the permanent Implementation History.

# 34. OWNER-APPROVED WORKSHOP TRANSFER AND COUNTER FABRIC PRICING REVISION

Approved 11 October 2026 after the Owner's handwritten stock-exit diagram and
explicit clarification. These later rules override conflicting earlier transfer
access and fixed Owner fabric-SP requirements for this workflow:

- Authorized Stock Entry staff get a Stock Transfer sidebar. Scan the original
  registered barcode, select all or some metres, and choose an active Showroom
  floor. Submission immediately deducts Workshop stock and adds destination stock.
  There is no receiving receipt, approval or confirmation by Showroom staff.
- Original and separated pieces retain exactly the same barcode. Location ledger
  balances determine how much of that identity is in Workshop or each floor.
  Transfers conserve total stock; selling/consumption reduces it.
- Authorized Stock Entry can transfer available Workshop fabric entered by any
  staff member. Owner retains existing broader ledger controls.
- Counter staff enter a price per metre for each fabric sale. Metres × entered
  price calculate its payable line total, rounded to paise. No fixed Owner SP or
  saved stock price is required or updated by this new sale API.
- Counter users have no assigned floor limitation. A sale explicitly chooses its
  source location and cannot deduct more than that location's available stock.
- Owner manages per-user action overrides (allow, deny, inherit role defaults).
  Transfer, label printing, delayed missing-CP fill and Counter price entry have
  separate controls alongside existing receive/sell permissions. Existing role
  eligibility, Owner-only internal costs/administration and active-staff rules
  remain enforced. Permission overrides do not grant roles or reveal internal CP.
- Historical stock, prices, immutable financial snapshots and migration files are
  preserved. Older sale APIs remain for historical compatibility. Finished Product
  pricing and Customer Tailoring CP/charges are outside this fabric pricing change.

# 35. OWNER-APPROVED SALESPERSON AND CUSTOMER TAILORING TOTAL REVISION

Approved 11 October 2026. These subsequent instructions supersede the earlier
Customer Tailoring CP + charge pricing rule for newly booked Counter orders.

- Add Salesperson as a separate sixth role alongside Owner, Counter / POS,
  E-commerce Manager, Tailor and Stock Entry. Reuse existing profiles, authentication
  and role assignments. A user can hold both Counter and Salesperson roles.
- POS explicitly selects one active Salesperson ID for the entire bill. Its
  credited Salesperson is separate from the authenticated operator in created_by.
  Customer Tailoring carries the same Salesperson into the linked job and order.
- Salesperson can log in to My Work to view only their attributed bills, fabric
  quantities, customer-facing prices and linked stitching progress. Owner can view
  and filter all attributed work. CP/internal costs and administrative access remain
  protected; Salesperson alone cannot sell, transfer, edit jobs or choose other users.
- Direct fabric sales still use the Counter-entered price per metre × metres.
- For Customer Tailoring, Counter enters one final total for the entire fabric
  and stitching order. No CP-derived quote or predefined tailoring charge determines
  this amount. CP is preserved only as an internal snapshot where known; omitted CP
  remains unknown and does not block a manually priced customer order.
- Choose stitching before completing a separate fabric sale. Carry selected fabric,
  quantities, source, customer and Salesperson into one atomic tailoring booking;
  create its job, required material issue and bill while deducting fabric once.
- Historical orders/jobs retain unknown Salesperson attribution. No automatic
  assignments or historical price changes. Existing generated CP + charge pricing
  tables remain unchanged; new manual totals use a separate private snapshot table.
- Finished Product bills also record one selected Salesperson; their existing
  Owner-controlled product SP and production-cost rules remain unchanged.
- Owner can revoke or grant Salesperson work viewing, Salesperson selection and
  final tailoring-total entry through the existing individual permissions controls.

# 36. OWNER-APPROVED PRODUCTION WORKFLOW REVISION

Approved 11 October 2026 after the nine-stage Owner Production comparison and
explicit implementation authorization. These later decisions supersede the earlier
single-Tailor assignment and mandatory adjacent finished-product floor transfer.

- Owner scans an existing fabric Thaan barcode, reviews actual location balances,
  selects its source and explicitly enters the required metres. Creating the
  Production Job and issuing its initial materials are atomic; unallocated metres
  remain at their original stock location. Production quantity is a separate piece
  count, never an automatic fabric multiplier.
- One Product/Design, one Factory/Section and one or multiple selected active Tailors
  share the same Production ID. Do not require assigned piece counts per Tailor or
  invent a lead-Tailor workflow. Every assigned Tailor may view the job; existing
  manage-jobs permission controls status changes.
- Additional fabric/materials are explicitly issued against the same open/in-progress
  Production ID. Completed jobs do not accept more material issues.
- All pieces arrive together. Keep the full Workshop receipt against the job quantity
  and record explicit actual material use separately for each physical piece.
- Generate a separate unique finished-product barcode only when the pieces are
  received into Workshop. The existing fabric barcode remains the source identity;
  Production ID connects the job. Finalized CP and Owner-entered SP attach afterward
  to each individual finished-product record; never rewrite its barcode.
- Owner approved total actual production cost divided by the finished-piece count
  for identical products. Include fabric, additional materials, production/tailoring,
  Design/Embroidery and applicable other costs. Preserve exact paise total with at
  most a one-paise rounding difference between piece allocations. Keep actual
  per-piece material traceability. Reuse the existing complete-cost/SP workflow.
- Authorized Stock Entry/Exit staff scan individual finished-product barcodes and
  transfer available Workshop pieces directly to a selected active Showroom floor.
  Posting immediately updates stock/location/history; no receiving confirmation,
  approval or receipt step. Owner controls a separate finished-transfer permission.
  Existing fabric-transfer permission and financial role restrictions remain.
- Owner product scanning must show planned pieces, actual produced pieces, sold
  pieces and remaining physical stock, with archived pieces distinguished where
  applicable. Counter sees exact product availability and Owner SP without CP.

# 37. OWNER-APPROVED GROUPED SIDEBAR

Approved 11 October 2026. Group navigation into Overview, Stock & Inventory,
Sales & Customers, Production, Commerce, Reports & Tracking and Administration.
Overview stays expanded when the user's role permits Dashboard. Other group headers
are clickable dropdowns: opening one closes the previously open non-Overview group;
clicking an open group collapses it. Apply the same behavior to the mobile drawer.
Show only existing role/permission-authorized options and hide empty groups.
Each child option opens its corresponding existing workflow/tab directly. Keep
same-page drafts and uncertain transaction retry payloads across tab navigation.
This navigation revision does not change database permissions or business rules.

# 38. OWNER-APPROVED LABELS-FIRST STOCK ENTRY

Approved 12 October 2026 through the batch-count/printing images, two-card Stock
Entry description and explicit implementation request. This supersedes entering
measurements before generating registered physical Thaan labels. Earlier approved
revisions remain applicable elsewhere.

- Stock Entry opens Scan Existing Barcode and Create Batch cards. Scanning shows
  details below, with authorized completion of missing data.
- Create Batch captures a unique delivery, supplier/provider selected from history
  or typed, arrival date, remarks, and fabric types with physical Thaan counts.
  Repeated supplier names do not reuse batch IDs.
- Generate one permanent unique barcode per physical Thaan before measurements.
  Retain provider prefix/random fabric number/sequential suffix rules, including
  first `a` and continuation after `z` to `aa`, `ab`.
- Print one fabric type's labels together, then navigate to the next. Print Again
  and reopening batches reuse codes. Appending Thaans continues the group's suffix;
  new fabric groups get new codes.
- Attach labels, then scan to enter actual colour, positive length and optional CP.
  Unknown measurements are NULL, never invented stock. Draft labels have no inventory
  item or movement until measured, then one atomic Workshop inward receipt.
- CP can be entered at measurement or filled later with appropriate permission.
  Owner separately controls label generation, measurement and staff own-registration
  CP viewing. Labels contain no CP. Existing Counter pricing remains.
- Initial generation is bounded to 100 types / 500 Thaans per type / 5,000 total;
  subsequent append operations support more labels. Combine duplicate fabric names
  in initial submission. Exact frozen retries must not duplicate stock.
- Legacy barcode scanning uses the existing safe catalogue. Do not reissue historical
  labels, change historical identities or guess missing opening quantities.

# 39. OWNER-APPROVED OPTIONAL DETAILS BEFORE PRINTING

Approved 12 October 2026 following the finalised workflow/reference comparison and
"do it then" authorization. Extends Section 38: measurements may also be entered
before barcode generation, without making them mandatory for identity creation.

- Clicking a fabric type expands its individual physical Thaan rows. Colour,
  positive actual length and optional CP per metre can be entered independently.
  Unopened/incomplete rows retain blank fields, not invented measurements or costs.
- Generate permanent identities and any entered details atomically. Retain saved
  values when collapsing groups; never silently discard entered rows when reducing
  counts. Preserve all approved barcode formats and fabric-by-fabric printing.
- Scanning retrieves the same exact Thaan with saved values and editable missing
  fields. Independently saving partial colour/length/CP is supported. Existing
  saved values are protected; existing Owner corrections remain separate.
- A pending Thaan becomes available only when both actual colour and positive length
  exist, with one atomic Workshop inward. CP is optional and may remain missing.
  A partial length alone creates no inventory item or movement.
- Existing Owner-managed action permissions, ownership and restricted CP visibility
  apply equally to pre-generation details and subsequent scanner completion.

# 40. OWNER-APPROVED WORKSHOP INVENTORY HIERARCHY

Approved 12 October 2026 through the Inventory/Fabric Stock screenshots and explicit
implementation request. Owner subsequently confirmed pushing to main rather than mail.

- Inventory Fabric Stock lists Workshop stock as Batch → Fabric Type → individual
  Thaan rows, newest-created batch first. Hierarchy remains expanded at all times.
- Upper stock search and barcode scanner filter the same rows while retaining their
  matching batch/type context. Remove the duplicate lower search and section heading.
- Show permitted CP per metre, not fabric SP. Counter sets fabric SP while billing.
  Incomplete only includes missing required names/type/colour/length and missing or
  zero CP. Optional remarks and explicitly available zero balance are not missing fields.
- Rightmost Barcode opens the existing exact label and permits printing that label
  only. No CP on labels; preserve historical shared labels without guessing new IDs.
- Row name opens a permission-controlled edit popup. Require reason/current version;
  preserve barcode IDs, group membership and all past transactions. Group-name edits
  affect its display name across the group. Original received length stays permanent;
  measured-stock quantity edits append Workshop adjustments, CP edits append versions.
- Owner manages separate CP and Workshop-balance correction actions. Staff retain
  own-registration restrictions and existing edit/receive/CP view/fill rules.
- Pending labels remain unavailable until actual colour/length are recorded. Unlocated
  legacy stock is explicitly unresolved; never invent its Workshop location or opening.

# 41. OWNER-APPROVED STAFF PERMISSIONS POPUP

Approved 13 October 2026 after the Owner reviewed the role-checkbox table and
separate individual-permissions panel.

- Keep staff role assignments in the Staff table, labelled Assigned roles.
- Open personal action overrides from that staff row's Actions → Manage permissions.
- Remove the separate lower permissions panel and second staff-selection dropdown.
- Show the selected name, email and assigned roles; group actions by module and
  provide search. Explain Use role default, Allow and Deny in plain language.
- Changes save immediately using the existing Owner permission API. Preserve role
  eligibility, protected-data restrictions, Owner control and last-Owner safeguards.
- No changes to database permissions, RLS, schema, or existing role defaults.

# 42. OWNER-APPROVED CROSS-REGISTRANT THAAN ACCESS

Approved 13 October 2026 after diagnosing the Stock Entry account's inability to
edit an Owner-created draft. This revises the own-registration restriction only
when the Owner explicitly grants the following independent actions:

- Edit Thaans registered by other staff: permit Inventory detail editing and scanner
  completion for another registrant's Workshop Thaans, including Owner registrations.
- View CP on Thaans registered by other staff: expose only their fabric CP in these
  authorised inventory/scanner workflows; no production costs or general cost access.
- Change CP on Thaans registered by other staff: require the editing and CP-viewing
  grants as well. Use audited corrections; preserve prior CP versions.

No new permission is granted to staff by default. Existing Receive stock, Edit thaan,
measurement and Workshop-balance correction requirements still apply. Preserve every
creator ID, barcode, original measured length, business relationship and historical
transaction. Unknown values remain blank until actual measurements are supplied.

The Owner permission popup must show database-enforced defaults/current access and
explicit role restrictions. Owner-only actions cannot offer an ineffective Allow
selection. Keep existing ineffective overrides as history rather than silently
rewriting them. The expandable role table is labelled Stored role defaults because
raw catalogue grants alone do not represent effective database access.

# 43. OWNER-APPROVED RESPONSIVE INVENTORY NAVIGATION

Approved 13 October 2026 from the Inventory screenshot:

- Fabric Stock uses its existing lower Workshop search/scanner only. Remove the
  duplicate input beside Incomplete only.
- Inventory sections retain their existing IDs, routing and role visibility. Show
  complete, spaced labels; wrap into desktop rows and a two-column mobile layout.
  Avoid clipped tab labels and horizontal/vertical scrollbars in the section selector.
- Keep Incomplete only separate from the navigation. Legacy/internal and archived
  Thaan views retain their own search because they do not contain the Workshop scanner.
- No changes to inventory data, permissions, barcode identity or database schema.

# 44. OWNER-APPROVED MODULE ACCESS — CREATOR IS AUDIT METADATA

Approved 13 October 2026. This supersedes the creator-based stock rules in Sections
33, 38–40 and the additional cross-registrant controls in Section 42:

- Work records belong to authorised modules/actions, not to their original creator.
  Stock Entry users can view and work with stock registered by the Owner or other
  stock employees. E-commerce users can view and update authorised Owner-created
  listings/orders. Owner has all workflows and administration without extra roles.
- Fabric CP visibility uses the stock fabric-CP permission across all registrants.
  Missing CP entry, measurement, metadata editing, completed CP correction and Workshop
  balance correction remain independently controlled actions. Existing explicit denies
  still apply. POS/E-commerce/Tailor/Salesperson do not receive stock CP.
- Retire the three creator-specific grant controls from the UI; preserve their metadata
  and historical override rows. They no longer control stock visibility or editing.
- Module eligibility applies to action grants. Stock/Counter users cannot gain listing
  management without the E-commerce role. POS users cannot browse/manage E-commerce
  online orders simply because they can sell at the counter. Multiple assigned roles
  give the union of their authorised workflows.
- Preserve creator IDs, request actor attribution, audit records and immutable history.
  Actor-bound idempotency receipts remain bound to the original caller. Tailor job
  assignments and Salesperson attribution remain because they define assigned work,
  not record creation ownership. No global sharing of private administrative data.
- POS and E-commerce retain stock-availability projections necessary for sales/listing
  work; these do not grant stock editing or internal CP access.

# 45. OWNER-APPROVED MULTIPLE-THAAN SCANNING AND TRANSFER UI

Approved 13 October 2026 from the four Stock Entry/Inventory/Transfer screenshots:

- Place the global Incomplete only filter on the right of the newest visible batch
  header. Keep it accessible when no rows match. Zero/missing CP remains incomplete.
- Stock Entry scans accumulate distinct physical Thaan rows. Select one, some or all
  rows and enter individual colour, measurement and authorised CP details. Unknown
  values remain blank; duplicate scans must not replace drafts or duplicate identities.
- Stock Transfer scans accumulate compact rows showing the existing barcode, source
  availability, metres to send and destination. Reprint selected existing barcode
  identities; split pieces keep the same original barcode.
- Post transfers immediately using existing stock authority. Each destination is a
  separate atomic document; each edited Thaan is a separate audited save. Show completed
  results and retain exact request IDs/payloads for uncertain-response retries.
- Remove the duplicate Finished Product Transfers selector from the fabric transfer
  page. Finished Product Stock remains reachable through its permitted sidebar link.
- Preserve module/action permissions, original quantities and historical movements.
  No receipt approval, invented measurements/prices, database schema changes or new roles.

# 46. OWNER-APPROVED DAILY DASHBOARD WORKSPACE

Approved 13 October 2026. Attached images explain behaviour, not visual styling.
Use the existing ERP visual language and responsive layout.

- A selected India date defaults to today. Four fixed clickable KPIs: paid fabric
  plus finished-product collections, fabric sales, finished-product sales and
  Customer Tailoring bookings separately.
- Always show quick actions, refresh/last-update state and current recorded alerts.
- Sales Trend, Sales Breakdown, Inventory and Production have meaningful independent
  view selectors. Tailoring workload stays separate from Owner Production.
- Recent Activity uses tabs for bills, tailoring, stock movements and reviews.
- Current stock/workload/control checks do not become historical snapshots when
  selecting another day. Paid sales use recorded completion dates; bookings use
  creation dates. Material issues and current recorded piece allocations are distinct.
- Unsupported payment-method/category, due-date, low-stock and shortage views must
  remain unavailable until actual source data/definitions exist. Do not invent them.

# 47. OWNER-APPROVED REPORTS & ANALYTICS WORKSPACE

Approved 13 October 2026; implement after Dashboard validation.

- Organise all 24 existing Owner datasets into seven categories: Sales & Payments,
  Stock & Inventory, Production & Costs, Orders & Tailoring, Finished Products,
  Transfers & Locations, Audit & Reconciliation.
- Select a report and display only supported relevant filters, report-specific
  summaries and complete underlying evidence, with search, sorting and pagination.
- Date ranges apply to recorded activity. Disable historical-date controls for
  current-state datasets. Show the applied period independently of draft filters.
- Paid sales, bookings, unknown costs and legacy evidence remain distinct. Never
  infer cost/margin from missing evidence. No salary/P2P/advance/deduction reporting.

# 48. OWNER-APPROVED IMMUTABLE AUDIT EVIDENCE WORKSPACE

Approved 13 October 2026; implement after Reports validation.

- Audit is a searchable newest-first evidence log, not a sales analytics dashboard.
- Search captured identifiers; filter recorded users, module, action, record type
  and date presets/custom ranges. Open an event for actor, timestamp, reference,
  recorded reason and captured before/after values.
- Missing evidence says Not recorded. Generic row updates remain updates, rather
  than reconstructed completion/cancellation events. Keep unmapped events visible.
- Read-only Owner UI; retain existing Owner-protected RPCs and immutable database
  audit protections. No event edits/deletes, salary/P2P or invented suspicious scores.

# 49. OWNER-APPROVED VISUAL REFERENCE REFINEMENT

Approved 13 October 2026 from three visual interface samples. These references guide
layout, hierarchy, spacing and presentation; sample figures, growth rates, alerts
and unsupported controls do not create new business rules or recorded data.

- Dashboard uses Business Overview heading, four clearer KPI cards, date navigation,
  actual-data column/doughnut charts, compact operational cards and a right-hand
  alerts/quick-actions rail. Keep the single-day scope and bookings/collections split.
- Reports keeps all 24 datasets/seven categories. Desktop has icon category navigation
  and a report sidebar; mobile retains the report selector. Definitions/limitations
  remain accessible without dominating the working area.
- Audit has a protected-history banner, supported event counts, a desktop evidence
  table, mobile event rows, module/action tags and a right-hand evidence drawer.
- Monetary audit summaries count actual captured differing monetary fields; categories
  can overlap. They do not reconstruct missing prior values or infer suspiciousness.
- Never copy illustrative growth percentages, notifications, stock snapshots,
  customer counts or unsupported alerts. Preserve Owner-only access and immutable
  history. No database change is required for this visual revision.

# 50. OWNER-APPROVED THAAN ENTRY TREE AND OPTIONAL DETAILS

Approved 13 October 2026.

- Create Batch shows an always-open Batch/provider → Fabric Type → individual
  Thaan hierarchy with indentation and connecting lines, on desktop and mobile.
- Each fabric has optional shared length in metres and CP per metre in rupees.
  Untouched/new rows inherit them; individual rows can override them. Apply to all
  explicitly replaces supplied fields for that fabric only; blank defaults do not
  erase saved input. Barcode identities and per-fabric printing remain unchanged.
- Colour is optional. Positive length receives real Workshop stock even without
  colour. Completeness requires positive length and CP, plus identifying names;
  zero/missing CP remains incomplete. CP is still per metre, not total Thaan cost.
- Correction reason is optional. Audit stores missing user reason as null; a
  required quantity-movement description explicitly states when no user reason
  was recorded. Keep correction permissions and immutable original quantities.
- No automatic historical receipt backfill. Prior saved measurement drafts show
  Awaiting stock activation until an authorized save receives their recorded length.
- New forward-only migration 20261013000200_thaan_optional_colour_reason.sql,
  mirrored as Drizzle 0039. Preserve all existing business rows and role boundaries.

# 51. OWNER-AUTHORIZED ONE-OFF TEST STOCK RESET

Approved 14 October 2026: the Owner explicitly confirmed all existing stock and
linked sales, tailoring jobs and online orders were test data and requested removal.

- Clear test stock identities, batches, costs/prices, balances, movements, holds,
  stock/listing links and dependent test transaction/request records atomically.
- Preserve login accounts, profiles, roles, permissions, customers, suppliers,
  locations and catalog definitions. Zero legacy material/listing stock quantities.
- Preserve immutable audit evidence and append an explicit administrative reset
  event. Resolve four legacy job assessments as removed test records; do not
  invent their missing historical domain/assignment.
- Clear 21 old test-fixture provenance rows linked to removed inventory; preserve
  migration execution history, all schema/security definitions and ID sequences.
- Verify a private complete public-row snapshot before reset; rehearse with rollback,
  check preservation inside the transaction and verify empty inventory after commit.
- This is one authorized maintenance operation, not an application deletion feature
  or standing permission to erase future data. No schema migration or UI change.

# 52. APPROVED ROLE WORKSPACES AND PRODUCTION ID RECEIPT

Approved 14 October 2026; supersedes Section 50's length-only stock activation rule.

- Seven roles: Stock Entry, Counter/POS, E-commerce, Salesperson, Tailor, Production,
  Owner. Staff receive the specifically approved workspace menus plus Account.
  Roles combine; Owner retains all workflows and grouped Administration.
- CP belongs to stock workflows across creators. Active stock requires positive
  recorded length AND CP; colour and inventory correction reason remain optional.
- Godown means Workshop. Counter sells only Showroom/floor stock while viewing
  matching fabric variants and Workshop reserve quantities without CP.
- Production issues scanned fabric immediately at the selected Workshop/Showroom
  source. Save product, predefined/custom design, size, count and selected Tailors.
  Generate a stable Production ID document with no printed CP. Custom design is
  per production job; only Owner manages predefined Products & Designs.
- Counter may scan that Production ID and issue additional scanned fabric. Capture
  positive issue-time CP privately for initial and additional issues, atomically.
- All finished pieces return together to Workshop. Production/Tailor marks finished;
  Stock Entry/Owner (or eligible explicit receipt exception) receives the whole batch.
  Divide all recorded issued-fabric CP across the planned pieces with exact paise
  rounding. No inferred consumption, returns, waste, labour or historical CP.
- Stock Entry/Owner sets or corrects finished SP at Workshop before Showroom transfer.
  Print product/design/size/SP/barcode labels. POS uses saved SP. Owner's scan retains
  production identity, count, issue/finish dates, recorded per-piece CP and SP.
- E-commerce and its future separate website see Showroom availability only. POS
  sales change ledger-derived public listing availability. Owner will connect that
  website manually; no storefront deployment is included here.
- Self-signups wait for Owner-assigned work access. Owner can add staff and create
  Tailor accounts directly while retaining the Owner session. Account supports own
  name/email/password; provider email-confirmation and signup policies apply.
- Forward-only migration 20261014000000_role_workspaces.sql / Drizzle 0040.
  Preserve existing business, account and audit rows; no real-data fixtures live.

# 53. APPROVED OWNER DAILY AND MONTHLY BUSINESS ANALYSIS

Approved 14–15 October 2026; supplements Section 52.

- Dashboard: today's India paid Counter + online sales, fabric/product totals,
  separate tailoring bookings, stock registrations/receipts, posted transfers,
  production issues/finished jobs/Workshop receipts, and customer jobs. Current
  stock and ongoing workload remain current, independent of the historical day.
- Reports defaults last completed calendar month versus its prior calendar month.
  Custom ranges compare equal-length preceding periods. Visual daily/channel
  analysis and fabric+vendor/vendor/product/credited Salesperson rankings use
  actual metres, pieces, revenue, bills and recorded margin with full evidence.
- Online self-service Salesperson optional; Counter requires credited Salesperson.
  Future website server posts verified paid orders through service-role-only API;
  one mixed checkout can span multiple Showroom floors and is one canonical bill.
  Exact retry/reference controls, sale-time CP, atomic stock debit and audit.
- No invented payments, historic costs, catalogue snapshots, customers or net profit.
  Salary/P2P remains separate. Current stock is never historical date-filtered.
- Forward 20261014000100_owner_business_analytics.sql / Drizzle 0041 applied with
  all 84 pre-existing public-table row fingerprints preserved. Protected API contract
  and acceptance proofs: docs/OWNER_BUSINESS_ANALYTICS.md and associated JSON files.
- Website/gateway connection, reservations, refunds and shipping remain separate
  future work; no external website deployment is included.

# 54. OWNER MOBILE GLOBAL BARCODE INSPECTOR

Approved 15 October 2026. Owner Dashboard phone-only floating scanner; no staff, tablet/desktop or other-page visibility. Reuse typed/keyboard entry and add camera input. Strict read-only active-Owner backend projection over existing barcode/item, ledger, order, production, material, receipt, cost and audit evidence. Separate current balances from captured history; missing evidence is never reconstructed. Exact numbers and complete paginated events. Forward migration 20261015000100 / Drizzle 0043; preserves every public business/account/audit row. Contract and proofs: docs/OWNER_BARCODE_INSPECTOR.md.

Legacy audit compatibility: forward 20261015000200 / Drizzle 0044 preserves recorded singular entity names, parent document codes and actor names.

# 55. COMPLETED BILLING, MIXED PRODUCTION AND SHARED DEFINITIONS — 15 OCTOBER 2026

Completes the previously pending section-54 workflow work. Inventory now has stock/scan, actual-ledger movements and archive views; duplicate legacy/receiving/configuration links are removed. Transfer notes are optional. Counter selects a Showroom floor first, scans fabric and fixed-SP products into one bill, groups tailoring cuts under one whole-job price, reuses optional customer contacts, requires credited Salesperson and supports paid/unpaid tailoring bills with immutable full-payment collection. Extra fabric adds issue-time CP to the original job and margin without changing its customer amount, as explicitly approved.

Production supports one ID with shared product/design/size defaults and per-piece overrides, one factory and multiple tailors, immediate scanned fabric deduction, whole Workshop receipt, equal issued-CP allocation with exact remainder, saved SP and Showroom transfer. Owner Administration provides shared Factory → Tailor, Products/Designs and Locations/Floors definitions. Operational work no longer repeats setup pages. Salesperson work shows each attributed combined bill once with linked tailoring progress. Owner Reports and the read-only mobile inspector include the new recorded payment, material-cost and specification evidence.

Forward versions 0045–0050 preserve existing business/account/audit rows; applied bytes of 0040/0041/0043/0044 remain unchanged. Verification: 1,836 cumulative database assertions; 27 workflow browser checks plus 31 Owner-dashboard/report and 30 inspector regression checks. TypeScript and scoped lint pass (one pre-existing Fast Refresh warning). See docs/WORKFLOW_WORKSPACES.md and associated proof files for build, rollout, live read-only verification and device acceptance limits. Detailed consumption, partial receipt, salary/P2P and the separate future public website integration remain outside this scope.

Rollout and acceptance completed: forward 0045–0050 applied, all rows in 88 pre-existing public tables preserved; 86 read-only live checks passed over 30 existing barcodes, both posted transfers and all 96 current public tables. No live operational fixtures were posted. Isolated Vercel production build passed; source push is recorded in Git history. Due-today/overdue dashboard alerts now use actual recorded delivery dates. Historical jobs without due dates remain excluded.

Forward 0050 retains the existing Showroom-only authorization on the older finished-sale endpoint and captures actual per-piece design/size. It supersedes that compatibility function without editing previously applied migration bytes.

Live role probes compare all business/audit and account identity/access fields. The normal concurrent profile last_login timestamp is excluded from acceptance fingerprints; atomic migration preservation includes every existing column.

# 56. SHOWROOM FLOOR VISIBILITY AND OWNER DEFINITION DELETE — 15 OCTOBER 2026

Original transfer records identify general Showroom without a floor. The Owner selected Showroom F3; a separate posted transfer assigned the two Velvet Thaans (10 m each) to F3 without changing original history, total stock or CP. Administration now shows general Showroom and floor-level stock counts. Owner-confirmed Delete removes floors/products/designs from future work while retaining historical identity, cost and audit records; stocked floors and canonical roots are protected, with backend role/stale-value/retry checks. Forward 0051 preserves pre-existing rows. See docs/DEFINITION_REMOVAL.md and acceptance proof files.

Completed: 0051 applied with all rows in 96 pre-existing public tables preserved. Verification passed 1,971 cumulative database assertions, 16 browser checks and 88 read-only live checks across 97 current tables. Live acceptance confirms F3 has two Thaans / 20 m and general Showroom has no unassigned Thaans. Normal concurrent profiles.last_login updates are excluded from read-only acceptance fingerprints; migration preservation checks include every column. TypeScript, scoped ESLint and isolated Vercel build passed.

# 57. GENERAL SHOWROOM REMOVED FROM OPERATIONAL LOCATIONS — 15 OCTOBER 2026

Owner requested removal of the general Showroom option after assigning both Velvet Thaans to F3. Forward 0052 hides the internal Showroom parent from current location choices and administration, restricts saleable locations to active floors, and blocks new general-Showroom ledger movements. Defined floors remain usable; finished-piece returns go directly from a floor to Workshop with existing Owner restrictions. Existing parent identities, floor definitions, stock and transaction history remain intact. See docs/SHOWROOM_FLOORS_ONLY.md and verification records.

Completed: 0052 applied with all rows in 97 existing public tables preserved. All 98 read-only live checks passed, including role-filtered location choices, the ledger guard, historical references and current floor totals. Deployment ad546c339b05bba4448ed6482f4d3f09555e7248 is successful and the updated production bundle was verified. Live summary checks use current ledger values so later sales remain reflected. Applied migration SHA256: 71f5d292c0572eef215696abb9d7dbff9da8aff105cfa0ef195b4cea23ea8a06.

# 58. SINGLE COUNTER BARCODE WORKSPACE — 15 OCTOBER 2026

Counter uses POS and Account only. After selecting a physical Showroom floor, one existing barcode field routes items to a new sale, customer bill/job IDs to their recorded tailoring work, and Production IDs to their existing document. Subsequent fabric is issued through the existing permission-checked RPCs against the chosen job and current floor, keeping customer totals unchanged. Multiple customer jobs require selection; unknown/ambiguous identifiers, closed jobs and pending retail/issue states are protected. Owner/Tailor/Production and combined-role workspaces remain available. See docs/COUNTER_UNIFIED_SCAN.md.

# 59. PHYSICAL BARCODE BALANCES, SALESPERSON NAMES AND NUMERIC CONTACT — 15 OCTOBER 2026

POS compact reserves show only the selected Thaan balances, while the existing expanded tree retains every variant. Salesperson names replace visible UUID suffixes while attribution IDs remain unchanged. Optional contact input accepts digits and preserves leading zeros. Forward 0053 prospectively validates new Counter bill contacts without editing existing customer/bill history or breaking exact historical retries. See docs/COUNTER_BARCODE_DETAILS.md and validation proof files.

Completed: 0053 applied with every row in all 97 existing public tables preserved. All 23 read-only live checks passed; sampled physical Thaan totals match the current location ledger. Source df0aaf2ae65f53dde31eb344d21dcac2f974677d is deployed and its published POS bundle verified. Migration SHA256: 43ed5e5bb92a823ed0357f9975f3b79df78a5a7702e8ae9aae0c98875dfaec25. No live stock or customer fixtures were posted.

# 62. POS TERMINALS, MULTI-FLOOR BILLING AND CUSTOMER FINISHING — 17 OCTOBER 2026

This section supersedes the earlier floor-first Counter wording in Sections 55 and 58. Owner manages editable POS terminal codes separately from staff accounts and assigns active terminals to Counter users; Owner accounts do not require a POS code. Current live assignments are `counter@example.com` → `F3-POS1` and `maaz7do@gmail.com` → `F3-POS2`.

One invoice can contain stock from multiple physical Showroom floors. Every sale line records, validates, locks and debits its own source location atomically. The receipt and Owner evidence retain both the item floor and transaction POS code. The internal Showroom parent remains for hierarchy and history but is excluded from operational stock cards and sale sources.

## 63. Central GST configuration and invoice snapshots — 18 October 2026

Owner Administration contains an effective-dated GST configuration with CA-controlled HSN/SAC and rates for purchases, fabric, finished products and tailoring. No rate is seeded or activated by migration. Stock Entry preserves base CP excluding GST while showing purchase GST and supplier totals; Counter sales calculate tax server-side and preserve immutable invoice snapshots for 58/80 mm reprints. Owner reconciliation groups output tax, purchases, ITC and audited adjustments. Internal transfers and production retain base CP without re-taxing movements. A future public e-commerce checkout must reuse the same tax service because this repository currently has listings but no public checkout/payment transaction. Contract: `docs/GST_CONFIGURATION.md`.

Counter records the advance and the remaining balance is calculated. Customer receipts contain prices; a separate tailor work order contains production details and notes without prices. Workshop can scan a customer bill or job, enter the stitched garment's name, size and SP and receive it under a new short barcode. This barcode is for the customer-finished garment only and does not convert purchased fabric into store-owned finished stock.

Forward Supabase migrations `20261016000100`–`20261016000400`, `20261017000100` and `20261017000200`, mirrored by Drizzle `0057`–`0062`, are applied. Dashboard cleanup hides the two legacy-only controls and duplicate lower sales cards while retaining detailed reports. Contract: `docs/POS_TERMINALS_MULTI_FLOOR_AND_CUSTOMER_FINISHING.md`.

# 64. CENTRAL GST INPUT CONTRACT — 19 OCTOBER 2026

Owner GST Configuration is the sole source for business identity, registration state, rates, classifications, overrides and invoice preferences. Do not add duplicate GST defaults to operational modules. Preserve the original four A/B groups: GST-inclusive/exclusive SP; final-price-first/taxable-first invoice display; separate/combined tailoring presentation; separate ITC/non-creditable-cost reporting.

Ordinary Counter billing uses the effective registration state without an intra/inter-state selector or always-visible customer GSTIN/state inputs. **Add GST business invoice details** reveals transaction-specific customer GSTIN; the current service derives its state and tax split against the effective business state. Preserve payment method, customer contact, Salesperson attribution, advance/balance and one multi-floor invoice. These are operational inputs, not business GST setup.

Stock Entry asks **Supplier invoice available?**. No permits receiving without purchase GST/ITC records. Yes reveals optional supplier invoice identity, GSTIN, actual amounts and ITC status for reconciliation. CP remains GST-exclusive. Calculated amounts are estimates, not verified invoice evidence or an automatic filing claim. Current code defaults ITC to pending, but an explicitly chosen eligible/ineligible/reversed status can still fall back to calculated tax when actual GST is absent; further accounting safeguards/acceptance are outstanding. Place-of-supply, required invoice fields, rates/HSN-SAC and ITC treatment require CA confirmation. Floor identifiers alone are not separate state registrations.

Local implementation: `2d8a1a3`. Prepared database change: `20261019000100_gst_operational_input_audit.sql` / Drizzle `0065_gst_operational_input_audit.sql`, revising `gst_snapshot_counter_bill` and `create_barcode_batch_with_gst` without new tables or historical rewrites. Detailed scope and limits: `docs/GST_OPERATIONAL_INPUT_AUDIT.md`, `docs/GST_CONFIGURATION.md`.

# 65. SCANNABLE DOCUMENT IDENTITY CONTRACT — 19 OCTOBER 2026

Internal UUID primary keys, accounting/business references and printed scan identities are distinct. New orders, production jobs and customer tailoring jobs receive unique, immutable, fixed-length 15-character codes: `BL-`, `PJ-` and `TJ-`, each with 12 random characters from `23456789ABCDEFGH`. Collision handling regenerates at the same length under a transaction lock; unique constraints remain the final guard. No global growing sequence is used for these document aliases.

Code 128 is retained. Print the short identity and readable text, preserve the original invoice/job reference, and keep old-code/UUID lookups working. Do not backfill or invalidate old labels. Do not change existing fabric or 12-digit finished-garment codes merely to align their appearance. Stock transfers record movement references and retain the item's barcode.

Barcode identities used by the business are: fabric Thaan; owner production job; each shop finished garment; customer bill; each customer tailoring job; customer-finished garment. Not every purchase passes through all six. Reprinting and moving stock between floors do not generate new item identities.

Local implementation: `e0d4859`. Prepared migration `20261019000200_short_document_scan_codes.sql` / Drizzle `0066_short_document_scan_codes.sql` adds nullable `scan_code` columns, generator/immutability triggers and private alias resolution. Existing authorization remains on operational RPCs. Receipt and production/tailor documents use the short alias when present. Physical printer/scanner acceptance remains required. Contract: `docs/SHORT_DOCUMENT_SCAN_CODES.md`.

# 66. GST SETTINGS PERSISTENCE AND DISPLAY — 19–20 OCTOBER 2026

The four original A/B controls must remain in the Owner editor and load the most recently saved version. Operational tax calculation instead uses the currently effective active configuration, including when an Owner operates POS. A future saved version must be visible to the editor without prematurely affecting transactions. Historical invoice reprints consume their stored preferences and amounts.

Local-time inputs must round-trip without UTC truncation: the prior UTC-to-`datetime-local` conversion backdated India saves by 5½ hours. New edits default to save time; explicit effective dates and existing future schedules are retained. Invoice rendering honors the saved final-first/taxable-first preference and separate/combined customer-tailoring presentation; accounting tax components remain separate in storage.

`1a7f5ef` implements the time/persistence/presentation correction and prepares `20261019000300_gst_configuration_reload.sql` / Drizzle `0067_gst_configuration_reload.sql`. It provides an Owner latest-saved reader and revises `gst_transaction_configuration` to return active effective settings for transaction screens. Existing configuration and invoice history remain immutable.

`b4868ca` supersedes the editor's dependency on that new RPC. `configuration-reader.ts` reads the original configuration/rule tables through existing Owner-only SELECT/RLS policies, verifies the saved version before reporting success and bounds reads to 15 seconds with cancellation/retry errors. The original controls were not removed: a loading failure could prevent the form appearing. This compatibility fix needs no database migration. The separate operational-reader change in 0067 still needs its migration. Tests include all four B choices, India date round-trip, latest-save/effective-date separation, future settings, permission isolation and timeouts. Contract: `docs/GST_CONFIGURATION.md`.

# 67. GST COUNTER TRANSACTION FINALIZATION — 20 OCTOBER 2026

GST calculation must complete before the immutable completed-sale boundary and before payment collection. A paid fabric-only bill must not be routed through a public unpaid-retail operation. The public rule remains: ordinary retail is paid in full; unpaid/advance treatment requires Customer Tailoring. Payment method selection does not change this rule.

`adf2cb1` prepares `20261020000100_gst_paid_retail_bill.sql` / Drizzle `0068_gst_paid_retail_bill.sql`. Private `gst_stage_counter_bill_multi` retains the original role checks, line validation and stock locks, stages a draft, then the GST wrapper calculates tax, completes the bill, captures the correct receipt and collects payment. No staff/anon execute grant exists on staging. Do not disable historical immutability to implement pricing. Failures roll back bill, stock, tax and payment together; exact retries retain one deduction and one payment.

The screenshot case is tested locally: ₹5,000 taxable + ₹250 GST = ₹5,250 collected, zero balance. Card/UPI, unchanged retry, public unpaid rejection, tax-error rollback, mixed retail/tailoring advances and unpaid tailoring also pass. Tests: `scripts/gst-paid-retail-cases.mjs` in the disposable full-chain harness. The migration has not been applied by this chat.

# 68. ONE FINISHED-GARMENT RECEIPT SCANNER — 20 OCTOBER 2026

Finished Products → Receive finished garments must not require a Customer stitching / Shop production mode selection. One scanner accepts a customer bill, customer tailoring job or owner production job. The database classifies exact original codes, UUIDs and short scan aliases; do not infer ownership from a prefix. Show the detected source label and original reference, then open its existing workflow.

- Customer stitching: show linked customer/job/factory/tailor details. Preselect a single job; if a bill contains several jobs, choose the garment that returned. Enter finished name, size and SP before generating its customer-finished barcode. Purchased fabric lines on the same bill are not received as finished store stock.
- Shop production: open the existing whole-batch Workshop receipt, piece SP and label actions. Classification is read-only; receipt keeps its existing scan-to-receive operation and repeat-scan behavior.
- Pending/uncertain child operations block replacing the scan. Failed lookups must not remount/repost the previous receipt. Keep existing piece transfer/history available below. Unknown/ambiguous codes and bills without stitching get explicit errors.

`f03faa9` implements the workspace and child-component integration. Prepared migration `20261020000200_unified_finished_receipt_lookup.sql` / Drizzle `0069_unified_finished_receipt_lookup.sql` introduces `resolve_finished_receipt(text)`. Owner or appropriate receiving/pricing permission is required. Authorized Production receivers can resolve customer jobs through this restricted projection without broadening the legacy tailoring-workspace API; CP/bill totals are excluded. It depends on 0066 columns. Existing mutation services retain their safeguards. Contract: `docs/UNIFIED_FINISHED_RECEIPT.md`.

# 69. VERIFICATION AND RELEASE STATUS — 20 OCTOBER 2026

| Revision | Local commit(s) | Database prerequisite | Production status verified in this work |
| --- | --- | --- | --- |
| GST operational-input cleanup | `2d8a1a3` | 0065 | Not rolled out by this chat; external state unverified |
| Compact document scan identities | `e0d4859` | 0066 | Not rolled out by this chat; external state unverified |
| GST effective-time/operational reader | `1a7f5ef` | 0067 | Not rolled out by this chat; external state unverified |
| GST editor loading compatibility | `b4868ca` | Original GST tables/RLS; no new RPC | Local source verified; hosted acceptance pending |
| Paid retail GST completion | `adf2cb1` | 0068 | Not rolled out by this chat; external state unverified |
| Automatic receipt-source detection | `f03faa9` | 0069, after 0066 | Not rolled out by this chat; external state unverified |

Prepared Supabase files, in order: `20261019000100_gst_operational_input_audit.sql`, `20261019000200_short_document_scan_codes.sql`, `20261019000300_gst_configuration_reload.sql`, `20261020000100_gst_paid_retail_bill.sql`, `20261020000200_unified_finished_receipt_lookup.sql`. Each has a byte-identical Drizzle 0065–0069 mirror and journal entry. Applied historical migration bytes were not rewritten.

Recorded local verification: TypeScript, targeted ESLint and production build; complete disposable PostgreSQL replay; 300 compact generated identities; legacy/short/UUID lookups and permissions; all four GST preference/date/load cases; paid/mixed/unpaid-tailoring/rollback billing cases; customer/production classification, receiving-role permissions and no stock writes during detection. Scripts: `short-document-codes-test.mjs`, `gst-configuration-reload-cases.mjs`, `gst-configuration-reader-test.mjs`, `gst-paid-retail-cases.mjs`, `unified-finished-receipt-cases.mjs`. No physical printer/scanner or authenticated hosted acceptance was performed. A build success does not establish a production deployment.

Next authorized release must first inspect the current deployed source and migration execution records, review pending SQL against the actual database, and preserve already-applied versions. Apply dependency migrations before dependent frontend code; then run authorized read-only rollout verification and hosted acceptance. Do not treat earlier screenshots or Section 63's dated zero-GST-config observation as current database evidence. Do not deploy or change production settings solely to synchronize documentation.

# 70. EXPLICIT OUTSTANDING WORK

- Customer-finished garment barcodes are generated and linked to jobs, but general POS/dedicated finished-customer-item scanning remains unimplemented.
- Owner mobile barcode inspection still needs new short document-alias and direct customer-tailoring-job roots. The unified receiving lookup does not automatically update other scanners.
- CA review of invoice/place-of-supply requirements and actual-versus-estimated supplier tax/ITC evidence remains necessary. Do not label estimates as verified purchase tax.
- Physical 58/80 mm/TSC printer acceptance, scanner compatibility and authenticated hosted desktop/mobile receiving/billing checks remain release tasks.
- Current external deployment/database status and production rollback readiness were not verified during these local revisions. Pending migrations are not marked live.
- The requested broad architecture, authorization, concurrency, backup/Storage recovery and reliability audit is not completed by these feature changes; do not infer its completion from the GST input audit.

These are recorded limits, not authorization for unrelated rewrites, new integrations or removal of reports/audit evidence. Earlier approved business rules continue unless explicitly superseded above.

# 71. GST OPTION PROPAGATION AND NO-INVOICE STOCK ENTRY — 20 OCTOBER 2026

Retain every A/B option. Selling-price mode applies consistently to POS previews and server tax for fabric, finished products and tailoring components. Invoice-display and tailoring-display choices are captured in immutable invoice snapshots and honored by shared screen/thermal rendering. Purchase mode is captured per purchase and exposed with its non-creditable-cost adjustment in reconciliation; internal transfers/production continue to carry base CP without adding tax again.

Item overrides precede category defaults in previews and transactions. Multi-fabric tailoring requires a tax component per fabric cut with the actual fabric reference and component rounding. `gst_invoice_lines.source_cut_ordinal` and cut-aware uniqueness permit those lines while existing snapshots retain their original values. The latest effective disabled version stops tax. A POS preview configuration ID must match the active version when completing a new bill; stale requests fail atomically and refresh before resubmission. Previously completed exact retries/reprints retain their saved data.

No supplier invoice uses `create_barcode_batch_with_details`; invoice submissions explicitly pass `p_purchase` to `create_barcode_batch_with_gst`. Schema-cache rejection releases the form, but uncertain results preserve the idempotency request. The GST function also accepts omitted/null purchase payloads after 0070. Actual supplier fields stay optional; missing actual GST must not create ITC or non-creditable-cost evidence from calculated estimates. This corrects the earlier fallback for future purchases without rewriting past accounting records.

Prepared forward migration `20261020000300_gst_option_consistency.sql` / Drizzle `0070_gst_option_consistency.sql`, after 0065–0069, implements database consistency, purchase ordinal correction and qualified report aggregation. No RLS/permission relaxation is introduced. Tests cover all 16 setting combinations, two fabrics in one tailoring job, overrides, preview/server totals, rendered receipts, distinct purchase Thaan links, ITC/cost reports, historical snapshots and disabled/stale settings. TypeScript, targeted lint, routing/reader tests, full disposable migration replay and production build pass. Production application/deployment, hosted desktop/mobile checks and physical print acceptance remain separate pending release tasks. See History Section 70 and `docs/GST_CONFIGURATION.md`.

# 72. LIVE MIGRATION RELEASE STATUS — 20 OCTOBER 2026

Following explicit authorization, all six pending Supabase migrations corresponding to Drizzle 0065–0070 were applied to the live database in one transaction with execution hashes and native migration records. The actual-schema dry run passed and rolled back before commit. `scripts/gst-pending-rollout.mjs` provides default rollback verification and explicit `--apply`, mirror/hash checks, a release lock, timeouts, historical business-value checksums and post-commit function/permission checks. It must not replay an already-recorded migration with different bytes.

Paid retail GST now uses the corrected private staging path live. Optional stock-purchase payloads, active configuration reads, disabled/stale settings handling, per-cut tax rules, purchase row lookup and GST reports were verified at the database definition/read-only service level. Historical business record checksums were unchanged. This release did not post a sample customer bill or alter business GST settings.

Remote main already contained `e07837e`; the hosted POS route returned 200 and its JavaScript contained the matching GST completion/version/loading guards. No extra frontend deployment was initiated. Earlier sections describing 0065–0070 as prepared-only are historical and superseded by this release entry. Authenticated checkout, physical printing and scanner acceptance remain pending; unrelated scanner/audit gaps are unchanged. See History Section 71.

# 73. RECEIPT AND COUNTER PAYMENT CONTRACT — 20 OCTOBER 2026

Customer receipts omit internal floor/POS and tailoring identity details while retaining the original invoice reference, bill barcode, purchased items, required customer/business data, saved tax presentation and payment result. Retail-only bills have no advance/balance block; stitching receipts show received amount and remaining balance. Invoice totals are not repeated in a second footer. The price-free tailor worksheet uses an 80 mm format with the job barcode, garment/design/instructions, delivery date, factory/tailor and issued fabrics. Customer 58/80 mm prints use explicit CSS and the same content as the screen.

Stitching payment state derives exclusively from the entered amount: zero/blank, partial or full total. Keep the payment-method selector; remove the independent paid/unpaid selector. Validate against the GST-inclusive total and preserve retry semantics. Finished-product transfer notes are optional at both UI and existing backend; unrelated mandatory correction reasons remain intact. No migration is needed for these changes.

Extra fabric remains scan job/bill → scan Thaan → enter metres → confirm. Preselect a single job, explicitly select among multiple garments and retain authorized open-job/stock checks. Record the issue against the same job and preserve the original customer invoice/balance. Exact retries must not duplicate deductions; tailor reprints include additional issues. Do not silently introduce extra charges. Verified with disposable transaction tests and synthetic/visually inspected receipt previews; physical printer acceptance remains pending. See History Section 72 and `docs/COUNTER_RECEIPTS.md`.
