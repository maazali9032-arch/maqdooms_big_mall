# Maqdoom's Fabric Manager

Build Maqdoom's Big Mall — ERP & Operations Platform

Build a professional, production-oriented ERP and retail operations management platform for Maqdoom's Big Mall.

This is the ERP/staff application only.

Do NOT build the public-facing e-commerce storefront in this project. A separate e-commerce repository will be built later and will connect to the same Supabase database through a controlled database contract.

The goal of this application is to provide Maqdoom's owner and staff with one centralized system for:

Fabric/thaan inventory

Barcode-based stock receiving

Stock ledger and traceability

Counter/POS sales

Fabric cutting

Tailoring material issuing

Tailoring jobs

Customers

E-commerce management dashboard

Online order/pick-task management foundations

WhatsApp integration foundations

Role-based access

Owner dashboard

Reports

Audit trail

The application must feel like a serious commercial ERP used by a large established retail business, not a student project, toy dashboard, generic SaaS template, or childish admin panel.

1. CORE PRODUCT PRINCIPLE

The most important concept in this application is:

Inventory is a ledger, not a mutable number.

Never design the system around simply overwriting a remaining_length field.

Every inventory change must conceptually be represented as a stock movement:

inward

sale

tailoring

return

wastage

adjustment

The remaining quantity of a thaan is derived from its movement history.

Every important action must be attributable to the logged-in user and timestamped.

The system must preserve historical records.

Never hard-delete depleted thaans.

They should eventually be archived/hidden from normal operational screens while their complete history remains available for audits and historical transactions.

2. IMPORTANT BUSINESS TERMINOLOGY

Use these terms consistently throughout the interface:

Thaan

One physical roll of fabric.

Every thaan is an independent inventory record and has its own unique barcode.

Even if 10 thaans have exactly the same:

fabric

colour

length

width

price

they are still 10 separate thaan records.

Do NOT represent them as:

quantity = 10

Instead:

TH-001
TH-002
TH-003
...
TH-010

Each has its own barcode and stock history.

Laagat

The cost price paid by the business for the thaan, represented per metre.

Selling price

The counter selling price per metre.

Cut

Any deduction of length from a physical thaan.

Ledger

The append-only stock movement history.

Hold

A temporary reservation of fabric for a future online checkout. This is mainly a foundation for the future storefront.

Listing

A public e-commerce product managed by the e-commerce manager.

3. UNIT SYSTEM

The shop works in METRES ONLY.

Do NOT introduce yards as an active business unit.

Internally, store lengths as integers in one canonical base unit, preferably:

millimetres

Example:

1 metre = 1000 mm
5.25 metres = 5250 mm
28.5 metres = 28500 mm

The UI should display and accept metres.

Never rely on floating-point metre values for authoritative inventory calculations.

Provide a reusable unit conversion utility.

4. TECHNOLOGY FOUNDATION

Use a modern production-oriented stack:

React

TypeScript

Vite

Tailwind CSS

Supabase

PostgreSQL

Supabase Auth

PostgreSQL Row Level Security

Responsive web application

Use a clean component architecture.

Use feature/domain-based organization rather than putting everything into generic folders.

Recommended structure:

src/
├── app/
│   ├── router/
│   ├── providers/
│   ├── layouts/
│   └── guards/
│
├── features/
│   ├── inventory/
│   ├── pos/
│   ├── tailoring/
│   ├── customers/
│   ├── ecommerce/
│   ├── whatsapp/
│   ├── auth-roles/
│   └── reports/
│
├── shared/
│   ├── components/
│   ├── hooks/
│   ├── utils/
│   ├── types/
│   └── constants/
│
└── infrastructure/
    ├── supabase/
    ├── barcode/
    └── storage/

Each feature should have its own internal structure where appropriate:

feature/
├── api/
├── components/
├── hooks/
├── schemas/
├── types/
├── utils/
└── index.ts

Features should not randomly import each other's internal files.

Expose public functionality through each feature's index.ts.

5. ENVIRONMENT VARIABLES

IMPORTANT:

Do NOT create, expose, commit, or populate a real .env file.

Create:

.env.example

with placeholder variables only.

For example:

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

Leave the values empty/example-only.

I will manually add the real API keys and credentials later.

Do not invent API keys.

Do not hardcode credentials anywhere in the codebase.

Do not create service-role credentials in the frontend.

6. APPLICATION SHELL

Create a polished ERP application shell.

Desktop:

