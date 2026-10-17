# Production scan receipt and thermal labels

Finished Products now begins with one action: scan or type the Production ID when the
complete batch arrives at Workshop. An authorized Owner or Stock Entry user performs
the scan. The database then records the completion when required, receives every
piece into Workshop, allocates the already captured fabric CP across the pieces, and
generates one short numeric product barcode per piece. A repeat scan only reopens the
same pieces; it never creates a second receipt or second set of barcodes.

Stock Entry or Owner can save each Workshop piece's SP and print its label. Existing
barcodes remain valid and unchanged. New finished-piece barcodes start with `80` and
are short enough for the small thermal labels shown in the supplied printer photos.

## TSC TE244 label setup

The app opens **Barcode Label Setup** before it prints inventory or finished-product
labels. The starting profile is 40 mm wide × 30 mm high, two labels across, a 3 mm
column gap, at 203 dpi. The supplied photos do not establish the actual roll size, so
these are a test profile rather than a claim about the installed roll.

Use **Print test row** first. In the TSC driver select the same width, height, number
of columns and gap, turn off browser margins/header/footer, use 100% scale, then
calibrate the printer's label gap. Save the adjusted values in the dialog; the browser
stores them on that device for the next print. The printer driver cannot reliably turn
an ordinary A4 browser page into correctly aligned thermal labels, which is why the
application now supplies exact thermal-page dimensions.

If an old long barcode makes a dense symbol, the dialog warns before print. It leaves
that existing identity intact; use a wider label or a higher-resolution printer for
that legacy label.

## Separate customer-tailoring receipt

This document describes store-owned Owner production. A customer's stitched garment
uses the separate customer bill or tailoring-job receipt flow: Workshop records its
name, size and SP and generates a short barcode for that garment only. The customer's
purchased fabric is not converted into store finished stock. See
`docs/POS_TERMINALS_MULTI_FLOOR_AND_CUSTOMER_FINISHING.md`.

## Controls and evidence

The receipt RPC is backend-authorized (`production.receive`), records the user who
scanned it, is request-idempotent, and rolls back the entire receipt if captured cost
evidence is missing. The barcode allocator and sequence cannot be called directly by
staff. CP remains visible only to roles already permitted to see it.

`PRODUCTION_SCAN_RECEIPT_DATABASE_VERIFICATION.json` records cumulative schema tests;
`PRODUCTION_SCAN_RECEIPT_UI_VERIFICATION.json` covers retry handling, mobile layout,
short labels and label configuration; `THERMAL_LABEL_MODEL_VERIFICATION.json` verifies
the printable label geometry.

## Fabric Stock summary

Fabric Stock now shows both **Workshop available** and **Showroom available**. The
Showroom figure is a separate current ledger total across active physical Showroom
floors. It excludes Workshop inventory and the retired general Showroom parent, so it
cannot double-count the same fabric.
