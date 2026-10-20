/** Real Counter UI, synthetic RPCs only. No environment file or hosted writes. */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const folder = await fs.mkdtemp(path.join(os.tmpdir(), "maqdooms-loaded-order-"));
await fs.writeFile(
  path.join(folder, "index.html"),
  '<div id="root"></div><script type="module" src="/main.tsx"></script>',
);
await fs.writeFile(
  path.join(folder, "session.ts"),
  `export const useSession=()=>({isOwner:false,roles:['counter'],userId:'counter',can:()=>true});`,
);
await fs.writeFile(
  path.join(folder, "client.ts"),
  `
const calls=window.testCalls=[], issues=window.testIssues=[],posted=new Set();let lost=false;
const doc={id:'production',code:'PROD-1',product:'Suit',design:'Embroidery',size:'40',quantity:2,status:'open',tailors:[{code:'T1',name:'Nadeem'}],fabrics:[{name:'Cotton',barcode:'TH-1',source:'Workshop',quantity_mm:5000,issue_type:'required'}],cp_total_paise:987654321};
export const supabase={rpc(name,args={}){
 calls.push({name,args});let data=null,error=null;
 if(name==='gst_transaction_configuration')data={configuration:null,rules:[]};
 else if(name==='tailoring_work_catalog')data={products:[],designs:[]};
 else if(name==='salesperson_options'||name==='tailoring_assignment_options')data=[];
 else if(name==='production_job_document') data=['PROD-1','PROD-CLOSED'].includes(args.p_code)?{...doc,code:args.p_code,status:args.p_code==='PROD-CLOSED'?'completed':'open'}:null;
 else if(name==='counter_bill')data=null;
 else if(name==='customer_tailoring_work')data=args.p_code==='TJ-1'?[{id:'customer',code:'TJ-1',garment:'Customer kurta',status:'open',factory:'Factory B',tailor:'Nadeem',fabrics:[]}]:[];
 else if(name==='counter_scan_barcode_any') data=['TH-1','TH-2'].includes(args.p_barcode)?{kind:'fabric',name:'Cotton',barcode:args.p_barcode,cuts:[{inventory_item_id:'fabric',locations:[{id:args.p_barcode==='TH-1'?'floor1':'floor2',name:args.p_barcode==='TH-1'?'Showroom F1':'Showroom F2',kind:'showroom_sublocation',quantity_mm:10000}]}]}:null;
 else if(name==='issue_additional_production_fabric'||name==='issue_additional_customer_fabric'){
   if(!posted.has(args.p_request)){posted.add(args.p_request);issues.push({name,args});}
   if(location.search.includes('retry')&&!lost){lost=true;error={message:'Simulated lost response'};}else data='issue';
 }else error={message:'Unexpected test RPC '+name};
 const result=Promise.resolve({data,error});result.abortSignal=()=>result;return result;
}};
`,
);
await fs.writeFile(
  path.join(folder, "main.tsx"),
  `import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {Toaster} from 'sonner';import {CounterWorkspace} from '@/features/pos/CounterWorkspace';import '@/styles.css';createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><main className="max-w-6xl mx-auto p-4"><CounterWorkspace/><Toaster/></main></QueryClientProvider>);`,
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
    port: 5207,
    strictPort: true,
    fs: { allow: [folder, process.cwd()] },
  },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const input = page.getByLabel("Counter barcode", { exact: true });
  const scan = async (code) => {
    await input.fill(code);
    await input.press("Enter");
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Counter barcode"]').value === "",
    );
  };
  await page.goto("http://127.0.0.1:5207");
  await scan("PROD-1");
  await page.getByRole("heading", { name: "Production order loaded", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Production ID · PROD-1", exact: true }).waitFor();
  assert(await page.getByText("Next: scan the fabric barcode above", { exact: false }).isVisible());
  assert.equal(
    await page.getByRole("button", { name: "Issue extra fabric", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.evaluate(() => window.testIssues.length),
    0,
    "Opening the order must not move stock",
  );
  assert(
    !(await page.locator("body").innerText()).includes("987654321"),
    "Counter must not see CP",
  );
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "Loaded order overflows at " + width,
    );
  }
  await page.screenshot({ path: path.join(folder, "production-loaded.png"), fullPage: true });
  await scan("TH-1");
  await page.getByLabel("Extra metres").fill("1");
  await scan("TH-2");
  assert.equal(
    await page.getByLabel("Extra metres").inputValue(),
    "",
    "Changing the fabric clears the quantity",
  );
  await page.getByLabel("Extra metres").fill("1");
  await page.getByRole("button", { name: "Issue extra fabric", exact: true }).click();
  await page.waitForFunction(() => window.testIssues.length === 1);
  const issue = await page.evaluate(() => window.testIssues[0]);
  assert.equal(issue.args.p_source, "floor2");
  assert.equal(issue.args.p_code, "PROD-1");
  assert.equal(issue.args.p_quantity_mm, 1000);
  await scan("TJ-1");
  await page
    .getByRole("heading", { name: "Customer tailoring order loaded", exact: true })
    .waitFor();
  assert(await page.getByText("Customer kurta", { exact: true }).isVisible());
  await scan("PROD-CLOSED");
  await page
    .getByText("This job is completed; extra fabric cannot be issued.", { exact: true })
    .waitFor();
  await scan("TH-1");
  assert(await page.getByRole("button", { name: "Issue extra fabric", exact: true }).isDisabled());
  await page.goto("http://127.0.0.1:5207?retry");
  await scan("PROD-1");
  await scan("TH-1");
  await page.getByLabel("Extra metres").fill("1");
  await page.getByRole("button", { name: "Issue extra fabric", exact: true }).click();
  await page.getByRole("button", { name: "Retry unchanged issue", exact: true }).waitFor();
  assert(await input.isDisabled());
  assert(await page.getByRole("button", { name: "New bill", exact: true }).isDisabled());
  await page.getByRole("button", { name: "Retry unchanged issue", exact: true }).click();
  await page
    .getByRole("button", { name: "Retry unchanged issue", exact: true })
    .waitFor({ state: "detached" });
  const retries = await page.evaluate(() =>
    window.testCalls.filter((c) => c.name === "issue_additional_production_fabric"),
  );
  assert.equal(retries.length, 2);
  assert.equal(retries[0].args.p_request, retries[1].args.p_request);
  assert.equal(await page.evaluate(() => window.testIssues.length), 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: immediate production/customer order details before fabric scan, no automatic issues, responsive layout, source changes, closed jobs and unchanged uncertain-result retries. Preview:",
    folder,
  );
} finally {
  await browser?.close();
  await server.close();
}
