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
const fixture = path.resolve("scripts/fixtures/salesperson-tailoring");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "salesperson-tailoring-vite-cache"),
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
  server: { host: "127.0.0.1", port: 5189, strictPort: true, fs: { allow: [process.cwd()] } },
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
  await page.goto("http://127.0.0.1:5189");
  await page.getByRole("heading", { name: "Direct Fabric Sale", exact: true }).waitFor();
  check(
    await page
      .getByRole("button", { name: "Complete Direct Fabric Sale", exact: true })
      .isDisabled(),
    "Cannot bill without credited Salesperson",
  );
  await page.getByLabel("Fabric Barcode", { exact: true }).fill("RDS-12345678c");
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await page.getByLabel("Stock location", { exact: true }).selectOption("floor2");
  await page.getByLabel("Salesperson ID", { exact: true }).selectOption("sales-one");
  await page.getByPlaceholder("Cut metres", { exact: true }).fill("3");
  check(
    (await page.getByLabel("Selling price per metre (₹)").inputValue()) === "",
    "Stitching does not require fabric SP",
  );
  await page
    .getByRole("button", { name: "Use selected metres for stitching", exact: true })
    .click();
  await page.getByRole("heading", { name: "Customer Tailoring", exact: true }).waitFor();
  check(
    (await page.getByLabel("Salesperson ID", { exact: true }).inputValue()) === "sales-one",
    "Salesperson carried into stitching",
  );
  check(
    await page.getByText(/Cotton \/ B0001 · Than than · 3 m/).isVisible(),
    "Selected metres carried without a sale",
  );
  check(
    (await page.getByLabel("Applicable Tailoring Charge").count()) === 0,
    "No automatic CP plus charge controls",
  );
  await page.getByLabel("Customer", { exact: true }).selectOption("customer");
  await page.getByLabel("Customer Tailoring garment").fill("Suit");
  await page.getByLabel("Factory", { exact: true }).selectOption("factory");
  await page.getByLabel("Section", { exact: true }).selectOption("section");
  await page.getByLabel("Tailor", { exact: true }).selectOption("assignment");
  await page.getByLabel("Final customer total (₹)", { exact: true }).fill("987.65");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Tailoring fits ${width}px`,
    );
  }
  await page
    .getByRole("button", { name: "Create Job / Issue Material to Job / Record Order", exact: true })
    .click();
  await page.getByRole("button", { name: "Retry pending job", exact: true }).waitFor();
  check(
    await page.getByLabel("Final customer total (₹)").isDisabled(),
    "Uncertain booking freezes price",
  );
  check(
    await page.getByRole("button", { name: "Back to fabric sale", exact: true }).isDisabled(),
    "Uncertain booking cannot switch branch",
  );
  await page.getByRole("button", { name: "Retry pending job", exact: true }).click();
  await page.getByText(/Customer Tailoring booked: job/).waitFor();
  const calls = await page.evaluate(() => window.salespersonCalls);
  const bookings = calls.filter((c) => c.name === "book_counter_tailoring");
  check(
    bookings.length === 2 && JSON.stringify(bookings[0].args) === JSON.stringify(bookings[1].args),
    "Exact frozen request retry",
  );
  check(
    bookings[0].args.p_final_price === 98765 &&
      bookings[0].args.p_salesperson === "sales-one" &&
      bookings[0].args.p_items[0].quantity === 3000,
    "Explicit total, Salesperson and exact metres sent",
  );
  check(
    !calls.some((c) =>
      [
        "complete_counter_fabric_sale",
        "quote_customer_tailoring",
        "create_customer_tailoring",
      ].includes(c.name),
    ),
    "Stitching uses only one booking path",
  );
  await page.getByRole("button", { name: "Salesperson fixture", exact: true }).click();
  await page.getByRole("heading", { name: "My Work", exact: true }).waitFor();
  check(
    (await page.getByRole("link", { name: "Counter / POS", exact: true }).count()) === 0,
    "Pure Salesperson has no billing access",
  );
  check(await page.getByText(/CT-BILL · customer tailoring/).isVisible(), "Own bill visible");
  check(
    await page.getByText(/CT-JOB · Suit · open/).isVisible(),
    "Linked stitching progress visible",
  );
  check(
    await page.getByText(/POS operator: counter-user/).isVisible(),
    "Operator distinct from credited Salesperson",
  );
  check(
    await page.getByText(/₹987.65 · 3.000 m/).isVisible(),
    "Personal final total preserves paise",
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `My Work fits ${width}px`,
    );
  }
  await page.getByRole("button", { name: "Other Salesperson fixture", exact: true }).click();
  await page.getByText("No attributed work yet.", { exact: true }).waitFor();
  check(
    (await page.getByText(/CT-BILL · customer tailoring/).count()) === 0,
    "Other Salesperson does not see credited bill",
  );
  await page.getByRole("button", { name: "Owner fixture", exact: true }).click();
  await page.getByRole("heading", { name: "Salesperson work", exact: true }).waitFor();
  check(
    await page.getByText(/CT-BILL · customer tailoring/).isVisible(),
    "Owner sees attributed work",
  );
  await page.getByLabel("Filter Salesperson").selectOption("sales-two");
  await page.getByText("No attributed work yet.", { exact: true }).waitFor();
  check(
    (await page.getByText(/CT-BILL · customer tailoring/).count()) === 0,
    "Owner can filter Salesperson",
  );
  check(errors.length === 0, "No browser errors: " + errors.join(","));
  await fs.writeFile(
    "docs/SALESPERSON_TAILORING_UI_VERIFICATION.json",
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        checks,
        errors,
        mode: "synthetic actual-component fixtures; no live writes/login",
      },
      null,
      2,
    ),
  );
  console.log(`PASS: ${checks} Salesperson/manual tailoring UI checks`);
} finally {
  await browser?.close();
  await server.close();
}
