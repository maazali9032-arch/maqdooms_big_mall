import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve("scripts/fixtures/owner-workspace");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "owner-workspace-vite"),
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
  server: { host: "127.0.0.1", port: 5198, strictPort: true, fs: { allow: [process.cwd()] } },
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

  await page.goto("http://127.0.0.1:5198?audit=1");
  await page.getByLabel("Audit from date").fill("2026-10-13");
  await page.getByLabel("Audit through date").fill("2026-10-13");
  await page.getByRole("button", { name: "Apply audit filters" }).click();
  await page.getByRole("button", { name: "Open audit event audit1" }).waitFor();
  check(
    await page.getByRole("button", { name: "Open audit event audit3" }).isVisible(),
    "Complete canonical and legacy cursor pages",
  );
  await page.getByRole("button", { name: "Open audit event audit1" }).click();
  await page.getByRole("dialog").waitFor();
  check(
    await page.getByText("12.000 m", { exact: true }).isVisible(),
    "Recorded previous length shown",
  );
  check(await page.getByText("11.500 m", { exact: true }).isVisible(), "Recorded new length shown");
  check(
    (await page.getByText("Not recorded", { exact: true }).count()) > 0,
    "Missing reason is not fabricated",
  );
  await page
    .locator('[role="dialog"]')
    .screenshot({ path: "docs/OWNER_VISUAL_AUDIT_EVIDENCE.png" });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Module", { exact: true }).selectOption("Staff & Permissions");
  await page.getByRole("button", { name: "Apply audit filters" }).click();
  check(
    await page.getByRole("button", { name: "Open audit event audit2" }).isVisible(),
    "Permission filter",
  );
  check(
    (await page.getByRole("button", { name: "Open audit event audit1" }).count()) === 0,
    "Nonmatching stock event excluded",
  );
  await page.getByLabel("Module", { exact: true }).selectOption("");
  await page.getByLabel("Search audit evidence").fill("LEGACY-BILL");
  await page.getByRole("button", { name: "Apply audit filters" }).click();
  await page.getByRole("button", { name: "Open audit event audit3" }).click();
  check(
    await page.getByText("Previous value: Not recorded", { exact: true }).isVisible(),
    "Legacy previous value not reconstructed",
  );
  check(
    await page.getByText("New value: Not recorded", { exact: true }).isVisible(),
    "Missing legacy new value not reconstructed",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  check(
    (await page.getByRole("button", { name: /delete|save event|edit event/i }).count()) === 0,
    "No edit/delete audit controls",
  );
  await page.getByLabel("Search audit evidence").fill("");
  await page.getByLabel("Action", { exact: true }).selectOption("Permission Changed");
  await page.getByRole("button", { name: "Apply audit filters" }).click();
  check(
    await page.getByRole("button", { name: "Open audit event audit2" }).isVisible(),
    "Action filter matches captured permission evidence",
  );
  await page.getByLabel("Action", { exact: true }).selectOption("");
  await page.getByLabel("Record type", { exact: true }).selectOption("Barcode/Thaan");
  await page.getByRole("button", { name: "Apply audit filters" }).click();
  check(
    await page.getByRole("button", { name: "Open audit event audit1" }).isVisible(),
    "Record type filter",
  );
  await page.getByLabel("Record type", { exact: true }).selectOption("");
  await page.getByLabel("Recorded user", { exact: true }).selectOption("staff");
  await page.getByRole("button", { name: "Apply audit filters" }).click();
  check(
    await page.getByRole("button", { name: "Open audit event audit1" }).isVisible(),
    "Recorded user filter",
  );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "Audit fits " + width,
    );
    await page.locator("main").screenshot({ path: "docs/OWNER_VISUAL_AUDIT_" + width + ".png" });
  }
  await page.evaluate(() => (window.ownerFail = "owner_erp_report"));
  await page.getByRole("button", { name: "Refresh audit" }).click();
  await page.getByRole("alert").waitFor();
  check(
    (await page.getByRole("button", { name: "Open audit event audit1" }).count()) === 0,
    "Failed load hides stale audit results",
  );
  await page.evaluate(() => delete window.ownerFail);
  await page.getByRole("button", { name: "Refresh audit" }).click();
  await page.getByRole("button", { name: "Open audit event audit1" }).waitFor();
  check(
    await page.getByRole("button", { name: "Open audit event audit1" }).isVisible(),
    "Retry restores evidence",
  );
  await page.goto("http://127.0.0.1:5198?audit=1&staff=1");
  await page.getByText("Owner access is required.", { exact: true }).waitFor();
  check(
    (await page.evaluate(() => window.ownerCalls.length)) === 0,
    "Staff makes no audit requests",
  );
  check(errors.length === 0, "No browser errors");
  await fs.writeFile(
    "docs/OWNER_VISUAL_AUDIT_UI_VERIFICATION.json",
    JSON.stringify(
      { verified_at: new Date().toISOString(), checks, passed: true, errors },
      null,
      2,
    ),
  );
  console.log("PASS: " + checks + " Audit checks");
} finally {
  await browser?.close();
  await server.close();
}
