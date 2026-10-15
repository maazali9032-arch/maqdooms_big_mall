/** Read-only production acceptance. Uses existing accounts/barcodes; no fixtures. */
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import postgres from "postgres";
process.loadEnvFile(".env");
const floorsOnly = process.argv.includes('--showroom-floors');
const sql = postgres(process.env.LOVABLE_DB_MIGRATION_URL, {
  ssl: "require",
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
});
let checks = 0;
const check = (v, label) => {
  assert(v, label);
  checks++;
};
async function inspect(id, barcode, role = "authenticated") {
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction read only");
    await tx`select set_config('request.jwt.claim.sub',${id ?? ""},true)`;
    await tx.unsafe("set local role " + role);
    return (await tx`select owner_barcode_inspect(${barcode},null,null,100) result`)[0].result;
  });
}
try {
  const users =
    await sql`select distinct on(r.role_key) r.role_key,p.id from user_roles r join profiles p on p.id=r.user_id where p.active order by r.role_key,p.id`;
  const owner = users.find((u) => u.role_key === "owner");
  check(!!owner, "Existing Owner available");
  const tables =
    await sql`select tablename from pg_tables where schemaname='public' order by tablename`;
  const fingerprint = async () => {
    const out = {};
    for (const { tablename } of tables) {
      // Presence updates from real logins can occur during separate read-only role probes.
      // All account identity/access fields and every business/audit field stay compared.
      const row = tablename==='profiles' ? "(to_jsonb(t)-'last_login')" : 'to_jsonb(t)';
      out[tablename] = (
        await sql.unsafe(
          `select count(*)::int n,md5(coalesce(string_agg(${row}::text,E'\\n' order by ${row}::text),'')) hash from public."${tablename}" t`,
        )
      )[0];
    }
    return out;
  };
  const before = await fingerprint();
  const codes =
    await sql`select b.code from barcodes b where exists(select 1 from fabric_stock s where s.barcode_id=b.id) or exists(select 1 from finished_products p where p.barcode_id=b.id) order by b.id limit 100`;
  let transfers = 0;
  for (const { code } of codes) {
    const result = await inspect(owner.id, code);
    check(result.status === "found", "Existing item resolves");
    check(
      result.events.every((e) => e.key && e.source),
      "Events identify exact evidence sources",
    );
    if (result.events.some((e) => e.source === "inventory_movements" && e.title === "TRANSFER"))
      transfers++;
  }
  check(
    (await inspect(owner.id, "UNKNOWN-INSPECTOR-ACCEPTANCE")).status === "unknown",
    "Unknown barcode is honest",
  );
  for (const user of users.filter((u) => u.role_key !== "owner")) {
    const hasOwner = (
      await sql`select exists(select 1 from user_roles where user_id=${user.id} and role_key='owner') owner`
    )[0].owner;
    if (hasOwner) continue;
    let rejected = false;
    try {
      await inspect(user.id, codes[0]?.code ?? "UNKNOWN");
    } catch (e) {
      rejected = e.code === "42501";
    }
    check(rejected, user.role_key + " rejected by backend");
  }
  let anonDenied = false;
  try {
    await inspect(null, "UNKNOWN", "anon");
  } catch {
    anonDenied = true;
  }
  check(anonDenied, "Anonymous caller denied");
  const grants = (
    await sql`select has_function_privilege('anon','owner_barcode_inspect(text,timestamptz,text,integer)','EXECUTE') anon,has_function_privilege('service_role','owner_barcode_inspect(text,timestamptz,text,integer)','EXECUTE') service,has_function_privilege('authenticated','barcode_inspector_json(jsonb)','EXECUTE') private_helper`
  )[0];
  check(
    !grants.anon && !grants.service && !grants.private_helper,
    "No anonymous/service/private-helper bypass grants",
  );
  const read = (id, query, args=[]) => sql.begin(async tx=>{await tx.unsafe('set transaction read only');await tx`select set_config('request.jwt.claim.sub',${id??''},true)`;await tx.unsafe('set local role authenticated');return tx.unsafe(query,args);});
  const activity=(await read(owner.id,'select stock_activity(200,null,null,null) result'))[0].result;
  check(activity.some(r=>r.kind==='TRANSFER'),'Real posted transfers visible in stock movements');
  check(Array.isArray((await read(owner.id,'select workshop_receipt_queue() result'))[0].result),'Owner Workshop receipt queue readable');
  check(Array.isArray((await read(owner.id,'select owner_factory_users() result'))[0].result),'Owner shared user definitions readable');
  check(Array.isArray((await read(owner.id,'select customer_tailoring_work(null) result'))[0].result),'Owner customer work projection readable');
  for(const u of users){
    if((await sql`select exists(select 1 from user_roles where user_id=${u.id} and role_key='owner') yes`)[0].yes)continue;
    let rejected=false;try{await read(u.id,'select owner_factory_users()');}catch{rejected=true;}check(rejected,'Owner definitions rejected for '+u.role_key);
  }
  const protectedTables=['counter_bills','counter_bill_payments','counter_tailoring_details','customer_issue_fabric_costs','counter_bill_print_records','production_piece_specs','mixed_production_requests','factory_user_requests','owner_definition_deletions'];
  for(const table of protectedTables){const p=(await sql.unsafe(`select has_table_privilege('anon',$1,'SELECT') a, has_table_privilege('authenticated',$1,'INSERT') i,has_table_privilege('authenticated',$1,'UPDATE') u,has_table_privilege('authenticated',$1,'DELETE') d`,[table]))[0];check(!p.a&&!p.i&&!p.u&&!p.d,'Protected history has no raw writes/anonymous grant: '+table);}
  const summaries=(await read(owner.id,'select owner_location_summary() result'))[0].result;
  const rootSummary=summaries.find(l=>l.kind==='showroom'),f3=summaries.find(l=>l.name==='Showroom F3');
  const root=floorsOnly?(await sql`select id,name from locations where kind='showroom'`)[0]:rootSummary;
  check(floorsOnly?!rootSummary:root&&root.fabric_thaans===0,floorsOnly?'General Showroom is absent from administration':'General Showroom is visible with no unassigned Thaans');
  if(floorsOnly){
    for(const u of users){const choices=await read(u.id,'select * from inventory_locations()');check(!choices.some(l=>l.kind==='showroom'||l.id===root.id),'General Showroom is not a work option for '+u.role_key);}
    let blocked=false;try{await read(owner.id,'select counter_scan_barcode($1,$2)',['unknown-barcode',root.id]);}catch(e){blocked=e.message.includes('active Showroom floor');}check(blocked,'Stale Counter source cannot use general Showroom');
    check((await sql`select count(*)::int n from pg_trigger where tgname='inventory_movement_showroom_floor_guard' and tgenabled='O'`)[0].n===1,'General Showroom ledger guard is enabled');
    check(!(await sql`select exists(select 1 from inventory_items i where inventory_balance(i.id,${root.id})<>0) yes`)[0].yes,'General Showroom contains no inventory');
  }
  if(floorsOnly){
    const [actual]=await sql`select (select count(*)::int from inventory_items i where i.thaan_id is not null and inventory_balance(i.id,l.id)>0) thaans,(select coalesce(sum(inventory_balance(i.id,l.id)),0) from inventory_items i where i.thaan_id is not null) mm from locations l where l.name='Showroom F3'`;
    check(f3&&f3.fabric_thaans===actual.thaans&&Number(f3.fabric_mm)===Number(actual.mm),'F3 summary matches current recorded stock; later business activity is preserved');
  }else check(f3&&f3.fabric_thaans===2&&Number(f3.fabric_mm)===20000,'F3 has exactly the two authorized 10-metre Thaans');
  check(activity.some(r=>r.kind==='TRANSFER'&&r.source==='Showroom — floor not assigned'&&r.destination==='Showroom F3'),'History distinguishes root Showroom from the newly assigned floor');
  for(const u of users){if((await sql`select exists(select 1 from user_roles where user_id=${u.id} and role_key='owner') yes`)[0].yes)continue;let rejected=false;try{await read(u.id,'select owner_delete_definition($1,$2,$3,$4,true)',['00000000-0000-0000-0000-000000000051','floor',root.id,root.name]);}catch(e){rejected=e.code==='42501';}check(rejected,'Staff Delete denied before any operational write: '+u.role_key);}
  const workshop=(await sql`select id from locations where kind='workshop' limit 1`)[0].id;
  let compatibilityBlocked=false;
  try{await read(owner.id,"select complete_finished_product_sale(null,$1,'[]'::jsonb,null,true,null,null)",[workshop]);}catch(e){compatibilityBlocked=e.message.includes('Showroom');}
  check(compatibilityBlocked,'Older finished-sale API rejects Workshop before any operational write');
  assert.deepEqual(await fingerprint(), before);
  check(true, "Every public row unchanged during acceptance");
  await fs.writeFile(
    floorsOnly ? "docs/SHOWROOM_FLOORS_ONLY_LIVE_VERIFICATION.json" : "docs/DEFINITION_REMOVAL_LIVE_VERIFICATION.json",
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        passed: true,
        checks,
        read_only_transactions: true,
        barcodes_checked: codes.length,
        barcodes_with_posted_transfers: transfers,
        public_tables_preserved: tables.length,
        concurrent_presence_column_excluded: 'profiles.last_login',
      },
      null,
      2,
    ) + "\n",
  );
  console.log("PASS: " + checks + " live read-only checks");
} finally {
  await sql.end();
}
