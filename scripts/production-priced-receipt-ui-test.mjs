/** Real production receipt screen, synthetic RPCs only. */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const folder = await fs.mkdtemp(path.join(os.tmpdir(), "maqdooms-priced-receipt-"));
await fs.writeFile(
  path.join(folder, "index.html"),
  '<div id="root"></div><script type="module" src="/main.tsx"></script>',
);
await fs.writeFile(
  path.join(folder, "session.ts"),
  `export const useSession=()=>({isOwner:false,can:p=>!location.search.includes('noPrice')||p!=='stock.price_finished'});`,
);
await fs.writeFile(
  path.join(folder, "client.ts"),
  `
window.calls=[];window.created=[];let received=false,lost=false;const processed=new Set();const specs=[{piece_number:1,product:'Shirt',design:'Plain',size:'38'},{piece_number:2,product:'Suit',design:'Embroidery',size:'40'}];
export const supabase={async rpc(name,args={}){window.calls.push({name,args});
 if(name==='production_job_document')return {data:{id:'job',code:'PROD-1',product:'Mixed products',quantity:2,size:null,design:'Mixed',status:received?'completed':'open',received_at:received?'2026-10-20T11:00:00Z':null,pieces:specs},error:null};
 if(name==='workshop_production_pieces')return {data:window.created,error:null};
 if(name==='receive_production_barcode_priced'){
  if(!processed.has(args.p_request)){processed.add(args.p_request);received=true;window.created=specs.map((s,i)=>({...s,id:'piece'+i,barcode:'80000000000'+i,location_kind:'workshop',status:'available',sp_paise:args.p_prices[i].sp_paise,cp_visible:false}));}
  if(location.search.includes('retry')&&!lost){lost=true;return {data:null,error:{message:'Simulated lost response'}};}
  return {data:'job',error:null};
 }
 return {data:null,error:{message:'Unexpected RPC '+name}};
}};`,
);
await fs.writeFile(
  path.join(folder, "main.tsx"),
  `import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {Toaster} from 'sonner';import {ProductionReceipt} from '@/features/inventory/ProductionReceipt';import '@/styles.css';createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><main className="max-w-5xl mx-auto p-4"><ProductionReceipt/><Toaster/></main></QueryClientProvider>);`,
);
const server = await createServer({
  configFile: false,
  envDir: false,
  root: folder,
  cacheDir: path.join(folder, "cache"),
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      { find: "@/app/providers/session", replacement: path.join(folder, "session.ts") },
      { find: "@/integrations/supabase/client", replacement: path.join(folder, "client.ts") },
      { find: "@", replacement: path.resolve("src") },
      ...["react", "react-dom", "@tanstack/react-query", "sonner"].map((name) => ({
        find: new RegExp("^" + name.replaceAll("/", "\\/") + "(/.*)?$"),
        replacement: path.resolve("node_modules", name) + "$1",
      })),
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5208,
    strictPort: true,
    fs: { allow: [folder, process.cwd()] },
  },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  async function open(suffix = "") {
    await page.goto("http://127.0.0.1:5208" + suffix);
    const scanner = page.getByLabel("Workshop Production ID", { exact: true });
    await scanner.fill("PROD-1");
    await scanner.press("Enter");
    await page
      .getByRole("heading", { name: "Set SP before generating finished-item barcodes" })
      .waitFor();
  }
  const confirm = () =>
    page.getByRole("button", { name: "Receive and generate priced barcodes", exact: true });
  await open();
  assert(await confirm().isDisabled());
  assert.equal(await page.evaluate(() => window.created.length), 0);
  await page.getByLabel("Initial SP for piece 1", { exact: true }).fill("500");
  assert(await confirm().isDisabled());
  await page.getByLabel("Initial SP for piece 2", { exact: true }).fill("0");
  assert(await confirm().isDisabled());
  await page.getByLabel("Initial SP for all pieces", { exact: true }).fill("500");
  await page.getByRole("button", { name: "Apply SP to all pieces", exact: true }).click();
  assert.equal(
    await page.getByLabel("Initial SP for piece 2", { exact: true }).inputValue(),
    "500",
  );
  await page.getByLabel("Initial SP for piece 2", { exact: true }).fill("750");
  assert(await confirm().isEnabled());
  for (const width of [320, 390, 768, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  await page.screenshot({ path: path.join(folder, "prices-before-barcodes.png"), fullPage: true });
  await confirm().click();
  await page.getByRole("button", { name: "Print saved product labels" }).waitFor();
  const calls = await page.evaluate(() => window.calls);
  assert(
    !calls.some((c) => c.name === "receive_production_barcode"),
    "Scanning must never call the unpriced write API",
  );
  const request = calls.find((c) => c.name === "receive_production_barcode_priced");
  assert.deepEqual(request.args.p_prices, [
    { piece_number: 1, sp_paise: 50000 },
    { piece_number: 2, sp_paise: 75000 },
  ]);
  await open("?noPrice");
  assert(await confirm().isDisabled());
  assert.equal(await page.getByLabel("Initial SP for piece 1", { exact: true }).count(), 0);
  await open("?retry");
  await page.getByLabel("Initial SP for all pieces", { exact: true }).fill("500");
  await page.getByRole("button", { name: "Apply SP to all pieces", exact: true }).click();
  await confirm().click();
  await page.getByRole("button", { name: "Retry same priced receipt", exact: true }).waitFor();
  assert(await page.getByLabel("Workshop Production ID", { exact: true }).isDisabled());
  assert(await page.getByLabel("Initial SP for piece 1", { exact: true }).isDisabled());
  await page.getByRole("button", { name: "Retry same priced receipt", exact: true }).click();
  await page.getByRole("button", { name: "Print saved product labels" }).waitFor();
  const retries = await page.evaluate(() =>
    window.calls.filter((c) => c.name === "receive_production_barcode_priced"),
  );
  assert.equal(retries.length, 2);
  assert.deepEqual(retries[0].args, retries[1].args);
  assert.equal(await page.evaluate(() => window.created.length), 2);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: read-only scanning, required per-piece positive SP, apply-all and overrides, permissions, responsive layout, saved label prices and exact locked retry. Preview:",
    folder,
  );
} finally {
  await browser?.close();
  await server.close();
}
