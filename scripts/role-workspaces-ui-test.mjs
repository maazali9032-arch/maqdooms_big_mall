/** Actual role components with synthetic data only; no hosted accounts or stock writes. */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve("scripts/fixtures/role-workspaces");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "role-workspaces-vite-cache"),
  plugins: [react(), tailwind()],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://fixture.supabase.co"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("fixture"),
  },
  resolve: {
    alias: [
      { find: "@/app/providers/session", replacement: path.join(fixture, "session.tsx") },
      { find: "@/integrations/supabase/client", replacement: path.join(fixture, "client.ts") },
      { find: "@supabase/supabase-js", replacement: path.join(fixture, "sdk.ts") },
      { find: "@", replacement: path.resolve("src") },
    ],
  },
  server: { host: "127.0.0.1", port: 5194, strictPort: true, fs: { allow: [process.cwd()] } },
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
  await page.goto("http://127.0.0.1:5194");
  const nav = page.getByRole("navigation", { name: "Role sidebar" });
  for (const [role, names] of Object.entries({
    production: ["Fabric", "Ongoing Production", "Account"],
    stock_entry: [
      "Stock Entry",
      "Stock Transfer",
      "Stock Inventory",
      "Finished Products",
      "Account",
    ],
    counter: ["Counter / POS", "Account"],
    ecommerce_manager: ["Showroom Fabric", "Showroom Finished Products", "Account"],
    tailor: ["Customer Tailoring", "Production Tailoring", "Account"],
    salesperson: ["My Work", "Account"],
  })) {
    await page.getByRole("button", { name: "Use " + role, exact: true }).click();
    check(
      JSON.stringify(await nav.getByRole("link").allTextContents()) === JSON.stringify(names),
      "Exact " + role + " sidebar",
    );
  }
  await page.getByRole("button", { name: "Use combined", exact: true }).click();
  check(
    (await nav.getByRole("link").allTextContents()).includes("Stock Entry") &&
      (await nav.getByRole("link").allTextContents()).includes("Counter / POS"),
    "Multiple roles union",
  );
  await page.getByRole("button", { name: "Use owner", exact: true }).click();
  for (const name of ["Dashboard", "Reports & Analytics", "Audit Trail", "Users & Permissions"])
    check((await nav.getByRole("link", { name, exact: true }).count()) === 1, "Owner " + name);
  await page.getByRole("button", { name: "Use production", exact: true }).click();
  await page.getByLabel("Production fabric barcode").fill("TH-1");
  await page.getByLabel("Production fabric barcode").press("Enter");
  await page.getByText("Workshop: 50 m", { exact: true }).waitFor();
  await page.getByLabel("Production material source").selectOption("workshop");
  await page.getByRole("button", { name: "Allocate scanned Thaan thaan", exact: true }).click();
  await page.getByLabel("Production Product").selectOption("product");
  await page.getByLabel("Production Design").selectOption("custom");
  await page.getByLabel("Custom production design").fill("Custom embroidery");
  await page.getByLabel("Production size", { exact: true }).fill("38");
  await page.getByLabel("Production piece count").fill("5");
  await page.getByLabel("Production Factory").selectOption("factory");
  await page.getByLabel("Production Section").selectOption("section");
  await page.getByLabel("Assign T1 · Tailor A", { exact: true }).check();
  await page.getByLabel("Total required quantity 1").fill("25");
  await page.getByLabel("Production creation reason").fill("Initial issue");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "Production fits " + width,
    );
  }
  await page
    .getByRole("button", { name: "Create Production Job and issue materials", exact: true })
    .click();
  await page.getByRole("button", { name: "Retry same Production Job", exact: true }).waitFor();
  check(
    await page.getByLabel("Production size", { exact: true }).isDisabled(),
    "Production request frozen on uncertain response",
  );
  await page.getByRole("button", { name: "Retry same Production Job", exact: true }).click();
  await page.getByRole("button", { name: "Print Production ID", exact: true }).waitFor();
  const created = await page.evaluate(() =>
    window.roleCalls.filter((c) => c.name === "create_production_batch"),
  );
  check(
    created.length === 2 && JSON.stringify(created[0].args) === JSON.stringify(created[1].args),
    "Full creation retry immutable",
  );
  check(
    created[0].args.p_size === "38" &&
      created[0].args.p_custom_design === "Custom embroidery" &&
      created[0].args.p_items[0].quantity === 25000,
    "Size custom design and exact 25m sent",
  );
  check(
    !(await page.locator("main").innerText()).includes("1040000"),
    "Production document hides CP",
  );
  await page.getByRole("button", { name: "Use stock_entry", exact: true }).click();
  await page.getByRole("button", { name: "Screen receipt", exact: true }).click();
  await page.getByLabel("Workshop Production ID").fill("PJ-TEST");
  await page.getByRole("button", { name: "Load production", exact: true }).click();
  await page.getByText(/Total issued fabric CP: ₹10400.00/).waitFor();
  await page.getByLabel("Workshop receipt or price confirmation").fill("All five arrived");
  await page
    .getByRole("button", { name: "Receive all 5 pieces into Workshop", exact: true })
    .click();
  await page.getByRole("button", { name: "Retry same whole receipt", exact: true }).waitFor();
  check(
    await page.getByLabel("Workshop Production ID").isDisabled(),
    "Receipt freezes uncertain request",
  );
  await page.getByRole("button", { name: "Retry same whole receipt", exact: true }).click();
  await page.getByLabel("SP for all Workshop pieces").waitFor();
  await page.getByLabel("SP for all Workshop pieces").fill("4000");
  await page.getByRole("button", { name: "Apply SP to all Workshop pieces", exact: true }).click();
  check(
    (await page.getByLabel("SP for piece 5", { exact: true }).inputValue()) === "4000",
    "SP applies to all five pieces",
  );
  await page.getByRole("button", { name: "Save Workshop SP", exact: true }).click();
  await page.getByRole("button", { name: "Retry same SP request", exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry same SP request", exact: true }).click();
  await page.getByText("SP: ₹4000.00", { exact: true }).first().waitFor();
  for (const api of ["complete_production_batch", "set_workshop_product_sp"]) {
    const calls = await page.evaluate(
      (name) => window.roleCalls.filter((c) => c.name === name),
      api,
    );
    check(
      calls.length === 2 && JSON.stringify(calls[0].args) === JSON.stringify(calls[1].args),
      api + " retry unchanged",
    );
  }
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "Receipt labels fit " + width,
    );
  }
  await page.getByRole("button", { name: "Use counter", exact: true }).click();
  await page.getByRole("button", { name: "Screen extra", exact: true }).click();
  await page.getByLabel("Additional issue Production ID").fill("PJ-TEST");
  await page.getByRole("button", { name: "Load Production ID", exact: true }).click();
  await page.getByRole("button", { name: "Print Production ID", exact: true }).waitFor();
  check(
    !(await page.locator("main").innerText()).includes("Total issued fabric CP"),
    "Counter no CP",
  );
  await page.getByLabel("Additional production Thaan barcode").fill("TH-1");
  await page.getByRole("button", { name: "Scan Thaan", exact: true }).click();
  await page.getByLabel("Additional production source").selectOption("workshop");
  await page.getByLabel("Additional production metres").fill("1");
  await page.getByLabel("Additional production reason").fill("Extra requested");
  await page.getByRole("button", { name: "Issue additional fabric", exact: true }).click();
  await page.getByRole("button", { name: "Retry same fabric issue", exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry same fabric issue", exact: true }).click();
  const extra = await page.evaluate(() =>
    window.roleCalls.filter((c) => c.name === "issue_additional_production_fabric"),
  );
  check(
    extra.length === 2 &&
      JSON.stringify(extra[0].args) === JSON.stringify(extra[1].args) &&
      extra[0].args.p_quantity_mm === 1000,
    "Extra fabric exact same production retry",
  );
  await page.getByRole("button", { name: "Use ecommerce_manager", exact: true }).click();
  await page.getByRole("button", { name: "Screen ecom", exact: true }).click();
  await page.getByText("10 m", { exact: true }).waitFor();
  check(!(await page.locator("main").innerText()).includes("Workshop"), "Ecom no reserve");
  await page.getByRole("button", { name: "Screen account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("New fixture name");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await page.getByText("Name updated", { exact: true }).waitFor();
  await page.getByLabel("New password", { exact: true }).fill("Synthetic123");
  await page.getByLabel("Confirm password", { exact: true }).fill("Synthetic123");
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await page.getByText("Password updated", { exact: true }).waitFor();
  check(
    (await page.getByLabel("New password", { exact: true }).inputValue()) === "",
    "Password cleared after save",
  );
  await page.getByRole("button", { name: "Use owner", exact: true }).click();
  await page.getByRole("button", { name: "Add staff fixture", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Production Staff");
  await dialog.getByLabel("Email", { exact: true }).fill("production@fixture.test");
  await dialog.getByLabel("Temporary password").fill("Synthetic123");
  await dialog.getByLabel("Staff role", { exact: true }).selectOption("production");
  await dialog.getByRole("button", { name: "Create staff account", exact: true }).click();
  await dialog.getByRole("button", { name: "Retry role assignment", exact: true }).waitFor();
  check(
    await dialog.getByLabel("Email", { exact: true }).isDisabled(),
    "Pending role assignment freezes identity",
  );
  await dialog.getByRole("button", { name: "Retry role assignment", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const signup = await page.evaluate(() => window.roleCalls.filter((c) => c.name === "signUp"));
  check(signup.length === 1, "Signup not repeated when role response interrupted");
  check(
    (await nav.getByRole("link", { name: "Dashboard", exact: true }).count()) === 1,
    "Owner session retained",
  );
  check(errors.length === 0, "No React errors: " + errors.join("; "));
  await fs.writeFile(
    "docs/ROLE_WORKSPACES_UI_VERIFICATION.json",
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        checks,
        passed: true,
        widths: [320, 390, 768, 1440],
        synthetic_only: true,
      },
      null,
      2,
    ),
  );
  console.log("PASS: " + checks + " role workspace browser checks");
} finally {
  await browser?.close();
  await server.close();
}
