# Showroom label print setup

Updated: 22 October 2026.

The main Print barcode labels dialog shows the active paper/sticker dimensions, preview, label/page counts, **Use showroom 40 × 30 roll**, Print test page and Print all labels. Advanced settings starts collapsed and contains alternative presets, media type, sticker and paper dimensions, gaps, rows/columns, margin and printer resolution.

The showroom reset uses the physically measured continuous roll: two 40 × 30 mm stickers across, 3 mm outer/column/row pitch and 203 DPI. Each browser print page is one measured 89 × 33 mm row: `3 + 40 + 3 + 40 + 3` mm wide and `3 + 30` mm high. These are configured dimensions, not connected-printer detection. The profile is versioned so older saved 4 × 6 experiments cannot override it.

In Chrome select the actual label printer, match driver media size, use 100% scale and turn off browser headers/footers. Print a test page, check alignment and scan the printed label before printing the batch. Adjust Advanced settings and driver gap calibration when needed.

Reprinting preserves the original barcode identity. No stock or financial data changes. Automated verification captures printer calls without sending a physical print job; hardware acceptance remains separate.

Verification: `scripts/label-setup-ui-test.mjs` exercises the real dialog with synthetic labels at 360/768/1440 px widths, preset/reset, preview, test/all output and saved-profile reload. `scripts/thermal-label-model-test.mjs` covers profile normalization, pagination and barcode geometry.

## Physical label content fit — 21 October 2026

The showroom profile is a two-column continuous roll. Selecting one barcode deliberately prints its left 40 × 30 mm sticker and leaves the adjacent right sticker blank. Select additional distinct labels when the next physical sticker should contain another barcode. The system does not duplicate a barcode merely to fill unused labels.

The first physical follow-up showed that a full-width 9.5 mm barcode was too wide and pushed its printed identity into the next sticker. That layout is superseded. Barcodes use only the whole thermal-dot width that safely fits inside the measured 40 mm sticker, use 7 mm bar height, and are horizontally centred. This is a layout-only correction: the recorded barcode ID, stock and reprint identity do not change. Automatic barcode-density validation remains in place before printing.

The 22 October physical follow-up established the final compact fabric-label order: batch/supplier first, fabric type/name second, barcode third and the exact barcode identity immediately below. All label text is centred as one group. Colour/length detail is intentionally omitted from this small physical label so it cannot push the identity outside the sticker; that information remains available when the barcode is scanned.

The print layout now assigns every selected barcode an absolute 40 × 30 mm sticker cell before it prints. Every browser page is one fixed two-column row on the 89 × 33 mm measured roll pitch; each cell clips its own contents. A later barcode therefore cannot flow into, overlap, or use the next sticker's space. The identity group begins 1.4 mm from the top and remains centred horizontally, leaving the lower part of each label available for a finished garment's future design, size or selling-price information. The 3 mm blank gap between physical stickers is part of the loaded roll; it cannot be printed on and must match the measured pitch.

For multi-label printing, **Print all labels** fills the roll left-to-right, two labels per row. Each pair is one exact 89 × 33 mm print row, so the next barcode always begins in its own 40 × 30 mm sticker cell after the measured 3 mm pitch. Each selected barcode prints once and an unused second sticker in an odd final row remains blank.

Refresh the deployed page and use **Print test page**. In Chrome select the label printer, choose continuous media with a custom 89 × 33 mm page (or the equivalent 40 × 30 mm two-column roll pitch), use 100% scale, and disable headers and footers. The UI/browser checks use representative fabric and priced labels and confirm the required text order, barcode centring, top placement, containment inside one sticker, and 13-label multi-page output. Scan and visually confirm one physical test label before printing a batch.
