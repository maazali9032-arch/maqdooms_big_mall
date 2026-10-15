/** Read-only production acceptance. Uses existing accounts/barcodes; no fixtures. */
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import postgres from "postgres";
process.loadEnvFile(".env");
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
  const protectedTables=['counter_bills','counter_bill_payments','counter_tailoring_details','customer_issue_fabric_costs','counter_bill_print_records','production_piece_specs','mixed_production_requests','factory_user_requests'];
  for(const table of protectedTables){const p=(await sql.unsafe(`select has_table_privilege('anon',$1,'SELECT') a, has_table_privilege('authenticated',$1,'INSERT') i,has_table_privilege('authenticated',$1,'UPDATE') u,has_table_privilege('authenticated',$1,'DELETE') d`,[table]))[0];check(!p.a&&!p.i&&!p.u&&!p.d,'Protected history has no raw writes/anonymous grant: '+table);}
  const workshop=(await sql`select id from locations where kind='workshop' limit 1`)[0].id;
  let compatibilityBlocked=false;
  try{await read(owner.id,"select complete_finished_product_sale(null,$1,'[]'::jsonb,null,true,null,null)",[workshop]);}catch(e){compatibilityBlocked=e.message.includes('Showroom');}
  check(compatibilityBlocked,'Older finished-sale API rejects Workshop before any operational write');
  assert.deepEqual(await fingerprint(), before);
  check(true, "Every public row unchanged during acceptance");
  await fs.writeFile(
    "docs/WORKFLOW_WORKSPACES_LIVE_VERIFICATION.json",
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