┌─────────────────────────────────────────────────────────────┐
│ Logo / Maqdoom's                    Search   Alerts   User  │
├───────────────┬─────────────────────────────────────────────┤
│               │                                             │
│ Dashboard     │                                             │
│ Inventory     │              MAIN CONTENT                   │
│ POS           │                                             │
│ Tailoring     │                                             │
│ Customers     │                                             │
│ E-commerce    │                                             │
│ WhatsApp      │                                             │
│ Reports       │                                             │
│ Access        │                                             │
│ Settings      │                                             │
│               │                                             │
└───────────────┴─────────────────────────────────────────────┘

Use a professional sidebar/navigation system.

The interface should feel suitable for:

owner

manager

stock-entry staff

multiple counter staff

tailoring staff

e-commerce manager

Do not create a childish UI.

Do not use excessive gradients, oversized rounded cards, cartoon illustrations, emojis, playful colors, or unnecessary decorative animations.

Use restrained spacing, strong typography, clear hierarchy, subtle borders, professional tables, meaningful status badges, and excellent information density.

7. FULL RESPONSIVENESS

The entire application MUST be fully responsive.

Do not design only for desktop.

It must work properly on:

large desktop monitors

laptops

tablets

mobile phones

The staff may use tablets/mobile devices for scanning and stock operations.

Tables should transform appropriately on smaller screens rather than simply overflowing horizontally wherever possible.

Side navigation should collapse into an appropriate mobile navigation pattern.

Forms must remain usable on touch devices.

Buttons and scanning inputs must have appropriate touch targets.

8. AUTHENTICATION

Implement Supabase authentication foundation.

Users should have:

account

name

role(s)

active/inactive status

last login

permissions

Do not use:

is_admin

as the main authorization model.

Use:

roles
permissions
role_permissions
user_roles

Support optional per-user permission overrides.

9. ROLES

Implement these primary roles:

Owner

Full access.

Can:

view everything

manage users

manage permissions

view costs

view reports

view audits

manage access

Stock Entry

Responsible for:

receiving new stock

scanning thaans

entering thaan details

bulk editing receiving records

viewing relevant inventory information

Counter / Salesperson

Responsible for:

scanning thaans

checking available length

selling fabric

cutting fabric

creating customer sales

issuing fabric to tailoring

handling checkout

Counter staff must NOT see laagat/cost.

Tailor

Internal employee account.

Responsible for:

viewing assigned tailoring jobs

receiving fabric/materials

updating job status where allowed

Tailors are NOT customers.

E-commerce Manager

Responsible for:

creating public listings

editing product descriptions

uploading images

setting online prices

linking listings to thaans

managing online orders

managing pick tasks

Customer

Do not build the public customer storefront here.

Customer authentication can be prepared for the shared authentication architecture, but the public e-commerce application is a separate repository.

10. PERMISSION SYSTEM

Use granular permissions such as:

inventory.receive
inventory.edit_thaan
inventory.view_cost

pos.sell
pos.override_price_or_discount
pos.issue_to_tailoring

stock.adjust
stock.return_from_tailor

tailoring.manage_jobs
tailoring.view_costs

ecommerce.manage_listings
ecommerce.link_stock

reports.view
audit.view

access.manage

Database-level authorization is mandatory.

Do not rely only on hiding UI buttons.

If a user doesn't have permission, the database must prevent the operation.

11. OWNER ACCESS MANAGEMENT

Create:

Manage Access

The owner can:

view staff

create/approve users

assign roles

grant/revoke permission layers

apply user-specific overrides

deactivate access

Revoking access must take effect immediately and terminate the active session.

The last owner account must never be removable or demoted.

12. INVENTORY MODULE

Create a complete inventory workspace.

Subsections:

Inventory
├── Overview
├── Products / Fabrics
├── Thaans
├── Receiving
├── Stock Movements
├── Adjustments
└── Archived

Dashboard metrics:

Active thaans

Total available metres

Incomplete stock

Low-stock items

Recently received

Recently cut

Depleted

Archived

Remember:

Do NOT aggregate multiple thaans into one sellable piece.

13. THAAN DATA MODEL / UI

Each thaan can have:

unique barcode

product/fabric

name

category

colour

design/pattern

original length

remaining length

width

selling price per metre

cost per metre

supplier

receiving batch

rack/location

status

created date

updated date

Remaining length must be derived from stock movements.

The UI can display:

Original Length: 28.50 m
Available:       21.25 m

but the database should not treat 21.25 as the authoritative mutable balance.

14. BARCODE WORKFLOW

Barcode scanners behave like keyboard input.

Create a highly optimized barcode scanning interface.

The stock employee should be able to:

FOCUS SCAN INPUT
↓
SCAN
↓
ROW APPEARS
↓
SCAN AGAIN
↓
ROW APPEARS
↓
SCAN AGAIN

