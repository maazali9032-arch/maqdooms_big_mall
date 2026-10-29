# Current system reference — 29 October 2026

> **Purpose:** This is the current operational reference for the ERP repository and its version-controlled database schema. It supersedes a dated rollout, phase, or UI note when they conflict. Older documents remain valuable historical records; they describe the state at the date in their title and are not silently rewritten as current fact.

> **Schema source:** `supabase/migrations/` is the canonical ordered migration chain. The newest repository migration is `20261030000100_revoke_legacy_entry_points.sql` (applied live 29 October 2026). This reference records the repository state, not a claim that an arbitrary remote database has applied every migration. Verify a target environment from its own migration ledger before release.

## Operating rules

- Stock, completed bills, barcode identities, movements and financial snapshots are traceable records. Correct them through the provided corrective workflows; do not overwrite historical events.
- Role and permission checks are enforced by the server. A visible control is never a substitute for authorization.
- Saved bills and jobs keep the GST, price, salesperson and customer snapshots that were valid at the time they were created.
- The public storefront is outside this repository. The E-commerce module here manages internal catalogue, availability, fulfilment and integration operations.

## Barcode families and printing

All new barcode identities below are six decoded characters: one uppercase prefix followed by five base-36 characters. Historical labels and aliases remain scannable and are never renumbered.

| Item or document | Prefix | Example | Main uses |
| --- | --- | --- | --- |
| Physical fabric Thaan | `T` | `T00001` | Stock detail, transfer, POS, tailoring issue |
| Vendor-purchased ready-made garment | `R` | `R00001` | Transfer, POS, ready-made stock |
| Owner-produced finished piece | `F` | `F00001` | Finished stock, transfer, POS |
| Customer-finished garment | `C` | `C00001` | Customer-garment receiving and lookup |
| Material or consumable physical unit | `M` | `M00001` | Material stock, transfer to a Master Tailor, consumption |
| Customer bill | `B` | `B00001` | POS bill lookup and reprint |
| Customer tailoring work order | `J` | `J00001` | Tailor and counter workflow |
| Owner production order | `P` | `P00001` | Production workflow and receiving |

Barcode printing uses fixed sticker cells for the configured showroom sheet. Each selected identity fills one cell; unused cells deliberately remain blank so a label is never duplicated merely to fill a page. Printing therefore depends on the selected label count and the printer profile, while physical alignment and scanner-read acceptance must be confirmed on the actual hardware. Material batches present an **M barcode labels** print step after successful receipt, and material batches are included in the batch-label reprint list.

## Stock receiving and images

Stock Entry has one batch flow with three item types:

1. **Fabric / Thaan** — one physical Thaan barcode per roll, measured in length.
2. **Ready-made Garments** — one `R` barcode per purchased garment piece.
3. **Materials & Consumables** — one `M` barcode per physical unit, such as a box of buttons or a roll of fusing.

Each batch has an arrival date, supplier selection and transport/other charges. A supplier profile can hold GSTIN, phone, email and address; selecting a known supplier can prefill those values when a supplier invoice is being recorded. The invoice toggle is intentional: choose **Yes** only when a supplier GST purchase invoice exists; it then reveals/fills the invoice information and ITC eligibility. No second invoice-date question is needed because the batch arrival date is the receipt date.

Purchase CP is entered as the received, GST-inclusive amount. Transport/other charges are allocated across the physical quantity: by metres for fabric, by pieces for ready-made garments and by material units for consumables. A type-level image is inherited by its subtypes unless a subtype has its own image; there is no batch-level image.

Material categories are owner-managed in **Products & Designs**. The selected category fixes the compact measurement unit. A material type expands to its requested number of units; default quantity and GST-inclusive CP flow into each individual row, which remains editable before M labels are generated.

## Stock transfer and factory allocation

The Stock Transfer page has one scanner queue. The scanned identity determines permitted destinations:

- `T`, `R` and `F` stock follows the normal location transfer workflow appropriate to its stock state.
- `M` material units transfer only as complete physical units to a **Factory**, then to its assigned **Master Tailor**. Material units are not sent to showroom floors and are not partially transferred.

One factory has many Master Tailors; one Master Tailor belongs to one factory and can have many Tailor Staff. A Tailor Staff member belongs to only one Master Tailor and factory. Material units remain allocated to the Master Tailor after an individual job consumes part of them; the remaining balance is used by later jobs until the unit is exhausted, then another full unit can be allocated.

