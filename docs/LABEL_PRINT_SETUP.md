# Showroom label print setup

Updated: 21 October 2026.

The main Print barcode labels dialog shows the active paper/sticker dimensions, preview, label/page counts, Use showroom 4 × 6 layout, Print test page and Print all labels. Advanced settings starts collapsed and contains alternative presets, media type, sticker and paper dimensions, gaps, rows/columns, margin and printer resolution.

The showroom reset uses a 101.6 × 152.4 mm fixed printer page with 50.8 × 25.4 mm stickers, two across and six rows, zero gaps/margins and 203 DPI. These are configured dimensions, not connected-printer detection. Match the actual loaded media before printing. Previously saved valid calibration is retained; absent media mode uses the showroom default.

In Chrome select the actual label printer, match driver media size, use 100% scale and turn off browser headers/footers. Print a test page, check alignment and scan the printed label before printing the batch. Adjust Advanced settings and driver gap calibration when needed.

Reprinting preserves the original barcode identity. No stock or financial data changes. Automated verification captures printer calls without sending a physical print job; hardware acceptance remains separate.

Verification: `scripts/label-setup-ui-test.mjs` exercises the real dialog with synthetic labels at 360/768/1440 px widths, preset/reset, preview, test/all output and saved-profile reload. `scripts/thermal-label-model-test.mjs` covers profile normalization, pagination and barcode geometry.
