/** Full disposable PostgreSQL replay and populated feature/security integration. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
let checks = 0;
const check = (value, label) => {
  assert(value, label);
  checks++;
};
for (const [directory, demo] of [
  ["supabase/migrations", true],
  ["drizzle/migrations", true],
  ["supabase/migrations", false],
]) {
  const db = new PGlite();
  const q = async (sql, args = []) => {
    try {
      return (await db.query(sql, args)).rows;
    } catch (error) {
      throw new Error(sql + ": " + error.message);
    }
  };
  const one = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const denied = async (sql, args = []) => {
    let failure = false;
    try {
      await q(sql, args);
    } catch {
      failure = true;
    }
    check(failure, "Denied: " + sql);
  };
  const login = async (id) => {
    await db.exec("reset role");
    await q("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
    if (id) await db.exec("set role authenticated");
  };
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`,
    );
    let oldTables, before;
    const snapshot = async () => {
      const result = {};
      for (const row of oldTables)
        result[row.name] = await q(
          `select to_jsonb(t) data from public."${row.name}" t order by to_jsonb(t)::text`,
        );
      return JSON.stringify(result);
    };
    for (const file of (await fs.readdir(directory))
      .filter((file) => file.endsWith(".sql") && !file.includes("_salesperson_tailoring_pricing") && !file.includes("_live_"))
      .sort()) {
      if (!demo && file.includes("demo_seed")) continue;
      if (file.includes("_stock_registration")) {
        oldTables = await q(
          "select tablename name from pg_tables where schemaname='public' order by tablename",
        );
        before = await snapshot();
      }
      await db.exec(await fs.readFile(resolve(directory, file), "utf8"));
    }

    const users = {};
    for (const role of [
      "owner",
      "stock_entry",
      "other_stock",
      "counter",
      "tailor",
      "ecommerce_manager",
    ]) {
      const id = (users[role] = randomUUID());
      await q("insert into auth.users values($1,$2)", [id, role + "@registration.test"]);
      await q("insert into profiles(id,full_name)values($1,$2)", [id, role]);
      await q("insert into user_roles(user_id,role_key)values($1,$2)", [
        id,
        role === "other_stock" ? "stock_entry" : role,
      ]);
    }

    const workshop = await one("select id from locations where kind='workshop'");
    await login(users.owner);
    const floors = [];
    for (let n = 1; n <= 3; n++)
      floors.push(
        await one("select manage_showroom_location(null,$1,$2,true)", [
          "REVISED-F" + n,
          "Revised Floor " + n,
        ]),
      );
    await login(users.stock_entry);
    const batch = await one("select register_delivery_batch($1,'Raymonds')", [randomUUID()]);
    await one("select register_fabric_type($1,$2,'Transfer cloth',$3::jsonb)", [
      randomUUID(),
      batch,
      JSON.stringify([{ length_mm: 50000, cp_paise_per_m: 12500 }]),
    ]);
    const registered = (await one("select stock_registration_catalog($1)", [batch]))[0]
      .fabric_types[0].variants[0];
    const barcode = registered.code;
    const inventory = (
      await q("select inventory_item_id from inventory_catalog() where item_id=$1", [
        registered.thaan_id,
      ])
    )[0].inventory_item_id;
    for (let n = 0; n < 3; n++) {
      const id = randomUUID();
      const items = JSON.stringify([{ inventory_item_id: inventory, quantity: 10000 }]);
      const args = [id, workshop, floors[n], items];
      const query = "select post_inventory_transfer($1,$2,$3,$4::jsonb,'floor transfer')";
      const result = await one(query, args);
      check(result === (await one(query, args)), "Exact transfer retry");
      check(
        (await one("select stock_transfer_history(null,50)")).some(
          (t) => t.id === result && t.status === "posted",
        ),
        "Immediately posted without receipt",
      );
      await login(users.other_stock);
      await denied(query, args);
      await login(users.stock_entry);
    }
    await login(users.owner);
    check(
      Number(
        await one(
          "select quantity from inventory_location_balances() where inventory_item_id=$1 and location_id=$2",
          [inventory, workshop],
        ),
      ) === 20000,
      "Workshop twenty metres",
    );
    for (const floor of floors)
      check(
        Number(
          await one(
            "select quantity from inventory_location_balances() where inventory_item_id=$1 and location_id=$2",
            [inventory, floor],
          ),
        ) === 10000,
        "Each floor ten metres",
      );
    check(
      Number(
        await one(
          "select sum(quantity) from inventory_location_balances() where inventory_item_id=$1",
          [inventory],
        ),
      ) === 50000,
      "Global fifty metres unchanged",
    );
    check(
      (await one("select count(*)::int from barcodes where code=$1", [barcode])) === 1,
      "Same single barcode",
    );
    await one("select owner_set_user_permission($1,'stock.transfer',false)", [users.stock_entry]);
    await login(users.stock_entry);
    const transferRows = JSON.stringify([{ inventory_item_id: inventory, quantity: 1000 }]);
    await denied("select post_inventory_transfer($1,$2,$3,$4::jsonb,'denied')", [
      randomUUID(),
      workshop,
      floors[0],
      transferRows,
    ]);
    await denied("select owner_set_user_permission($1,'stock.transfer',true)", [users.stock_entry]);
    await login(users.owner);
    await one("select owner_set_user_permission($1,'stock.transfer',null)", [users.stock_entry]);
    await login(users.other_stock);
    await denied("select post_inventory_transfer($1,$2,$3,$4::jsonb,'oversell')", [
      randomUUID(),
      workshop,
      floors[0],
      JSON.stringify([{ inventory_item_id: inventory, quantity: 20001 }]),
    ]);
    await denied("select post_inventory_transfer($1,$2,$3,$4::jsonb,'reverse')", [
      randomUUID(),
      floors[0],
      workshop,
      transferRows,
    ]);
    check(
      await one("select post_inventory_transfer($1,$2,$3,$4::jsonb,'other staff')", [
        randomUUID(),
        workshop,
        floors[0],
        transferRows,
      ]),
      "Authorized staff may transfer other's stock",
    );
    await login(users.counter);
    const saleRows = JSON.stringify([
      { inventory_item_id: inventory, quantity: 2500, sp_paise_per_m: 33333 },
    ]);
    const request = randomUUID();
    const saleQuery = "select complete_counter_fabric_sale($1,$2,$3::jsonb,null,true,null)";
    const sale = await one(saleQuery, [request, floors[0], saleRows]);
    check(sale === (await one(saleQuery, [request, floors[0], saleRows])), "Exact sale retry");
    const history = (await one("select direct_fabric_order_history($1)", [sale]))[0];
    check(history.final_customer_price_paise === 83333, "Exact rate times metres rounded to paise");
    check(
      history.items[0].sp_paise_per_m === 33333 && history.items[0].barcode === barcode,
      "Sale rate and barcode retained",
    );
    for (const bad of [null, -1, 1.1, "12500", 9007199254740992])
      await denied(saleQuery, [
        randomUUID(),
        floors[1],
        JSON.stringify([{ inventory_item_id: inventory, quantity: 1, sp_paise_per_m: bad }]),
      ]);
    await denied(saleQuery, [request, floors[1], saleRows]);
    await denied(saleQuery, [
      randomUUID(),
      floors[1],
      JSON.stringify([{ inventory_item_id: inventory, quantity: 10001, sp_paise_per_m: 1 }]),
    ]);
    for (const floor of floors.slice(1))
      check(
        await one(saleQuery, [
          randomUUID(),
          floor,
          JSON.stringify([{ inventory_item_id: inventory, quantity: 1000, sp_paise_per_m: 25000 }]),
        ]),
        "Counter uses any floor",
      );
    check(
      (await one("select direct_fabric_sale_catalog($1)", [barcode]))[0].cuts[0].locations.some(
        (l) => l.id === workshop && l.quantity_mm === 19000,
      ),
      "POS sees Workshop remainder",
    );
    await login(users.owner);
    check(
      (await one("select count(*)::int from fabric_stock_prices where fabric_stock_id=$1", [
        registered.stock_id,
      ])) === 0,
      "No saved Owner SP",
    );
    check(
      (await one("select owner_direct_fabric_order_costs($1)", [sale]))[0].cp_paise_per_m === 12500,
      "CP protected snapshot preserved",
    );
    await one("select owner_set_user_permission($1,'pos.enter_price',false)", [users.counter]);
    await login(users.counter);
    await denied(saleQuery, [randomUUID(), floors[0], saleRows]);
    await login(users.owner);
    await one("select owner_set_user_permission($1,'inventory.fill_missing_cp',false)", [
      users.stock_entry,
    ]);
    await login(users.stock_entry);
    await denied("select fill_registered_thaan_cp($1,$2,1)", [randomUUID(), barcode]);
    await denied("select registration_fill_cp_internal($1,$2,1)", [randomUUID(), barcode]);
    for (const role of ["tailor", "ecommerce_manager"]) {
      await login(users[role]);
      await denied("select post_inventory_transfer($1,$2,$3,$4::jsonb,'not staff')", [
        randomUUID(),
        workshop,
        floors[0],
        transferRows,
      ]);
      await denied(saleQuery, [randomUUID(), floors[0], saleRows]);
    }
    await login(users.owner);
    check(
      Number(
        await one(
          "select sum(quantity) from inventory_location_balances() where inventory_item_id=$1",
          [inventory],
        ),
      ) === 45500,
      "Only sales reduce global stock",
    );
    check(
      (await one("select count(*)::int from orders where sale_request_id=$1", [request])) === 1,
      "Sale posts once",
    );
    console.log(directory + (demo ? " demo" : " clean") + ": transfer/pricing verified");
  } finally {
    await db.close();
  }
}
console.log(`PASS: ${checks} revised transfer/pricing/security assertions`);
await fs.writeFile(
  "docs/STOCK_TRANSFER_PRICING_DATABASE_VERIFICATION.json",
  JSON.stringify(
    {
      verified_at: new Date().toISOString(),
      checks,
      chains: ["supabase demo", "drizzle demo", "supabase clean"],
      mode: "disposable local databases only",
    },
    null,
    2,
  ),
);
