import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve("scripts/fixtures/thaan-tree");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "thaan-tree-vite"),
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      {
        find: "@/app/providers/session",
        replacement: path.resolve("scripts/fixtures/workshop-inventory/session.tsx"),
      },
      { find: "@/integrations/supabase/client", replacement: path.join(fixture, "client.ts") },
      {
        find: /^@\/features\/inventory$/,
        replacement: path.resolve("scripts/fixtures/labels-first-stock-entry/inventory.ts"),
      },
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
try {
  await server.listen();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5199");
  await page.getByRole("button", { name: "Create Batch", exact: true }).click();
  await page.getByLabel("Supplier / provider", { exact: true }).fill("Raymonds");
  await page.getByLabel("Fabric Type 1", { exact: true }).fill("Velvet");
  await page.getByLabel("Thaan count 1", { exact: true }).fill("3");
  check(
    await page.getByLabel("Colour (optional) - fabric 1, Thaan 3", { exact: true }).isVisible(),
    "All leaf rows visible without expansion",
  );
  check(
    (await page.getByRole("button", { name: /optional Thaan details|Hide details/ }).count()) === 0,
    "No collapsible details",
  );
  await page.getByLabel("Length for all fabric 1").fill("9");
  await page.getByLabel("CP for all fabric 1").fill("400");
  await page.getByRole("button", { name: "Apply to all 3 Thaans", exact: true }).click();
  for (let n = 1; n <= 3; n++) {
    check(
      (await page
        .getByLabel("Length (metres) - fabric 1, Thaan " + n, { exact: true })
        .inputValue()) === "9",
      "Bulk length applied to " + n,
    );
    check(
      (await page
        .getByLabel("CP per metre (optional) - fabric 1, Thaan " + n, { exact: true })
        .inputValue()) === "400",
      "Bulk CP applied to " + n,
    );
  }
  await page.getByLabel("Length (metres) - fabric 1, Thaan 2", { exact: true }).fill("5");
  await page.getByLabel("CP per metre (optional) - fabric 1, Thaan 2", { exact: true }).fill("300");
  await page.getByRole("button", { name: "Add Another Fabric Type", exact: true }).click();
  await page.getByLabel("Fabric Type 2", { exact: true }).fill("Cotton");
  await page.getByLabel("Thaan count 2", { exact: true }).fill("2");
  check(
    (await page.getByLabel("Length (metres) - fabric 2, Thaan 1", { exact: true }).inputValue()) ===
      "",
    "Defaults isolated to fabric group",
  );
  await page.getByLabel("CP for all fabric 2").fill("200");
  await page.getByRole("button", { name: "Apply to all 2 Thaans", exact: true }).click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "Tree fits " + width,
    );
    if (width === 390 || width === 1440)
      await page.locator("main").screenshot({ path: "docs/THAAN_TREE_" + width + ".png" });
  }
  await page.getByRole("button", { name: "Generate All Barcodes", exact: true }).click();
  await page.getByRole("button", { name: "Retry same request", exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry same request", exact: true }).click();
  await page.getByRole("heading", { name: "Print Fabric Type Labels", exact: true }).waitFor();
  const calls = await page.evaluate(() =>
    window.thaanCalls.filter((c) => c.name === "create_barcode_batch_with_details"),
  );
  const rows = calls[0].args.p_fabrics[0].rows;
  check(
    rows.map((r) => r.length_mm).join(",") === "9000,5000,9000",
    "Exact bulk/individual lengths submitted",
  );
  check(
    rows.map((r) => r.cp_paise_per_m).join(",") === "40000,30000,40000",
    "Exact bulk/individual CP submitted",
  );
  check(
    rows.every((r) => r.colour === null),
    "Missing colour remains null",
  );
  check(
    calls[0].args.p_fabrics[1].rows.every((r) => r.length_mm === null),
    "No length invented from CP-only defaults",
  );
  check(
    JSON.stringify(calls[0].args) === JSON.stringify(calls[1].args),
    "Uncertain batch retry retains exact values/request",
  );
  await page.getByRole("button", { name: "Next Fabric Type", exact: true }).click();
  check(
    await page.getByRole("img", { name: "Barcode RDS-31002a", exact: true }).isVisible(),
    "Per-fabric label sequence retained",
  );
  await page.getByRole("button", { name: "inventory view", exact: true }).click();
  await page.getByRole("button", { name: "Cotton - Thaan 1", exact: true }).waitFor();
  check(
    await page.getByText("Awaiting stock activation", { exact: true }).isVisible(),
    "Saved draft distinguished from incomplete metadata",
  );
  await page.getByLabel("Incomplete only", { exact: true }).check();
  check(
    (await page.locator("tbody tr").count()) === 1,
    "Only zero-CP row incomplete; absent colour not incomplete",
  );
  await page.getByLabel("Incomplete only", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Cotton - Thaan 3", exact: true }).click();
  check(
    (await page.getByLabel("Correction reason (optional)", { exact: true }).inputValue()) === "",
    "Reason optional",
  );
  await page.getByRole("button", { name: "Save details", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const edit = await page.evaluate(() =>
    window.thaanCalls.find((c) => c.name === "edit_workshop_thaan"),
  );
  check(
    edit.args.p_reason === "" && edit.args.p_changes.length_mm === 9000,
    "Saved draft activates with no entered reason",
  );
  check(
    (await page.getByText("Awaiting stock activation", { exact: true }).count()) === 0,
    "Activation status refreshed",
  );
  await page.getByRole("button", { name: "scanner view", exact: true }).click();
  await page.getByLabel("Thaan barcode", { exact: true }).fill("RDS-10001b");
  await page.getByRole("button", { name: "Scan Thaan", exact: true }).click();
  await page.getByLabel("CP RDS-10001b").fill("250");
  check(
    await page.getByRole("button", { name: "Save selected Thaans", exact: true }).isEnabled(),
    "Bulk scan save not gated by optional reason",
  );
  await page.getByRole("button", { name: "Save selected Thaans", exact: true }).click();
  await page.getByText("Saved", { exact: true }).waitFor();
  check(errors.length === 0, "No runtime errors");
  await fs.writeFile(
    "docs/THAAN_TREE_UI_VERIFICATION.json",
    JSON.stringify(
      { verified_at: new Date().toISOString(), checks, passed: true, errors },
      null,
      2,
    ),
  );
  console.log("PASS: " + checks + " hierarchy/default/optional-field UI checks");
} finally {
  await browser?.close();
  await server.close();
}
