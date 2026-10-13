import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve("scripts/fixtures/owner-workspace");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "owner-workspace-vite"),
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
  server: { host: "127.0.0.1", port: 5198, strictPort: true, fs: { allow: [process.cwd()] } },
});
let browser,
  checks = 0;
const errors = [];
const check = (v, label) => {
  assert(v, label);
  checks++;
};
try {
  await server.listen();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5198");
  await page.getByLabel("Operational date").fill("2026-10-13");
  await page.getByText("₹300.00", { exact: true }).waitFor();
  check(
    await page.getByText("₹50.00", { exact: true }).isVisible(),
    "Booking distinct from paid sales",
  );
  check(
    (await page.locator('a[href*="payment=payment_confirmed"]').count()) === 3,
    "KPIs drill into paid sales",
  );
  await page.getByLabel("Sales trend", { exact: true }).selectOption("bills");
  check(
    await page.getByRole("heading", { name: "Sales trend", exact: true }).isVisible(),
    "Trend switches without changing day",
  );
  check(
    (await page.getByLabel("Operational date").inputValue()) === "2026-10-13",
    "Dropdown preserves global date",
  );
  await page.getByLabel("Inventory view").selectOption("fabric");
  check(
    await page.getByText("12.500 m", { exact: true }).isVisible(),
    "Current fabric amount keeps exact units",
  );
  check(
    (await page.getByText("Shirt", { exact: true }).count()) === 0,
    "Fabric view excludes finished pieces",
  );
  await page.getByLabel("Production view").selectOption("usage");
  await page.getByText("3.000 m", { exact: true }).first().waitFor();
  check(
    (await page.getByText("Recorded Finished Piece Allocations", { exact: false }).count()) === 0,
    "Usage scope retained as recorded field",
  );
  await page.getByRole("tab", { name: "Pending Reviews" }).click();
  await page.getByText("OP-2", { exact: true }).first().waitFor();
  check(
    await page.getByText("OP-2", { exact: true }).first().isVisible(),
    "Reviews have underlying records",
  );
  await page.getByLabel("Operational date").fill("2026-10-12");
  await page.getByText("₹0.00", { exact: true }).first().waitFor();
  check(
    await page.getByText("12.500 m", { exact: true }).isVisible(),
    "Historical day does not time travel current stock",
  );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "Dashboard fits " + width,
    );
    await page.locator("main").screenshot({ path: `docs/OWNER_DASHBOARD_${width}.png` });
  }
  await page.goto("http://127.0.0.1:5198?staff=1");
  await page.getByText("Owner access is required.", { exact: true }).waitFor();
  check(
    (await page.evaluate(() => window.ownerCalls.length)) === 0,
    "Staff makes no reporting requests",
  );
  check(errors.length === 0, "No browser errors");
  await fs.writeFile(
    "docs/OWNER_DASHBOARD_UI_VERIFICATION.json",
    JSON.stringify(
      { verified_at: new Date().toISOString(), checks, passed: true, errors },
      null,
      2,
    ),
  );
  console.log("PASS: " + checks + " dashboard checks");
} finally {
  await browser?.close();
  await server.close();
}
