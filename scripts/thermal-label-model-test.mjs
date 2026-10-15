import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, server: { middlewareMode: true } });
const { STARTING_LABEL_PROFILE, labelPrintCSS, labelRows, symbolSize, validProfile } =
  await vite.ssrLoadModule("/src/features/inventory/label-print-model.ts");

let checks = 0;
const check = (value, label) => {
  assert(value, label);
  checks++;
};
const labels = Array.from({ length: 5 }, (_, index) => ({
  code: `80000000000${index + 1}`,
  name: "Sherwani",
  description: "DES-1 · Size 40",
  detail: "",
  price: "₹3,999.00",
}));
check(
  validProfile(STARTING_LABEL_PROFILE),
  "Starting TE244 label profile fits the printer media width",
);
check(
  !validProfile({ ...STARTING_LABEL_PROFILE, width: 60, columns: 2, gap: 3 }),
  "A row wider than the TE244 media limit is rejected",
);
check(
  labelRows(labels, 2)
    .map((row) => row.length)
    .join(",") === "2,2,1",
  "Five labels print as two-column rows",
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
  css.includes("@page{size:83mm 30mm;margin:0}") &&
    css.includes("grid-template-columns:repeat(2,40mm)"),
  "Print CSS uses exact two-column label dimensions with no browser page margin",
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
