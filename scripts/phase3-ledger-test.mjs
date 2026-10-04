/** PostgreSQL replay with real RLS roles. Disposable DB only, no .env/live server. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
let passed = 0;
const { quantityInput, quantityText } =
  await import("../src/features/inventory/ledger-quantity.ts");
for (const [input, unit, expected] of [
  ["1.001", "mm", 1001],
  ["0.001", "mm", 1],
  ["30", "mm", 30000],
  ["10", "pc", 10],
  ["2.125", "m", 2.125],
]) {
  assert.equal(quantityInput(input, unit), expected);
  passed++;
}
assert.equal(quantityText(30000, "mm"), "30 m");
passed++;
assert.equal(quantityInput("0.125", "mm", false), 0.125);
passed++;
assert.equal(quantityText(0.125, "mm", false), "0.125 mm");
passed++;
for (const invalid of ["0", "-1", "1.0001", "1e3", "Infinity", "9007199254740993"]) {
  assert.throws(() => quantityInput(invalid, "mm"));
  passed++;
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
      throw new Error(`${sql}: ${e.message}`);
    }
  };
  const scalar = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const check = (v, label) => {
    assert.ok(v, label);
    passed++;
  };
  const rejects = async (sql, args = [], label = sql) => {
    let e;
    try {
      await q(sql, args);
    } catch (error) {
      e = error;
    }
    check(e, `${label}: expected rejection`);
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
    const includePhase7 =
      process.argv.includes("--include-phase9") ||
      process.argv.includes("--include-phase8") ||
      process.argv.includes("--include-phase7");
    const includePhase6 = includePhase7 || process.argv.includes("--include-phase6");
    const includePhase5 = includePhase6 || process.argv.includes("--include-phase5");
    const includePhase4 = includePhase5 || process.argv.includes("--include-phase4");
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
          (includePhase4 || !f.includes("phase4_")) &&
          (includePhase5 || !f.includes("phase5_")) &&
          (includePhase6 || !f.includes("phase6_")) &&
          (includePhase7 || !f.includes("phase7_")),
      )
      .sort();
    assert.equal(
      files.length,
      includePhase7
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
        : includePhase6
          ? 16
          : includePhase5
            ? 15
            : includePhase4
              ? 14
              : 13,
    );
    let before;
    const snapshot = async () =>
      JSON.stringify(
        await q(
          "select * from (select 'thaans' t,to_jsonb(x) row from thaans x union all select 'materials',to_jsonb(x)-'category' from materials x union all select 'stock_movements',to_jsonb(x) from stock_movements x) s order by t,row::text",
        ),
      );
    for (const file of files) {
      if (!demo && file.includes("demo_seed")) continue;
      if (file.includes("phase3_")) before = await snapshot();
      try {
        await db.exec(await readFile(resolve(directory, file), "utf8"));
      } catch (e) {
        throw new Error(`${file}: ${e.message}`);
      }
    }
    check(before === (await snapshot()), "Migration leaves legacy values/history unchanged");
    check(await scalar("select count(*)=0 from inventory_items"), "No invented cutover");
    check(await scalar("select count(*)=0 from inventory_movements"), "No invented opening stock");
    const users = {};
    for (const role of ["owner", "counter", "stock_entry", "tailor"]) {
      const id = (users[role] = randomUUID());
      await q("insert into auth.users(id,email) values($1,$2)", [id, role + "@test.invalid"]);
      await q("insert into profiles(id,full_name) values($1,$2)", [id, role]);
      await q("insert into user_roles(user_id,role_key) values($1,$2)", [id, role]);
    }
    const workshop = await scalar("select id from locations where kind='workshop'");
    const showroom = await scalar("select id from locations where kind='showroom'");
    const fabric = await scalar(
      "insert into fabrics(code,name,category) values('P3-F','Phase 3 Fabric','Fabric') returning id",
    );
    const batch = await scalar(
      "insert into receiving_batches(code,status) values('P3-B','committed') returning id",
    );
    const barcode = await scalar(
      "insert into barcodes(code,kind) values('P3-BAR','fabric') returning id",
    );
    const stock = await scalar(
      "insert into fabric_stock(fabric_id,batch_id,barcode_id,entry_state) values($1,$2,$3,'complete') returning id",
      [fabric, batch, barcode],
    );
    const thaans = [];
    for (let n = 0; n < 10; n++) {
      const t = await scalar(
        "insert into thaans(barcode,fabric_id,batch_id,fabric_stock_id,original_mm,price_paise,status) values($1,$2,$3,$4,10000,85000,'active') returning id",
        ["P3-" + n, fabric, batch, stock],
      );
      thaans.push(t);
      await q("insert into stock_movements(thaan_id,kind,delta_mm) values($1,'INWARD',10000)", [t]);
      await q("insert into thaan_costs(thaan_id,cost_paise) values($1,50000)", [t]);
    }
    const material = await scalar(
      "insert into materials(name,unit,qty_on_hand,cost_paise) values('Test thread','m',10.125,500) returning id",
    );
    await login(users.owner);
    const floor = await scalar("select manage_showroom_location(null,'P3-FLOOR','Floor A',true)");
    check(
      (await scalar("select count(*) from inventory_locations()")) == 3,
      "Dynamic sublocation created",
    );
    await rejects(
      "select manage_showroom_location($1,$2,$3,true)",
      [floor, "RENAMED", "Floor B"],
      "Location code immutable",
    );
    const allocation = (location, quantity) =>
      JSON.stringify([{ location_id: location, quantity }]);
    await rejects(
      "select reconcile_inventory_item($1,$2,$3::jsonb,$4)",
      ["fabric", thaans[0], allocation(workshop, 9999), "Counted stock"],
      "Opening must match legacy total",
    );
    const ids = [];
    for (const t of thaans)
      ids.push(
        await scalar("select reconcile_inventory_item($1,$2,$3::jsonb,$4)", [
          "fabric",
          t,
          allocation(workshop, 10000),
          "Verified physical count at Workshop",
        ]),
      );
    await rejects(
      "select reconcile_inventory_item($1,$2,$3::jsonb,$4)",
      ["fabric", thaans[0], allocation(workshop, 10000), "Retry"],
      "Duplicate reconciliation blocked",
    );
    const balance = async (location) =>
      Number(
        await scalar(
          "select coalesce(sum(quantity),0) from inventory_location_balances() where location_id=$1 and inventory_item_id=any($2::uuid[])",
          [location, ids],
        ),
      );
    check((await balance(workshop)) === 100000, "Ten 10m Thans = 100m Workshop");
    const request = randomUUID();
    const items = JSON.stringify(
      ids.slice(0, 3).map((id) => ({ inventory_item_id: id, quantity: 10000 })),
    );
    const transfer = await scalar("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
      request,
      workshop,
      showroom,
      items,
      "Restock Showroom",
    ]);
    check((await balance(workshop)) === 70000, "100m minus 30m = 70m Workshop");
    check((await balance(showroom)) === 30000, "30m Showroom");
    check(
      (await scalar("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
        request,
        workshop,
        showroom,
        items,
        "Restock Showroom",
      ])) === transfer,
      "Transfer retry idempotent",
    );
    await rejects(
      "select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)",
      [request, workshop, showroom, items, "Changed reason"],
      "Idempotency conflict",
    );
    await rejects(
      "select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)",
      [
        randomUUID(),
        showroom,
        workshop,
        JSON.stringify([{ inventory_item_id: ids[0], quantity: 10001 }]),
        "Overdraw",
      ],
      "Overtransfer denied",
    );
    const beforeRollback = await scalar("select count(*) from inventory_movement_history(500)");
    const orderedAvailable = ids.slice(3).sort();
    await rejects(
      "select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)",
      [
        randomUUID(),
        workshop,
        showroom,
        JSON.stringify([
          { inventory_item_id: orderedAvailable[0], quantity: 1000 },
          { inventory_item_id: orderedAvailable[1], quantity: 10001 },
        ]),
        "Atomic failure",
      ],
      "Multi-item atomic rollback",
    );
    check(
      (await scalar("select count(*) from inventory_movement_history(500)")) === beforeRollback,
      "Failed batch posts no partial movements",
    );
    check(
      Number(
        await scalar(
          "select quantity from inventory_location_balances() where inventory_item_id=$1 and location_id=$2",
          [orderedAvailable[0], workshop],
        ),
      ) === 10000,
      "First posted line rolled back after second-line failure",
    );
    // Simulate the future Order-linked sale producer: no sale RPC is implemented here.
    await login(null);
    const order = await scalar(
      "insert into orders(code,kind,source_location_id) values('P3-SALE','direct_fabric_sale',$1) returning id",
      [showroom],
    );
    const line = await scalar(
      "insert into order_items(order_id,thaan_id,fabric_stock_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) values($1,$2,$3,4000,'mm',85000,340000) returning id",
      [order, thaans[0], stock],
    );
    await q(
      "insert into inventory_movements(inventory_item_id,kind,thaan_id,fabric_stock_id,quantity,unit,source_location_id,order_item_id,reason,actor_id) values($1,'SALE',$2,$3,4000,'mm',$4,$5,'Downstream sale fixture',$6)",
      [ids[0], thaans[0], stock, showroom, line, users.owner],
    );
    await login(users.owner);
    check((await balance(showroom)) === 26000, "Order-linked 4m deduction leaves 26m Showroom");
    check(
      Number(
        await scalar(
          "select sum(quantity) from inventory_catalog() where item_id=any($1::uuid[])",
          [thaans],
        ),
      ) === 96000,
      "Single authority total is 96m, not legacy plus opening ledger",
    );
    check(
      await scalar("select count(*)=0 from inventory_movement_history(500) where kind='WASTAGE'"),
      "Transfers and sales never automatically create wastage",
    );
    check((await balance(workshop)) === 70000, "Sale leaves Workshop unchanged");
    check(
      Number(await scalar("select thaan_available_mm($1)", [thaans[0]])) === 6000,
      "Canonical helper uses new ledger",
    );
    check(
      Number(
        await scalar("select available_mm from v_thaan_stock where thaan_id=$1", [thaans[0]]),
      ) === 6000,
      "Legacy overview follows canonical ledger",
    );
    await rejects(
      "select adjust_thaan($1,1000,'ADJUSTMENT','Old writer')",
      [thaans[0]],
      "Legacy write frozen after cutover",
    );
    const oldSales = await scalar("select count(*) from sales");
    await rejects(
      "select complete_fabric_sale($1::jsonb,null,null)",
      [JSON.stringify([{ barcode: "P3-0", length_mm: 1000 }])],
      "Legacy Counter sale blocked for reconciled stock",
    );
    check(
      (await scalar("select count(*) from sales")) === oldSales,
      "Blocked old sale rolls back its bill",
    );
    await rejects(
      "select record_inventory_correction($1,$2,$3,$4,$5,$6)",
      [ids[0], showroom, "SALE", 1, false, "Not Phase 5"],
      "No generic sale endpoint",
    );
    const mid = await scalar("select reconcile_inventory_item($1,$2,$3::jsonb,$4)", [
      "consumable",
      material,
      allocation(workshop, 10.125),
      "Verified thread",
    ]);
    await scalar("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      workshop,
      floor,
      JSON.stringify([{ inventory_item_id: mid, quantity: 2.125 }]),
      "Thread transfer",
    ]);
    check(
      Number(await scalar("select material_available_qty($1)", [material])) === 10.125,
      "Consumable transfer preserves total",
    );
    await scalar("select record_inventory_correction($1,$2,$3,$4,$5,$6)", [
      mid,
      floor,
      "WASTAGE",
      0.125,
      false,
      "Explicit damaged thread",
    ]);
    check(
      Number(await scalar("select material_available_qty($1)", [material])) === 10,
      "Explicit wastage only",
    );
    await rejects(
      "select manage_showroom_location($1,$2,$3,false)",
      [floor, "P3-FLOOR", "Floor A"],
      "Occupied location cannot deactivate",
    );
    await rejects(
      "select record_inventory_correction($1,$2,$3,$4,$5,$6)",
      [mid, floor, "WASTAGE", 3, false, "Too much"],
      "No negative consumable balance",
    );
    await login(null);
    const zeroMaterial = await scalar(
      "insert into materials(name,unit,qty_on_hand) values('Zero buttons','pc',0) returning id",
    );
    const heldThan = await scalar(
      "insert into thaans(barcode,fabric_id,batch_id,fabric_stock_id,original_mm,price_paise,status) values('P3-HELD',$1,$2,$3,1000,85000,'active') returning id",
      [fabric, batch, stock],
    );
    await q("insert into stock_movements(thaan_id,kind,delta_mm) values($1,'INWARD',1000)", [
      heldThan,
    ]);
    await q(
      "insert into holds(thaan_id,length_mm,expires_at) values($1,100,now()+interval '1 hour')",
      [heldThan],
    );
    const factory = await scalar(
      "insert into tailoring_factories(code,name) values('P3-FACTORY','Factory') returning id",
    );
    const section = await scalar(
      "insert into tailoring_sections(factory_id,code,name) values($1,'P3-SECTION','Section') returning id",
      [factory],
    );
    const tailor = await scalar(
      "insert into tailors(code,real_name,profile_id) values('P3-TAILOR','Tailor',$1) returning id",
      [users.tailor],
    );
    const assignment = await scalar(
      "insert into tailor_assignments(tailor_id,factory_id,section_id) values($1,$2,$3) returning id",
      [tailor, factory, section],
    );
    const product = await scalar(
      "insert into products(code,name) values('P3-PRODUCT','Product') returning id",
    );
    const design = await scalar(
      "insert into designs(code,name) values('P3-DESIGN','Design') returning id",
    );
    const job = await scalar(
      "insert into production_jobs(code,product_id,design_id,quantity,tailor_assignment_id) values('P3-JOB',$1,$2,1,$3) returning id",
      [product, design, assignment],
    );
    const productBarcode = await scalar(
      "insert into barcodes(code,kind) values('P3-PIECE','product') returning id",
    );
    const piece = await scalar(
      "insert into finished_products(production_job_id,product_id,design_id,piece_number,barcode_id,current_location_id) values($1,$2,$3,1,$4,$5) returning id",
      [job, product, design, productBarcode, workshop],
    );
    await login(users.owner);
    await rejects(
      "select reconcile_inventory_item($1,$2,$3::jsonb,$4)",
      ["fabric", heldThan, allocation(workshop, 1000), "Held opening"],
      "Unlocated holds block cutover",
    );
    const zid = await scalar("select reconcile_inventory_item($1,$2,$3::jsonb,$4)", [
      "consumable",
      zeroMaterial,
      "[]",
      "Verified no stock",
    ]);
    check(
      Number(await scalar("select material_available_qty($1)", [zeroMaterial])) === 0,
      "Zero opening invents no quantity",
    );
    await scalar("select record_inventory_correction($1,$2,$3,$4,$5,$6)", [
      zid,
      workshop,
      "ADJUSTMENT",
      20,
      true,
      "Verified buttons restock correction",
    ]);
    await scalar("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      workshop,
      showroom,
      JSON.stringify([{ inventory_item_id: zid, quantity: 10 }]),
      "Ten buttons transfer",
    ]);
    check(
      Number(await scalar("select material_available_qty($1)", [zeroMaterial])) === 20,
      "Consumable pc transfers permit multiple units",
    );
    const pid = await scalar("select reconcile_inventory_item($1,$2,$3::jsonb,$4)", [
      "finished_product",
      piece,
      allocation(workshop, 1),
      "Verified linked piece",
    ]);
    await rejects(
      "select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)",
      [
        randomUUID(),
        workshop,
        showroom,
        JSON.stringify([{ inventory_item_id: pid, quantity: 0.5 }]),
        "Half piece",
      ],
      "No fractional Finished Product",
    );
    await scalar("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      workshop,
      showroom,
      JSON.stringify([{ inventory_item_id: pid, quantity: 1 }]),
      "Display piece",
    ]);
    check(
      (await scalar("select current_location_id from finished_products where id=$1", [piece])) ===
        showroom,
      "Piece current location follows ledger transfer",
    );
    await rejects(
      "select record_inventory_correction($1,$2,$3,$4,$5,$6)",
      [pid, showroom, "RETURN", 1, true, "Duplicate piece"],
      "No duplicated physical piece",
    );
    await scalar("select record_inventory_correction($1,$2,$3,$4,$5,$6)", [
      pid,
      showroom,
      "WASTAGE",
      1,
      false,
      "Explicit damaged piece",
    ]);
    check(
      (await scalar("select status from finished_products where id=$1", [piece])) === "archived",
      "Removed piece status follows zero count",
    );
    await rejects(
      "select record_inventory_correction($1,$2,$3,$4,$5,$6)",
      [pid, showroom, "RETURN", 1, true, "Wrong return location"],
      "Piece returns through Workshop",
    );
    await scalar("select record_inventory_correction($1,$2,$3,$4,$5,$6)", [
      pid,
      workshop,
      "RETURN",
      1,
      true,
      "Recovered piece returned to Workshop",
    ]);
    check(
      (await scalar("select current_location_id from finished_products where id=$1", [piece])) ===
        workshop,
      "Returned piece in Workshop",
    );
    const emptyLocation = await scalar(
      "select manage_showroom_location(null,'P3-EMPTY','Empty floor',true)",
    );
    await scalar("select manage_showroom_location($1,$2,$3,false)", [
      emptyLocation,
      "P3-EMPTY",
      "Empty floor",
    ]);
    await rejects(
      "select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)",
      [
        randomUUID(),
        workshop,
        emptyLocation,
        JSON.stringify([{ inventory_item_id: pid, quantity: 1 }]),
        "Inactive location",
      ],
      "Inactive location rejects stock",
    );
    await login(null);
    await rejects(
      "update locations set active=false where id=$1",
      [workshop],
      "Workshop root cannot deactivate",
    );
    await rejects(
      "update materials set qty_on_hand=999 where id=$1",
      [material],
      "Legacy consumable cache cannot overwrite ledger",
    );
    await rejects(
      "update finished_products set current_location_id=$1 where id=$2",
      [showroom, piece],
      "Direct piece teleport blocked",
    );
    await rejects(
      "insert into holds(thaan_id,length_mm,expires_at) values($1,1,now()+interval '1 hour')",
      [thaans[0]],
      "Unlocated holds rejected after cutover",
    );
    await rejects(
      "insert into stock_movements(thaan_id,kind,delta_mm) values($1,'ADJUSTMENT',-2000)",
      [heldThan],
      "Negative legacy stock blocked",
    );
    await rejects(
      "insert into stock_transfer_lines(transfer_id,material_id,quantity,unit) values($1,$2,1,'m')",
      [transfer, material],
      "No append to posted transfer",
    );
    for (const role of ["counter", "stock_entry", "tailor"]) {
      await login(users[role]);
      await rejects(
        "select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)",
        [randomUUID(), workshop, showroom, items, "Forbidden"],
        role + " transfer denied",
      );
      await rejects(
        "select manage_showroom_location(null,$1,$2,true)",
        ["BAD-" + role, "Forbidden"],
        role + " location write denied",
      );
      await rejects(
        "select reconcile_inventory_item($1,$2,$3::jsonb,$4)",
        ["fabric", thaans[0], allocation(workshop, 10000), "Forbidden"],
        role + " reconciliation denied",
      );
      await rejects(
        "select inventory_balance($1,null)",
        [ids[0]],
        role + " private balance helper denied",
      );
      check(await scalar("select count(*)=0 from thaan_costs"), role + " no CP leakage");
      check(
        await scalar("select count(*)=0 from production_cost_lines"),
        role + " no production cost leakage",
      );
      if (role !== "tailor")
        check(
          (await q("select * from inventory_catalog()")).every(
            (row) => !Object.keys(row).some((k) => /cost|price|cp|sp_snapshot/.test(k)),
          ),
          role + " catalog no financial columns",
        );
    }
    await login(users.counter);
    check((await balance(showroom)) === 26000, "Counter sees safe stock by location");
    await login(users.tailor);
    check(
      await scalar("select count(*)=0 from inventory_location_balances()"),
      "Tailor cannot see partial global balances",
    );
    check(
      await scalar("select count(*)=0 from inventory_movement_history(500)"),
      "Unassigned Tailor no movement history",
    );
    await login(null);
    await rejects(
      "delete from stock_movements where thaan_id=$1",
      [thaans[0]],
      "Legacy history immutable",
    );
    await rejects(
      "delete from inventory_movements where inventory_item_id=$1",
      [ids[0]],
      "Ledger history immutable",
    );
    await rejects(
      "delete from stock_transfers where id=$1",
      [transfer],
      "Posted transfer immutable",
    );
    console.log(`${directory} (${demo ? "demo" : "clean"}): Phase 3 verified`);
  } finally {
    await db.close();
  }
}
console.log(`PASS: ${passed} Phase 3 ledger/security checks`);
