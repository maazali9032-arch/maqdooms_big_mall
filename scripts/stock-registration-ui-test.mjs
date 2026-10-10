/** Actual Stock Entry/sidebar components; synthetic backend, no live writes/login. */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve("scripts/fixtures/stock-registration");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "stock-registration-vite-cache"),
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      { find: "@/app/providers/session", replacement: path.join(fixture, "session.tsx") },
      { find: "@/integrations/supabase/client", replacement: path.join(fixture, "client.ts") },
      { find: /^@\/features\/inventory$/, replacement: path.join(fixture, "inventory.ts") },
      { find: "@", replacement: path.resolve("src") },
    ],
  },
  server: { host: "127.0.0.1", port: 5187, strictPort: true, fs: { allow: [process.cwd()] } },
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
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5187");
  await page.getByRole("heading", { name: "1. Create delivery batch" }).waitFor();
  check(
    await page.getByRole("link", { name: "Stock Entry", exact: true }).isVisible(),
    "Stock Entry sidebar link",
  );
  check(
    (await page
      .getByRole("link", { name: "Stock Entry", exact: true })
      .getAttribute("aria-current")) === "page",
    "Stock Entry active sidebar item",
  );
  const provider = page.getByPlaceholder("Select from history or type a provider");
  await provider.fill("Raymonds Textiles");
  await page.getByRole("button", { name: "Create new delivery batch", exact: true }).click();
  await page
    .getByLabel("Delivery batch")
    .locator("option")
    .filter({ hasText: "B0001" })
    .waitFor({ state: "attached" });
  await page.getByLabel("New Fabric Type name").fill("Cotton");
  await page.locator('input[id^="length-"]').first().fill("10");
  await page.locator('input[id^="cp-"]').first().fill("450");
  await page.getByRole("button", { name: "Add another Than", exact: true }).click();
  await page.locator('input[id^="length-"]').nth(1).fill("5");
  await page.getByRole("button", { name: "Register and receive Thans", exact: true }).click();
  await page.getByText(/original 5.000 m/).waitFor();
  check(await page.getByText(/CP not entered/).isVisible(), "Missing CP stays explicit");
  check(
    !(await page.getByText("₹450.00", { exact: false }).count()),
    "Recorded CP not shown to Stock Entry",
  );
  let code = await page.evaluate(
    () => window.stockRegistrationCalls.find((call) => call.name === "register_fabric_type").args,
  );
  check(
    code.p_rows[0].length_mm === 10000 &&
      code.p_rows[1].length_mm === 5000 &&
      code.p_rows[0].cp_paise_per_m === 45000 &&
      code.p_rows[1].cp_paise_per_m === null,
    "Per-Than exact length and optional CP submission",
  );
  for (const detail of await page.locator("details details").all())
    await detail.locator("summary").click();
  const printButtons = page.getByRole("button", { name: /^Print RDS-/ });
  check((await printButtons.count()) === 2, "Separate printable barcode per physical Than");
  const label = await printButtons.nth(1).textContent();
  const barcode = label.replace("Print ", "").trim();
  await page.getByLabel("Registered Than barcode").fill(barcode);
  await page.getByRole("button", { name: "Scan Than", exact: true }).click();
  await page.getByLabel("Missing CP for " + barcode).fill("480");
  await page.getByRole("button", { name: "Save missing CP", exact: true }).click();
  await page.getByLabel("Missing CP for " + barcode).waitFor({ state: "detached" });
  check(
    await page.evaluate(() =>
      window.stockRegistrationCalls.some(
        (call) => call.name === "fill_registered_thaan_cp" && call.args.p_cp === 48000,
      ),
    ),
    "Scan fills exactly selected barcode CP",
  );
  await page.getByLabel("Fabric Type", { exact: true }).selectOption({
    label: await page
      .getByLabel("Fabric Type", { exact: true })
      .locator("option")
      .nth(1)
      .textContent(),
  });
  await page.locator('input[id^="length-"]').first().fill("9");
  await page.getByRole("button", { name: "Register and receive Thans", exact: true }).click();
  await page.getByText(/original 9.000 m/).waitFor();
  check(
    (await page.getByRole("button", { name: /^Print RDS-.*c$/, includeHidden: true }).count()) ===
      1,
    "Append uses existing type and next suffix",
  );
  await page.getByRole("button", { name: "Create new delivery batch", exact: true }).click();
  await page
    .getByLabel("Delivery batch")
    .locator("option")
    .filter({ hasText: "B0002" })
    .waitFor({ state: "attached" });
  check(
    (await page
      .getByLabel("Delivery batch")
      .locator("option")
      .filter({ hasText: "Raymonds Textiles" })
      .count()) === 2,
    "Same provider name creates independent deliveries",
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "No overflow " + width,
    );
    if (width === 320 || width === 1440) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: path.join(os.tmpdir(), "stock-registration-ui-" + width + ".png"),
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Switch to Counter fixture", exact: true }).click();
  await page.getByText("Fixture page", { exact: true }).waitFor();
  check(
    (await page.getByRole("link", { name: "Stock Entry", exact: true }).count()) === 0,
    "Counter has no Stock Entry sidebar",
  );
  check(
    (await page.getByRole("heading", { name: "1. Create delivery batch" }).count()) === 0,
    "Counter redirected away from registration",
  );
  check(errors.length === 0, "No browser runtime errors: " + errors.join(";"));
  await fs.writeFile(
    "docs/STOCK_REGISTRATION_UI_VERIFICATION.json",
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        checks,
        errors,
        viewports: [320, 390, 768, 1440],
        mode: "synthetic fixture only",
      },
      null,
      2,
    ),
  );
  console.log("PASS: " + checks + " Stock Registration browser checks");
} finally {
  await browser?.close();
  await server.close();
}
