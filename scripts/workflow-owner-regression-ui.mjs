import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve("scripts/fixtures/owner-business");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "owner-business-vite"),
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
  await page.clock.setFixedTime(new Date("2026-10-15T08:00:00Z"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5198");
  await page.getByLabel("Operational date").fill("2026-10-13");
  await page.getByText("₹550.00", { exact: true }).first().waitFor();
  check(
    await page.getByText("₹50.00", { exact: true }).isVisible(),
    "Booking distinct from paid sales",
  );
  check(
    (await page.locator('a[href*="payment=payment_confirmed"]').count()) === 3,
    "KPIs drill into paid sales",
  );
  check(
    await page.getByRole("heading", { name: "Selected-day operations" }).isVisible(),
    "Daily operations are always visible",
  );
  check(
    await page.getByText("E-commerce sales", { exact: true }).isVisible(),
    "Online channel total visible",
  );
  check(
    await page.getByText("20 Thaans", { exact: true }).isVisible(),
    "Stock registrations counted",
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
  await page.getByLabel("Operational date").fill("2026-10-13");
  await page.getByText("20 Thaans", { exact: true }).waitFor();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "Dashboard fits " + width,
    );
    await page.locator("main").screenshot({ path: `docs/WORKFLOW_OWNER_BUSINESS_DASHBOARD_${width}.png` });
  }
  await page.goto("http://127.0.0.1:5198?reports=1");
  await page.getByRole("heading", { name: "Business performance", exact: true }).waitFor();
  check(
    (await page.getByLabel("From date").inputValue()) === "2026-09-01",
    "Default last completed calendar month",
  );
  await page.getByText("No previous-period sales to compare", { exact: true }).waitFor();
  check(
    await page.getByText("Compare 2026-08-01 through 2026-08-31", { exact: false }).isVisible(),
    "Comparison is previous complete month",
  );
  await page.locator("main").screenshot({ path: "docs/WORKFLOW_OWNER_BUSINESS_REPORTS_1440.png" });
  await page.getByLabel("Ranking measure").selectOption("quantity");
  check(
    await page
      .getByLabel("Business ranking chart")
      .getByText("2.500 m", { exact: true })
      .isVisible(),
    "Ranking uses real metres",
  );
  const rankingPanel = page
    .locator("section.panel")
    .filter({ has: page.getByRole("heading", { name: "Sales rankings", exact: true }) });
  await rankingPanel.getByRole("button", { name: "Next", exact: true }).click();
  check(
    await rankingPanel.getByText("Page 2 of 2", { exact: true }).isVisible(),
    "Rankings paginate all groups",
  );
  await rankingPanel.locator("summary").first().click();
  check(
    await rankingPanel.getByText("2026-09-01", { exact: true }).first().isVisible(),
    "Ranking full record exposes its actual period",
  );
  await rankingPanel.getByRole("button", { name: "Previous", exact: true }).click();
  await page.getByLabel("Ranking measure").selectOption("margin");
  check(
    await page.getByText("1 groups excluded", { exact: false }).isVisible(),
    "Unknown costs excluded, never zero margin",
  );
  await page.getByLabel("Business ranking", { exact: true }).selectOption("product");
  await page.getByLabel("Ranking measure").selectOption("quantity");
  check(
    (await page.getByRole("option", { name: "Pieces sold", exact: true }).count()) === 1,
    "Product ranking changes unit",
  );
  await page.getByLabel("Business ranking", { exact: true }).selectOption("salesperson");
  check(
    await page
      .getByLabel("Business ranking chart")
      .getByText("Credited Person 15", { exact: true })
      .isVisible(),
    "Credited people ranked instead of operators",
  );
  await page.getByLabel("Report month").fill("2026-08");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await page.getByText("2026-08-01 through 2026-08-31", { exact: false }).first().waitFor();
  check(
    (await page.getByLabel("From date").inputValue()) === "2026-08-01",
    "Month shortcut updates full range",
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "Reports fit " + width,
    );
  }
  await page.goto("http://127.0.0.1:5198?reports=1&from=2026-09-01&through=2026-09-30");
  await page.getByRole("heading", { name: "Business performance", exact: true }).waitFor();
  await page.evaluate(() => (window.ownerFail = "owner_monthly_business"));
  await page.getByLabel("Report month").fill("2026-07");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  try { await page.getByText("Could not load this data.", { exact: false }).waitFor({timeout:5000}); } catch(e){ console.log(await page.locator('body').innerText());console.log(await page.evaluate(()=>JSON.stringify(window.ownerCalls.slice(-6))));throw e; }
  await page.evaluate(() => (window.ownerFail = undefined));
  await page.getByRole("button", { name: "Try again" }).first().click();
  await page.getByText("No sales in either period", { exact: true }).waitFor();
  await page.goto("http://127.0.0.1:5198?staff=1");
  await page.getByText("Owner access is required.", { exact: true }).waitFor();
  check(
    (await page.evaluate(() => window.ownerCalls.length)) === 0,
    "Staff makes no reporting requests",
  );
  check(errors.length === 0, "No browser errors");
  await fs.writeFile(
    "docs/WORKFLOW_OWNER_BUSINESS_ANALYTICS_UI_VERIFICATION.json",
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
