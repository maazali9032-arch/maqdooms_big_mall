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

  await page.goto("http://127.0.0.1:5198?reports=1&from=2026-10-13&through=2026-10-13#orders");
  await page.getByText("₹300.00", { exact: true }).waitFor();
  check(
    await page.getByText("₹50.00", { exact: true }).first().isVisible(),
    "Bookings separate from collections",
  );
  check(
    (await page.getByRole("button", { name: "Sales & Payments", exact: true }).count()) === 1,
    "Category navigation",
  );
  check(
    await page.getByText("BILL-FAB", { exact: true }).first().isVisible(),
    "Completion date retains earlier-created paid bill",
  );
  check(
    await page.getByText("4 matching records", { exact: true }).isVisible(),
    "All server cursor pages loaded",
  );
  await page.getByLabel("Payment / booking state").selectOption("payment_confirmed");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  check(
    await page.getByText("2 matching records", { exact: true }).isVisible(),
    "Paid filter excludes bookings and unpaid",
  );
  await page.getByLabel("Search report").fill("BILL-FAB");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  check(
    await page.getByText("1 matching records", { exact: true }).isVisible(),
    "Exact identifier search across full evidence",
  );
  await page.getByText("Full record", { exact: true }).click();
  check(
    await page.getByText("2026-10-01T08:00:00Z", { exact: true }).isVisible(),
    "Complete underlying evidence retained",
  );
  await page.getByRole("button", { name: "Stock & Inventory", exact: true }).click();
  await page.getByText("12.500 m", { exact: true }).first().waitFor();
  check(
    await page.getByLabel("From date", { exact: true }).isDisabled(),
    "Current stock disables historical date implication",
  );
  check(
    await page.getByLabel("Location", { exact: true }).isVisible(),
    "Stock location filter supported",
  );
  check(
    (await page.getByLabel("Payment / booking state").count()) === 0,
    "Irrelevant payment filter absent",
  );
  await page.getByLabel("Location", { exact: true }).selectOption("Workshop");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  check(
    await page.getByText("1 matching records", { exact: true }).isVisible(),
    "Location filter applies to records and summaries",
  );
  await page.getByRole("button", { name: "Production & Costs", exact: true }).click();
  await page.getByRole("button", { name: "Recorded cost revisions", exact: true }).click();
  await page.getByRole("cell", { name: "OP-2", exact: true }).first().waitFor();
  await page.getByLabel("Cost evidence").selectOption("false");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  check(
    await page.getByText("1 matching records", { exact: true }).isVisible(),
    "Cost evidence filter preserves unfinalized record",
  );
  check(
    (await page.getByText("Recorded piece costs", { exact: true }).count()) === 0,
    "No fabricated cost total for unfinalized revision",
  );

  await page.getByRole("button", { name: "Finished Products", exact: true }).click();
  await page.getByText("31 matching records", { exact: true }).waitFor();
  await page.getByLabel("Rows per page", { exact: true }).selectOption("10");
  check(
    await page.getByText("Page 1 of 4", { exact: true }).isVisible(),
    "Client page size covers full result",
  );
  await page.getByRole("button", { name: "Next", exact: true }).click();
  check(await page.getByText("Page 2 of 4", { exact: true }).isVisible(), "Next evidence page");
  await page.getByRole("button", { name: "Sort by Barcode", exact: true }).click();
  check(await page.getByText("Page 1 of 4", { exact: true }).isVisible(), "Sort resets pagination");
  check(
    await page.getByRole("cell", { name: "PIECE-00", exact: true }).isVisible(),
    "Sorting applies across full dataset",
  );
  const discovered = [];
  for (const category of [
    "Sales & Payments",
    "Stock & Inventory",
    "Production & Costs",
    "Orders & Tailoring",
    "Finished Products",
    "Transfers & Locations",
    "Audit & Reconciliation",
  ]) {
    await page.getByRole("button", { name: category, exact: true }).click();
    discovered.push(
      ...(await page
        .getByLabel("Report", { exact: true })
        .locator("option")
        .evaluateAll((options) => options.map((o) => o.value))),
    );
  }
  check(new Set(discovered).size === 24, "All 24 datasets mapped once");
  await page.getByRole("button", { name: "Sales & Payments", exact: true }).click();
  await page.getByLabel("From date", { exact: true }).fill("2026-10-14");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  check(await page.getByRole("alert").isVisible(), "Invalid date range rejected before query");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "Reports fit " + width,
    );
    await page.locator("main").screenshot({ path: "docs/OWNER_VISUAL_REPORTS_" + width + ".png" });
  }
  await page.goto("http://127.0.0.1:5198?reports=1&staff=1");
  await page.getByText("Owner access is required.", { exact: true }).waitFor();
  check(
    (await page.evaluate(() => window.ownerCalls.length)) === 0,
    "Staff makes no report requests",
  );
  check(errors.length === 0, "No browser errors");
  await fs.writeFile(
    "docs/OWNER_VISUAL_REPORTS_UI_VERIFICATION.json",
    JSON.stringify(
      { verified_at: new Date().toISOString(), checks, passed: true, errors },
      null,
      2,
    ),
  );
  console.log("PASS: " + checks + " Reports checks");
} finally {
  await browser?.close();
  await server.close();
}
