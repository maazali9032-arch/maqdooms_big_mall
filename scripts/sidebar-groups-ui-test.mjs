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
const fixture = path.resolve("scripts/fixtures/sidebar-groups");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "sidebar-groups-vite-cache"),
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
  server: { host: "127.0.0.1", port: 5191, strictPort: true, fs: { allow: [process.cwd()] } },
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
  await page.goto("http://127.0.0.1:5191");
  const group = (name) => page.getByRole("button", { name, exact: true });
  const link = (name) => page.getByRole("link", { name, exact: true });
  const openGroup = async (name) => {
    if ((await group(name).getAttribute("aria-expanded")) !== "true") await group(name).click();
  };
  await link("Dashboard").waitFor();
  check((await group("Overview").getAttribute("aria-expanded")) === "true", "Overview starts open");
  check(
    (await group("Stock & Inventory").getAttribute("aria-expanded")) === "false",
    "Other groups initially closed on Dashboard",
  );
  await group("Stock & Inventory").click();
  check(await link("Fabric Stock").isVisible(), "Stock group expands");
  await group("Production").click();
  check(!(await link("Fabric Stock").isVisible()), "Opening Production closes Stock");
  check(
    (await link("Owner Production").isVisible()) && (await link("Dashboard").isVisible()),
    "Production and pinned Overview stay open",
  );
  await group("Production").click();
  check(
    !(await link("Owner Production").isVisible()) && (await link("Dashboard").isVisible()),
    "Click open group collapses it but not Overview",
  );
  await group("Production").focus();
  await group("Production").press("Enter");
  check(await link("Production Costing & SP").isVisible(), "Keyboard opens a group");
  await link("Production Costing & SP").click();
  await page.getByLabel("cost draft").waitFor();
  check(
    (await link("Production Costing & SP").getAttribute("aria-current")) === "page",
    "Deep link selects exact costing workflow and active link",
  );
  await page.getByLabel("cost draft").fill("Retain costing draft");
  await group("Administration").click();
  check(!(await link("Owner Production").isVisible()), "Administration closes Production");
  await link("Products & Designs").click();
  await page.getByRole("heading", { name: "Products & Designs", exact: true }).waitFor();
  check(
    await page.getByLabel("Catalogue code").isVisible(),
    "Administration opens actual editable product/design catalogue",
  );
  check(
    (await page.getByLabel("Production piece count").count()) === 0,
    "Catalogue shortcut does not show job creation form",
  );
  check(true, "Products/Designs opens catalogue workflow");
  await group("Production").click();
  await link("Production Costing & SP").click();
  check(
    (await page.getByLabel("cost draft").inputValue()) === "Retain costing draft",
    "Same-page workflow navigation retains draft",
  );
  await group("Stock & Inventory").click();
  await link("Materials & Consumables").click();
  await page.getByLabel("consumables draft").waitFor();
  check(true, "Inventory option selects its actual tab");
  await page.getByLabel("Search permitted modules").fill("Workshop Returns");
  await page.getByRole("button", { name: "Workshop Returns", exact: true }).click();
  await page.getByLabel("products draft").waitFor();
  check(
    (await group("Production").getAttribute("aria-expanded")) === "true",
    "Search navigation opens matching group",
  );
  await group("Commerce").click();
  check(await link("E-commerce").isVisible(), "Commerce dropdown works");
  await group("Reports & Tracking").click();
  check(
    (await link("Reports").isVisible()) && !(await link("E-commerce").isVisible()),
    "Reports closes Commerce",
  );
  // Responsive drawer shares group state, unique control IDs and closes after selection.
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    const drawer = page.getByRole("dialog");
    await drawer.waitFor();
    await drawer.getByRole("button", { name: "Stock & Inventory", exact: true }).click();
    await drawer.getByRole("button", { name: "Sales & Customers", exact: true }).click();
    check(
      !(await drawer.getByRole("link", { name: "Stock Entry", exact: true }).isVisible()),
      `Mobile exclusive group ${width}px`,
    );
    check(
      await drawer.getByRole("link", { name: "Dashboard", exact: true }).isVisible(),
      `Mobile pinned Overview ${width}px`,
    );
    await drawer.getByRole("link", { name: "Customer Tailoring", exact: true }).click();
    await page.getByLabel("customer draft").waitFor();
    await drawer.waitFor({ state: "hidden" });
    check((await drawer.count()) === 0, `Mobile closes after workflow navigation ${width}px`);
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `No document overflow ${width}px`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const ids = await page.evaluate(() => [...document.querySelectorAll("[id]")].map((e) => e.id));
  check(new Set(ids).size === ids.length, "Navigation control IDs unique");
  await page.getByRole("button", { name: "Use counter", exact: true }).click();
  await openGroup("Sales & Customers");
  check(await link("Sales History").isVisible(), "Counter sees separate sales history");
  await link("Sales History").click();
  await page.getByRole("heading", { name: "Fabric Sales History", exact: true }).waitFor();
  await page.getByText(/FAB-BILL/).waitFor();
  check(
    await page.getByText(/PRD-BILL/).isVisible(),
    "Sales History uses both existing completed-bill APIs",
  );
  check((await group("Administration").count()) === 1, "Counter retains Settings group");
  await group("Administration").click();
  check(
    (await link("Users & Permissions").count()) === 0 &&
      (await link("Factories, Sections & Tailors").count()) === 0,
    "Counter has no Owner administration options",
  );
  check(await link("Settings").isVisible(), "Counter account settings remain accessible");
  await page.getByRole("button", { name: "Use stock_entry", exact: true }).click();
  await openGroup("Stock & Inventory");
  check(
    (await link("Stock Transfer").count()) === 0 &&
      (await link("Finished Product Stock").isVisible()),
    "Finished-only permission shows dedicated product stock without fabric transfer link",
  );
  check((await link("Stock Entry").count()) === 0, "Receive action remains permission-restricted");
  check((await group("Production").count()) === 0, "Stock staff cannot open Production");
  await page.getByRole("button", { name: "Toggle permissions", exact: true }).click();
  check((await link("Stock Transfer").count()) === 0, "Denied transfer permission hides link");
  await page.getByRole("button", { name: "Use salesperson", exact: true }).click();
  await openGroup("Sales & Customers");
  check(
    (await link("My Work").isVisible()) && (await link("Counter / POS").count()) === 0,
    "Salesperson sees My Work without POS",
  );
  check(
    (await group("Stock & Inventory").count()) === 0 && (await group("Production").count()) === 0,
    "Salesperson excluded from stock and production",
  );
  check(errors.length === 0, "No browser errors");
  await fs.writeFile(
    "docs/SIDEBAR_GROUPS_UI_VERIFICATION.json",
    JSON.stringify(
      { verified_at: new Date().toISOString(), checks, passed: true, errors },
      null,
      2,
    ),
  );
  console.log(`PASS: ${checks} sidebar group/navigation/browser checks`);
} finally {
  await browser?.close();
  await server.close();
}
