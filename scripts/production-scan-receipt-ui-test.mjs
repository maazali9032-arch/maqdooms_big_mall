import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve("scripts/fixtures/workflow-workspaces");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "production-scan-receipt-vite"),
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      {
        find: "@/app/providers/session",
        replacement: path.resolve("scripts/fixtures/workshop-inventory/session.tsx"),
      },
      { find: "@/integrations/supabase/client", replacement: path.join(fixture, "client.ts") },
      { find: "@", replacement: path.resolve("src") },
    ],
  },
  server: { host: "127.0.0.1", port: 5208, strictPort: true, fs: { allow: [process.cwd()] } },
});
let browser;
let checks = 0;
const errors = [];
const check = (value, label) => {
  assert(value, label);
  checks++;
};
try {
  await server.listen();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => errors.push(error.message));
  const url = "http://127.0.0.1:5208?role=stock_entry&view=finished&receiptFlow&receiptRetry";
  await page.goto(url);
  await page.getByRole("heading", { name: "Scan Production Barcode" }).waitFor();
  check(
    !(await page.getByText("Existing Pieces, Transfers & History").count()),
    "Receipt starts with only production scan",
  );
  await page.getByLabel("Workshop Production ID").fill("PROD-1");
  await page.getByLabel("Workshop Production ID").press("Enter");
  await page.getByText("The receipt result is uncertain.").waitFor();
  check(
    !(await page.getByText("Piece 1 · Sherwani").count()),
    "Uncertain response does not fabricate pieces",
  );
  await page.getByRole("button", { name: "Retry same production scan" }).click();
  await page.getByText("Piece 5 · Sherwani").waitFor();
  check(
    await page.getByText("Received into Workshop").isVisible(),
    "Scan receives the complete batch into Workshop",
  );
  check(
    await page.getByText(/^800000000001$/).isVisible(),
    "New generated label identity is a short barcode",
  );
  await page.getByLabel("SP for all Workshop pieces").fill("3999");
  await page.getByRole("button", { name: "Apply SP to all Workshop pieces" }).click();
  await page.getByRole("button", { name: "Save Workshop SP" }).click();
  await page.getByText("Saved SP: ₹3,999.00").first().waitFor();
  await page.getByRole("button", { name: "Print saved product labels" }).click();
  await page.getByRole("dialog").getByText("Barcode Label Setup").waitFor();
  check(
    (await page.getByLabel("Sticker width (mm)").inputValue()) === "40",
    "Thermal label setup starts with a testable 40 mm label width",
  );
  check(
    (await page.getByLabel("Labels across roll").inputValue()) === "2",
    "Thermal label setup starts with two columns",
  );
  await page.getByRole("button", { name: "Close setup" }).click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Receipt screen fits ${width}px`,
    );
  }
  check(!errors.length, `No receipt runtime errors: ${errors.join(", ")}`);
  await fs.writeFile(
    "docs/PRODUCTION_SCAN_RECEIPT_UI_VERIFICATION.json",
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        passed: true,
        checks,
        fixture: true,
        real_customer_data_used: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`PASS: ${checks} production scan receipt browser checks`);
} finally {
  await browser?.close();
  await server.close();
}
