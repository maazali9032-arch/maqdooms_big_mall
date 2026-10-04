/** Headless fixture UI: real components with synthetic reads, never live writes/login. */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve("scripts/fixtures/phase16");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "maqdooms-phase16-vite-cache"),
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      { find: "@/app/providers/session", replacement: path.join(fixture, "session.tsx") },
      { find: "@/integrations/supabase/client", replacement: path.join(fixture, "client.ts") },
      { find: "@", replacement: path.resolve("src") },
    ],
  },
  server: { host: "127.0.0.1", port: 5186, strictPort: true, fs: { allow: [process.cwd()] } },
});
server.middlewares.use((req, res, next) => {
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
    );
  } else next();
});
let browser;
let checks = 0;
const check = (value, name) => {
  assert(value, name);
  checks++;
};
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5186");
  await page.getByText("Today's Direct Fabric Sales", { exact: true }).waitFor();
  check(
    (await page.getByText("₹1,234.56", { exact: true }).count()) > 0,
    "Dashboard exact canonical paid amount",
  );
  check((await page.getByText("100.000 m", { exact: true }).count()) > 0, "Exact stock units");
  check(
    !(await page.evaluate(() => window.phase16Calls.includes("mounted:Job notes"))),
    "Unvisited workflow not mounted",
  );
  await page.getByLabel("Sale cart").fill("Retain cart and retry");
  await page.getByRole("tab", { name: "Job draft" }).click();
  await page.getByLabel("Job notes").fill("Retain job");
  check(!(await page.getByLabel("Sale cart").isVisible()), "Inactive workflow hidden");
  await page.getByRole("tab", { name: "Sale draft" }).click();
  check(
    (await page.getByLabel("Sale cart").inputValue()) === "Retain cart and retry",
    "Draft survives tab switching",
  );
  check(
    (await page.evaluate(
      () => window.phase16Calls.filter((x) => x === "mounted:Sale cart").length,
    )) === 1,
    "Workflow mounts only once",
  );
  check(
    (await page.getByLabel("Report records; scroll for more columns").locator("th").count()) === 9,
    "Reports bounded to eight summary columns and full evidence",
  );
  await page.getByText("View all fields", { exact: true }).click();
  check(
    await page.getByText(/"complete_cost_evidence"/).isVisible(),
    "Complete nested Owner evidence accessible",
  );
  await page.getByLabel("Record / barcode / keyword").fill("missing");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await page.getByText("No matching records.", { exact: true }).waitFor();
  check(true, "Search empty state");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByText("View all fields", { exact: true }).waitFor();
  check(
    (await page.getByLabel("Record / barcode / keyword").inputValue()) === "",
    "Clear filters restores records",
  );
  await page.getByLabel("From date (India)").fill("2026-10-05");
  await page.getByLabel("Through date (India)").fill("2026-10-04");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  check(
    await page.getByRole("alert").filter({ hasText: "Start date" }).isVisible(),
    "Invalid dates have explicit validation",
  );
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByRole("button", { name: "Fail reads", exact: true }).click();
  await page
    .getByText("Could not load this data. Check your connection and try again.")
    .first()
    .waitFor();
  check(true, "Read failures not presented as zero stock/sales");
  await page.getByRole("button", { name: "Recover reads", exact: true }).click();
  for (
    let attempt = 0;
    attempt < 3 && (await page.getByRole("button", { name: "Try again", exact: true }).count());
    attempt++
  )
    await page.getByRole("button", { name: "Try again", exact: true }).first().click();
  await page.getByText("Today's Direct Fabric Sales", { exact: true }).waitFor();
  check(true, "Retry recovers reads");
  const beforeRefresh = await page.evaluate(
    () =>
      window.phase16Calls.filter(
        (name) => name === "owner_erp_overview" || name === "owner_erp_report",
      ).length,
  );
  await page.getByRole("button", { name: "Successful fixture write", exact: true }).click();
  await page.waitForFunction(
    (before) =>
      window.phase16Calls.filter(
        (name) => name === "owner_erp_overview" || name === "owner_erp_report",
      ).length >=
      before + 3,
    beforeRefresh,
  );
  check(true, "Successful mutation invalidates dashboard and report reads");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      "No document overflow at " + width,
    );
    if (width === 320 || width === 1440) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(os.tmpdir(), `maqdooms-phase16-ui-${width}.png`) });
    }
  }
  check(
    !(await page
      .locator("body")
      .innerText()
      .then((text) => text.includes("12345"))),
    "Customer print excludes extra Owner CP",
  );
  await page.getByRole("button", { name: "Print fixture label", exact: true }).click();
  check(
    (await page.locator("iframe[aria-hidden=true]").count()) === 1,
    "Isolated label print frame created",
  );
  const iframe = page.frames().find((frame) => frame !== page.mainFrame());
  check((await iframe.title()) === "Fabric Barcode label", "Print title set");
  await page.getByRole("button", { name: "Toggle Owner", exact: true }).click();
  check(
    (await page.getByText("Owner access is required.", { exact: true }).count()) === 2,
    "Owner widgets blocked for non-Owner",
  );
  check(
    !(await page.getByText("View all fields", { exact: true }).isVisible()),
    "Private report no longer rendered after access change",
  );
  check(errors.length === 0, "No browser runtime errors: " + errors.join("; "));
  await fs.writeFile(
    "docs/PHASE16_UI_VERIFICATION.json",
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        checks,
        errors,
        mode: "synthetic fixture reads only",
        viewports: [320, 390, 768, 1440],
      },
      null,
      2,
    ),
  );
  console.log("PASS: " + checks + " Phase 16 browser fixture checks");
} finally {
  await browser?.close();
  await server.close();
}