No unnecessary modal interaction after every scan.

Every thaan has its own unique barcode.

The barcode itself contains only a short identifier.

Do NOT encode:

remaining length

price

changing inventory data

Those values belong in the database.

15. STOCK RECEIVING

Create:

Inventory → Enter New Stock

Workflow:

Step 1

Create receiving batch.

Fields:

Supplier

Date

Bill number

Notes

Step 2

Rapidly scan thaans.

Display:

# | Barcode | Fabric | Length | Width | Cost | Selling Price | Status

All detail fields are optional during initial scanning except barcode.

Step 3

Allow:

Bulk Edit

Select 1, 5, 20, 100 etc. records.

Set:

fabric

length

width

cost

selling price

other shared fields

Apply to selected records.

Step 4

Individual edit

Allow staff to edit each thaan independently.

Validation

A thaan without:

length

selling price

must be marked:

Incomplete

and cannot be sold.

Cost may be empty but should show:

Cost incomplete

Duplicate scan

If barcode already exists:

warning

visual indication

audible/clear feedback

do not silently create duplicate

Confirm

Scanned records remain drafts until the receiving batch is committed.

16. STOCK LEDGER

Create:

Inventory → Stock Movements

Display:

Date/time

Thaan

Movement type

Quantity

User

Reference

Purpose

Cost snapshot

Selling price snapshot

Movement types:

INWARD
SALE
TAILORING
RETURN
WASTAGE
ADJUSTMENT

Do not silently overwrite movement history.

Every correction must create an adjustment with:

user

timestamp

reason

17. COUNTER / POS

Create a fast counter interface.

The primary action should be:

[ SCAN THAAN BARCODE ]

After scanning:

Show:

Thaan
Barcode
Fabric
Original Length
Available Length
Selling Price / m

Then:

Length to Cut: [     ] m

Calculate:

price = metres × selling price per metre

Purpose selector:

Customer Sale
Tailoring

Default:

Customer Sale

If Customer Sale:

customer

sale

invoice/bill foundation

payment information foundation

If Tailoring:

select existing tailoring job or create one

select tailor

issue the cut to that job

do NOT create a normal customer sale bill

A cut larger than available length must be rejected.

18. ATOMIC CUTTING

Design the database architecture for one atomic cut function:

cut_thaan()

The function must:

lock the thaan

calculate actual available length

account for active holds where applicable

verify requested length

reject insufficient stock

create movement

create related sale/tailoring record

snapshot prices

record user

commit atomically

Never implement authoritative cutting only in React.

This is a core business operation.

19. CONCURRENCY

The system must handle multiple counter users simultaneously.

Example:

TH-001 = 10m

Counter A requests 6m
Counter B requests 5m

Only one transaction should succeed.

The other must receive:

Insufficient stock / no longer available

Do not allow negative inventory.

20. PRICE SNAPSHOTS

Every transaction must preserve historical prices.

If:

Current selling price = ₹500/m

and customer buys:

5m

record:

5m × ₹500

Later if the price changes to:

₹600/m

the old sale must remain ₹500/m.

Same principle applies to cost snapshots.

21. COST VISIBILITY

Counter staff must NEVER see laagat.

Cost information should only be accessible through appropriate restricted database structures/functions.

Stock entry and owner can view cost.

Do not merely hide cost from the frontend.

22. TAILORING MODULE

Create:

Tailoring
├── Overview
├── Jobs
├── Materials
├── Assigned to Me
└── History

A tailoring job is per garment.

A job belongs to:

tailor

customer order or shop stock

Each fabric line contains:

thaan

metres

category

cost snapshot

selling price snapshot

Categories may include:

outer fabric

waistcoat

lining/inline

other fabric

Non-fabric materials such as:

padding

buttons

lining

accessories

should be represented as normal inventory items where appropriate.

23. TAILORING TRANSACTION

A tailoring job may consume:

Main fabric
Waistcoat fabric
Lining
Padding
Buttons
Other materials

The operation must be all-or-nothing.

If one thaan doesn't have enough length:

the entire save fails.

Do not partially consume materials.

After successful save, show:

Materials Taken
Total Fabric Cost
Total Selling Value
Tailor
Time
Thaan IDs

Owner can see:

Fabric Cost
vs
Potential Selling Value

Do NOT add an arbitrary fixed tailoring surcharge.

24. CUSTOMER MODULE

Create the foundation for:

customer profiles

phone

purchase history

sales

tailoring references

Do not invent detailed customer-tailoring billing/measurement workflows yet.

