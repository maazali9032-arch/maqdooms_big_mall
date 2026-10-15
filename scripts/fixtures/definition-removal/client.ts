const locations=[{id:'root',name:'Showroom',code:'SHOWROOM',kind:'showroom',parent_id:null,active:true,fabric_thaans:0,fabric_mm:'0',finished_pieces:'0'}, {id:'f3',name:'Showroom F3',code:'F3',kind:'showroom_sublocation',parent_id:'root',active:true,fabric_thaans:2,fabric_mm:'20000',finished_pieces:'0'},{id:'empty',name:'Test Display A',code:'TEST-A',kind:'showroom_sublocation',parent_id:'root',active:false,fabric_thaans:0,fabric_mm:'0',finished_pieces:'0'}];
const products=[{id:'sherwani',name:'Sherwani',code:'01',active:true},{id:'suit',name:'Suit',code:'02',active:true}];
const designs=[{id:'design',name:'Embroidery',code:'DES-1',active:true}];
const deleted=new Set<string>();const calls:{name:string;args:Record<string,unknown>}[]=[];
Object.assign(window,{definitionCalls:calls});
export const supabase={rpc:async(name:string,args:Record<string,unknown>={})=>{
 calls.push({name,args});if(name==='owner_location_summary')return {data:locations.filter(l=>!deleted.has(l.id)),error:null};if(name==='owner_production_catalog')return {data:{products:products.filter(p=>!deleted.has(p.id)),designs:designs.filter(d=>!deleted.has(d.id))},error:null};
 if(name==='owner_delete_definition'){if(location.search.includes('reject'))return {data:null,error:{code:'P0001',message:'Move all stock out of this floor before deleting it'}};deleted.add(String(args.p_id));return {data:args.p_id,error:null};}
 if(name==='inventory_locations')return {data:[...locations.filter(l=>l.kind!=='showroom'&&!deleted.has(l.id)),{id:'workshop',name:'Workshop',kind:'workshop',active:true,parent_id:null}],error:null};
 return {data:null,error:new Error('Unexpected fixture RPC '+name)};
}};
