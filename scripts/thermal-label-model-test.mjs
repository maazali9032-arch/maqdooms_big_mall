import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, server: { middlewareMode: true } });
const {
  STARTING_LABEL_PROFILE,
  normalizeProfile,
  labelPages,
  labelPrintCSS,
  labelRows,
  symbolSize,
  validProfile,
} = await vite.ssrLoadModule("/src/features/inventory/label-print-model.ts");

let checks = 0;
const check = (value, label) => {
  assert(value, label);
  checks++;
};
check(
  normalizeProfile(null).mode === "roll",
  "First-use setup preserves the measured showroom roll mode",
);
check(normalizeProfile({ mode: "roll" }).mode === "roll", "Saved roll calibration is preserved");
const labels = Array.from({ length: 5 }, (_, index) => ({
  code: `80000000000${index + 1}`,
  name: "Sherwani",
  description: "DES-1 · Size 40",
  detail: "",
  price: "₹3,999.00",
}));
check(
  validProfile(STARTING_LABEL_PROFILE),
  "Starting TE244 profile fits the measured 40 by 30 mm roll",
);
check(
  STARTING_LABEL_PROFILE.width === 40 &&
    STARTING_LABEL_PROFILE.height === 30 &&
    STARTING_LABEL_PROFILE.gap === 3 &&
    STARTING_LABEL_PROFILE.rowGap === 3 &&
    STARTING_LABEL_PROFILE.margin === 3 &&
    STARTING_LABEL_PROFILE.pageWidth === 89 &&
    STARTING_LABEL_PROFILE.pageHeight === 33,
  "TSC default matches the measured 3,40,3,40,3 width and 3,30 repeated roll pitch",
);
check(
  labelRows(labels, 2)
    .map((row) => row.length)
    .join(",") === "2,2,1",
  "Five labels print as two-column rows",
);
check(
  labelPages(labels, STARTING_LABEL_PROFILE)
    .map((page) => page.length)
    .join(",") === "2,2,1",
  "TSC profile automatically creates exact physical rows for the continuous roll",
);
check(
  labelPages(
    Array.from({ length: 13 }, () => labels[0]),
    STARTING_LABEL_PROFILE,
  )
    .map((page) => page.length)
    .join(",") === "2,2,2,2,2,2,1",
  "TSC roll gives every pair of labels its own measured physical row",
);
check(
  labelPages(labels, {
    mode: "sheet",
    width: 60,
    height: 30,
    columns: 3,
    rows: 2,
    gap: 3,
    rowGap: 2,
    pageWidth: 210,
    pageHeight: 297,
    margin: 9,
    dpi: 300,
  }).length === 1,
  "An arbitrary sheet layout groups labels into one configured print page",
);
check(
  validProfile({
    mode: "sheet",
    width: 90,
    height: 37,
    columns: 2,
    rows: 7,
    gap: 5,
    rowGap: 2,
    pageWidth: 210,
    pageHeight: 297,
    margin: 8,
    dpi: 300,
  }),
  "The A4 two-by-seven preset fits inside its paper height and width",
);
const short = symbolSize(labels[0].code, STARTING_LABEL_PROFILE);
check(
  short.dots >= 2 && short.width <= STARTING_LABEL_PROFILE.width - 8,
  "Short numeric piece barcode has readable modules without stretching across the sticker",
);
const legacy = symbolSize("PRD-0fd2d3fb-3b6e-425e-9c58-4da18ca665c5", STARTING_LABEL_PROFILE);
check(
  legacy.dots <= short.dots,
  "Existing long barcodes remain unchanged and are flagged as denser labels",
);
const css = labelPrintCSS(STARTING_LABEL_PROFILE);
check(
  css.includes("@page{size:89mm 33mm;margin:0}") &&
    css.includes("grid-template-columns:repeat(2,40mm)") &&
    css.includes("padding:3mm 3mm 0") &&
    css.includes("grid-auto-flow:row") &&
    css.includes("contain:layout paint") &&
    css.includes(".label-content{position:absolute;top:1.4mm;left:4mm;right:4mm") &&
    css.includes("text-align:center") &&
    css.includes(".sticker svg{max-width:100%;height:7mm") &&
    css.includes(".sticker .code{text-align:center"),
  "Print CSS gives every barcode a fixed sticker cell and reserves lower label space",
);
await fs.writeFile(
  "docs/THERMAL_LABEL_MODEL_VERIFICATION.json",
  JSON.stringify(
    {
      verified_at: new Date().toISOString(),
      passed: true,
      checks,
      profile: STARTING_LABEL_PROFILE,
    },
    null,
    2,
  ) + "\n",
);
console.log(`PASS: ${checks} thermal-label model checks`);
await vite.close();
