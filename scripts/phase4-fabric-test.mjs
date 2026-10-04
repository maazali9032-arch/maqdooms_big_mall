/** Full migration replay; disposable PostgreSQL, real roles, no live credentials. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
let checks = 0;
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
  const check = (v, label) => {
    assert.ok(v, label);
    checks++;
  };
  const denied = async (sql, args = [], label = sql) => {
    let error;
    try {
      await q(sql, args);
    } catch (e) {
      error = e;
    }
    check(error, label);
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
          "select * from (select 'thaans' t,to_jsonb(x) row from thaans x union all select 'stock_movements',to_jsonb(x) from stock_movements x union all select 'inventory_movements',to_jsonb(x) from inventory_movements x union all select 'fabric_stock',to_jsonb(x) from fabric_stock x) s order by t,row::text",
        ),
      );
    const includePhase7 =
      process.argv.includes("--include-phase9") ||
      process.argv.includes("--include-phase8") ||
      process.argv.includes("--include-phase7");
    const includePhase6 = includePhase7 || process.argv.includes("--include-phase6");
    const includePhase5 = includePhase6 || process.argv.includes("--include-phase5");
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
            : 14,
    );
    let before;
    for (const f of files) {
      if (!demo && f.includes("demo_seed")) continue;
      if (f.includes("phase4_")) before = await snapshot();
      try {
        await db.exec(await readFile(resolve(directory, f), "utf8"));
      } catch (e) {
        throw new Error(f + ": " + e.message);
      }
    }
    check(before === (await snapshot()), "No Phase 4 migration data rewrite");
    const users = {};
    for (const role of ["owner", "stock_entry", "counter", "tailor"]) {
      const id = (users[role] = randomUUID());
      await q("insert into auth.users(id,email) values($1,$2)", [id, role + "@test.invalid"]);
      await q("insert into profiles(id,full_name) values($1,$2)", [id, role]);
      await q("insert into user_roles(user_id,role_key) values($1,$2)", [id, role]);
    }
    const other = randomUUID();
    await q("insert into auth.users(id,email) values($1,$2)", [other, "other@test.invalid"]);
    await q("insert into profiles(id,full_name) values($1,$2)", [other, "Other entry"]);
    await q("insert into user_roles(user_id,role_key) values($1,'stock_entry')", [other]);
    const fabric = await one(
      "insert into fabrics(code,name,category) values('P4-F','Phase 4 Fabric','Fabric') returning id",
    );
    await login(users.stock_entry);
    const batch = await one("insert into receiving_batches(code) values('P4-B') returning id");
    const req = randomUUID(),
      lengths = "[10000,12345,1]";
    const stock = await one("select create_fabric_entry($1,$2,$3,$4::jsonb,$5)", [
      req,
      fabric,
      batch,
      lengths,
      50000,
    ]);
    check(
      (await one("select create_fabric_entry($1,$2,$3,$4::jsonb,$5)", [
        req,
        fabric,
        batch,
        lengths,
        50000,
      ])) === stock,
      "Same entry retry same stock",
    );
    await denied(
      "select create_fabric_entry($1,$2,$3,$4::jsonb,$5)",
      [req, fabric, batch, lengths, 50001],
      "Request mismatch",
    );
    await denied(
      "select create_fabric_entry($1,$2,$3,$4::jsonb,$5)",
      [randomUUID(), fabric, batch, lengths, 50000],
      "Duplicate Fabric + Batch rejected",
    );
    const catalog = () => one("select fabric_stock_catalog(null)");
    const current = () =>
      one(
        "select fabric_stock_catalog((select code from barcodes where id=(select barcode_id from fabric_stock where id=$1)))",
        [stock],
      );
    const s = (await current())[0];
    check(s.barcode.startsWith("FAB-"), "Generated Fabric Barcode");
    check(s.thans.length === 3, "Variable internal Than rows");
    check(s.original_mm === 22346, "Exact total");
    check(s.available_mm === 0, "Draft not available");
    check(s.sp_paise_per_m === null, "SP optional");
    check((await one("select domain_stock_entry_cp($1,null)", [stock])) === 50000, "Open own CP");
    check(
      await one("select count(*)=0 from fabric_stock_costs where fabric_stock_id=$1", [stock]),
      "No raw CP history",
    );
    check(
      await one("select count(*)=0 from fabric_entry_requests"),
      "Private retry payload hidden",
    );
    const edited = s.thans.map((t) => ({
      id: t.id,
      length_mm: t.original_mm === 10000 ? 11000 : t.original_mm,
    }));
    await q("select update_fabric_entry($1,$2::jsonb,$3)", [stock, JSON.stringify(edited), 51000]);
    check(
      (await one("select domain_stock_entry_cp($1,null)", [stock])) === 51000,
      "Draft correction CP append",
    );
    await denied(
      "select update_fabric_entry($1,$2::jsonb,$3)",
      [stock, JSON.stringify([...edited, { id: edited[0].id, length_mm: 1 }]), 51000],
      "Duplicate draft rows",
    );
    await login(other);
    await denied("select domain_stock_entry_cp($1,null)", [stock], "Other entry CP denied");
    await denied("select complete_fabric_entry($1)", [stock], "Other completion denied");
    await denied(
      "select create_fabric_entry($1,$2,$3,$4::jsonb,$5)",
      [req, fabric, batch, lengths, 50000],
      "Other retry payload denied",
    );
    await login(users.stock_entry);
    await q("select complete_fabric_entry($1)", [stock]);
    await q("select complete_fabric_entry($1)", [stock]);
    const complete = (await current())[0];
    check(complete.available_mm === 23346, "Workshop receipt exact");
    check(complete.sp_paise_per_m === null, "Completion without SP");
    check(
      complete.locations.length === 1 && complete.locations[0].name === "Workshop",
      "Receipt Workshop only",
    );
    check(
      await one("select count(*)=3 from inventory_movements where fabric_stock_id=$1", [stock]),
      "Idempotent receipt movements",
    );
    check(
      await one(
        "select count(*)=0 from stock_movements where thaan_id in(select id from thaans where fabric_stock_id=$1)",
        [stock],
      ),
      "No legacy double counting",
    );
    check(
      await one("select count(*)=0 from thaans where fabric_stock_id=$1 and barcode is not null", [
        stock,
      ]),
      "No per-Than barcode",
    );
    check(
      await one(
        "select count(*)=0 from inventory_movements where fabric_stock_id=$1 and kind='WASTAGE'",
        [stock],
      ),
      "No automatic wastage",
    );
    await denied("select domain_stock_entry_cp($1,null)", [stock], "Closed CP unavailable");
    await denied("select domain_stock_entry_cp($1,1)", [stock], "Closed CP edit denied");
    await denied(
      "select owner_set_fabric_sp($1,85000,$2)",
      [stock, "Set SP"],
      "Stock Entry SP denied",
    );
    await denied(
      "select open_fabric_cp_correction($1,$2)",
      [stock, "Try reopening"],
      "Stock Entry cannot reopen",
    );
    await login(users.owner);
    check(
      (await one("select domain_stock_entry_cp($1,null)", [stock])) === 51000,
      "Owner CP after completion",
    );
    await q("select owner_set_fabric_sp($1,85000,$2)", [stock, "Initial SP"]);
    await q("select owner_set_fabric_sp($1,90000,$2)", [stock, "Updated SP"]);
    check((await current())[0].barcode === s.barcode, "Barcode stable after SP edits");
    check(
      await one("select count(*)=2 from fabric_stock_prices where fabric_stock_id=$1", [stock]),
      "SP revisions retained",
    );
    check(
      await one("select count(*)=2 from fabric_stock_costs where fabric_stock_id=$1", [stock]),
      "CP revisions retained",
    );
    await denied(
      "update fabric_stock_prices set sp_paise_per_m=1 where fabric_stock_id=$1",
      [stock],
      "SP history immutable",
    );
    await denied(
      "update thaans set barcode=$1 where id=$2",
      ["ROLL-NEW", edited[0].id],
      "Roll barcode bypass denied",
    );
    await denied(
      "update thaans set price_paise=1 where id=$1",
      [edited[0].id],
      "Legacy SP bypass denied",
    );
    await denied(
      "update thaans set original_mm=0 where id=$1",
      [edited[0].id],
      "Received lengths immutable",
    );
    await q("select open_fabric_cp_correction($1,$2)", [stock, "Invoice correction authorized"]);
    await login(users.stock_entry);
    check(
      (await one("select domain_stock_entry_cp($1,null)", [stock])) === 51000,
      "Owner-authorized own correction CP",
    );
    await q("select domain_stock_entry_cp($1,52000)", [stock]);
    await q("select complete_fabric_entry($1)", [stock]);
    check((await current())[0].available_mm === 23346, "CP correction no quantity receipt");
    await denied("select domain_stock_entry_cp($1,null)", [stock], "Correction closes CP");
    await login(users.counter);
    const staff = (await current())[0];
    check(staff.sp_paise_per_m === 90000, "Counter scans same barcode SP");
    check(staff.barcode === s.barcode, "Counter same barcode");
    check(!JSON.stringify(staff).includes("cp_"), "Safe scan no CP fields");
    check(
      await one("select count(*)=0 from fabric_stock_costs where fabric_stock_id=$1", [stock]),
      "Counter direct CP invisible",
    );
    check(await one("select count(*)=0 from fabric_entry_requests"), "Counter retry CP invisible");
    await denied("select domain_stock_entry_cp($1,null)", [stock], "Counter CP API denied");
    await denied(
      "select owner_set_fabric_sp($1,1,$2)",
      [stock, "Attack"],
      "Counter SP mutation denied",
    );
    await denied(
      "select create_fabric_entry($1,$2,$3,$4::jsonb,$5)",
      [randomUUID(), fabric, batch, lengths, 1],
      "Counter entry denied",
    );
    const hist = await one("select fabric_stock_history($1)", [stock]);
    check(
      hist.length === 3 &&
        hist.every((h) => h.actor_id === users.stock_entry && h.reference.startsWith("RECEIPT:")),
      "Traceable receipt history",
    );
    await login(users.tailor);
    await denied("select fabric_stock_catalog(null)", [], "Unassigned Tailor scan denied");
    await denied("select fabric_stock_history($1)", [stock], "Tailor history denied");
    await login(null);
    await db.exec("set role anon");
    await denied("select fabric_stock_catalog(null)", [], "Anon scan denied");
    await denied(
      "select create_fabric_entry($1,$2,$3,$4::jsonb,$5)",
      [req, fabric, batch, lengths, 50000],
      "Anon create denied",
    );
    await login(users.stock_entry);
    const batch2 = await one(
      "insert into receiving_batches(code) values('P4-INVALID') returning id",
    );
    await denied(
      "select create_fabric_entry($1,$2,$3,$4::jsonb,$5)",
      [randomUUID(), fabric, batch2, "[10000,0]", 50000],
      "Late invalid row atomic rollback",
    );
    check(!(await catalog()).some((x) => x.batch_id === batch2), "Failed entry no barcode or rows");
    await denied(
      "select create_fabric_entry($1,$2,$3,$4::jsonb,$5)",
      [randomUUID(), fabric, batch2, "[1.5]", 50000],
      "Fractional mm rejected",
    );
    await denied(
      "select create_fabric_entry($1,$2,$3,$4::jsonb,$5)",
      [randomUUID(), fabric, batch2, "[10]", -1],
      "Negative CP rejected",
    );
    await denied(
      "insert into thaans(barcode,batch_id) values('NEW-ROLL',$1)",
      [batch2],
      "Per-roll receiving creation deprecated at backend",
    );
    await denied("select can_receive_fabric()", [], "Private authorization helper sealed");
    const stock2 = await one("select create_fabric_entry($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      fabric,
      batch2,
      "[1000,2000]",
      100,
    ]);
    const order = (
      await q("select id from thaans where fabric_stock_id=$1 order by id", [stock2])
    ).map((t) => t.id);
    await q("update thaans set original_mm=0 where id=$1", [order[1]]);
    await denied(
      "select complete_fabric_entry($1)",
      [stock2],
      "Late invalid Than rolls back earlier receipt",
    );
    check(
      await one(
        "select count(*)=0 from inventory_items where thaan_id in(select id from thaans where fabric_stock_id=$1)",
        [stock2],
      ),
      "Failed completion creates no authority",
    );
    check(
      await one("select count(*)=0 from inventory_movements where fabric_stock_id=$1", [stock2]),
      "Failed completion creates no inward events",
    );
    check(
      await one("select count(*)=2 from thaans where fabric_stock_id=$1 and status='draft'", [
        stock2,
      ]),
      "Failed receipt all Thans stay draft",
    );
    await q("select update_fabric_entry($1,$2::jsonb,$3)", [
      stock2,
      JSON.stringify(order.map((id) => ({ id, length_mm: 1000 }))),
      100,
    ]);
    await login(null);
    const fabric2 = await one(
      "insert into fabrics(code,name,category) values('P4-F2','Another Fabric','Fabric') returning id",
    );
    await login(users.stock_entry);
    const stock3 = await one("select create_fabric_entry($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      fabric2,
      batch2,
      "[1500]",
      101,
    ]);
    const old = (await catalog()).find((s) => s.id === stock2);
    await denied(
      "select update_fabric_entry($1,$2::jsonb,$3)",
      [stock2, JSON.stringify(order.map((id, i) => ({ id, length_mm: i === 0 ? 500 : 0 }))), 102],
      "Late invalid draft edit rollback",
    );
    check(
      (await catalog()).find((s) => s.id === stock2).original_mm === old.original_mm,
      "Draft edit rollback keeps lengths",
    );
    check(
      (await one("select domain_stock_entry_cp($1,null)", [stock2])) === 100,
      "Failed edit keeps CP",
    );
    await q("select complete_fabric_entry($1)", [stock2]);
    check(
      await one("select status='draft' from receiving_batches where id=$1", [batch2]),
      "Multi-fabric batch stays open for other draft",
    );
    await q("select complete_fabric_entry($1)", [stock3]);
    check(
      await one("select status='committed' from receiving_batches where id=$1", [batch2]),
      "Last receipt closes batch",
    );
    check(
      await one(
        "select sum(available_mm)=23346 and bool_and(not is_incomplete) from v_thaan_overview where id in(select id from thaans where fabric_stock_id=$1)",
        [stock],
      ),
      "Overview canonical quantities, optional SP does not mark incomplete",
    );
    await login(users.owner);
    await denied(
      "update fabric_stock set created_by=$1 where id=$2",
      [other, stock],
      "New stock ownership immutable",
    );
    await denied("delete from fabric_stock where id=$1", [stock], "Stock identity retained");
    await denied(
      "update barcodes set code='REPLACED' where id=(select barcode_id from fabric_stock where id=$1)",
      [stock],
      "Barcode immutable",
    );
    await denied(
      "insert into fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m) values($1,999,-1)",
      [stock],
      "CP constraints intact",
    );
    const qty = (await catalog()).find((s) => s.id === stock).available_mm;
    const inv = await one("select id from inventory_items where thaan_id=$1", [
      edited.find((t) => t.length_mm >= 100).id,
    ]);
    const workshop = await one("select id from locations where kind='workshop'");
    const showroom = await one("select id from locations where kind='showroom'");
    await q("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      workshop,
      showroom,
      JSON.stringify([{ inventory_item_id: inv, quantity: 100 }]),
      "Verify stock scan location totals",
    ]);
    const after = (await catalog()).find((s) => s.id === stock);
    check(
      after.available_mm === qty &&
        after.locations.find((l) => l.id === showroom).quantity_mm === 100,
      "Fabric scan aggregates location ledger without duplicating totals",
    );
    await login(null);
    await q("update profiles set active=false where id=$1", [users.stock_entry]);
    await login(users.stock_entry);
    await denied("select fabric_stock_catalog(null)", [], "Inactive scan denied");
    await denied("select complete_fabric_entry($1)", [stock], "Inactive completion denied");
    check(
      await one("select count(*)=0 from fabric_entry_requests"),
      "Inactive private payload denied",
    );
    console.log(directory + (demo ? " demo" : " clean") + ": Phase 4 role/receipt checks passed");
  } finally {
    await db.close();
  }
}
console.log(`PASS: ${checks} Phase 4 checks`);
