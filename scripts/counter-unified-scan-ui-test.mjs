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
const server=await createServer({configFile:false,envDir:false,root:fixture,cacheDir:path.join(os.tmpdir(),'counter-unified-scan-vite'),plugins:[react(),tailwind()],resolve:{alias:[{find:'@/app/providers/session',replacement:path.resolve('scripts/fixtures/workshop-inventory/session.tsx')},{find:'@/integrations/supabase/client',replacement:path.join(fixture,'client.ts')},{find:'@',replacement:path.resolve('src')}]},server:{host:'127.0.0.1',port:5205,strictPort:true,fs:{allow:[process.cwd()]}}});
let browser,checks=0;const errors=[];const check=(v,label)=>{assert(v,label);checks++;};const base='http://127.0.0.1:5205';
try{
 await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
 const input=()=>page.getByLabel('Counter barcode',{exact:true});
 const calls=()=>page.evaluate(()=>window.workflowCalls);
 const issues=()=>page.evaluate(()=>window.workflowIssues);
 async function start(suffix='') {await page.goto(base+'?role=counter'+suffix);await page.getByLabel('Work source location').selectOption('floor');await page.getByRole('button',{name:'Proceed',exact:true}).click();await input().waitFor();}
 async function enter(code){await input().fill(code);await input().press('Enter');}
 async function scan(code){await enter(code);await page.waitForFunction(()=>document.querySelector('[aria-label="Counter barcode"]').value==='');}
 await start();
 const nav=await page.getByRole('navigation',{name:'Role navigation'}).innerText();
 check(nav.includes('Counter / POS')&&nav.includes('Account')&&!nav.includes('Customer Tailoring')&&!nav.includes('Owner Production'),'Counter navigation contains POS and Account only');
 check(await input().count()===1&&!await page.getByRole('button',{name:'Find bill',exact:true}).count()&&!await page.getByRole('button',{name:'Extra fabric for existing ID',exact:true}).count(),'One shared scan entry without manual workflow tabs');
 await scan('TAIL-BILL');await page.getByRole('heading',{name:'Customer tailoring · extra fabric'}).waitFor();
 check(await page.getByLabel('Existing customer job').inputValue()==='','Multi-job customer bill requires explicit job selection');
 check((await issues()).length===0,'Reading bill changes no stock');
 await page.getByLabel('Existing customer job').selectOption('customer-2');await scan('TH-1');await page.getByLabel('Extra metres').fill('1');
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Customer extra issue fits '+width);}
 await page.getByRole('button',{name:'Issue extra fabric',exact:true}).click();await page.waitForFunction(()=>window.workflowIssues.length===1);await input().waitFor({state:'visible'});
 let posted=await issues();check(posted[0].p_job==='customer-2'&&posted[0].p_source==='floor'&&posted[0].p_quantity===1000,'Customer issue uses chosen job, current floor and exact millimetres');
 await page.getByText('Original customer bill · TAIL-BILL',{exact:true}).click();await page.getByText('Total ₹2,500.00',{exact:true}).waitFor();
 check(!(await calls()).some(c=>c.name==='complete_counter_bill'||c.name==='mark_counter_bill_paid'),'Extra issue never rebuilds or settles the customer bill');
 await scan('PROD-1');await page.getByRole('heading',{name:'Production ID · PROD-1'}).waitFor();
 check(!await page.getByText('987654321',{exact:false}).count(),'Production document does not expose CP in Counter UI');
 await scan('TH-2');await page.getByLabel('Extra metres').fill('10');await page.getByRole('button',{name:'Issue extra fabric',exact:true}).click();await page.getByText('Requested metres exceed this floor’s stock',{exact:true}).waitFor();check((await issues()).length===1,'Over-issue is rejected without posting');
 await page.getByLabel('Extra metres').fill('1');await page.getByRole('button',{name:'Issue extra fabric',exact:true}).click();await page.waitForFunction(()=>window.workflowIssues.length===2);
 posted=await issues();check(posted[1].p_code==='PROD-1'&&posted[1].p_source==='floor'&&posted[1].p_quantity_mm===1000,'Production issue links the original Production ID and selected floor');
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Production extra issue fits '+width);}
 await enter('FP-1');await page.getByText('This ID is loaded for extra fabric.',{exact:false}).waitFor();check(!await page.getByLabel('Remove FP-1').count()&&(await issues()).length===2,'Finished-piece scan cannot become a sale while an issue ID is loaded');
 await scan('PROD-CLOSED');await scan('TH-1');check(await page.getByRole('button',{name:'Issue extra fabric',exact:true}).isDisabled(),'Closed production remains read-only');
 await page.getByRole('button',{name:'New bill',exact:true}).click();await scan('TH-1');await enter('TAIL-BILL');await page.getByText('Complete or clear the current bill before opening an existing ID',{exact:true}).waitFor();check(await page.getByLabel('Remove TH-1').isVisible(),'Existing-ID scan preserves an unfinished sale');
 await page.getByLabel('Remove TH-1').click();await scan('TAIL-BILL');await page.getByLabel('Existing customer job').selectOption('customer-1');await scan('TH-1');await page.getByLabel('Extra metres').fill('1');
 await enter('UNKNOWN');await page.getByText('No item, customer bill or Production ID matches this barcode',{exact:true}).waitFor();check(!await page.getByLabel('Extra metres').count(),'Failed scan cannot issue previously scanned fabric');
 await enter('COLLISION');await page.getByText('This barcode matches different records.',{exact:false}).waitFor();check((await issues()).length===2,'Ambiguous cross-record identifier is rejected');
 await scan('RETAIL-BILL');await page.getByRole('heading',{name:'Customer bill',exact:true}).waitFor();check(!await page.getByRole('heading',{name:'Customer tailoring · extra fabric'}).count(),'Retail-only bill loads as receipt without inventing tailoring');
 await start('&retry');await scan('TAIL-JOB-1');await scan('TH-1');await page.getByLabel('Extra metres').fill('1');await page.getByRole('button',{name:'Issue extra fabric',exact:true}).click();await page.getByRole('button',{name:'Retry unchanged issue',exact:true}).waitFor();
 check(await input().isDisabled()&&await page.getByRole('button',{name:'Change floor',exact:true}).isDisabled()&&await page.getByRole('button',{name:'New bill',exact:true}).isDisabled(),'Uncertain issue freezes scanner, floor and document changes');
 await page.getByRole('button',{name:'Retry unchanged issue',exact:true}).click();await page.getByRole('button',{name:'Retry unchanged issue',exact:true}).waitFor({state:'detached'});
 const retries=(await calls()).filter(c=>c.name==='issue_additional_customer_fabric');check(retries.length===2&&retries[0].args.p_request===retries[1].args.p_request&&(await issues()).length===1,'Lost response retries the same request without a second issue');
 const module=await server.ssrLoadModule(path.resolve('src/app/access/modules.ts'));
 check(!module.canAccessPath(['counter'],[],'/tailoring')&&module.canAccessPath(['counter'],[],'/pos'),'Counter has a single operational page');
 check(module.canAccessPath(['owner'],[],'/tailoring')&&module.canAccessPath(['tailor'],[],'/tailoring')&&module.canAccessPath(['counter','tailor'],[],'/tailoring'),'Owner, Tailor and combined role access preserved');
 check(!errors.length,'No component runtime errors: '+errors.join(', '));
 await fs.writeFile('docs/COUNTER_UNIFIED_SCAN_UI_VERIFICATION.json',JSON.stringify({verified_at:new Date().toISOString(),passed:true,checks,fixture:true,live_writes:false},null,2)+'\n');console.log('PASS: '+checks+' unified Counter UI checks');
}finally{await browser?.close();await server.close();}
