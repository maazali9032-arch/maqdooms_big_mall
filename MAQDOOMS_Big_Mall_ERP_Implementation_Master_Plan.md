# MAQDOOM'S BIG MALL — ERP IMPLEMENTATION MASTER PLAN

## Purpose

This is the implementation source of truth for the complete MAQDOOM'S Big Mall ERP.

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