Those are intentionally deferred until requirements are confirmed with the owner.

Keep the architecture extensible.

25. E-COMMERCE MANAGER MODULE

IMPORTANT:

This is not the public e-commerce site.

This is the internal dashboard used by the e-commerce manager.

Create:

E-commerce
├── Overview
├── Listings
├── Create Listing
├── Inventory Links
├── Online Orders
└── Pick Tasks

The manager controls what appears publicly.

Inventory must NEVER automatically become public.

Only products explicitly published by the e-commerce manager become listings.

26. LISTING TYPES

Support three stock modes.

1. Linked to Thaans

For fabric sold by metre.

Manager can link one or many thaans.

Availability is calculated automatically.

Example:

Listing:
Premium Navy Suiting

Linked Thaans:
TH-001
TH-004
TH-009

But online availability must be based on the largest single remaining thaan, not the sum.

If:

TH-001 = 2m
TH-004 = 4m
TH-009 = 3m

Online maximum orderable length:

4m

NOT:

9m

2. Manual Quantity

For ready-made products/sizes.

Example:

Sherwani
M = 2
L = 1
XL = 0

3. Untracked

For showcase/enquiry-only products.

27. E-COMMERCE LISTING FIELDS

Manager controls:

title

description

images

price

sale price if needed

category

collection

tags

SEO fields

stock mode

linked thaans

visibility

published/unpublished

For linked fabric listings, show the manager:

Largest Available Piece
Linked Thaans
Online Availability

Customers will NOT see exact thaan inventory.

28. ONLINE STOCK RULE

For linked listings:

online availability =
largest single remaining thaan
minus active holds

Do not sum lengths from multiple thaans.

When an in-store cut happens, the e-commerce dashboard must reflect the updated availability automatically.

This ERP is the source of truth.

29. READY-MADE SUITS / SHERWANIS

Support them through manual e-commerce management.

These may be single designer pieces.

Manager can:

publish

edit

mark sold

remove listing

Do not build complicated automatic ready-made stock synchronization yet.

30. HOLDS

Prepare the data model/UI foundation for online checkout holds.

A hold:

temporarily reserves length

expires after a configurable period

prevents counter sale during the active hold

Do not hardcode the final hold duration.

The owner requirement is deferred.

The system should support configuration later.

31. ONLINE ORDER FOUNDATION

Create the ERP side of online orders.

An online order should eventually appear as:

Pick Task

Counter staff:

Open Pick Task
↓
See requested length
↓
Scan thaan
↓
System validates
↓
Cut through normal cut flow

Do not create a second inventory deduction mechanism.

All physical deductions must go through the same cutting logic.

32. WHATSAPP

WhatsApp automation is deferred as a complete feature.

For this demo, build only the foundation and a realistic demo receipt/message flow.

Create a WhatsApp module structure that can later support:

templates

triggers

message log

provider integration

Do NOT invent a provider.

Do NOT hardcode API credentials.

Do NOT pretend that real WhatsApp automation is connected if no provider credentials are configured.

For the demo, create a clear:

WhatsApp Receipt Preview

showing what the customer would receive.

33. OWNER DASHBOARD

The owner dashboard is the most important high-level screen.

Create professional KPI cards:

Active Thaans
Available Fabric
Today's Sales
Tailoring Jobs
Online Orders
Low Stock
Incomplete Stock
Pending Actions

Include useful sections:

Stock overview

active thaans

depleted

incomplete

recent receiving

recent movements

Sales

today

week

month

sales by counter user

Tailoring

active jobs

materials consumed

fabric cost

selling value

E-commerce

active listings

online orders

pick tasks

stock availability

Audit

recent actions

adjustments

price changes

stock cuts

access changes

34. AUDIT TRAIL

Create a serious audit system.

Track:

who scanned

who created stock

who edited a thaan

who changed price

who cut fabric

who issued fabric to tailoring

who returned stock

who adjusted stock

who changed permissions

timestamp

affected record

reason where applicable

Make the audit interface searchable and filterable.

35. REPORTS

Create a reports foundation.

Reports should eventually support:

Inventory

stock by thaan

available metres

depleted thaans

stock movement

stock valuation

Sales

sales by day

sales by employee

sales by fabric

cut lengths

revenue

Tailoring

jobs

material consumption

fabric cost

selling value

tailor workload

Audit

adjustments

price changes

unusual activity

36. DATABASE STRUCTURE

Create the database architecture around entities such as:

users
roles
permissions
role_permissions
user_roles
user_permission_overrides

fabrics
thaans
thaan_costs
receiving_batches

stock_movements

sales
sale_items

tailoring_jobs
tailoring_job_lines
materials

