# Showroom label print setup

Updated: 22 October 2026.

The main Print barcode labels dialog shows the active paper/sticker dimensions, preview, label/page counts, Use showroom 4 × 6 layout, Print test page and Print all labels. Advanced settings starts collapsed and contains alternative presets, media type, sticker and paper dimensions, gaps, rows/columns, margin and printer resolution.

The showroom reset uses a 101.6 × 152.4 mm fixed printer page with 50.8 × 25.4 mm stickers, two across and six rows, zero gaps/margins and 203 DPI. These are configured dimensions, not connected-printer detection. Match the actual loaded media before printing. Previously saved valid calibration is retained; absent media mode uses the showroom default.

In Chrome select the actual label printer, match driver media size, use 100% scale and turn off browser headers/footers. Print a test page, check alignment and scan the printed label before printing the batch. Adjust Advanced settings and driver gap calibration when needed.

Reprinting preserves the original barcode identity. No stock or financial data changes. Automated verification captures printer calls without sending a physical print job; hardware acceptance remains separate.

Verification: `scripts/label-setup-ui-test.mjs` exercises the real dialog with synthetic labels at 360/768/1440 px widths, preset/reset, preview, test/all output and saved-profile reload. `scripts/thermal-label-model-test.mjs` covers profile normalization, pagination and barcode geometry.

## Physical label content fit — 21 October 2026

The showroom profile remains a two-column, six-row 4 × 6 inch sheet. Selecting one barcode deliberately prints one label; the other eleven positions remain blank. Select additional distinct labels when the sheet should contain additional barcodes. The system does not duplicate a barcode merely to fill unused labels.

The first physical follow-up showed that a full-width 9.5 mm barcode was too wide and pushed its printed identity into the next sticker. That layout is superseded. Six-character barcodes now use three whole thermal dots per module where the fixed sticker safely permits it, use 7 mm bar height, and are horizontally centred. The complete compact content block is vertically centred inside the 25.4 mm sticker with 4 mm left/right content insets. This is a layout-only correction: the recorded barcode ID, stock and reprint identity do not change. Automatic barcode-density validation remains in place before printing.

The 22 October physical follow-up established the final compact fabric-label order: batch/supplier first, fabric type/name second, barcode third and the exact barcode identity immediately below. All label text is centred. Colour/length detail is intentionally omitted from this small physical label so it cannot push the identity outside the sticker; that information remains available when the barcode is scanned. A physical printer calibration raises the unpriced fabric-label block by 4 mm inside its CSS sticker cell (2 mm for priced finished-product labels), correcting the observed downward hardware placement while keeping every element within the label boundary.

For multi-label printing, **Print all labels** fills the sheet left-to-right, two labels per row and six rows per page. Twelve selected labels use one 4 × 6 page; the thirteenth begins a second page. Each selected barcode prints once and unused sticker positions remain blank. The same barcode geometry, text order and safe margins apply to every label in every page.

Refresh the deployed page and use **Print test page**. In Chrome select the label printer, choose its matching 101.6 × 152.4 mm media, use 100% scale, and disable headers and footers. The UI/browser checks use representative fabric and priced labels and confirm the required text order, barcode centring, bottom clearance, containment inside one sticker, and 13-label multi-page output. Scan and visually confirm one physical test label before printing a batch.
