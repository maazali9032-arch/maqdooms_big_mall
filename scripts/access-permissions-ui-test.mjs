/** Real AccessPage, queries, popup and RPC wiring; synthetic transport, no live writes. */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve("scripts/fixtures/access-permissions");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "access-permissions-vite-cache"),
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      {
        find: "@/app/providers/session",
        replacement: path.resolve("scripts/fixtures/labels-first-stock-entry/session.tsx"),
      },
      { find: "@/integrations/supabase/client", replacement: path.join(fixture, "client.ts") },
      { find: "@", replacement: path.resolve("src") },
    ],
  },
  server: { host: "127.0.0.1", port: 5197, strictPort: true, fs: { allow: [process.cwd()] } },
});
const results = [],
  errors = [];
const check = (value, label) => {
  assert(value, label);
  results.push(label);
};
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5197");
  await page.getByRole("button", { name: "Actions for Stock Example" }).waitFor();
  check(
    await page.getByRole("columnheader", { name: "Assigned roles" }).isVisible(),
    "Role assignments clearly identified",
  );
  check(
    (await page.getByLabel("Permission user", { exact: true }).count()) === 0,
    "Redundant lower user selector removed",
  );
  const open = async (name) => {
    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Manage permissions" }).click();
    await page.getByLabel("Transfer stock permission").waitFor();
  };
  await open("Stock Example");
  const dialog = page.getByRole("dialog");
  check(
    await dialog.getByText("stock@example.test", { exact: true }).isVisible(),
    "Selected staff identity shown without second selection",
  );
  check(
    (await page.getByLabel("Transfer stock permission").inputValue()) === "inherit",
    "Role defaults retained",
  );
  check(
    (await page.getByLabel("Print barcodes permission").inputValue()) === "allow",
    "Existing personal exceptions loaded",
  );
  check(
    await dialog.getByRole("heading", { name: "stock", exact: true }).isVisible(),
    "Permissions grouped by module",
  );
  await page.getByLabel("Search permissions").fill("audit");
  check(
    (await page.getByLabel("Transfer stock permission").count()) === 0 &&
      (await page.getByLabel("View audit trail permission").isVisible()),
    "Action search filters modules",
  );
  await page.getByLabel("Search permissions").fill("unmatched");
  check(
    await dialog.getByText("No actions match your search.").isVisible(),
    "Empty search clearly explained",
  );
  await page.getByLabel("Search permissions").fill("");
  await page.evaluate(() => {
    window.accessControls.holdSave = true;
  });
  await page.getByLabel("Transfer stock permission").selectOption("deny");
  await page.getByText("Saving permission…", { exact: true }).waitFor();
  check(
    await page.getByLabel("Print barcodes permission").isDisabled(),
    "Concurrent permission writes disabled",
  );
  await page.keyboard.press("Escape");
  check(
    (await dialog.isVisible()) &&
      (await page.getByRole("button", { name: "Done", exact: true }).isDisabled()),
    "Closing blocked during save",
  );
  await page.evaluate(() => {
    window.accessControls.holdSave = false;
    window.accessControls.release();
  });
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Transfer stock permission"]')?.value === "deny",
  );
  check(
    await page.evaluate(
      () =>
        window.accessControls.calls.at(-1).p_user === "stock" &&
        window.accessControls.calls.at(-1).p_granted === false,
    ),
    "Deny RPC targets the selected staff member",
  );
  await page.getByLabel("Transfer stock permission").selectOption("inherit");
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Transfer stock permission"]')?.value === "inherit",
  );
  check(
    await page.evaluate(() => window.accessControls.calls.at(-1).p_granted === null),
    "Use role default removes only personal override",
  );
  await page.evaluate(() => {
    window.accessControls.failSave = true;
  });
  await page.getByLabel("Transfer stock permission").selectOption("deny");
  await page.getByText("Synthetic permission save failed", { exact: true }).waitFor();
  check(
    (await page.getByLabel("Transfer stock permission").inputValue()) === "inherit",
    "Failed save does not display unsaved override",
  );
  await page.evaluate(() => {
    window.accessControls.failSave = false;
  });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    check(
      await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.left >= 0 &&
          r.right <= innerWidth + 1 &&
          r.top >= 0 &&
          r.bottom <= innerHeight + 1 &&
          el.scrollWidth <= el.clientWidth + 1
        );
      }),
      `Popup fits ${width}px without clipped controls`,
    );
    await dialog.screenshot({
      path: `docs/ACCESS_PERMISSIONS_${width === 390 ? "MOBILE" : "DESKTOP"}.png`,
      style: "[data-sonner-toaster] { visibility: hidden !important; }",
    });
  }
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await open("Counter Example");
  check(
    (await page.getByLabel("Search permissions").inputValue()) === "" &&
      (await page.getByLabel("Print barcodes permission").inputValue()) === "inherit",
    "Opening another staff member resets search and isolates overrides",
  );
  await page.getByLabel("Print barcodes permission").selectOption("allow");
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Print barcodes permission"]')?.value === "allow",
  );
  check(
    await page.evaluate(
      () =>
        window.accessControls.calls.at(-1).p_user === "counter" &&
        window.accessControls.calls.at(-1).p_granted === true,
    ),
    "Allow RPC targets the new selected user",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Actions for Owner Example" }).click();
  check(
    (await page
      .getByRole("menuitem", { name: "Deactivate account" })
      .getAttribute("data-disabled")) !== null,
    "Last active Owner deactivation safeguard retained",
  );
  await page.getByRole("menuitem", { name: "Manage permissions" }).click();
  await page.getByLabel("Transfer stock permission").waitFor();
  check(
    (await page.getByLabel("Transfer stock permission").isDisabled()) &&
      (await page.getByText(/Owner accounts always retain full control/).isVisible()),
    "Owner overrides disabled and explained",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Actions for Stock Example" }).waitFor();
  await page.evaluate(() => {
    window.accessControls.failTable = "user_permission_overrides";
  });
  await page.getByRole("button", { name: "Actions for Stock Example" }).click();
  await page.getByRole("menuitem", { name: "Manage permissions" }).click();
  await page.getByText("Permissions could not load. Retry before changing access.").waitFor();
  check(
    (await page.getByLabel("Transfer stock permission").count()) === 0,
    "Failed load exposes no writable defaults",
  );
  await page.evaluate(() => {
    window.accessControls.failTable = "";
  });
  await page.getByRole("button", { name: "Retry loading permissions" }).click();
  await page.getByLabel("Transfer stock permission").waitFor();
  check(
    (await page.getByLabel("Print barcodes permission").inputValue()) === "allow",
    "Retry restores verified existing permissions",
  );
  check(errors.length === 0, "No browser runtime errors");
  await fs.writeFile(
    "docs/ACCESS_PERMISSIONS_UI_VERIFICATION.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        checks: results.length,
        results,
        browserErrors: errors,
        transport: "Synthetic; no live account or database changes",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ checks: results.length, errors }));
} finally {
  await browser?.close();
  await server.close();
}
