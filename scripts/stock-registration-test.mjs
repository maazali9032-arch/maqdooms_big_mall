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
      .filter((file) => file.endsWith(".sql") && !file.includes("_live_"))
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
    check(before === (await snapshot()), "Every pre-existing business row preserved");
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
    check(
      (await one("select registration_provider_prefix('Raymonds Textiles')")) === "RDS",
      "Provider uses only first word",
    );
    check(
      (await one("select registration_provider_prefix('Arvind')")) === "AND",
      "First + last two letters",
    );
    for (const [ordinal, suffix] of [
      [1, "a"],
      [26, "z"],
      [27, "aa"],
      [28, "ab"],
      [52, "az"],
      [53, "ba"],
      [702, "zz"],
      [703, "aaa"],
    ])
      check(
        (await one("select registration_variant_suffix($1)", [ordinal])) === suffix,
        "Suffix " + ordinal,
      );
    await login(users.stock_entry);
    const batchRequest = randomUUID();
    const batch = await one("select register_delivery_batch($1,'Raymonds Textiles')", [
      batchRequest,
    ]);
    check(
      (await one("select register_delivery_batch($1,'Raymonds Textiles')", [batchRequest])) ===
        batch,
      "Batch retry idempotent",
    );
    await denied("select register_delivery_batch($1,'Arvind')", [batchRequest]);
    const secondBatch = await one("select register_delivery_batch($1,'Raymonds Textiles')", [
      randomUUID(),
    ]);
    check(secondBatch !== batch, "Same provider, separate delivery IDs");
    check(
      (await one("select stock_registration_catalog()")).length === 2,
      "Provider history retained",
    );
    const rows = [
      { length_mm: 10000, cp_paise_per_m: 45000 },
      { length_mm: 5000, cp_paise_per_m: null },
      { length_mm: 10000, cp_paise_per_m: 0 },
    ];
    const request = randomUUID();
    const group = await one("select register_fabric_type($1,$2,'Cotton',$3::jsonb)", [
      request,
      batch,
      JSON.stringify(rows),
    ]);
    check(
      (await one("select register_fabric_type($1,$2,'Cotton',$3::jsonb)", [
        request,
        batch,
        JSON.stringify(rows),
      ])) === group,
      "Fabric retry does not duplicate receipt",
    );
    let data = await one("select stock_registration_catalog($1)", [batch]);
    let fabric = data[0].fabric_types[0];
    check(/^RDS-\d+$/.test(fabric.code), "Generated provider/numeric type code");
    check(
      fabric.variants.map((v) => v.code).join(",") ===
        [fabric.code + "a", fabric.code + "b", fabric.code + "c"].join(","),
      "Each physical Than sequential barcode",
    );
    check(
      fabric.variants.map((v) => Number(v.available_mm)).join(",") === "10000,5000,10000",
      "Lengths received exactly once",
    );
    check(
      fabric.variants.every((v) => v.cp_paise_per_m === null),
      "Stock Entry cannot retrieve recorded CP",
    );
    check(
      fabric.variants.map((v) => v.cp_missing).join(",") === "false,true,false",
      "Unknown CP distinct from zero",
    );
    const [first, missing, zero] = fabric.variants;
    const fillRequest = randomUUID();
    check(
      (await one("select fill_registered_thaan_cp($1,$2,48000)", [fillRequest, missing.code])) ===
        missing.stock_id,
      "Scan-specific delayed CP allowed after receipt",
    );
    check(
      (await one("select fill_registered_thaan_cp($1,$2,48000)", [fillRequest, missing.code])) ===
        missing.stock_id,
      "CP retry no revision duplicate",
    );
    await denied("select fill_registered_thaan_cp($1,$2,49000)", [randomUUID(), missing.code]);
    await denied("select domain_stock_entry_cp($1)", [first.stock_id]);
    check(
      (await one("select count(*) from fabric_stock_costs")) === 0,
      "Raw CP remains inaccessible",
    );
    const extra = Array.from({ length: 25 }, () => ({ length_mm: 1000, cp_paise_per_m: null }));
    const appendRequest = randomUUID();
    await one("select append_registered_thans($1,$2,$3::jsonb)", [
      appendRequest,
      group,
      JSON.stringify(extra),
    ]);
    await one("select append_registered_thans($1,$2,$3::jsonb)", [
      appendRequest,
      group,
      JSON.stringify(extra),
    ]);
    data = await one("select stock_registration_catalog($1)", [batch]);
    fabric = data[0].fabric_types[0];
    check(fabric.variants.length === 28, "Append retry retains exact count");
    check(
      fabric.variants[25].code === fabric.code + "z" &&
        fabric.variants[26].code === fabric.code + "aa" &&
        fabric.variants[27].code === fabric.code + "ab",
      "Real appended sequence beyond z",
    );
    const secondType = await one("select register_fabric_type($1,$2,'Cotton',$3::jsonb)", [
      randomUUID(),
      batch,
      JSON.stringify([{ length_mm: 7000 }]),
    ]);
    const thirdType = await one("select register_fabric_type($1,$2,'Cotton',$3::jsonb)", [
      randomUUID(),
      secondBatch,
      JSON.stringify([{ length_mm: 15000 }]),
    ]);
    check(secondType !== group && thirdType !== group, "New type/batch never merges by name");
    await denied("select fill_registered_thaan_cp($1,$2,-1)", [
      randomUUID(),
      fabric.variants[3].code,
    ]);
    const stateBefore = JSON.stringify(await one("select stock_registration_catalog()"));
    await denied("select append_registered_thans($1,$2,$3::jsonb)", [
      randomUUID(),
      group,
      JSON.stringify([{ length_mm: 1000 }, { length_mm: -1 }]),
    ]);
    check(
      stateBefore === JSON.stringify(await one("select stock_registration_catalog()")),
      "Invalid later row rolls back complete receipt/codes/ordinal",
    );
    await denied("select append_registered_thans($1,$2,$3::jsonb)", [
      randomUUID(),
      group,
      JSON.stringify([{ length_mm: 0 }]),
    ]);
    await denied("select append_registered_thans($1,$2,$3::jsonb)", [
      randomUUID(),
      group,
      JSON.stringify([{ length_mm: 1000, sp: 99 }]),
    ]);
    await denied("select register_delivery_batch($1,'AB')", [randomUUID()]);
    await denied(
      "insert into stock_registration_variants(fabric_type_id,ordinal,code,fabric_stock_id,thaan_id,created_by)values($1,99,$2,$3,$4,$5)",
      [group, fabric.code + "zz", first.stock_id, first.thaan_id, users.stock_entry],
    );
    await login(users.other_stock);
    check(
      (await one("select stock_registration_catalog()")).length === 0,
      "Other staff cannot inspect private entry workflows",
    );
    await denied("select fill_registered_thaan_cp($1,$2,100)", [
      randomUUID(),
      fabric.variants[3].code,
    ]);
    await denied("select append_registered_thans($1,$2,$3::jsonb)", [
      randomUUID(),
      group,
      JSON.stringify([{ length_mm: 1000 }]),
    ]);
    await denied("select append_registered_thans($1,$2,$3::jsonb)", [
      appendRequest,
      group,
      JSON.stringify(extra),
    ]);
    await login(users.owner);
    const cpData = (
      await one("select stock_registration_catalog($1)", [batch])
    )[0].fabric_types.find((v) => v.id === group);
    check(
      cpData.variants[0].cp_paise_per_m === "45000" &&
        cpData.variants[1].cp_paise_per_m === "48000" &&
        cpData.variants[2].cp_paise_per_m === "0",
      "Owner sees exact independent CP",
    );
    const scan = (await one("select fabric_stock_catalog($1)", [first.code]))[0];
    check(
      scan.id === first.stock_id && scan.thans.length === 1,
      "Existing scan identifies exact physical Than",
    );
    const workshop = await one("select id from locations where kind='workshop'");
    const showroom = await one("select id from locations where kind='showroom'");
    const item = await one("select id from inventory_items where thaan_id=$1", [first.thaan_id]);
    await one("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      workshop,
      showroom,
      JSON.stringify([{ inventory_item_id: item, quantity: 4000 }]),
      "New physical barcode transfer",
    ]);
    check(
      Number(
        await one(
          "select quantity from inventory_location_balances() where inventory_item_id=$1 and location_id=$2",
          [item, workshop],
        ),
      ) === 6000,
      "Existing transfer exact source balance",
    );
    await one("select owner_set_fabric_sp($1,85000,$2)", [first.stock_id, "Set SP on new barcode"]);
    check(
      (await one("select direct_fabric_sale_catalog()")).some((v) => v.id === first.stock_id),
      "Existing direct sale catalogue interoperates",
    );
    const sp = (await one("select direct_fabric_sale_catalog($1)", [first.code]))[0];
    await login(users.counter);
    const saleRequest = randomUUID();
    const saleItems = JSON.stringify([
      { inventory_item_id: item, quantity: 2000, sp_version_id: sp.sp_version_id },
    ]);
    const order = await one(
      "select complete_direct_fabric_sale($1,$2,$3::jsonb,null,true,'Registered Than sale')",
      [saleRequest, showroom, saleItems],
    );
    check(
      (await one(
        "select complete_direct_fabric_sale($1,$2,$3::jsonb,null,true,'Registered Than sale')",
        [saleRequest, showroom, saleItems],
      )) === order,
      "New barcode sale retries exactly once",
    );
    check(
      Number(
        await one(
          "select quantity from inventory_location_balances() where inventory_item_id=$1 and location_id=$2",
          [item, showroom],
        ),
      ) === 2000,
      "New barcode sale deducts physical length",
    );
    check(
      !JSON.stringify(await one("select direct_fabric_sale_catalog($1)", [first.code])).includes(
        "cp_",
      ),
      "Counter scan exposes no CP keys",
    );
    await login(users.owner);
    const charge = await one(
      "select set_customer_tailoring_charge('SR-CH','Registration charge',80000)",
    );
    const chargeVersion = charge;
    const quoted = await one("select quote_customer_tailoring($1,$2::jsonb,$3)", [
      workshop,
      JSON.stringify([{ inventory_item_id: item, quantity: 1000 }]),
      chargeVersion,
    ]);
    check(
      quoted.final_customer_price_paise === 125000,
      "New barcode tailoring uses 45000 CP + 80000 charge, not SP",
    );
    const unknownVariant = fabric.variants[3];
    const unknownItem = await one("select id from inventory_items where thaan_id=$1", [
      unknownVariant.thaan_id,
    ]);
    await denied("select quote_customer_tailoring($1,$2::jsonb,$3)", [
      workshop,
      JSON.stringify([{ inventory_item_id: unknownItem, quantity: 500 }]),
      chargeVersion,
    ]);
    await one("select owner_set_fabric_sp($1,85000,'Price before missing CP')", [
      unknownVariant.stock_id,
    ]);
    const unknownSp = (
      await one("select direct_fabric_sale_catalog($1)", [unknownVariant.code])
    )[0];
    await login(users.counter);
    const unknownOrder = await one(
      "select complete_direct_fabric_sale($1,$2,$3::jsonb,null,true,'Unknown CP remains unknown')",
      [
        randomUUID(),
        workshop,
        JSON.stringify([
          { inventory_item_id: unknownItem, quantity: 500, sp_version_id: unknownSp.sp_version_id },
        ]),
      ],
    );
    await login(users.owner);
    check(
      await one(
        "select cp_snapshot_paise is null from order_item_financials f join order_items i on i.id=f.order_item_id where i.order_id=$1",
        [unknownOrder],
      ),
      "Direct SP sale retains NULL cost snapshot when CP omitted",
    );
    await one("select fill_registered_thaan_cp($1,$2,50000)", [randomUUID(), unknownVariant.code]);
    check(
      await one(
        "select cp_snapshot_paise is null from order_item_financials f join order_items i on i.id=f.order_item_id where i.order_id=$1",
        [unknownOrder],
      ),
      "Delayed CP does not rewrite original unknown sale cost",
    );
    check(
      (
        await one("select owner_erp_report('fabric_stock',null,null,null,200,$1)", [first.code])
      ).rows.find((row) => row.data.barcode === first.code).data.cp_paise_per_m === "45000",
      "Owner reporting reused with exact CP",
    );
    check(
      (await one("select count(*) from erp_audit_records where entity_table=$1", [
        "stock_registration_variants",
      ])) >= 30,
      "New code/receipt metadata audited",
    );
    await denied("delete from stock_registration_variants where id=$1", [first.id]);
    await denied("update fabric_stock set created_by=$1 where id=$2", [
      users.other_stock,
      first.stock_id,
    ]);
    await denied("update thaans set original_mm=9999 where id=$1", [first.thaan_id]);
    await denied(
      "insert into thaans(fabric_id,batch_id,fabric_stock_id,original_mm,status,created_by)select fabric_id,batch_id,id,1000,'draft',$1 from fabric_stock where id=$2",
      [users.owner, first.stock_id],
    );
    await denied(
      "update fabrics set code='REWRITTEN' where id=(select fabric_id from fabric_stock where id=$1)",
      [first.stock_id],
    );
    const providerBefore = await one(
      "select provider_name from stock_registration_batches where batch_id=$1",
      [batch],
    );
    await denied(
      "update stock_registration_batches set provider_name='Changed' where batch_id=$1",
      [batch],
    );
    check(
      (await one("select provider_name from stock_registration_batches where batch_id=$1", [
        batch,
      ])) === providerBefore,
      "Original provider snapshot preserved",
    );
    const rowsBeforeFailure = JSON.stringify(await one("select stock_registration_catalog()"));
    await login(null);
    await db.exec(
      "create function public.registration_test_abort() returns trigger language plpgsql as $$begin raise exception 'Final audit fixture failure';end;$$;create trigger registration_test_abort before insert on erp_audit_records for each row execute function registration_test_abort();",
    );
    await login(users.owner);
    await denied("select append_registered_thans($1,$2,$3::jsonb)", [
      randomUUID(),
      group,
      JSON.stringify([{ length_mm: 1000 }]),
    ]);
    check(
      JSON.stringify(await one("select stock_registration_catalog()")) === rowsBeforeFailure,
      "Audit failure rolls back complete operation",
    );
    await login(null);
    await db.exec(
      "drop trigger registration_test_abort on erp_audit_records;drop function registration_test_abort();",
    );
    for (const role of ["counter", "tailor", "ecommerce_manager"]) {
      await login(users[role]);
      await denied("select stock_registration_catalog()");
      await denied("select register_delivery_batch($1,'Arvind')", [randomUUID()]);
      await denied("select fill_registered_thaan_cp($1,$2,1)", [
        randomUUID(),
        fabric.variants[3].code,
      ]);
      check((await one("select count(*) from fabric_stock_costs")) === 0, "No CP access " + role);
    }
    await login(users.stock_entry);
    await login(null);
    await q("update profiles set active=false where id=$1", [users.stock_entry]);
    await login(users.stock_entry);
    await denied("select stock_registration_catalog()");
    await login(null);
    await db.exec("set role anon");
    await denied("select stock_registration_catalog()");
    await denied("select register_delivery_batch($1,'Arvind')", [randomUUID()]);
    await db.exec("reset role");
    console.log(directory + (demo ? " demo" : " clean") + ": stock registration passed");
  } finally {
    await db.close();
  }
}
console.log("PASS: " + checks + " stock registration checks");
