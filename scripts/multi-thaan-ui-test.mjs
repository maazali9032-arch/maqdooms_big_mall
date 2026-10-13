/** Actual stock entry/transfer route, synthetic transport; no production changes. */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve("scripts/fixtures/multi-thaan");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "multi-thaan-vite"),
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      {
        find: "@/app/providers/session",
        replacement: path.resolve("scripts/fixtures/workshop-inventory/session.tsx"),
      },
      { find: "@/integrations/supabase/client", replacement: path.join(fixture, "client.ts") },
      { find: /^@\/features\/inventory$/, replacement: path.join(fixture, "inventory.ts") },
      { find: "@", replacement: path.resolve("src") },
    ],
  },
  server: { host: "127.0.0.1", port: 5198, strictPort: true, fs: { allow: [process.cwd()] } },
});
let browser;
const checks = [],
  errors = [];
const check = (value, label) => {
  assert(value, label);
  checks.push(label);
};
try {
  await server.listen();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5198");
  await page.getByLabel("Thaan barcode", { exact: true }).waitFor();
  const scanEntry = async (code) => {
    await page.getByLabel("Thaan barcode", { exact: true }).fill(code);
    await page.getByRole("button", { name: "Scan Thaan", exact: true }).click();
    await page.getByLabel(`Colour ${code}`, { exact: true }).waitFor();
  };
  await scanEntry("RDS-10001a");
  await scanEntry("RDS-10001b");
  await scanEntry("RDS-10001a");
  check(
    (await page.locator("tbody tr").count()) === 2,
    "Repeated scans accumulate distinct rows without duplicates",
  );
  check(
    (await page.getByLabel("Length RDS-10001a").inputValue()) === "" &&
      (await page.getByLabel("CP RDS-10001b").inputValue()) === "",
    "Unknown measurements and CP remain blank",
  );
  await page.getByLabel("Colour RDS-10001a").fill("White");
  await page.getByLabel("Length RDS-10001a").fill("10");
  await page.getByLabel("CP RDS-10001a").fill("150");
  await page.getByLabel("Colour RDS-10001b").fill("Red");
  await page.getByLabel("Length RDS-10001b").fill("8");
  await page.getByLabel("CP RDS-10001b").fill("200");
  await page.getByLabel("Scanned Thaan edit reason").fill("Actual measurements verified");
  await page.evaluate(() => {
    window.multiControls.interruptEdit = true;
  });
  await page.getByRole("button", { name: "Save selected Thaans" }).click();
  await page.getByRole("button", { name: "Retry pending saves" }).waitFor();
  check(
    await page.getByLabel("Length RDS-10001b").isDisabled(),
    "Ambiguous save freezes remaining values",
  );
  await page.getByRole("button", { name: "Retry pending saves" }).click();
  await page.getByText("Selected Thaan details saved", { exact: true }).waitFor();
  check(
    await page.evaluate(() => {
      const calls = window.multiControls.calls.filter((c) => c.name === "edit_workshop_thaan");
      return (
        calls.length === 3 &&
        calls[0].args.p_request === calls[1].args.p_request &&
        calls[2].args.p_changes.length_mm === 8000 &&
        calls[0].args.p_changes.length_mm === 10000
      );
    }),
    "Each row retains its actual values and uncertain retry reuses request",
  );
  check(
    (await page.getByLabel("Colour RDS-10001a").inputValue()) === "White" &&
      (await page.getByLabel("Colour RDS-10001b").inputValue()) === "Red",
    "Bulk edits preserve separate colours",
  );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Stock editing fits ${width}px`,
    );
    await page.locator("main").screenshot({
      path: `docs/MULTI_THAAN_ENTRY_${width}.png`,
      style: "[data-sonner-toaster]{visibility:hidden!important}",
    });
  }
  await page.getByRole("button", { name: "Transfer view", exact: true }).click();
  await page.getByLabel("Transfer Fabric Barcode").waitFor();
  check(
    (await page.getByText("Finished Product Transfers", { exact: true }).count()) === 0,
    "Actual Stock Transfer route removes duplicate finished-products tab",
  );
  const scanTransfer = async (code) => {
    await page.getByLabel("Transfer Fabric Barcode").fill(code);
    await page.getByRole("button", { name: "Scan", exact: true }).click();
  };
  await scanTransfer("RDS-10001a");
  await scanTransfer("RDS-10001b");
  await scanTransfer("RDS-10001c");
  await scanTransfer("RDS-10001a");
  check((await page.locator("tbody tr").count()) === 3, "Transfer scans accumulate distinct rows");
  await page.getByLabel("Select transfer c", { exact: true }).uncheck();
  await page.getByLabel("Send metres a").fill("2.5");
  await page.getByLabel("Destination a").selectOption("floor1");
  await page.getByLabel("Send metres b").fill("3");
  await page.getByLabel("Destination b").selectOption("floor2");
  await page.getByLabel("Fabric Transfer reason or reference").fill("Floor stock allocation");
  await page.evaluate(() => {
    window.printedLabels = [];
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLIFrameElement.prototype,
      "contentWindow",
    );
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        const win = descriptor.get.call(this);
        if (win) win.print = () => window.printedLabels.push(this.contentDocument.body.innerText);
        return win;
      },
    });
  });
  await page.getByRole("button", { name: "Print selected barcodes", exact: true }).click();
  check(
    await page.evaluate(
      () =>
        window.printedLabels[0].includes("RDS-10001a") &&
        window.printedLabels[0].includes("RDS-10001b") &&
        !window.printedLabels[0].includes("RDS-10001c"),
    ),
    "Selected label printing retains exact identities and excludes unselected row",
  );
  await page.getByLabel("Send metres a").fill("11");
  await page.getByRole("button", { name: "Transfer selected Thaans" }).click();
  await page.getByText(/enter metres within available Workshop stock/).waitFor();
  check(
    await page.evaluate(
      () =>
        window.multiControls.calls.filter((c) => c.name === "post_inventory_transfer").length === 0,
    ),
    "Over-transfer rejected before posting",
  );
  await page.getByLabel("Send metres a").fill("2.5");
  await page.evaluate(() => {
    window.multiControls.interruptTransfer = true;
  });
  await page.getByRole("button", { name: "Transfer selected Thaans" }).click();
  await page.getByRole("button", { name: "Retry pending transfers" }).waitFor();
  check(
    await page.getByLabel("Destination b").isDisabled(),
    "Uncertain transfer preserves quantities and destinations",
  );
  await page.getByRole("button", { name: "Retry pending transfers" }).click();
  await page.getByText("Selected stock transferred", { exact: true }).waitFor();
  check(
    await page.evaluate(() => {
      const c = window.multiControls.calls.filter((c) => c.name === "post_inventory_transfer");
      return (
        c.length === 3 &&
        c[0].args.p_request_id === c[1].args.p_request_id &&
        c[2].args.p_destination === "floor2" &&
        window.multiControls.floorBalances.floor1 === 2500 &&
        window.multiControls.floorBalances.floor2 === 3000
      );
    }),
    "Different floors get separate exact documents and retry does not deduct twice",
  );
  check(
    (await page.getByRole("cell", { name: "Transferred", exact: true }).count()) === 2,
    "Partial/multiple transfer results marked per row",
  );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Transfer rows fit ${width}px`,
    );
    await page.locator("main").screenshot({
      path: `docs/MULTI_THAAN_TRANSFER_${width}.png`,
      style: "[data-sonner-toaster]{visibility:hidden!important}",
    });
  }
  check(errors.length === 0, "No browser runtime errors");
  await fs.writeFile(
    "docs/MULTI_THAAN_UI_VERIFICATION.json",
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        checks: checks.length,
        results: checks,
        errors,
        transport: "Synthetic; no live business changes",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ checks: checks.length, errors }));
} finally {
  await browser?.close();
  await server.close();
}
