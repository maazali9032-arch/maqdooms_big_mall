/** Phase 4 receipt -> Phase 5 bidirectional transfer; isolated PostgreSQL only. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { prepareFabricTransfer } from "../src/features/inventory/fabric-transfer.ts";
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
let checks = 0;
const check = (value, label) => {
  assert.ok(value, label);
  checks++;
};
const a = { thaan_id: "A", inventory_item_id: "B", source_mm: 10000 },
  b = { thaan_id: "B", inventory_item_id: "A", source_mm: 20000 };
const planned = prepareFabricTransfer([a, b], { A: "1.001", B: "2" });
check(planned.total_mm === 3001, "Exact UI mm conversion and total");
check(planned.lines[0].inventory_item_id === "A", "Canonical stable payload order");
check(
  JSON.stringify(planned) === JSON.stringify(prepareFabricTransfer([b, a], { B: "2", A: "1.001" })),
  "Refresh/reordered Thans preserves retry payload",
);
check(
  prepareFabricTransfer([a, b], { A: "0", B: "2" }).total_mm === 2000,
  "Explicit zero skips Than",
);
for (const [rows, choices] of [
  [[a], { A: "11" }],
  [[a], { A: "-1" }],
  [[a], { A: "1.0001" }],
  [[a], { Unknown: "1" }],
  [[{ ...a, inventory_item_id: null }], { A: "1" }],
  [[a], {}],
  [[a, { ...b, inventory_item_id: "B" }], { A: "1", B: "1" }],
]) {
  assert.throws(() => prepareFabricTransfer(rows, choices));
  checks++;
}
check(
  prepareFabricTransfer([{ ...a, source_mm: 0 }], { A: "10" }, false).total_mm === 10000,
  "Uncertain full-stock retry can build same original payload after source depleted",
);
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
        await q(
          "select * from (select 'thaans' t,to_jsonb(x) row from thaans x union all select 'fabric_stock',to_jsonb(x) from fabric_stock x union all select 'inventory_movements',to_jsonb(x) from inventory_movements x union all select 'stock_transfers',to_jsonb(x) from stock_transfers x union all select 'erp_audit_records',to_jsonb(x) from erp_audit_records x) z order by t,row::text",
        ),
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
            !f.includes("phase7_")) &&
          (process.argv.includes("--include-phase9") ||
            process.argv.includes("--include-phase8") ||
            process.argv.includes("--include-phase7") ||
            process.argv.includes("--include-phase6") ||
            !f.includes("phase6_")),
      )
      .sort();
    assert.equal(
      files.length,
      process.argv.includes("--include-phase9") ||
        process.argv.includes("--include-phase8") ||
        process.argv.includes("--include-phase7") ||
        process.argv.includes("--include-phase6")
        ? process.argv.includes("--include-phase9") ||
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
          : 16
        : 15,
    );
    let before;
    for (const f of files) {
      if (!demo && f.includes("demo_seed")) continue;
      if (f.includes("phase5_")) before = await snapshot();
      try {
        await db.exec(await readFile(resolve(directory, f), "utf8"));
      } catch (e) {
        throw new Error(f + ": " + e.message);
      }
    }
    check(before === (await snapshot()), "Phase 5 migration changes no existing data");
    const users = {};
    for (const role of ["owner", "stock_entry", "counter", "tailor", "ecommerce_manager"]) {
      const id = (users[role] = randomUUID());
      await q("insert into auth.users(id,email) values($1,$2)", [id, role + "@test.invalid"]);
      await q("insert into profiles(id,full_name) values($1,$2)", [id, role]);
      await q("insert into user_roles(user_id,role_key) values($1,$2)", [id, role]);
    }
    const fabric = await one(
      "insert into fabrics(code,name,category) values('P5-F','Phase 5 Fabric','Fabric') returning id",
    );
    const workshop = await one("select id from locations where kind='workshop'");
    const showroom = await one("select id from locations where kind='showroom'");
    await login(users.stock_entry);
    const batch = await one("insert into receiving_batches(code) values('P5-B') returning id");
    const stock = await one("select create_fabric_entry($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      fabric,
      batch,
      "[40000,60000]",
      50000,
    ]);
    await q("select complete_fabric_entry($1)", [stock]);
    await login(users.owner);
    const floor = await one(
      "select manage_showroom_location(null,'P5-FLOOR','Dynamic Floor',true)",
    );
    const rows = await q(
      "select id,thaan_id from inventory_items where thaan_id in(select id from thaans where fabric_stock_id=$1) order by id",
      [stock],
    );
    const balance = async (loc) =>
      Number(
        await one(
          "select coalesce(sum(quantity),0) from inventory_location_balances() where location_id=$1 and inventory_item_id in(select id from inventory_items where thaan_id in(select id from thaans where fabric_stock_id=$2))",
          [loc, stock],
        ),
      );
    const catalog = async () => {
      const all = await one("select fabric_stock_catalog(null)");
      return all.find((s) => s.id === stock);
    };
    const history = async () => one("select stock_transfer_history($1,50)", [stock]);
    const item = (row, quantity) => ({ inventory_item_id: row.id, quantity });
    const post = async (id, src, dst, items, reason = "Stock Transfer") =>
      one("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
        id,
        src,
        dst,
        JSON.stringify(items),
        reason,
      ]);
    check((await balance(workshop)) === 100000, "100m Workshop receipt");
    check((await balance(showroom)) === 0, "No invented Showroom balance");
    const barcode = (await catalog()).barcode;
    const req = randomUUID();
    const lines = [item(rows[0], 10000), item(rows[1], 20000)];
    const transfer = await post(req, workshop, showroom, lines, "Workshop to Showroom");
    check((await balance(workshop)) === 70000, "100m -> 70m Workshop");
    check((await balance(showroom)) === 30000, "Showroom 30m");
    check((await catalog()).available_mm === 100000, "Transfer total remains 100m");
    check(
      (await post(req, workshop, showroom, lines, "Workshop to Showroom")) === transfer,
      "Exact retry returns same transfer",
    );
    check((await history()).length === 1, "Retry no duplicate transfer");
    check(
      await one(
        "select count(*)=2 from inventory_movements where stock_transfer_line_id in(select id from stock_transfer_lines where transfer_id=$1)",
        [transfer],
      ),
      "Exactly one movement per line",
    );
    check(
      await one(
        "select count(*)=1 from erp_audit_records where action='post_inventory_transfer' and entity_id=$1",
        [transfer],
      ),
      "Retry no duplicate audit",
    );
    await denied(
      "select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)",
      [req, workshop, showroom, JSON.stringify([item(rows[0], 1)]), "Different"],
      "Mismatched retry denied",
    );
    await post(
      randomUUID(),
      showroom,
      workshop,
      [item(rows[1], 12000)],
      "Showroom back to Workshop",
    );
    check(
      (await balance(workshop)) === 82000 && (await balance(showroom)) === 18000,
      "Reverse transfer 82m/18m",
    );
    await post(randomUUID(), showroom, floor, [item(rows[0], 5000)], "Move to dynamic floor");
    check(
      (await balance(showroom)) === 13000 && (await balance(floor)) === 5000,
      "Dynamic Showroom sublocation 13m/5m",
    );
    await post(randomUUID(), floor, workshop, [item(rows[0], 5000)], "Floor back to Workshop");
    check(
      (await balance(workshop)) === 87000 &&
        (await balance(showroom)) === 13000 &&
        (await balance(floor)) === 0,
      "Floor return conserves 100m",
    );
    const documents = await history();
    check(
      documents.length === 4,
      "Transfer-document history includes both directions and sublocation",
    );
    const first = documents.find((t) => t.id === transfer);
    check(
      first.source_name === "Workshop" &&
        first.destination_name === "Showroom" &&
        first.request_id === req,
      "Named source/destination stable reference",
    );
    check(
      first.lines.length === 2 &&
        first.lines.every(
          (l) =>
            l.barcode === barcode && l.actor_id === users.owner && l.movement_id && l.occurred_at,
        ),
      "Same Fabric Barcode, individual Than/movement/user/time trace",
    );
    check(
      !JSON.stringify(documents).includes("cp_paise") &&
        !JSON.stringify(documents).includes("sp_paise"),
      "Transfer document has no financial fields",
    );
    check(
      (await one("select stock_transfer_history($1,1)", [stock])).length === 1,
      "History limit applied",
    );
    check(
      (await one("select stock_transfer_history($1,0)", [stock])).length === 1,
      "History bound clamps",
    );
    check(
      (await one("select stock_transfer_history($1,50)", [randomUUID()])).length === 0,
      "Stock filter isolates other identity",
    );
    const unchanged = await snapshot();
    for (const [src, dst, items, reason, label] of [
      [workshop, workshop, [item(rows[0], 1)], "Same", "Same location denied"],
      [workshop, showroom, [item(rows[0], 999999)], "Overdraw", "Source overdraw denied"],
      [workshop, showroom, [item(rows[0], 0)], "Zero", "Zero denied"],
      [workshop, showroom, [item(rows[0], 1.5)], "Fractional", "Fractional mm denied"],
      [
        workshop,
        showroom,
        [item(rows[0], 1), item(rows[0], 1)],
        "Duplicate",
        "Duplicate Than denied",
      ],
      [workshop, showroom, [item(rows[0], 1)], "", "Reason required"],
      [
        workshop,
        showroom,
        [{ inventory_item_id: randomUUID(), quantity: 1 }],
        "Unknown",
        "Unknown item denied",
      ],
    ])
      await denied(
        "select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)",
        [randomUUID(), src, dst, JSON.stringify(items), reason],
        label,
      );
    check(unchanged === (await snapshot()), "Rejected transfers leave data/history unchanged");
    await login(null);
    const last = rows[1].id;
    await db.exec(
      `create function public.test_late_transfer_failure() returns trigger language plpgsql as $$begin if NEW.kind='TRANSFER' and NEW.inventory_item_id='${last}'::uuid then raise exception 'Forced late transfer failure';end if;return NEW;end$$;create trigger zz_test_late_failure before insert on inventory_movements for each row execute function public.test_late_transfer_failure();`,
    );
    await login(users.owner);
    const prior = await snapshot();
    await denied(
      "select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)",
      [
        randomUUID(),
        workshop,
        showroom,
        JSON.stringify([item(rows[0], 1000), item(rows[1], 1000)]),
        "Late failure",
      ],
      "Late line failure rolls back first line",
    );
    check(prior === (await snapshot()), "Whole transfer header/lines/events/audit rollback");
    await login(null);
    await db.exec(
      "drop trigger zz_test_late_failure on inventory_movements;drop function public.test_late_transfer_failure();",
    );
    await login(users.owner);
    await q("select manage_showroom_location($1,'P5-FLOOR','Dynamic Floor',false)", [floor]);
    await denied(
      "select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)",
      [randomUUID(), workshop, floor, JSON.stringify([item(rows[0], 1)]), "Inactive"],
      "Inactive destination denied",
    );
    const remaining = await one(
      "select quantity from inventory_location_balances() where inventory_item_id=$1 and location_id=$2",
      [rows[0].id, workshop],
    );
    const allReq = randomUUID();
    const allLines = [item(rows[0], remaining)];
    const allId = await post(allReq, workshop, showroom, allLines, "Move remaining Than");
    check(
      await one(
        "select coalesce(sum(quantity),0)=0 from inventory_location_balances() where inventory_item_id=$1 and location_id=$2",
        [rows[0].id, workshop],
      ),
      "Full Than transfer depletes its source",
    );
    check(
      (await post(allReq, workshop, showroom, allLines, "Move remaining Than")) === allId,
      "Retry after source depletion returns existing transfer",
    );
    check(
      (await catalog()).barcode === barcode && (await catalog()).available_mm === 100000,
      "Barcode and total preserved",
    );
    check(
      await one(
        "select count(*)=0 from inventory_movements where fabric_stock_id=$1 and kind='WASTAGE'",
        [stock],
      ),
      "No automatic wastage",
    );
    await denied(
      "update stock_transfers set reason=$1 where id=$2",
      ["Rewrite", transfer],
      "Posted document immutable",
    );
    await denied(
      "delete from stock_transfer_lines where transfer_id=$1",
      [transfer],
      "Posted lines immutable",
    );
    for (const role of ["stock_entry", "counter", "tailor", "ecommerce_manager"]) {
      await login(users[role]);
      await denied(
        "select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)",
        [randomUUID(), workshop, showroom, JSON.stringify([item(rows[1], 1)]), "Unauthorized"],
        role + " transfer denied",
      );
      await denied("select stock_transfer_history(null,50)", [], role + " document reader denied");
      check(
        await one("select count(*)=0 from fabric_stock_costs where fabric_stock_id=$1", [stock]),
        role + " no CP",
      );
    }
    await login(null);
    const backupOwner = randomUUID();
    await q("insert into auth.users(id,email) values($1,'backup-owner@test.invalid')", [
      backupOwner,
    ]);
    await q("insert into profiles(id,full_name) values($1,'Backup Owner')", [backupOwner]);
    await q("insert into user_roles(user_id,role_key) values($1,'owner')", [backupOwner]);
    await q("update profiles set active=false where id=$1", [users.owner]);
    await login(users.owner);
    await denied("select stock_transfer_history(null,50)", [], "Inactive Owner history denied");
    await denied(
      "select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)",
      [randomUUID(), workshop, showroom, JSON.stringify([item(rows[1], 1)]), "Inactive"],
      "Inactive Owner mutation denied",
    );
    await login(null);
    await db.exec("set role anon");
    await denied(
      "select stock_transfer_history(null,50)",
      [],
      "Anonymous history execution revoked",
    );
    console.log(directory + (demo ? " demo" : " clean") + ": Phase 5 transfer acceptance passed");
  } finally {
    await db.close();
  }
}
console.log(`PASS: ${checks} Phase 5 transfer / UI planning checks`);
