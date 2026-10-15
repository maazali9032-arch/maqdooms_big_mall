import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve("scripts/fixtures/workflow-workspaces");
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixture,
  cacheDir: path.join(os.tmpdir(), "showroom-fabric-card-vite"),
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
  server: { host: "127.0.0.1", port: 5209, strictPort: true, fs: { allow: [process.cwd()] } },
});
let browser;
let checks = 0;
const check = (value, label) => {
  assert(value, label);
  checks++;
};
try {
  await server.listen();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://127.0.0.1:5209?role=stock_entry&view=stock-cards");
  await page.getByText("Showroom available", { exact: true }).waitFor();
  check(
    await page.getByText("250.00 m", { exact: true }).isVisible(),
    "Showroom card shows the current physical-floor total",
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Four stock cards fit ${width}px`,
    );
  }
  console.log(`PASS: ${checks} showroom fabric card browser checks`);
} finally {
  await browser?.close();
  await server.close();
}
