import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture=path.resolve('scripts/fixtures/workflow-workspaces');
const server=await createServer({configFile:false,envDir:false,root:fixture,cacheDir:path.join(os.tmpdir(),'counter-stitching-vite'),plugins:[react(),tailwind()],resolve:{alias:[{find:'@/app/providers/session',replacement:path.resolve('scripts/fixtures/workshop-inventory/session.tsx')},{find:'@/integrations/supabase/client',replacement:path.join(fixture,'client.ts')},{find:'@',replacement:path.resolve('src')}]},server:{host:'127.0.0.1',port:5207,strictPort:true,fs:{allow:[process.cwd()]}}});
let browser,checks=0;const errors=[];const check=(v,label)=>{assert(v,label);checks++;};
try{
 await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5207?role=counter&barcodeDetails');await page.getByLabel('Work source location').selectOption('floor');await page.getByRole('button',{name:'Proceed',exact:true}).click();
 const scan=page.getByLabel('Counter barcode',{exact:true});for(const code of ['TH-1','TH-2']){await scan.fill(code);await scan.press('Enter');await page.waitForFunction(()=>document.querySelector('[aria-label="Counter barcode"]').value==='');}
 await page.getByLabel('Cut metres TH-1').fill('5');await page.getByLabel('Fabric price per metre TH-1').fill('100');await page.getByLabel('Cut metres TH-2').fill('4');await page.getByLabel('Fabric price per metre TH-2').fill('100');
 await page.getByLabel('Select TH-2 for tailoring').check();await page.getByLabel('Tailoring garment',{exact:true}).fill('Sherwani');await page.getByLabel('Stitching charge',{exact:true}).fill('300');await page.getByLabel('Assignment factory',{exact:true}).selectOption('factory');await page.getByRole('radio',{name:/Ali/}).check();
 const total=page.getByText('Bill total ₹1,200.00',{exact:true});await total.waitFor();check(true,'Draft stitching immediately appears in the ₹1,200 preview');
 check(await page.getByRole('button',{name:'Complete paid bill',exact:true}).isDisabled(),'Incomplete tailoring cannot silently complete as fabric-only');
 await page.getByRole('button',{name:'Add tailoring job',exact:true}).click();await page.getByText('Select a delivery date before adding the tailoring job',{exact:true}).waitFor();
 check(!await page.evaluate(()=>window.workflowCalls.some(c=>c.name==='complete_counter_bill')),'Missing date does not submit a bill');
 await page.getByLabel('Tailoring delivery date').fill('2026-10-26');await page.getByRole('button',{name:'Add tailoring job',exact:true}).click();
 await page.getByText('Fabric ₹400.00 + Stitching ₹300.00 · Bill line ₹700.00',{exact:true}).waitFor();check(await total.isVisible(),'Adding the job includes fabric and stitching exactly once');
 check(await page.getByLabel('Fabric price per metre TH-2').inputValue()==='100','Tailored fabric keeps an explicit editable per-metre price');
 await page.getByLabel('Fabric price per metre TH-2').fill('110');check(await page.getByText('Bill total ₹1,240.00',{exact:true}).isVisible(),'Tailored fabric price changes update the combined total');await page.getByLabel('Fabric price per metre TH-2').fill('100');
 await page.getByRole('button',{name:'Edit job',exact:true}).click();check(await page.getByLabel('Stitching charge',{exact:true}).inputValue()==='300','Editing retains the recorded stitching input');check(await total.isVisible(),'Editing the job never doubles its stitching charge');check(await page.getByRole('button',{name:'Complete paid bill',exact:true}).isDisabled(),'Edited job must be added before bill completion');await page.getByRole('button',{name:'Add tailoring job',exact:true}).click();
 await page.getByLabel('Salesperson',{exact:true}).selectOption('3c8edb35-9c60-4e33-9b27-4ab67cd50132');await page.getByLabel('Bill payment status').selectOption('unpaid');check(await page.getByRole('button',{name:'Complete bill',exact:true}).isEnabled(),'Customer tailoring retains unpaid billing');await page.getByLabel('Bill payment status').selectOption('paid');
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Combined stitching form fits '+width);}
 await page.getByRole('button',{name:'Complete bill',exact:true}).click();await page.getByRole('heading',{name:'Customer bill',exact:true}).waitFor();
 const args=await page.evaluate(()=>window.workflowCalls.find(c=>c.name==='complete_counter_bill').args);
 check(args.p_items.length===1&&args.p_items[0].quantity===5000&&args.p_items[0].sp_paise_per_m===10000,'Retail line submits ₹500 from five metres');
 check(args.p_tailoring.length===1&&args.p_tailoring[0].stitching_paise===30000&&!Object.hasOwn(args.p_tailoring[0],'total_paise'),'Whole-job stitching is submitted separately from fabric SP');
 check(args.p_tailoring[0].items.length===1&&args.p_tailoring[0].items[0].quantity===4000&&args.p_tailoring[0].items[0].sp_paise_per_m===10000,'Tailored line explicitly submits four metres at ₹100');
 const bill=page.locator('section').filter({has:page.getByRole('heading',{name:'Customer bill',exact:true})});
 const amounts=await bill.locator('.divide-y > div > div > strong:last-child').allTextContents();check(JSON.stringify(amounts)===JSON.stringify(['₹500.00','₹700.00']),'Receipt shows exactly the requested ₹500 and ₹700 main lines');
 check(await bill.getByText('Total ₹1,200.00',{exact:true}).isVisible(),'Saved receipt totals ₹1,200');check(await bill.getByText('Fabric ₹400.00 + Stitching ₹300.00 · Delivery: 2026-10-26',{exact:true}).isVisible(),'Combined line explains its fabric and stitching charge');check(!/cost|lagat|assignment|factory|CP\b/i.test(await bill.innerText()),'Customer receipt exposes no CP or internal factory assignment');
 await page.getByRole('button',{name:'Print bill',exact:true}).click();const print=page.frameLocator('iframe[title="Customer bill BILL-1"]');await print.getByText('Total ₹1,200.00',{exact:true}).waitFor();check(JSON.stringify(await print.locator('.divide-y > div > div > strong:last-child').allTextContents())===JSON.stringify(['₹500.00','₹700.00']),'Print source preserves the same two amounts');
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Receipt fits '+width);}
 check(!errors.length,'No runtime errors: '+errors.join(', '));await fs.writeFile('docs/COUNTER_STITCHING_UI_VERIFICATION.json',JSON.stringify({verified_at:new Date().toISOString(),passed:true,checks,fixture:true,live_writes:false,example:{fabric_lines:[500,400],stitching:300,bill_lines:[500,700],total:1200}},null,2)+'\n');console.log('PASS: '+checks+' stitching browser checks');
}finally{await browser?.close();await server.close();}
