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
const fixture = path.resolve("scripts/fixtures/workshop-inventory");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "labels-first-stock-entry-vite-cache"),
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      { find: "@/app/providers/session", replacement: path.join(fixture, "session.tsx") },
      { find: "@/integrations/supabase/client", replacement: path.join(fixture, "client.ts") },
      { find: /^@\/features\/inventory$/, replacement: path.join(fixture, "inventory.ts") },
      { find: "@", replacement: path.resolve("src") },
    ],
  },
  server: { host: "127.0.0.1", port: 5195, strictPort: true, fs: { allow: [process.cwd()] } },
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
  await page.goto("http://127.0.0.1:5195");
  await page.getByRole("heading", { name: "B0002 - Raymonds", exact: true }).waitFor();
  check((await page.locator("tbody tr").count()) === 3, "Every Thaan is an individual row");
  const headings = await page.locator("h2").allTextContents();
  check(
    headings.indexOf("B0002 - Raymonds") < headings.indexOf("B0001 - Arvind"),
    "Newest batch appears first",
  );
  check(
    (await page.getByRole("columnheader", { name: "CP / metre", exact: true }).count()) === 2,
    "CP replaces SP",
  );
  check(
    (await page.getByRole("columnheader", { name: "SP / m", exact: true }).count()) === 0,
    "No SP column",
  );
  check(
    (await page.getByLabel("Search Fabric Stock", { exact: true }).count()) === 0,
    "Lower redundant search removed",
  );
  await page.getByLabel("Incomplete only", { exact: true }).check();
  check((await page.locator("tbody tr").count()) === 2, "Zero and missing CP included");
  await page.getByLabel("Upper inventory search").fill("Raymonds");
  check(
    (await page.locator("tbody tr").count()) === 1,
    "Upper search combines with incomplete filter",
  );
  await page.getByLabel("Incomplete only", { exact: true }).uncheck();
  check((await page.locator("tbody tr").count()) === 2, "Unchecking retains search");
  await page.getByLabel("Search or scan Workshop stock", { exact: true }).fill("AND-20001a");
  await page.getByLabel("Search or scan Workshop stock", { exact: true }).press("Enter");
  check(
    (await page.locator("tbody tr").count()) === 1 &&
      (await page.getByRole("heading", { name: "B0001 - Arvind", exact: true }).isVisible()),
    "Scanner filters rows and retains batch/type context",
  );
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: "Barcode for RDS-10001a", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  check(
    await page.getByRole("img", { name: "Barcode RDS-10001a", exact: true }).isVisible(),
    "Exact Thaan barcode popup",
  );
  await page.evaluate(() => {
    window.printedLabels = [];
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLIFrameElement.prototype,
      "contentWindow",
    );
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      get() {
        const win = descriptor.get.call(this);
        win.print = () => window.printedLabels.push(this.contentDocument.body.innerText);
        return win;
      },
      configurable: true,
    });
  });
  await page.getByRole("button", { name: "Print this barcode", exact: true }).click();
  check(
    await page.evaluate(
      () =>
        window.printedLabels[0].includes("RDS-10001a") &&
        !window.printedLabels[0].includes("RDS-10001b"),
    ),
    "Print only selected identity, no CP",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Cotton - Thaan 2", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByLabel("CP per metre", { exact: true }).fill("125");
  await page.getByLabel("Correction reason").fill("Actual supplier cost");
  await page.getByRole("button", { name: "Save details", exact: true }).click();
  await page.getByRole("button", { name: "Retry same request", exact: true }).waitFor();
  check(
    await page.getByLabel("CP per metre", { exact: true }).isDisabled(),
    "Uncertain save freezes editor",
  );
  await page.getByRole("button", { name: "Retry same request", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const edits = await page.evaluate(() =>
    window.inventoryCalls.filter((c) => c.name === "edit_workshop_thaan"),
  );
  check(
    edits.length === 2 && JSON.stringify(edits[0].args) === JSON.stringify(edits[1].args),
    "Exact edit retry retains version, changes and request",
  );
  await page.getByLabel("Incomplete only", { exact: true }).check();
  check(
    (await page.locator("tbody tr").count()) === 1,
    "Positive corrected CP removes completed row",
  );
  await page.getByLabel("Incomplete only", { exact: true }).uncheck();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Hierarchy fits ${width}px`,
    );
    if (width === 390 || width === 1440)
      await page.locator("main").screenshot({
        path: `docs/WORKSHOP_INVENTORY_${width === 1440 ? "DESKTOP" : "MOBILE"}.png`,
      });
  }
  check(errors.length === 0, "No browser errors");
  await fs.writeFile(
    "docs/WORKSHOP_INVENTORY_UI_VERIFICATION.json",
    JSON.stringify(
      { verified_at: new Date().toISOString(), checks, passed: true, errors },
      null,
      2,
    ),
  );
  console.log(`PASS: ${checks} Workshop inventory UI checks`);
} finally {
  await browser?.close();
  await server.close();
}
