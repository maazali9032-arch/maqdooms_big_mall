import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const root = path.resolve("scripts/fixtures/ecommerce-listings");
const server = await createServer({
  configFile: false,
  envDir: false,
  root,
  cacheDir: path.join(os.tmpdir(), "ecommerce-listings-vite"),
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      { find: "@/app/providers/session", replacement: path.join(root, "session.ts") },
      { find: "@/integrations/supabase/client", replacement: path.join(root, "client.ts") },
      { find: "@", replacement: path.resolve("src") },
    ],
  },
  server: { host: "127.0.0.1", port: 5198, strictPort: true, fs: { allow: [process.cwd()] } },
});
let browser;
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errors.push(e.message));
  const base = "http://127.0.0.1:5198";
  await page.goto(base);
  const scan = async (code) => {
    await page.getByLabel("Scan showroom barcode for listing", { exact: true }).fill(code);
    await page.getByLabel("Scan showroom barcode for listing", { exact: true }).press("Enter");
    await page.getByRole("button", { name: "Add barcode", exact: true }).waitFor();
  };
  await scan("FAB-1");
  await page.getByRole("button", { name: "Remove barcode FAB-1", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Product name", { exact: true }).inputValue(), "Cotton");
  assert.equal(await page.locator("#l-price").inputValue(), "");
  await scan("FAB-2");
  await page.getByRole("button", { name: "Remove barcode FAB-2", exact: true }).waitFor();
  await scan("FAB-1");
  assert.equal(
    await page.getByRole("button", { name: "Remove barcode FAB-1", exact: true }).count(),
    1,
  );
  await scan("PRODUCT-1");
  assert.equal(
    await page.getByRole("button", { name: "Remove barcode PRODUCT-1", exact: true }).count(),
    0,
    "Mixed kinds rejected",
  );
  await page.getByLabel("Product name", { exact: true }).fill("Custom Cotton");
  await page.locator("#l-price").fill("450");
  await page.getByLabel("Tags (comma separated)").fill("cotton, summer");
  await page.getByLabel("Category", { exact: true }).fill("Fabric");
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), "ecommerce-listings-preview-"));
  await page.getByRole("dialog").screenshot({ path: path.join(artifacts, "listing.png") });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Editor closed", { exact: true }).waitFor();
  const saved = await page.evaluate(() => window.listingSaves[0]);
  assert.equal(saved.p_details.title, "Custom Cotton");
  assert.deepEqual(saved.p_details.tags, ["cotton", "summer"]);
  assert.equal(saved.p_details.price_paise, 45000);
  assert.equal(saved.p_stock.length, 2);
  await page.goto(base);
  await scan("PRODUCT-1");
  await page.getByRole("button", { name: "Remove barcode PRODUCT-1", exact: true }).waitFor();
  assert.equal(await page.locator("#l-price").inputValue(), "1250");
  assert(await page.getByText("Online price (₹/piece)", { exact: true }).isVisible());
  await page.goto(base + "?edit=1");
  await page.getByRole("button", { name: "Remove barcode FAB-1", exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Product name", { exact: true }).inputValue(),
    "Existing cotton",
  );
  await scan("FAB-2");
  await page.getByRole("button", { name: "Remove barcode FAB-2", exact: true }).waitFor();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Editor closed", { exact: true }).waitFor();
  const edited = await page.evaluate(() => window.listingSaves[0]);
  assert.equal(edited.p_listing, "existing");
  assert.deepEqual(edited.p_details.images, ["existing/image.jpg"]);
  assert.equal(edited.p_details.seo_title, "Existing SEO");
  assert.equal(edited.p_stock.length, 2);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: all-screen listing scans, duplicate/mixed rejection, fabric online price, finished SP prefill, manual Enter, retained metadata/images and atomic save payload. Previews: " +
      artifacts,
  );
} finally {
  await browser?.close();
  await server.close();
}
