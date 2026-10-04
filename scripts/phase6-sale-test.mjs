/** Isolated PostgreSQL acceptance: canonical Direct Fabric Sale, money and RLS. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { fabricSaleAmount, fabricSaleCut } from "../src/features/pos/fabric-sale-input.ts";
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
let checks = 0;
const check = (v, label) => {
  assert.ok(v, label);
  checks++;
};
check(fabricSaleAmount(1, 500) === 1, "Half-paise rounds up identically to PostgreSQL");
check(fabricSaleAmount(1001, 12345) === 12357, "Exact mm price calculation");
check(fabricSaleCut("1.001", 1001, 12345).quantity === 1001, "Three-decimal metres");
check(fabricSaleAmount(1000, 0) === 0, "Zero SP permitted");
for (const fn of [
  () => fabricSaleCut("1.0001", 2000, 1),
  () => fabricSaleCut("2", 1000, 1),
  () => fabricSaleCut("-1", 2000, 1),
  () => fabricSaleCut("0", 2000, 1),
  () => fabricSaleAmount(1, 1.1),
  () => fabricSaleAmount(2147483647, Number.MAX_SAFE_INTEGER),
]) {
  assert.throws(fn);
  checks++;
}
for (const [directory, demo] of [
  ["supabase/migrations", true],
  ["drizzle/migrations", true],
  ["supabase/migrations", false],
]) {
  const db = new PGlite();
  const q = async (sql, args = []) => {
    try {
      return (await db.query(sql, args)).rows;
    } catch (e) {
      throw new Error(sql + ": " + e.message);
    }
  };
  const one = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const denied = async (sql, args = [], label = sql) => {
    let err;
    try {
      await q(sql, args);
    } catch (e) {
      err = e;
    }
    check(err, label);
  };
  const login = async (id) => {
    await db.exec("reset role");
    await q("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
    if (id) await db.exec("set role authenticated");
  };
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`);
    const snapshot = async () =>
      JSON.stringify(
        await q(`select t,row from (
 select 'thaans' t,to_jsonb(x) row from thaans x union all select 'fabric_stock',to_jsonb(x) from fabric_stock x
 union all select 'stock_movements',to_jsonb(x) from stock_movements x
 union all select 'inventory_movements',to_jsonb(x) from inventory_movements x
 union all select 'financials',to_jsonb(x) from order_item_financials x
 union all select 'audit',to_jsonb(x) from erp_audit_records x) z order by t,row::text`),
      );
    const files = (await readdir(directory))
      .filter(
        (f) =>
          f.endsWith(".sql") &&
          (process.argv.includes("--include-phase15") || !f.includes("phase15_")) &&
          (process.argv.includes("--include-phase14") || !f.includes("phase14_")) &&
          (process.argv.includes("--include-phase13") || !f.includes("phase13_")) &&
          (process.argv.includes("--include-phase12") || !f.includes("phase12_")) &&
          (process.argv.includes("--include-phase11") || !f.includes("phase11_")) &&
          (process.argv.includes("--include-phase10") || !f.includes("phase10_")) &&
          !f.includes("_live_") &&
          (process.argv.includes("--include-phase10") ||
            process.argv.includes("--include-phase9") ||
            !f.includes("phase9_")) &&
          (process.argv.includes("--include-phase9") ||
            process.argv.includes("--include-phase8") ||
            !f.includes("phase8_")) &&
          (process.argv.includes("--include-phase9") ||
            process.argv.includes("--include-phase8") ||
            process.argv.includes("--include-phase7") ||
            !f.includes("phase7_")),
      )
      .sort();
    check(
      files.length ===
        (process.argv.includes("--include-phase9") ||
        process.argv.includes("--include-phase8") ||
        process.argv.includes("--include-phase7")
          ? process.argv.includes("--include-phase9") || process.argv.includes("--include-phase8")
            ? process.argv.includes("--include-phase15")
              ? 26
              : process.argv.includes("--include-phase14")
                ? 25
                : process.argv.includes("--include-phase13")
                  ? 24
                  : process.argv.includes("--include-phase12")
                    ? 23
                    : process.argv.includes("--include-phase11")
                      ? 22
                      : process.argv.includes("--include-phase10")
                        ? 21
                        : process.argv.includes("--include-phase9")
                          ? 20
                          : 19
            : 17
          : 16),
      "Full 16-file chain",
    );
    let before;
    for (const file of files) {
      if (!demo && file.includes("demo_seed")) continue;
      if (file.includes("phase6_")) before = await snapshot();
      try {
        await db.exec(await readFile(resolve(directory, file), "utf8"));
      } catch (e) {
        throw new Error(file + ": " + e.message);
      }
    }
    check(
      before === (await snapshot()),
      "Migration preserves all existing stock, ledger, finance and audit rows",
    );
    const users = {};
    for (const role of ["owner", "stock_entry", "counter", "tailor", "ecommerce_manager"]) {
      const id = (users[role] = randomUUID());
      await q("insert into auth.users(id,email) values($1,$2)", [id, role + "@sale.test"]);
      await q("insert into profiles(id,full_name) values($1,$2)", [id, role]);
      await q("insert into user_roles(user_id,role_key) values($1,$2)", [id, role]);
    }
    const workshop = await one("select id from locations where kind='workshop'");
    const showroom = await one("select id from locations where kind='showroom'");
    const fabric = await one(
      "insert into fabrics(code,name,category) values('P6-F','Sale Fabric','Fabric') returning id",
    );
    const customer = await one(
      "insert into customers(name,phone,whatsapp_phone) values('Sale Customer','12345','54321') returning id",
    );
    await login(users.stock_entry);
    const batch = await one("insert into receiving_batches(code) values('P6-B') returning id");
    const stock = await one("select create_fabric_entry($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      fabric,
      batch,
      "[40000,60000]",
      50000,
    ]);
    await q("select complete_fabric_entry($1)", [stock]);
    await login(users.owner);
    const rows = await q(
      "select i.id,t.id thaan_id from inventory_items i join thaans t on t.id=i.thaan_id where t.fabric_stock_id=$1 order by i.id",
      [stock],
    );
    await q("select owner_set_fabric_sp($1,75000,$2)", [stock, "Initial SP"]);
    const cat = async () =>
      (await one("select direct_fabric_sale_catalog(null)")).find((s) => s.id === stock);
    const sp = (await cat()).sp_version_id;
    const barcode = (await cat()).barcode;
    const item = (row, qty, version = sp) => ({
      inventory_item_id: row.id,
      quantity: qty,
      sp_version_id: version,
    });
    const transfer = async (src, dst, lines) =>
      one("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
        randomUUID(),
        src,
        dst,
        JSON.stringify(lines),
        "Sale allocation",
      ]);
    await transfer(workshop, showroom, [
      { inventory_item_id: rows[0].id, quantity: 10000 },
      { inventory_item_id: rows[1].id, quantity: 20000 },
    ]);
    const balance = async (loc) =>
      Number(
        await one(
          "select coalesce(sum(quantity),0) from inventory_location_balances() where location_id=$1 and inventory_item_id=any($2::uuid[])",
          [loc, rows.map((r) => r.id)],
        ),
      );
    const saleArgs = (
      req,
      lines,
      src = showroom,
      cust = customer,
      paid = true,
      ref = "Test sale",
    ) => [req, src, JSON.stringify(lines), cust, paid, ref];
    const sql = "select complete_direct_fabric_sale($1,$2,$3::jsonb,$4,$5,$6)";
    const post = async (...args) => one(sql, saleArgs(...args));
    await login(users.counter);
    check(!JSON.stringify(await cat()).includes("cp_"), "Sale catalog has no CP");
    check(
      (await balance(workshop)) === 70000 && (await balance(showroom)) === 30000,
      "100m receipt: 70m Workshop, 30m Showroom",
    );
    const request = randomUUID(),
      lines = [item(rows[0], 4000)];
    const order = await post(request, lines);
    check(
      (await balance(workshop)) === 70000 && (await balance(showroom)) === 26000,
      "Sale deducts exactly 4m from Showroom",
    );
    check((await cat()).available_mm === 96000, "Global stock 96m after sale");
    check((await cat()).barcode === barcode, "Stable Fabric + Batch barcode");
    const history = async (id = order) => one("select direct_fabric_order_history($1,50)", [id]);
    const h = (await history())[0];
    check(
      h.final_customer_price_paise === 300000 && h.items[0].sp_paise_per_m === 75000,
      "SP-based amount and snapshot",
    );
    check(
      h.customer_snapshot.name === "Sale Customer" &&
        h.customer_snapshot.whatsapp_phone === "54321",
      "Customer snapshot",
    );
    check(
      h.items[0].movement_id &&
        h.source_name &&
        h.created_by === users.counter &&
        h.completed_at &&
        h.payment_confirmed_at,
      "Traceable order, user, location, payment and ledger",
    );
    check(!JSON.stringify(h).includes("cp_"), "Counter history has no CP keys");
    check(
      await one("select count(*)=0 from order_item_financials where order_item_id=$1", [
        h.items[0].id,
      ]),
      "Counter raw financial RLS hides snapshots",
    );
    await denied(
      "select owner_direct_fabric_order_costs($1)",
      [order],
      "Counter cannot call Owner costs",
    );
    await denied(
      "select inventory_balance($1,null)",
      [rows[0].id],
      "Counter cannot call private balance helper",
    );
    check((await post(request, lines)) === order, "Exact retry returns same order");
    await denied(sql, saleArgs(request, [item(rows[0], 4001)]), "Conflicting retry refused");
    const after = JSON.stringify(await history());
    for (const cuts of [
      [item(rows[0], 0)],
      [item(rows[0], -1)],
      [item(rows[0], 0.5)],
      [item(rows[0], 6001)],
      [item(rows[0], 1), item(rows[0], 1)],
      [{ ...item(rows[0], 1), sp_version_id: null }],
      [item({ id: randomUUID() }, 1)],
      [item(rows[0], 1), item(rows[1], 20001)],
    ]) {
      await denied(
        sql,
        saleArgs(randomUUID(), cuts),
        "Invalid / overdraw / duplicate / missing / late failure",
      );
      check(
        (await balance(showroom)) === 26000,
        "Rejected checkout atomic; no partial stock deduction",
      );
    }
    await denied(
      sql,
      saleArgs(randomUUID(), [item(rows[0], 1)], showroom, customer, false),
      "Payment required",
    );
    await denied(
      sql,
      saleArgs(randomUUID(), [item(rows[0], 1)], randomUUID()),
      "Existing source required",
    );
    await denied(
      sql,
      saleArgs(randomUUID(), [item(rows[0], 1)], showroom, randomUUID()),
      "Existing customer required",
    );
    check(after === JSON.stringify(await history()), "Rejected sales preserve completed history");
    for (const role of ["stock_entry", "tailor", "ecommerce_manager"]) {
      await login(users[role]);
      await denied(sql, saleArgs(randomUUID(), [item(rows[0], 1)]), role + " checkout denied");
      await denied("select direct_fabric_sale_catalog(null)", [], role + " sale catalog denied");
      await denied(
        "select direct_fabric_order_history(null,50)",
        [],
        role + " order history denied",
      );
      await denied(
        "select owner_direct_fabric_order_costs($1)",
        [order],
        role + " cost history denied",
      );
    }
    await login(users.owner);
    check(
      (await one("select owner_direct_fabric_order_costs($1)", [order]))[0].cp_paise_per_m ===
        50000,
      "Owner sees CP snapshot",
    );
    await q("select owner_set_fabric_sp($1,80000,$2)", [stock, "New SP"]);
    await q("select open_fabric_cp_correction($1,$2)", [stock, "New CP"]);
    await q("select domain_stock_entry_cp($1,$2)", [stock, 55000]);
    const newSp = (await cat()).sp_version_id;
    await login(users.counter);
    await denied(sql, saleArgs(randomUUID(), [item(rows[0], 1)]), "Stale quoted SP rejected");
    check(
      (await post(request, lines)) === order,
      "Committed retry remains valid after SP/CP revision",
    );
    const depletionReq = randomUUID(),
      depletionLines = [item(rows[0], 6000, newSp), item(rows[1], 20000, newSp)];
    const full = await post(depletionReq, depletionLines);
    check(
      (await balance(showroom)) === 0 && (await balance(workshop)) === 70000,
      "Multi-Than cut empties location only",
    );
    check(
      (await post(depletionReq, depletionLines)) === full,
      "Full-location retry succeeds without another deduction",
    );
    const global = await post(
      randomUUID(),
      [
        item(
          rows[0],
          Number(
            await one(
              "select quantity from inventory_location_balances() where inventory_item_id=$1 and location_id=$2",
              [rows[0].id, workshop],
            ),
          ),
          newSp,
        ),
      ],
      workshop,
      null,
    );
    check(global, "Walk-in Workshop sale allowed");
    check(
      await one("select status='depleted' from thaans where id=$1", [rows[0].thaan_id]),
      "Counter full global sale depletes internal Than",
    );
    const globalRow = (
      await q("select sale_request_id,sale_request_payload from orders where id=$1", [global])
    )[0];
    check(
      (await one(sql, [
        globalRow.sale_request_id,
        workshop,
        JSON.stringify(globalRow.sale_request_payload.items),
        null,
        true,
        "Test sale",
      ])) === global,
      "Exact retry works after global depletion and status change",
    );
    // Another complete receipt with no Owner SP must never sell at an invented price.
    await login(users.stock_entry);
    const unpricedBatch = await one(
      "insert into receiving_batches(code) values('P6-UNPRICED') returning id",
    );
    const unpriced = await one("select create_fabric_entry($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      fabric,
      unpricedBatch,
      "[1000]",
      100,
    ]);
    await q("select complete_fabric_entry($1)", [unpriced]);
    await login(users.counter);
    const unpricedCatalog = (await one("select direct_fabric_sale_catalog(null)")).find(
      (s) => s.id === unpriced,
    );
    const smallItem = { id: unpricedCatalog.cuts[0].inventory_item_id };
    await denied(
      sql,
      saleArgs(randomUUID(), [item(smallItem, 1, null)], workshop),
      "Missing Owner SP blocks sale",
    );
    await login(users.owner);
    await q("select owner_set_fabric_sp($1,500,$2)", [unpriced, "Rounding check"]);
    const smallSp = (await one("select direct_fabric_sale_catalog(null)")).find(
      (s) => s.id === unpriced,
    ).sp_version_id;
    const rounded = await post(randomUUID(), [item(smallItem, 1, smallSp)], workshop);
    check(
      (await history(rounded))[0].final_customer_price_paise === 1,
      "Database half-paise rounds up exactly as UI",
    );
    await q("select owner_set_fabric_sp($1,0,$2)", [unpriced, "Explicit zero SP"]);
    const zeroSp = (await one("select direct_fabric_sale_catalog(null)")).find(
      (s) => s.id === unpriced,
    ).sp_version_id;
    const zero = await post(randomUUID(), [item(smallItem, 1, zeroSp)], workshop);
    check(
      (await history(zero))[0].final_customer_price_paise === 0,
      "Explicit Owner zero SP preserved",
    );
    const floor = await one("select manage_showroom_location(null,'P6-FLOOR','Sale Floor',true)");
    const inactiveFloor = await one(
      "select manage_showroom_location(null,'P6-INACTIVE','Closed Floor',false)",
    );
    await transfer(workshop, floor, [{ inventory_item_id: rows[1].id, quantity: 1000 }]);
    await login(users.counter);
    await denied(
      sql,
      saleArgs(randomUUID(), [item(rows[1], 1, newSp)], inactiveFloor),
      "Inactive source denied",
    );
    const floorOrder = await post(randomUUID(), [item(rows[1], 500, newSp)], floor);
    check(
      (await history(floorOrder))[0].source_name === "Sale Floor",
      "Dynamic Showroom sublocation sale supported",
    );
    // Legacy fixture without invented CP: explicit Owner reconciliation only.
    await login(null);
    const legacyBatch = await one(
      "insert into receiving_batches(code,status) values('P6-LEGACY','committed') returning id",
    );
    const legacyBarcode = await one(
      "insert into barcodes(code,kind) values('P6-LEGACY-FAB','fabric') returning id",
    );
    const legacyStock = await one(
      "insert into fabric_stock(fabric_id,batch_id,barcode_id,entry_state) values($1,$2,$3,'legacy_pending') returning id",
      [fabric, legacyBatch, legacyBarcode],
    );
    const legacyThan = await one(
      "insert into thaans(barcode,fabric_id,batch_id,fabric_stock_id,original_mm,price_paise,status) values('P6-LEGACY-TH',$1,$2,$3,1000,500,'active') returning id",
      [fabric, legacyBatch, legacyStock],
    );
    await q("insert into stock_movements(thaan_id,kind,delta_mm) values($1,'INWARD',1000)", [
      legacyThan,
    ]);
    await login(users.owner);
    const legacyItem = await one("select reconcile_inventory_item('fabric',$1,$2::jsonb,$3)", [
      legacyThan,
      JSON.stringify([{ location_id: workshop, quantity: 1000 }]),
      "Verified legacy count",
    ]);
    await q("select owner_set_fabric_sp($1,500,$2)", [legacyStock, "Verified legacy SP"]);
    const legacySp = (await one("select direct_fabric_sale_catalog(null)")).find(
      (s) => s.id === legacyStock,
    ).sp_version_id;
    const legacyOrder = await post(randomUUID(), [item({ id: legacyItem }, 1, legacySp)], workshop);
    check(
      (await one("select owner_direct_fabric_order_costs($1)", [legacyOrder]))[0].cp_paise_per_m ===
        null,
      "Missing legacy CP remains explicitly unknown",
    );
    // Same-role users may read safe history but cannot claim another actor's retry.
    await login(null);
    const another = randomUUID();
    await q("insert into auth.users(id,email) values($1,'another@counter.test')", [another]);
    await q("insert into profiles(id,full_name) values($1,'Another Counter')", [another]);
    await q("insert into user_roles(user_id,role_key) values($1,'counter')", [another]);
    await login(another);
    await denied(sql, saleArgs(request, lines), "Different Counter cannot claim retry");
    await login(users.owner);
    check(
      (await one("select owner_direct_fabric_order_costs($1)", [order]))[0].cp_paise_per_m ===
        50000,
      "Historical CP immutable after revision",
    );
    check(
      (await history())[0].items[0].sp_paise_per_m === 75000,
      "Historical SP immutable after revision",
    );
    await denied(
      "update orders set reference=$1 where id=$2",
      ["Rewrite", order],
      "Authenticated raw order mutation denied",
    );
    await login(null);
    await denied(
      "update orders set reference=$1 where id=$2",
      ["Rewrite", order],
      "Completed header protected even from trusted direct update",
    );
    await denied(
      "update order_items set final_customer_price_paise=0 where id=$1",
      [h.items[0].id],
      "Completed line immutable",
    );
    await denied(
      "delete from order_item_financials where order_item_id=$1",
      [h.items[0].id],
      "Financial snapshot immutable",
    );
    await denied(
      "insert into inventory_movements(kind,fabric_stock_id,thaan_id,inventory_item_id,quantity,unit,source_location_id,order_item_id,reason,actor_id) values('SALE',$1,$2,$3,4000,'mm',$4,$5,'Duplicate',$6)",
      [stock, rows[0].thaan_id, rows[0].id, showroom, h.items[0].id, users.counter],
      "Duplicate sale movement refused",
    );
    check(
      await one(
        "select count(*)=0 from inventory_movements where fabric_stock_id=$1 and kind='WASTAGE'",
        [stock],
      ),
      "No automatic wastage",
    );
    check(
      await one("select count(*)=1 from erp_audit_records where entity_id=$1 and action=$2", [
        order,
        "complete_direct_fabric_sale",
      ]),
      "One audit record after retries",
    );
    await q("update profiles set active=false where id=$1", [users.counter]);
    await login(users.counter);
    await denied(
      sql,
      saleArgs(randomUUID(), [item(rows[1], 1, newSp)], workshop),
      "Inactive Counter checkout denied",
    );
    await denied("select direct_fabric_order_history(null,50)", [], "Inactive reader denied");
    await login(null);
    await db.exec("set role anon");
    await denied("select direct_fabric_sale_catalog(null)", [], "Anonymous execute revoked");
    await denied(
      sql,
      saleArgs(randomUUID(), [item(rows[1], 1, newSp)], workshop),
      "Anonymous checkout revoked",
    );
    console.log(directory + (demo ? " demo" : " clean") + ": Phase 6 sale acceptance passed");
  } finally {
    await db.close();
  }
}
console.log(`PASS: ${checks} Phase 6 sale / money / security checks`);
