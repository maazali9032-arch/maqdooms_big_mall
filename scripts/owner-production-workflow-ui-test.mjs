/** Actual components, isolated synthetic backend; no live user or stock writes. */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve("scripts/fixtures/owner-production-workflow");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "owner-production-workflow-vite-cache"),
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      {
        find: "@/app/providers/session",
        replacement: path.resolve("scripts/fixtures/stock-registration/session.tsx"),
      },
      { find: "@/integrations/supabase/client", replacement: path.join(fixture, "client.ts") },
      { find: /^@\/features\/customers$/, replacement: path.join(fixture, "customers.ts") },
      { find: /^@\/features\/access$/, replacement: path.join(fixture, "access.ts") },
      { find: "@", replacement: path.resolve("src") },
    ],
  },
  server: { host: "127.0.0.1", port: 5190, strictPort: true, fs: { allow: [process.cwd()] } },
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5190");
  await page.getByRole("heading", { name: "Owner Production", exact: true }).waitFor();
  await page.getByLabel("Production fabric barcode").fill("RDS-12345c");
  await page.getByLabel("Production fabric barcode").press("Enter");
  await page.getByText("Workshop: 50 m", { exact: true }).waitFor();
  check(true, "Barcode scan displays exact available length");
  await page.getByLabel("Production material source").selectOption("workshop");
  await page.getByRole("button", { name: "Allocate scanned Thaan thaan", exact: true }).click();
  check(
    (await page.getByLabel("Production material 1").inputValue()) === "item",
    "Scan selects exact internal Thaan",
  );
  await page.getByLabel("Production Product").selectOption("product");
  await page.getByLabel("Production Design").selectOption("design");
  await page.getByLabel("Production piece count").fill("3");
  await page.getByLabel("Production Factory").selectOption("factory");
  await page.getByLabel("Production Section").selectOption("section");
  await page.getByLabel("Assign T-A").check();
  await page.getByLabel("Assign T-B").check();
  await page.getByLabel("Total required quantity 1").fill("25");
  await page.getByLabel("Production creation reason").fill("Actual requirement");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Production fits ${width}px`,
    );
  }
  await page
    .getByRole("button", { name: "Create Production Job and issue materials", exact: true })
    .click();
  await page.getByRole("button", { name: "Retry same Production Job", exact: true }).waitFor();
  check(
    await page.getByLabel("Production piece count").isDisabled(),
    "Interrupted job request freezes inputs",
  );
  await page.getByRole("button", { name: "Retry same Production Job", exact: true }).click();
  await page
    .getByRole("button", { name: "Create Production Job and issue materials", exact: true })
    .waitFor();
  const created = await page.evaluate(() =>
    window.productionCalls.filter((c) => c.name === "create_owner_production_shared"),
  );
  check(
    created.length === 2 && JSON.stringify(created[0].args) === JSON.stringify(created[1].args),
    "Retry preserves full production payload and UUID",
  );
  check(
    created[0].args.p_assignments.length === 2 &&
      created[0].args.p_items[0].quantity === 25000 &&
      created[0].args.p_quantity === 3,
    "Two shared Tailors and exact 25m allocation; no piece multiplier",
  );
  check(
    (await page.getByLabel("Production piece count").inputValue()) === "",
    "Successful job clears count",
  );
  await page.getByRole("button", { name: "Stock staff fixture", exact: true }).click();
  await page
    .getByRole("heading", { name: "Finished Product inventory & transfers", exact: true })
    .waitFor();
  await page.getByLabel("Finished Product transfer barcode").fill("PRD-1234567");
  await page.getByLabel("Finished Product transfer barcode").press("Enter");
  await page.getByRole("button", { name: "Reprint same Product Barcode", exact: true }).waitFor();
  check(
    (await page.getByLabel("Source location", { exact: true }).inputValue()) === "workshop",
    "Staff scan loads recorded Workshop source",
  );
  check(
    await page.getByLabel("Move PRD-1234567").isChecked(),
    "Scanned piece selected automatically",
  );
  check(
    await page.getByRole("img", { name: "Product Barcode PRD-1234567" }).isVisible(),
    "Same unique Product Barcode available for reprint",
  );
  await page.getByLabel("Finished Product transfer barcode").fill("PRD-SECOND");
  await page.getByLabel("Finished Product transfer barcode").press("Enter");
  await page.getByLabel("Move PRD-SECOND").waitFor();
  check(
    await page.getByLabel("Move PRD-1234567").isChecked(),
    "First scanned piece outside loaded pages remains visible and selected",
  );
  check(
    await page.getByLabel("Move PRD-SECOND").isChecked(),
    "Second exact scanned piece also selected",
  );
  await page.getByLabel("Destination location", { exact: true }).selectOption("floor");
  await page.getByLabel("Finished Product transfer reason").fill("Showroom display");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Finished transfer fits ${width}px`,
    );
  }
  await page.getByRole("button", { name: "Post Finished Product transfer", exact: true }).click();
  await page.getByRole("button", { name: "Retry same transfer", exact: true }).waitFor();
  check(
    await page.getByLabel("Destination location", { exact: true }).isDisabled(),
    "Interrupted transfer freezes destination",
  );
  await page.getByRole("button", { name: "Retry same transfer", exact: true }).click();
  await page.getByText(/Posted transfer/).waitFor();
  const transfers = await page.evaluate(() =>
    window.productionCalls.filter((c) => c.name === "transfer_finished_products"),
  );
  check(
    transfers.length === 2 &&
      JSON.stringify(transfers[0].args) === JSON.stringify(transfers[1].args),
    "Transfer retry uses same immutable payload",
  );
  check(
    transfers[0].args.p_pieces.length === 2,
    "Both scanned physical products retained in transfer review/payload",
  );
  check(
    transfers[0].args.p_source === "workshop" &&
      transfers[0].args.p_destination === "floor" &&
      transfers[0].args.p_pieces[0] === "piece",
    "Staff posts direct Workshop-to-floor transfer",
  );
  check(
    !(await page.evaluate(() => window.productionCalls)).some(
      (c) => c.name.includes("receive") || c.name.includes("confirm_transfer"),
    ),
    "No receiving confirmation call",
  );
  await page.getByRole("button", { name: "Toggle transfer permission", exact: true }).click();
  check(
    (await page
      .getByRole("heading", { name: "Finished Product inventory & transfers", exact: true })
      .count()) === 0,
    "Owner permission denial hides staff action",
  );
  await page.getByRole("button", { name: "Owner scan fixture", exact: true }).click();
  await page.getByText(/Production totals.*Produced: 3.*Sold: 1.*Remaining in stock: 2/).waitFor();
  check(true, "Owner sees produced/sold/remaining on product scan");
  check(
    (await page.getByText(/T-A.*Tailor A.*T-B.*Tailor B/).count()) > 0,
    "Both Tailors appear in piece genealogy",
  );
  check(errors.length === 0, "No browser errors");
  await fs.writeFile(
    "docs/OWNER_PRODUCTION_WORKFLOW_UI_VERIFICATION.json",
    JSON.stringify(
      { verified_at: new Date().toISOString(), checks, errors, passed: true },
      null,
      2,
    ),
  );
  console.log(`PASS: ${checks} Owner Production workflow browser checks`);
} finally {
  await browser?.close();
  await server.close();
}
