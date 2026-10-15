const params=new URLSearchParams(location.search);
const floor={id:'floor',name:'Showroom Floor 1',kind:'showroom_sublocation',parent_id:'showroom',active:true};
const workshop={id:'workshop',name:'Workshop',kind:'workshop',parent_id:null,active:true};
const products=[{id:'sherwani',name:'Sherwani',code:'SH',active:true},{id:'suit',name:'Suit',code:'SU',active:true}],designs=[{id:'design',name:'Embroidery',code:'DES-1',active:true}];
const cuts=(code:string)=>[{inventory_item_id:'item-'+code,thaan_id:'thaan-'+code,locations:params.has('barcodeDetails')?(code==='TH-1'?[{...floor,quantity_mm:9000}]:code==='TH-2'?[{...floor,quantity_mm:8000}]:[{...workshop,quantity_mm:10000}]):[{...floor,quantity_mm:9000},{...workshop,quantity_mm:11000}]}];
const fabric=(code:string)=>({kind:'fabric',barcode:code,name:'Cotton',fabric_name:'Cotton',batch:'B0001',batch_code:'B0001',cuts:cuts(code),variants:(params.has('barcodeDetails')?Array.from({length:10},(_,i)=>'TH-'+(i+1)):['TH-1','TH-2']).map(barcode=>({barcode,fabric_name:'Cotton',batch_code:'B0001',cuts:cuts(barcode)}))});
const piece={kind:'product',id:'piece',barcode:'FP-1',name:'Suit',design:'Embroidery',size:'40',sp_paise:500000,sp_version_id:'price',available:true};
const doc={id:'production',code:'PROD-1',product:'Mixed products / sizes',design:'Per-piece specifications',size:null,quantity:2,status:'open',tailors:[{code:'T-1',name:'Ali'}],fabrics:[],pieces:[{piece_number:1,product:'Sherwani',design:'Embroidery',size:'38'},{piece_number:2,product:'Suit',design:'Embroidery',size:'40'}]};
const existingReceipt={id:'existing-bill',code:'TAIL-BILL',created_at:'2026-10-15T08:00:00Z',total_paise:'250000',paid:true,paid_at:'2026-10-15T08:00:00Z',source:'Original Floor',salesperson:'Recorded Salesperson',customer:{name:'Recorded Customer',phone:null},lines:[]};
const customerJobs=[{id:'customer-1',code:'TAIL-JOB-1',garment:'Customer Sherwani',status:'open',bill_id:'existing-bill',factory:'Central Factory',tailor:'Ali',fabrics:[]},{id:'customer-2',code:'TAIL-JOB-2',garment:'Customer Suit',status:'in_progress',bill_id:'existing-bill',factory:'Central Factory',tailor:'Imran',fabrics:[]}];
const issues:Record<string,unknown>[]=[];const posted=new Set<string>();let retrySeen=false;
const calls:{name:string;args:Record<string,unknown>}[]=[];
Object.assign(window,{workflowCalls:calls,workflowIssues:issues});let receipt:Record<string,unknown>|null=null;
export const supabase={rpc:async(name:string,args:Record<string,unknown>={})=>{
 calls.push({name,args});let data:unknown=null;
 if(name==='inventory_locations')data=[floor,workshop,{id:'showroom',name:'Showroom',kind:'showroom',parent_id:null,active:true}];
 else if(name==='tailoring_work_catalog'||name==='owner_production_catalog')data={products,designs};
 else if(name==='tailoring_assignment_options')data=['a1','a2'].map((id,i)=>({id,factory_id:'factory',factory_name:'Central Factory',tailor_code:'T-'+(i+1),tailor_name:i?'Imran':'Ali',section_name:null}));
 else if(name==='salesperson_options')data=[{id:params.has('barcodeDetails')?'3c8edb35-9c60-4e33-9b27-4ab67cd50132':'salesperson',name:'Recorded Salesperson'}];
 else if(name==='counter_scan_barcode')data=args.p_barcode==='FP-1'?piece:['TH-1','TH-2','COLLISION'].includes(String(args.p_barcode))?fabric(String(args.p_barcode)):args.p_barcode==='TH-WORKSHOP'?{...fabric('TH-WORKSHOP'),cuts:[{inventory_item_id:'workshop-only',locations:[{...workshop,quantity_mm:9000}]}]}:null;
 else if(name==='production_fabric_catalog')data=[fabric(String(args.p_barcode))];
 else if(name==='production_job_document')data=['production','PROD-1','COLLISION'].includes(String(args.p_code))?{...doc,cp_total_paise:987654321}:args.p_code==='PROD-CLOSED'?{...doc,id:'closed',code:'PROD-CLOSED',status:'completed'}:null;
 else if(name==='owner_production_history'||name==='ongoing_production_work')data=[doc];
 else if(name==='customer_tailoring_work')data=['TAIL-BILL','existing-bill'].includes(String(args.p_code))?customerJobs:customerJobs.filter(j=>j.code===args.p_code||j.id===args.p_code);
 else if(name==='owner_factory_users')data=[{id:'user',name:'Existing Tailor',roles:['tailor']}];
 else if(name==='owner_tailoring_hierarchy')data={factories:[{id:'factory',code:'F1',name:'Central Factory',active:true}],tailors:[{id:'tailor',code:'T1',real_name:'Ali',profile_id:'user',active:true}],assignments:[{id:'a1',factory_id:'factory',tailor_id:'tailor',valid_until:null}]};
 else if(name==='complete_counter_bill'){
  type Cut={inventory_item_id:string;quantity:number;sp_paise_per_m:number};
  const items=args.p_items as ({kind:string}&Partial<Cut>)[],groups=args.p_tailoring as {items:Cut[];stitching_paise:number;garment:string;delivery_date:string}[];
  const lines=[...items.map((r,i)=>({id:'retail-'+i,kind:r.kind,name:r.kind==='product'?'Suit':'Cotton',barcode:r.kind==='product'?'FP-1':r.inventory_item_id!.slice(5),quantity:String(r.kind==='product'?1:r.quantity),unit:r.kind==='product'?'pc':'mm',price_paise:r.kind==='product'?null:String(r.sp_paise_per_m),amount_paise:String(r.kind==='product'?500000:Math.round(r.quantity!*r.sp_paise_per_m!/1000))})),...groups.map((g,i)=>{
   const fabric=g.items.reduce((n,c)=>n+Math.round(c.quantity*c.sp_paise_per_m/1000),0);
   return {id:'tailoring-'+i,kind:'tailoring',name:g.garment,quantity:'1',unit:'job',amount_paise:String(fabric+g.stitching_paise),fabric_amount_paise:String(fabric),stitching_paise:String(g.stitching_paise),job_id:'new-job-'+i,job_code:'NEW-JOB-'+i,delivery_date:g.delivery_date,fabrics:g.items.map(c=>({name:'Cotton',barcode:c.inventory_item_id.slice(5),quantity_mm:String(c.quantity)}))};
  })];
  const total=lines.reduce((n,l)=>n+Number(l.amount_paise),0);
  receipt={id:'bill',code:'BILL-1',created_at:'2026-10-15T12:00:00Z',total_paise:String(total),paid:args.p_paid,paid_at:null,source:floor.name,salesperson:'Recorded Salesperson',customer:{name:null,phone:null},lines};data='bill';
 }else if(name==='counter_bill')data=['TAIL-BILL','existing-bill'].includes(String(args.p_code))?existingReceipt:args.p_code==='RETAIL-BILL'?{...existingReceipt,id:'retail',code:'RETAIL-BILL'}:receipt&&[receipt.id,receipt.code].includes(args.p_code)?receipt:null;
 else if(name==='issue_additional_customer_fabric'||name==='issue_additional_production_fabric'){
  if(!posted.has(String(args.p_request))){posted.add(String(args.p_request));issues.push({name,...args});}
  if(params.has('retry')&&!retrySeen){retrySeen=true;return {data:null,error:{message:'Simulated response lost after posting'}};}
  data='issue';
 }
 else if(name==='create_mixed_production')data='production';
 else if(name==='progress_owner_production')data='production';
 else if(name==='manage_production_catalog'||name==='manage_tailoring_entity'||name==='owner_assign_factory_user')data='saved';
 else return {data:null,error:{message:'Unmocked fixture RPC: '+name}};
 if(params.get('fail')===name)return {data:null,error:{message:'Disposable simulated connection failure'}};
 return {data,error:null};
}};
