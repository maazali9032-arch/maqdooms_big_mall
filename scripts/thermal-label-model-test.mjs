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
check(normalizeProfile(null).mode === "sheet", "First-use setup preserves the showroom sheet mode");
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
  "Starting TE244 profile fits the original four-by-six media",
);
check(
  Math.abs(STARTING_LABEL_PROFILE.width * STARTING_LABEL_PROFILE.columns - 101.6) < 0.001 &&
    Math.abs(STARTING_LABEL_PROFILE.height * STARTING_LABEL_PROFILE.rows - 152.4) < 0.001,
  "TSC default fills the original four-by-six media with two columns and six rows",
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
    .join(",") === "5",
  "TSC profile automatically fills available rows on the original printer page",
);
check(
  labelPages(
    Array.from({ length: 13 }, () => labels[0]),
    STARTING_LABEL_PROFILE,
  )
    .map((page) => page.length)
    .join(",") === "12,1",
  "TSC profile continues onto a new page after twelve labels",
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
  short.dots >= 2 && short.width <= STARTING_LABEL_PROFILE.width - 4,
  "Short numeric piece barcode has readable module width",
);
const legacy = symbolSize("PRD-0fd2d3fb-3b6e-425e-9c58-4da18ca665c5", STARTING_LABEL_PROFILE);
check(
  legacy.dots <= short.dots,
  "Existing long barcodes remain unchanged and are flagged as denser labels",
);
const css = labelPrintCSS(STARTING_LABEL_PROFILE);
check(
  css.includes("@page{size:101.6mm 152.4mm;margin:0}") &&
    css.includes("grid-template-columns:repeat(2,50.8mm)") &&
    css.includes(".sticker svg{width:100%;height:9.5mm") &&
    css.includes(".sticker .code{text-align:center"),
  "Print CSS fills each sticker safely with a full-width barcode and readable code",
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
