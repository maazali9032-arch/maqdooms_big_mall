/** Real label dialog with synthetic labels; printer calls are captured, never sent. */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const folder = await fs.mkdtemp(path.join(os.tmpdir(), "maqdooms-label-setup-"));
await fs.writeFile(
  path.join(folder, "index.html"),
  '<div id="root"></div><script type="module" src="/main.tsx"></script>',
);
await fs.writeFile(
  path.join(folder, "main.tsx"),
  `
import {createRoot} from 'react-dom/client';
import {LabelPrintDialog} from '@/features/inventory/LabelPrintDialog';
import '@/styles.css';
const labels=Array.from({length:13},(_,i)=>({code:'T'+String(i+1).padStart(5,'0'),name:'Cotton',description:'Batch 12 / Supplier',detail:'Grey · 10.000 m',price:i===0?'₹3,999.00':''}));
createRoot(document.getElementById('root')!).render(<LabelPrintDialog labels={labels} title="Test labels" close={()=>{}}/>);
`,
);
const server = await createServer({
  configFile: false,
  envDir: false,
  root: folder,
  cacheDir: path.join(folder, "cache"),
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve("src") },
      ...["react", "react-dom"].map((name) => ({
        find: new RegExp("^" + name + "(/.*)?$"),
        replacement: path.resolve("node_modules", name) + "$1",
      })),
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5209,
    strictPort: true,
    fs: { allow: [folder, process.cwd()] },
  },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.printed = [];
    // React mounts after DOMContentLoaded; intercept only the hidden print iframe.
    document.addEventListener("DOMContentLoaded", () => {
      const original = document.body.append.bind(document.body);
      document.body.append = (...nodes) => {
        original(...nodes);
        for (const node of nodes)
          if (node instanceof HTMLIFrameElement && node.getAttribute("aria-hidden") === "true") {
            node.contentWindow.print = () =>
              window.printed.push({
                codes: [...node.contentDocument.querySelectorAll(".code")].map(
                  (el) => el.textContent,
                ),
                pages: node.contentDocument.querySelectorAll(".label-page").length,
              });
          }
      };
    });
  });
  await page.goto("http://127.0.0.1:5209");
  await page.getByRole("heading", { name: "Print barcode labels" }).waitFor();
  assert.equal(await page.locator("details").getAttribute("open"), null);
  assert.equal(await page.getByLabel("Printer resolution", { exact: true }).isVisible(), false);
  assert.equal(
    await page.getByRole("button", { name: "A4 2 × 7 sheet", exact: true }).isVisible(),
    false,
  );
  assert.match(
    await page.getByRole("status").first().textContent(),
    /13 labels · 2 print pages\. 2 labels across/,
  );
  await page
    .frameLocator('iframe[title="Barcode label preview"]')
    .locator(".code")
    .first()
    .waitFor();
  assert.equal(
    await page
      .frameLocator('iframe[title="Barcode label preview"]')
      .locator(".code")
      .first()
      .textContent(),
    "T00001",
  );
  const previewBarcode = page
    .frameLocator('iframe[title="Barcode label preview"]')
    .locator('svg[aria-label="Barcode T00001"]');
  assert.equal(
    await previewBarcode.evaluate((svg) => {
      const label = svg.closest(".sticker");
      if (!label) return false;
      const labelBox = label.getBoundingClientRect();
      const svgBox = svg.getBoundingClientRect();
      return (
        svgBox.width >= labelBox.width * 0.5 &&
        svgBox.width <= labelBox.width * 0.65 &&
        Math.abs((svgBox.left + svgBox.right) / 2 - (labelBox.left + labelBox.right) / 2) <= 1
      );
    }),
    true,
    "Preview barcode keeps its natural scanner-safe width and is horizontally centred",
  );
  assert.equal(
    await page
      .frameLocator('iframe[title="Barcode label preview"]')
      .locator(".sticker")
      .first()
      .evaluate((label) => {
        const box = label.getBoundingClientRect();
        return [...label.children].every((child) => {
          const childBox = child.getBoundingClientRect();
          return (
            childBox.left >= box.left - 0.5 &&
            childBox.right <= box.right + 0.5 &&
            childBox.top >= box.top - 0.5 &&
            childBox.bottom <= box.bottom + 0.5
          );
        });
      }),
    true,
    "Every text line, barcode and printed ID stays inside one physical sticker",
  );
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.getByRole("dialog").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
      `dialog fits ${width}px`,
    );
    await page
      .getByRole("button", { name: "Print all labels", exact: true })
      .scrollIntoViewIfNeeded();
    assert.equal(
      await page.getByRole("button", { name: "Print all labels", exact: true }).isVisible(),
      true,
    );
  }
  await page.getByText("Advanced settings", { exact: true }).click();
  assert.equal(await page.getByLabel("Printer resolution", { exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "1-up thermal roll", exact: true }).click();
  assert.match(
    await page.getByRole("status").first().textContent(),
    /13 print pages\. 1 label across/,
  );
  await page.getByRole("button", { name: "Use showroom 4 × 6 layout", exact: true }).click();
  assert.equal(await page.getByLabel("Labels down per page", { exact: true }).inputValue(), "6");
  assert.equal(await page.getByLabel("Label media type", { exact: true }).inputValue(), "sheet");
  await page.getByText("Advanced settings", { exact: true }).click();
  await page.getByRole("button", { name: "Print test page", exact: true }).click();
  await page.waitForFunction(() => window.printed.length === 1);
  await page.getByRole("button", { name: "Print all labels", exact: true }).click();
  await page.waitForFunction(() => window.printed.length === 2);
  assert.deepEqual(
    await page.evaluate(() => window.printed.map((p) => [p.codes.length, p.pages])),
    [
      [12, 1],
      [13, 2],
    ],
  );
  assert.equal(await page.evaluate(() => window.printed[1].codes.at(-1)), "T00013");
  await page.reload();
  await page.getByRole("heading", { name: "Print barcode labels" }).waitFor();
  assert.match(
    await page.getByRole("status").first().textContent(),
    /2 print pages\. 2 labels across/,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: simplified label setup, three screen widths, preset/reset, preview, test/all print output and saved profile reload",
  );
} finally {
  await browser?.close();
  await server.close();
  await fs.rm(folder, { recursive: true, force: true });
}
