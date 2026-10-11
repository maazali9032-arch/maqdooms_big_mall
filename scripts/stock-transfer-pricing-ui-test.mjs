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
const fixture = path.resolve("scripts/fixtures/stock-transfer-pricing");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "transfer-pricing-vite-cache"),
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
  server: { host: "127.0.0.1", port: 5188, strictPort: true, fs: { allow: [process.cwd()] } },
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
  await page.goto("http://127.0.0.1:5188");
  await page.getByRole("heading", { name: "Stock Transfer", exact: true }).waitFor();
  check(
    (await page
      .getByRole("link", { name: "Stock Transfer", exact: true })
      .getAttribute("aria-current")) === "page",
    "Active dedicated sidebar",
  );
  await page.getByLabel("Transfer Fabric Barcode").fill("RDS-12345678c");
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  check(
    (await page.getByLabel("Source", { exact: true }).inputValue()) === "workshop",
    "Workshop auto selected",
  );
  await page.getByLabel("Destination", { exact: true }).selectOption("floor1");
  await page.getByLabel("Transfer from Than 1 in metres").fill("30");
  await page.getByLabel("Fabric Transfer reason or reference").fill("Showroom allocation");
  await page.getByRole("button", { name: "Post Stock Transfer", exact: true }).click();
  await page.getByText("Posted 30 m from Workshop to Floor 1.", { exact: true }).waitFor();
  check(
    await page.getByRole("button", { name: "Print same barcode for outgoing piece" }).isEnabled(),
    "Reprint existing code after transfer",
  );
  check(
    await page.getByText("Workshop: 20 m", { exact: true }).isVisible(),
    "Workshop balance refreshed",
  );
  check(
    await page.getByText("Floor 1: 30 m", { exact: true }).isVisible(),
    "Floor balance refreshed",
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Transfer fits ${width}px`,
    );
  }
  await page.getByRole("button", { name: "Counter fixture", exact: true }).click();
  await page.getByRole("heading", { name: "Direct Fabric Sale", exact: true }).waitFor();
  check(
    (await page.getByRole("link", { name: "Stock Transfer", exact: true }).count()) === 0,
    "Counter has no transfer sidebar",
  );
  await page.getByLabel("Fabric Barcode", { exact: true }).fill("RDS-12345678c");
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await page.getByLabel("Stock location", { exact: true }).selectOption("floor1");
  await page.getByLabel("Salesperson ID", { exact: true }).selectOption("sales-one");
  await page.getByLabel("Selling price per metre (₹)", { exact: true }).fill("333.33");
  await page.getByPlaceholder("Cut metres", { exact: true }).fill("2.5");
  check(
    await page.getByText("₹833.33", { exact: true }).isVisible(),
    "Live rate times metres total",
  );
  await page.getByRole("button", { name: "Add cuts to sale", exact: true }).click();
  await page.getByLabel("Customer payment received").check();
  await page.getByRole("button", { name: "Complete Direct Fabric Sale", exact: true }).click();
  await page.waitForFunction(() =>
    window.revisionCalls.some((c) => c.name === "complete_counter_fabric_sale"),
  );
  const sale = await page.evaluate(() =>
    window.revisionCalls.find((c) => c.name === "complete_counter_fabric_sale"),
  );
  check(
    sale.args.p_items[0].sp_paise_per_m === 33333 && sale.args.p_items[0].quantity === 2500,
    "Exact entered price and millimetres submitted",
  );
  await page.getByRole("button", { name: "Owner fixture", exact: true }).click();
  await page.getByRole("link", { name: "Manage Access", exact: true }).click();
  await page.getByLabel("Permission user", { exact: true }).selectOption("staff");
  await page.getByLabel("Transfer stock permission", { exact: true }).selectOption("deny");
  await page.waitForFunction(() =>
    window.revisionCalls.some((c) => c.name === "owner_set_user_permission"),
  );
  check(
    (await page.getByLabel("Transfer stock permission").inputValue()) === "deny",
    "Owner saves per-user denial",
  );
  await page.getByLabel("Transfer stock permission").selectOption("inherit");
  await page.waitForFunction(
    () => window.revisionCalls.filter((c) => c.name === "owner_set_user_permission").length === 2,
  );
  check(
    await page.evaluate(
      () =>
        window.revisionCalls.filter((c) => c.name === "owner_set_user_permission")[1].args
          .p_granted === null,
    ),
    "Reset to inherited role default",
  );
  check(errors.length === 0, "No browser errors: " + errors.join(","));
  await fs.writeFile(
    "docs/STOCK_TRANSFER_PRICING_UI_VERIFICATION.json",
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        checks,
        errors,
        mode: "isolated synthetic fixtures only",
      },
      null,
      2,
    ),
  );
  console.log(`PASS: ${checks} transfer/pricing/permission UI checks`);
} finally {
  await browser?.close();
  await server.close();
}
