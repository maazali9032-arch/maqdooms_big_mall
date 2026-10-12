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
const fixture = path.resolve("scripts/fixtures/labels-first-stock-entry");
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
  server: { host: "127.0.0.1", port: 5192, strictPort: true, fs: { allow: [process.cwd()] } },
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
  await page.goto("http://127.0.0.1:5192");
  await page.getByRole("heading", { name: "Scan Existing Barcode", exact: true }).waitFor();
  check(
    await page.getByRole("heading", { name: "Create Batch", exact: true }).isVisible(),
    "Home shows both scanner and creation cards",
  );
  await page.getByRole("button", { name: "Create Batch", exact: true }).click();
  await page.getByLabel("Supplier / provider").fill("Raymonds");
  await page.getByLabel("Arrival date").fill("2026-10-12");
  await page.getByLabel("Remarks (optional)").fill("Truck arrival");
  await page.getByLabel("Fabric Type 1", { exact: true }).fill("Velvet");
  await page.getByLabel("Thaan count 1", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Add Another Fabric Type", exact: true }).click();
  await page.getByLabel("Fabric Type 2", { exact: true }).fill("Cotton");
  await page.getByLabel("Thaan count 2", { exact: true }).fill("2");
  check(
    await page.getByText("Total Thaans: 5", { exact: true }).isVisible(),
    "Summary calculates entered counts",
  );
  check(
    await page.getByText("Estimated Barcodes: 5", { exact: true }).isVisible(),
    "Barcode count matches Thaans",
  );
  check(
    (await page.getByLabel("Actual length (metres)", { exact: true }).count()) === 0,
    "Batch generation asks for no unknown lengths",
  );
  await page.getByRole("button", { name: "Enter optional Thaan details 1", exact: true }).click();
  await page.getByLabel("Colour � fabric 1, Thaan 2", { exact: true }).fill("Blue");
  await page.getByLabel("Length (metres) � fabric 1, Thaan 2", { exact: true }).fill("10");
  await page.getByLabel("CP per metre (optional) � fabric 1, Thaan 2", { exact: true }).fill("450");
  await page.getByLabel("Colour � fabric 1, Thaan 3", { exact: true }).fill("White");
  await page.getByRole("button", { name: "Hide optional Thaan details 1", exact: true }).click();
  await page.getByRole("button", { name: "Enter optional Thaan details 1", exact: true }).click();
  check(
    (await page.getByLabel("Colour � fabric 1, Thaan 2", { exact: true }).inputValue()) === "Blue",
    "Collapsed details retained",
  );
  await page.getByLabel("Thaan count 1", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Generate All Barcodes", exact: true }).click();
  await page.getByText(/Thaan count would discard entered details/).waitFor();
  check(
    (await page.evaluate(
      () =>
        window.stockRegistrationCalls.filter((c) => c.name === "create_barcode_batch_with_details")
          .length,
    )) === 0,
    "Reduction cannot silently discard entered data",
  );
  await page.getByLabel("Thaan count 1", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Enter optional Thaan details 2", exact: true }).click();
  await page.getByLabel("CP per metre (optional) � fabric 2, Thaan 1", { exact: true }).fill("200");
  check(
    (await page.getByLabel("Colour � fabric 1, Thaan 1", { exact: true }).inputValue()) === "",
    "Unentered fields stay empty",
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Batch builder fits ${width}px`,
    );
  }
  await page.getByRole("button", { name: "Generate All Barcodes", exact: true }).click();
  await page.getByRole("button", { name: "Retry same request", exact: true }).waitFor();
  check(
    await page.getByLabel("Thaan count 1", { exact: true }).isDisabled(),
    "Uncertain batch generation freezes counts",
  );
  await page.getByRole("button", { name: "Retry same request", exact: true }).click();
  await page.getByRole("heading", { name: "Print Fabric Type Labels", exact: true }).waitFor();
  await page.getByRole("img", { name: "Barcode RDS-31001a", exact: true }).waitFor();
  const requests = await page.evaluate(() =>
    window.stockRegistrationCalls.filter((c) => c.name === "create_barcode_batch_with_details"),
  );
  check(
    requests[0].args.p_fabrics[0].rows[1].length_mm === 10000 &&
      requests[0].args.p_fabrics[0].rows[1].cp_paise_per_m === 45000,
    "Optional creation details converted exactly",
  );
  check(
    requests[0].args.p_fabrics[1].rows[0].cp_paise_per_m === 20000 &&
      requests[0].args.p_fabrics[1].rows[0].length_mm === null,
    "CP-only row retained without guessed length",
  );
  check(
    requests.length === 2 && JSON.stringify(requests[0].args) === JSON.stringify(requests[1].args),
    "Exact batch retry preserves UUID and all fields",
  );
  check(
    (await page.getByRole("img").count()) === 3,
    "First fabric shows exactly three unique labels",
  );
  check(
    !(
      await page
        .locator("article")
        .innerText()
        .catch(() => "")
    ).includes("CP"),
    "Labels do not include internal CP",
  );
  await page.evaluate(() => {
    window.printedLabels = [];
    const original = HTMLIFrameElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(original, "contentWindow");
    Object.defineProperty(original, "contentWindow", {
      get() {
        const win = descriptor.get.call(this);
        win.print = () => window.printedLabels.push(this.contentDocument.body.innerText);
        return win;
      },
      configurable: true,
    });
  });
  await page.getByRole("button", { name: "Print All Labels for This Fabric", exact: true }).click();
  await page.getByRole("button", { name: "Print Again", exact: true }).click();
  let prints = await page.evaluate(() => window.printedLabels);
  check(prints.length === 2 && prints[0] === prints[1], "Reprint preserves exact labels");
  check(
    prints[0].includes("RDS-31001a") &&
      prints[0].includes("RDS-31001c") &&
      !prints[0].includes("RDS-31002a"),
    "Printing contains only selected Velvet group",
  );
  await page.getByRole("button", { name: "Next Fabric Type", exact: true }).click();
  await page.getByRole("img", { name: "Barcode RDS-31002a", exact: true }).waitFor();
  check((await page.getByRole("img").count()) === 2, "Next fabric shows its two labels");
  await page.getByRole("button", { name: "Print All Labels for This Fabric", exact: true }).click();
  prints = await page.evaluate(() => window.printedLabels);
  check(
    prints[2].includes("RDS-31002b") && !prints[2].includes("RDS-31001a"),
    "Cotton prints separately",
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Labels fit ${width}px`,
    );
  }
  await page.getByRole("button", { name: "Finish - Scan Thaans", exact: true }).click();
  await page.getByLabel("Thaan barcode").fill("RDS-31001a");
  await page.getByLabel("Thaan barcode").press("Enter");
  await page.getByLabel("Actual colour").waitFor();
  check(
    await page.getByText(/Awaiting actual measurement/).isVisible(),
    "Scanner shows pending unmeasured identity",
  );
  await page.getByLabel("Actual colour").fill("Maroon");
  await page.getByLabel("Actual length (metres)", { exact: true }).fill("12.5");
  await page.getByLabel("CP per metre (optional)", { exact: true }).fill("123.45");
  await page.getByRole("button", { name: "Save actual Thaan details", exact: true }).click();
  await page.getByRole("button", { name: "Retry same request", exact: true }).waitFor();
  check(
    await page.getByLabel("Actual length (metres)", { exact: true }).isDisabled(),
    "Interrupted actual measurement freezes fields",
  );
  await page.getByRole("button", { name: "Retry same request", exact: true }).click();
  await page.getByText(/Saved length: 12.500 m/).waitFor();
  const measured = await page.evaluate(() =>
    window.stockRegistrationCalls.filter((c) => c.name === "save_registered_thaan_details"),
  );
  check(
    measured.length === 2 && JSON.stringify(measured[0].args) === JSON.stringify(measured[1].args),
    "Measurement retry retains exact payload",
  );
  check(
    measured[0].args.p_length_mm === 12500 && measured[0].args.p_cp === 12345,
    "Actual metres/CP converted exactly",
  );
  check(
    await page.getByText(/Workshop: 12.500 m/).isVisible(),
    "Saved physical stock shown below scanner",
  );
  await page.getByLabel("Thaan barcode").fill("RDS-31001c");
  await page.getByLabel("Thaan barcode").press("Enter");
  await page.getByText("Colour: White", { exact: true }).waitFor();
  check(
    (await page.getByLabel("Actual colour", { exact: true }).count()) === 0,
    "Saved partial colour displayed and protected",
  );
  await page.getByLabel("Actual length (metres)", { exact: true }).fill("8");
  await page.getByRole("button", { name: "Save actual Thaan details", exact: true }).click();
  await page.getByText("Workshop: 8.000 m", { exact: true }).waitFor();
  check(true, "Missing-only scan activates saved partial row");
  await page.getByLabel("Previous batch").selectOption("batch");
  await page.getByRole("button", { name: "Open batch labels", exact: true }).click();
  await page.getByText("Add more labels to this batch", { exact: true }).click();
  await page.getByLabel("Additional Thaan count").fill("1");
  await page.getByRole("button", { name: "Add Thaans to this Fabric Type", exact: true }).click();
  await page.getByRole("img", { name: "Barcode RDS-31001d", exact: true }).waitFor();
  check(true, "Later additions continue suffix and print identity");
  check(errors.length === 0, "No browser errors");
  await fs.writeFile(
    "docs/OPTIONAL_THAAN_DETAILS_UI_VERIFICATION.json",
    JSON.stringify(
      { verified_at: new Date().toISOString(), checks, passed: true, errors },
      null,
      2,
    ),
  );
  console.log(`PASS: ${checks} labels-first Stock Entry browser checks`);
} finally {
  await browser?.close();
  await server.close();
}
