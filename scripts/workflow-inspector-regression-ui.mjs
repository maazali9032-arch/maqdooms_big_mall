import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium, devices } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve("scripts/fixtures/barcode-inspector");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "barcode-inspector-vite"),
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
  server: { host: "127.0.0.1", port: 5199, strictPort: true, fs: { allow: [process.cwd()] } },
});
let browser,
  checks = 0;
const errors = [];
const check = (v, label) => {
  assert(v, label);
  checks++;
};
const base = "http://127.0.0.1:5199";
try {
  await server.listen();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await phone.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("button", { name: "Open Global Barcode Inspector" }).click();
  await page.getByText("Camera permission was denied.", { exact: false }).waitFor();
  check(
    await page.getByLabel("Inspect barcode", { exact: true }).isVisible(),
    "Existing shared manual entry works after denied camera",
  );
  await page.getByLabel("Inspect barcode", { exact: true }).fill("AND-909558881");
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await page.getByText("₹400.00", { exact: true }).waitFor();
  check(
    await page.getByRole("heading", { name: "Current stock & location" }).isVisible(),
    "Current balance distinct from lifecycle",
  );
  await page.getByRole("button", { name: "Load older events" }).click();
  await page.getByText("INWARD", { exact: true }).waitFor();
  check(
    await page.getByText("TRANSFER", { exact: true }).isVisible(),
    "Older pagination preserves initial event",
  );
  await page.getByText("TRANSFER", { exact: true }).click();
  check(
    await page
      .getByLabel("Recorded lifecycle")
      .getByText("10.000 m", { exact: true })
      .first()
      .isVisible(),
    "Exact unit conversion in evidence",
  );
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 850 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "Drawer fits phone " + width,
    );
    await page
      .getByRole("dialog")
      .screenshot({ path: `docs/WORKFLOW_OWNER_BARCODE_INSPECTOR_${width}.png` });
  }
  await page.getByLabel("Inspect barcode", { exact: true }).fill("UNKNOWN");
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await page.getByText("No recorded barcode matches", { exact: false }).waitFor();
  check(
    (await page.getByText("₹400.00", { exact: true }).count()) === 0,
    "Unknown clears previous CP and evidence",
  );
  await page.getByLabel("Inspect barcode", { exact: true }).fill("ERROR");
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await page.getByRole("button", { name: "Retry inspection" }).click();
  await page.getByText("₹400.00", { exact: true }).waitFor();
  check(true, "Network failure supports retry");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 768, height: 1024 });
  check(
    (await page.getByRole("button", { name: "Open Global Barcode Inspector" }).count()) === 0,
    "Tablet width removes inspector",
  );
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole("button", {name:"Open Global Barcode Inspector"}).waitFor();
  check(
    await page.getByRole("button", { name: "Open Global Barcode Inspector" }).isVisible(),
    "Phone landscape retains inspector",
  );
  await page.getByRole("button", { name: "Open Global Barcode Inspector" }).click();
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "Landscape drawer fits",
  );
  await page.setViewportSize({ width: 900, height: 1000 });
  check(
    (await page.getByRole("dialog").count()) === 0,
    "Resizing out of phone layout closes drawer",
  );
  for (const role of [
    "stock_entry",
    "counter",
    "tailor",
    "production",
    "salesperson",
    "ecommerce_manager",
  ]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + "?staff=" + role);
    check(
      (await page.getByRole("button", { name: "Open Global Barcode Inspector" }).count()) === 0,
      "No inspector for " + role,
    );
  }
  for (const pageName of ["reports", "audit", "inventory"]) {
    await page.goto(base + "?" + pageName + "=1");
    check(
      (await page.getByRole("button", { name: "Open Global Barcode Inspector" }).count()) === 0,
      "No inspector on " + pageName,
    );
  }
  await page.goto(base + "?camera=scan");
  await page.getByRole("button", { name: "Open Global Barcode Inspector" }).click();
  await page.getByText("₹400.00", { exact: true }).waitFor({ timeout: 30000 });
  check(
    (await page.getByLabel("Inspect barcode", { exact: true }).inputValue()) === "AND-909558881",
    "Actual camera CODE128 decoded through shared lookup",
  );
  check(await page.evaluate(() => window.cameraStops > 0), "Detection stops camera tracks");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Remove Owner access (fixture)" }).click();
  check(
    (await page.getByRole("button", { name: "Open Global Barcode Inspector" }).count()) === 0,
    "Role removal unmounts inspector",
  );
  await page.goto(base + "?camera=delay");
  await page.getByRole("button", { name: "Open Global Barcode Inspector" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.waitForTimeout(650);
  check(
    await page.evaluate(() => window.cameraStops > 0),
    "Late permission response after close stops tracks",
  );
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(base);
  check(
    (await desktop.getByRole("button", { name: "Open Global Barcode Inspector" }).count()) === 0,
    "Desktop never shows floating icon",
  );
  await desktop.setViewportSize({ width: 390, height: 844 });
  check(
    (await desktop.getByRole("button", { name: "Open Global Barcode Inspector" }).count()) === 0,
    "Narrow desktop still excluded",
  );
  const tablet = await browser.newContext({
    ...devices["iPad Mini"],
    viewport: { width: 600, height: 900 },
  });
  const tp = await tablet.newPage();
  await tp.goto(base);
  check(
    (await tp.getByRole("button", { name: "Open Global Barcode Inspector" }).count()) === 0,
    "Narrow tablet explicitly excluded",
  );
  check(errors.length === 0, "No browser runtime errors: " + errors.join(","));
  await fs.writeFile(
    "docs/WORKFLOW_OWNER_BARCODE_INSPECTOR_UI_VERIFICATION.json",
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        passed: true,
        checks,
        actual_decoder: true,
        physical_camera_tested: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("PASS: " + checks + " inspector browser checks");
} finally {
  await browser?.close();
  await server.close();
}