## Tailoring and production lifecycle

The shared three-stage lifecycle is explicit:

1. **Issued** — fabric is issued for the customer order or owner production order, and relevant material units may be allocated to the Master Tailor.
2. **Work Recorded** — the Master Tailor scans the `J` or `P` receipt, records consumed `M` units/quantities and the Tailor Staff member who worked on it. This is a recorded event, not a return of the allocated material unit.
3. **Finished & Ready** — Stock Entry receives the completed work using the same job/receipt identity, finalizes CP (fabric + consumed materials + stitching) and creates the finished-piece barcode(s) after SP is set.

Customer-tailored garments use one final selling price and the entered size. Owner production and customer tailoring retain their separate commercial records while sharing the lifecycle and material-consumption evidence. Transit groups issued fabric and allocated materials by factory and indicates whether each item is for a production or customer order.

## POS, customer details, discounts and returns

POS scans showroom stock and supports fabric cut-unit selection. Metre is the default, while compatible smaller units can be selected for both an initial sale and extra fabric issued to a loaded customer order. Fabric-only lines use a per-unit selling price; finished and customer-tailored garments use their saved/final SP.

Customer name, contact and birth date are optional. Birth date is recorded as day, month and year rather than requiring a calendar interaction. A bill can use a percentage or fixed-rupee discount. The Owner can correct a bill's discount on the same bill and barcode for one hour after billing; Counter users cannot edit completed bills. A discount changes the bill total, not a fabricated refund balance.

Defective-return workflow supports refund/credit note, exchange or repair. The recorded disposition controls whether the returned stock is quarantined/depleted or held for repair; exchanges create their linked replacement settlement. This preserves the original bill and return evidence instead of deleting sale history.

## GST and supplier input

Selling prices are GST-inclusive. Discount is applied first, then GST is extracted from the discounted inclusive selling price. Fabric uses the configured fabric rate (normally 5%). Vendor ready-made, owner-produced finished and customer-tailored garments use the configured garment slab based on discounted unit SP: at or below the threshold (default `₹2,500`) uses the lower rate (default 5%); above it uses the higher rate (default 18%). The Owner manages threshold and rates in GST Configuration, and saved invoices retain their historical GST snapshot.

For purchases, the received CP is GST-inclusive and the system does not add GST again. Supplier invoice details and ITC eligibility are captured only when an invoice is available. Purchase GST and output GST remain separately recorded for reconciliation; payable GST is the applicable output GST less eligible input GST, subject to accounting review.

## People, permissions and reporting

Current roles include Owner, Stock Entry, Counter, Tailor (Master Tailor), Tailor Staff, Salesperson, Production, E-commerce Manager and Stock Audit. The Owner can grant individual exceptions through **Users & Permissions**. Each credited salesperson can receive an Owner-editable, digits-only salesperson number; new bills preserve that number/name snapshot and show it on the printed receipt.

Salesperson Work reports credited sales separately from POS operator identity, with filters, totals, current charts and bill drill-downs. Factory hierarchy shows readable user names, factory/master-tailor/staff relationships and job/assignment totals rather than internal user UUIDs.

## Main workspaces

| Workspace | Current responsibility |
| --- | --- |
| Stock Entry | Receive fabric, ready-made garments and material units; print/reprint labels |
| Stock Transfer | Scan queue and destination-aware movement, including Master Tailor allocation |
| Fabric Stock | Fabric, ready-made and materials stock; list/grid views, camera scan, filters, showroom, transit and movements |
| Counter / POS | Sell/show items, create customer tailoring, issue extra fabric, bill/receipt/returns |
| Finished Products | Receive completed work, finalize costs/SP and generate finished barcodes |
| Factories & Tailors | Manage factories, Master Tailors and Tailor Staff hierarchy |
| Products & Designs | Manage product definitions, designs and material categories/units |
| GST Configuration | Maintain GST slabs, business invoice identity and supplier profiles |
| E-commerce | Internal catalogue, visibility, pricing, fulfilment, shipping, customers, content, reports and integration health |

## Release checklist

Before declaring a deployment ready, verify the target environment's migration ledger, generated Supabase types and role grants; test at least one new barcode from each relevant family; check a material-label print and reprint; scan a material unit into a Master Tailor allocation; complete a J/P lifecycle through Finished & Ready; test POS GST/discount math; and perform a hardware printer/camera scan where that equipment is used.