listings
listing_thaan_links
listing_variants

holds

audit_log

Database functions should include the foundation for:

cut_thaan
place_hold
release_hold
commit_receiving_batch
save_tailoring_job

Use proper foreign keys and constraints.

Use indexes for:

barcode

status

thaan ID

listing ID

movement date

user

receiving batch

Barcode must have a unique constraint.

37. SUPABASE / SECURITY

The ERP repository owns:

migrations

database schema

RLS

database functions

permissions

Use Supabase RLS extensively.

The public storefront will later access only deliberately exposed public views/functions.

Never expose:

stock ledger

internal users

costs

internal permissions

private operational data

to the public application.

38. DESIGN LANGUAGE

The UI must look like a serious enterprise retail platform.

Design goals:

premium

clean

mature

operational

information-dense but readable

fast

professional

trustworthy

Avoid:

childish dashboards

excessive gradients

huge decorative cards

cartoon icons

unnecessary animations

excessive glassmorphism

fake analytics

meaningless charts

excessive rounded elements

generic startup/SaaS appearance

Use:

restrained color palette

professional typography

clear tables

subtle shadows

consistent spacing

status indicators

strong empty states

clear confirmation dialogs

useful filters

search

keyboard-friendly workflows

The product should look like software that a serious retail organization could actually use.

39. RESPONSIVENESS

This is mandatory.

Every page, table, form, dashboard, modal, navigation element and workflow must be responsive.

Test the design conceptually for:

Desktop
Laptop
Tablet
Mobile

Especially optimize:

barcode scanning

POS

stock receiving

tailoring

owner dashboard

Do not simply shrink desktop layouts onto mobile.

40. DEMO DATA

Since this is a demo, seed the UI with realistic sample data.

Use fictional data clearly marked as demo data.

Include:

multiple fabrics

multiple thaans

different lengths

different prices

partially consumed thaans

depleted thaans

incomplete thaans

several sales

tailoring jobs

e-commerce listings

audit events

multiple staff roles

Make the demo feel alive.

The sample data should demonstrate the system's actual business logic.

41. IMPORTANT DEMO FLOW

The first version must make this complete workflow visually demonstrable:

STOCK ENTRY
    ↓
SCAN THAANS
    ↓
SET LENGTH / PRICE
    ↓
COMMIT RECEIVING
    ↓
THAAN BECOMES ACTIVE
    ↓
COUNTER SCANS BARCODE
    ↓
SYSTEM SHOWS AVAILABLE LENGTH
    ↓
CUT 5 METRES
    ↓
PRICE CALCULATED
    ↓
LEDGER CREATED
    ↓
REMAINING LENGTH UPDATES
    ↓
TAILORING JOB
    ↓
FABRIC + PADDING CONSUMED
    ↓
OWNER SEES COST VS SELLING VALUE
    ↓
AUDIT TRAIL SHOWS EVERYTHING
    ↓
WHATSAPP RECEIPT PREVIEW

This is the core vertical slice.

42. WHAT NOT TO BUILD YET

Do NOT spend the initial implementation on:

public e-commerce storefront

payment gateway

shipping integration

real WhatsApp provider integration

GST finalization

multi-branch implementation

complex customer measurement/billing workflow

advanced CRM

loyalty program

marketing automation

complicated accounting integration

These requirements are intentionally deferred.

Build the architecture so they can be added later.

43. CODE QUALITY

Do not create a prototype that is impossible to extend.

Use:

strict TypeScript

reusable components

schema validation

proper error handling

loading states

empty states

optimistic UI only where safe

proper database transactions

clean naming

modular architecture

Avoid:

huge monolithic components

duplicated logic

business logic hidden inside UI components

hardcoded inventory calculations

fake local-only inventory state

arbitrary mock APIs pretending to be production APIs

Where backend functionality cannot yet be connected because credentials are absent, create clean integration boundaries and realistic mock/demo states without pretending they are live.

44. FINAL PRIORITY

Prioritize correctness of the following above visual decoration:

Thaan identity

Barcode workflow

Stock receiving

Stock ledger concept

Available-length calculation

Cutting workflow

Role-based access

Price/cost separation

Tailoring material consumption

Owner audit visibility

The platform should make the owner immediately understand:

"Every physical thaan is individually tracked, every cut is recorded, every employee action is attributable, tailoring consumption is traceable, and the same inventory can later power the separate e-commerce storefront."

Build the foundation cleanly so that the next development phase can replace/demo data with the real Supabase implementation without restructuring the entire application.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a86bb45e-b3f5-4904-b0e7-640135ec1de2).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
