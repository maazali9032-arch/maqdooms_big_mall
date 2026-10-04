/** Disposable PostgreSQL business/security tests, no live credentials. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
let checks = 0;
const check = (v, label) => {
  assert.ok(v, label);
  checks++;
};
for (const [directory, demo] of [
  ["supabase/migrations", true],
  ["drizzle/migrations", true],
  ["supabase/migrations", false],
]) {
  const db = new PGlite();
  const q = async (s, a = []) => {
    try {
      return (await db.query(s, a)).rows;
    } catch (e) {
      throw new Error(s + ": " + e.message);
    }
  };
  const one = async (s, a = []) => Object.values((await q(s, a))[0])[0];
  const denied = async (s, a = [], label = s) => {
    let error;
    try {
      await q(s, a);
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
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`,
    );
    let tables, before;
    const snapshot = async () => {
      const out = {};
      for (const t of tables)
        out[t.name] = await q(
          `select row from(select(select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(r)) where key=any($1::text[])) row from public."${t.name}" r) x order by row::text`,
          [t.columns],
        );
      return JSON.stringify(out);
    };
    const files = (await fs.readdir(directory))
      .filter(
        (f) =>
          (process.argv.includes("--include-phase10") || !f.includes("phase12_")) &&
          f.endsWith(".sql") &&
          (process.argv.includes("--include-phase15") || !f.includes("phase15_")) &&
          (process.argv.includes("--include-phase14") || !f.includes("phase14_")) &&
          (process.argv.includes("--include-phase13") || !f.includes("phase13_")) &&
          (process.argv.includes("--include-phase12") || !f.includes("phase12_")) &&
          (process.argv.includes("--include-phase11") || !f.includes("phase12_")) &&
          (process.argv.includes("--include-phase10") || !f.includes("phase12_")) &&
          !f.includes("_live_"),
      )
      .sort();
    check(
      files.length ===
        (process.argv.includes("--include-phase15")
          ? 26
          : process.argv.includes("--include-phase14")
            ? 25
            : process.argv.includes("--include-phase13")
              ? 24
              : 23),
      "Full Phase 13 business chain",
    );
    for (const f of files) {
      if (!demo && f.includes("demo_seed")) continue;
      if (f.includes("phase13_")) {
        tables = await q(
          "select table_name name,array_agg(column_name order by ordinal_position) columns from information_schema.columns where table_schema='public' and table_name in(select tablename from pg_tables where schemaname='public') group by table_name order by table_name",
        );
        before = await snapshot();
      }
      await db.exec(await fs.readFile(resolve(directory, f), "utf8"));
    }
    check(before === (await snapshot()), "Every old table/column/value preserved");
    const users = {};
    for (const role of [
      "owner",
      "counter",
      "stock_entry",
      "tailor",
      "other_tailor",
      "ecommerce_manager",
    ]) {
      const id = (users[role] = randomUUID());
      await q("insert into auth.users values($1,$2)", [id, role + "@p10.test"]);
      await q("insert into profiles(id,full_name) values($1,$2)", [id, role]);
      await q("insert into user_roles(user_id,role_key) values($1,$2)", [
        id,
        role === "other_tailor" ? "tailor" : role,
      ]);
    }
    await login(users.owner);
    const m = "select manage_production_catalog($1,$2,$3,$4,$5,$6,$7,$8)";
    const config = async (kind, code, charge = null) =>
      one(m, [randomUUID(), kind, null, code, code, true, charge, "Explicit configuration"]);
    const productArgs = [
      randomUUID(),
      "product",
      null,
      "P10P",
      "Product",
      true,
      null,
      "Create Product",
    ];
    const product = await one(m, productArgs);
    check((await one(m, productArgs)) === product, "Configuration retry");
    await denied(
      m,
      [...productArgs.slice(0, 4), "Changed", ...productArgs.slice(5)],
      "Changed catalogue retry",
    );
    const design = await config("design", "P10D", 12345);
    const design2 = await config("design", "P10D2");
    const hierarchy = "select manage_tailoring_entity($1,$2,$3,$4,$5,true,$6,$7,$8)";
    const factory = await one(hierarchy, [
      randomUUID(),
      "factory",
      null,
      "P10F",
      "Factory",
      null,
      null,
      "Create",
    ]);
    const section = await one(hierarchy, [
      randomUUID(),
      "section",
      null,
      "P10S",
      "Section",
      factory,
      null,
      "Create",
    ]);
    const tailor = await one(hierarchy, [
      randomUUID(),
      "tailor",
      null,
      "P10T",
      "Tailor",
      null,
      users.tailor,
      "Create",
    ]);
    const assignment = await one("select assign_tailor($1,$2,$3,$4,null,$5)", [
      randomUUID(),
      tailor,
      factory,
      section,
      "Assign",
    ]);
    const workshop = await one("select id from locations where kind='workshop'");
    const showroom = await one("select id from locations where kind='showroom'");
    const fabric = await one(
      "insert into fabrics(code,name,category) values('P10F','Fabric','Fabric') returning id",
    );
    const batch = await one("insert into receiving_batches(code) values('P10B') returning id");
    const stock = await one("select create_fabric_entry($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      fabric,
      batch,
      "[100000]",
      10000,
    ]);
    await q("select complete_fabric_entry($1)", [stock]);
    const item = await one(
      "select id from inventory_items where thaan_id in(select id from thaans where fabric_stock_id=$1)",
      [stock],
    );
    const receipt = await one(
      "select receive_consumable($1,null,'Thread','m','thread',$2,100,100,'Receipt')",
      [randomUUID(), workshop],
    );
    const material = await one("select inventory_item_id from consumable_receipts where id=$1", [
      receipt,
    ]);
    const create = "select create_owner_production($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)";
    const args = [
      randomUUID(),
      product,
      design,
      10,
      assignment,
      workshop,
      JSON.stringify([
        { inventory_item_id: item, quantity: 30000 },
        { inventory_item_id: material, quantity: 2.125 },
      ]),
      "10 identical pieces",
      "Actual total quantities",
    ];

    const job = await one(create, args);
    const job2 = await one(create, [
      randomUUID(),
      product,
      design2,
      1,
      assignment,
      workshop,
      JSON.stringify([{ inventory_item_id: item, quantity: 1000 }]),
      null,
      "Other job",
    ]);
    const progress = "select progress_owner_production($1,$2,$3,$4,$5)";
    const receive = "select receive_finished_products($1,$2,$3::jsonb,$4)";
    const fabricLine = await one(
      "select l.id from material_issue_lines l join material_issues i on i.id=l.material_issue_id where i.production_job_id=$1 and l.thaan_id is not null",
      [job],
    );
    const threadLine = await one(
      "select l.id from material_issue_lines l join material_issues i on i.id=l.material_issue_id where i.production_job_id=$1 and l.material_id is not null",
      [job],
    );
    const foreignLine = await one(
      "select l.id from material_issue_lines l join material_issues i on i.id=l.material_issue_id where i.production_job_id=$1",
      [job2],
    );
    const pieces = Array.from({ length: 10 }, (_, i) => ({
      piece_number: i + 1,
      materials: [
        { issue_line_id: fabricLine, quantity: 3000 },
        { issue_line_id: threadLine, quantity: 0.2 },
      ],
    }));
    const request = [
      randomUUID(),
      job,
      JSON.stringify(pieces),
      "Ten physical pieces returned to Workshop",
    ];
    await denied(receive, request, "Open job cannot create pieces");
    await one(progress, [randomUUID(), job, "open", "in_progress", "Started"]);
    await denied(receive, request, "In-progress job cannot create pieces");
    await one(progress, [
      randomUUID(),
      job,
      "in_progress",
      "completed",
      "All ten physically completed",
    ]);
    const snapshotProduction = () =>
      one(
        "select jsonb_build_array((select count(*) from finished_products),(select count(*) from barcodes),(select count(*) from finished_product_materials),(select count(*) from finished_product_receipts),(select count(*) from finished_product_receipt_pieces),(select count(*) from inventory_items),(select count(*) from inventory_movements),(select count(*) from erp_audit_records))",
      );
    check((await one(receive, request)) === job, "Actual pieces received before costing");
    const cp = await one(
      "select id from fabric_stock_costs where fabric_stock_id=$1 order by revision desc limit 1",
      [stock],
    );
    const materials = [
      { issue_line_id: fabricLine, quantity: 30000, fabric_cost_id: cp },
      { issue_line_id: threadLine, quantity: 2, category: "thread", receipt_id: receipt },
    ];
    const finalize = "select finalize_production_cost($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8)";
    const costs = [
      randomUUID(),
      job,
      null,
      JSON.stringify(materials),
      100000,
      "job_total",
      JSON.stringify([{ description: "Explicit finishing cost", amount_paise: 17 }]),
      "Actual billed quantities, CP sources and whole-job Design charge reviewed",
    ];
    const version = await one(finalize, costs);
    check((await one(finalize, costs)) === version, "Cost retry once");
    const context = await one("select owner_production_costs($1)", [job]);
    const first = context.versions[0];
    check(
      Number(first.total_paise) === 412562,
      "Fabric + thread + tailoring + Design + other complete total",
    );
    check(Number(first.mean_piece_paise) === 41256.2, "Exact average total divided by ten");
    check(
      first.allocations.reduce((s, p) => s + Number(p.amount_paise), 0) === 412562,
      "Allocations preserve exact total",
    );
    check(
      first.allocations.slice(0, 2).every((p) => Number(p.amount_paise) === 41257) &&
        first.allocations.slice(2).every((p) => Number(p.amount_paise) === 41256),
      "Deterministic one-paise remainder",
    );
    check(
      first.lines.find((l) => l.category === "design_embroidery").amount_paise === 12345,
      "Retained Design charge included once per explicit job basis",
    );
    check(
      first.lines.find((l) => l.category === "fabric").amount_paise === 300000,
      "Fabric CP x explicit metres",
    );
    check(
      first.lines.find((l) => l.category === "thread").amount_paise === 200,
      "Native receipt CP x actual billed thread",
    );
    const originalPieces = await one("select finished_product_catalog(null,$1)", [job]);
    await one("select set_finished_product_sp($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      job,
      version,
      JSON.stringify(originalPieces.map((p) => ({ piece_id: p.id, sp_paise: 345678 }))),
      "Explicit Owner SP",
    ]);
    const costSnapshot = JSON.stringify(await one("select owner_production_costs($1)", [job]));
    const genealogy = () =>
      one(
        "select jsonb_agg(to_jsonb(p)-'current_location_id' order by p.id) from finished_products p where production_job_id=$1",
        [job],
      );
    const identities = JSON.stringify(await genealogy());
    const floor = await one(
      "select manage_showroom_location(null,'P13FLOOR','Named Display',true)",
    );
    const floor2 = await one(
      "select manage_showroom_location(null,'P13OTHER','Other Display',true)",
    );
    const inactive = await one(
      "select manage_showroom_location(null,'P13INACTIVE','Closed Display',false)",
    );
    const ids = originalPieces.map((p) => p.id);
    const move = "select transfer_finished_products($1,$2,$3,$4::jsonb,$5)";
    const requestArgs = [
      randomUUID(),
      workshop,
      showroom,
      JSON.stringify(ids.slice(0, 3)),
      "Three pieces to Showroom",
    ];
    const firstTransfer = await one(move, requestArgs);
    check((await one(move, requestArgs)) === firstTransfer, "Idempotent exact retry");
    check(
      (await one(move, [
        ...requestArgs.slice(0, 3),
        JSON.stringify(ids.slice(0, 3).reverse()),
        requestArgs[4],
      ])) === firstTransfer,
      "Piece order canonicalized for retry",
    );
    await denied(move, [...requestArgs.slice(0, 4), "Changed reason"], "Changed payload rejected");
    const secondTransfer = await one(move, [
      randomUUID(),
      showroom,
      floor,
      JSON.stringify(ids.slice(0, 2)),
      "Two pieces to named sublocation",
    ]);
    check(firstTransfer !== secondTransfer, "Distinct posted transfers");
    const inventory = await one("select finished_product_inventory()");
    check(
      inventory.length === 10 && inventory.every((p) => p.available && Number(p.quantity) === 1),
      "Every piece is available once",
    );
    for (const [location, count] of [
      [workshop, 7],
      [showroom, 1],
      [floor, 2],
    ]) {
      check(
        inventory.filter((p) => p.location_id === location).length === count,
        "Physical location inventory exact",
      );
      check(
        Number(
          await one(
            "select coalesce(sum(quantity),0) from v_inventory_location_balances where finished_product_id=any($1::uuid[]) and location_id=$2",
            [ids, location],
          ),
        ) === count,
        "Canonical ledger location balance exact",
      );
    }
    check(
      Number(
        await one(
          "select sum(quantity) from v_inventory_location_balances where finished_product_id=any($1::uuid[])",
          [ids],
        ),
      ) === 10,
      "Transfers conserve total quantity",
    );
    check(
      !/sp_paise|cp_paise|cost_version|production_cost|amount_paise/.test(
        JSON.stringify(inventory),
      ),
      "Inventory projection has no finance",
    );
    const page1 = await one("select finished_product_inventory(null,3)");
    const page2 = await one("select finished_product_inventory($1,3)", [page1.at(-1).id]);
    check(
      page1.length === 3 &&
        page2.length === 3 &&
        !page1.some((p) => page2.some((x) => x.id === p.id)),
      "Keyset pages do not overlap",
    );
    check(
      (await one("select finished_product_inventory($1,100)", [inventory.at(-1).id])).length === 0,
      "Terminal page empty",
    );
    await denied("select finished_product_inventory(null,201)");
    await denied("select finished_product_movement_history(null,0)");
    const movements = await one("select finished_product_movement_history()");
    check(movements.length === 15, "Ten Workshop receipts plus five piece transfer events");
    const pieceHistory = await one("select finished_product_movement_history($1)", [ids[0]]);
    check(
      pieceHistory.length === 3 &&
        pieceHistory.every(
          (m) =>
            m.barcode === originalPieces[0].barcode &&
            m.actor_id === users.owner &&
            m.reason &&
            m.reference,
        ),
      "Receipt and both transfer movements retain identity/actor/reason/reference",
    );
    check(
      pieceHistory
        .filter((m) => m.kind === "TRANSFER")
        .every(
          (m) =>
            m.transfer_id &&
            m.transfer_line_id &&
            m.request_id &&
            Number(m.quantity) === 1 &&
            m.unit === "pc",
        ),
      "Movement transfer document linkage",
    );
    check(
      !/sp_paise|cp_paise|production_cost|amount_paise/.test(JSON.stringify(movements)),
      "Movement history has no finance",
    );
    const transferSnapshot = () =>
      one(
        "select jsonb_build_array((select jsonb_agg(to_jsonb(p) order by id) from finished_products p),(select count(*) from inventory_movements),(select count(*) from stock_transfers),(select count(*) from stock_transfer_lines),(select count(*) from finished_product_transfer_requests),(select count(*) from erp_audit_records))",
      );
    const prior = JSON.stringify(await transferSnapshot());
    for (const args of [
      [randomUUID(), workshop, floor, JSON.stringify([ids[3]]), "Skip Showroom"],
      [randomUUID(), floor, floor2, JSON.stringify([ids[0]]), "Skip parent"],
      [randomUUID(), showroom, inactive, JSON.stringify([ids[2]]), "Inactive"],
      [randomUUID(), workshop, showroom, JSON.stringify([ids[0]]), "Stale source"],
      [
        randomUUID(),
        workshop,
        showroom,
        JSON.stringify([ids[3], ids[0]]),
        "Mixed batch must rollback",
      ],
      [randomUUID(), workshop, showroom, JSON.stringify([ids[3], ids[3]]), "Duplicate"],
      [randomUUID(), workshop, showroom, JSON.stringify([randomUUID()]), "Missing piece"],
      [randomUUID(), workshop, showroom, "[]", "Empty"],
      [randomUUID(), workshop, workshop, JSON.stringify([ids[3]]), "Same location"],
      [randomUUID(), workshop, showroom, JSON.stringify([ids[3]]), " "],
    ])
      await denied(move, args, "Invalid/stale/path/quantity transfer rejected");
    const generic = "select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)";
    const stockItem = await one("select id from inventory_items where finished_product_id=$1", [
      ids[3],
    ]);
    await denied(generic, [
      randomUUID(),
      workshop,
      floor,
      JSON.stringify([{ inventory_item_id: stockItem, quantity: 1 }]),
      "Generic cannot bypass path",
    ]);
    await denied(generic, [
      randomUUID(),
      workshop,
      showroom,
      JSON.stringify([{ inventory_item_id: stockItem, quantity: 0.5 }]),
      "No fractional pieces",
    ]);
    check(
      prior === JSON.stringify(await transferSnapshot()),
      "All rejected transfers leave complete state unchanged",
    );
    await login(null);
    await db.exec(
      "create function phase13_late_failure() returns trigger language plpgsql as $$begin raise exception 'Forced final request failure';end$$;create trigger z_phase13_failure before insert on finished_product_transfer_requests for each row execute function phase13_late_failure();",
    );
    await login(users.owner);
    await denied(move, [
      randomUUID(),
      workshop,
      showroom,
      JSON.stringify(ids.slice(3, 6)),
      "Forced late failure",
    ]);
    check(
      prior === JSON.stringify(await transferSnapshot()),
      "Late failure rolls back pieces, ledger, documents, request and audit",
    );
    await login(null);
    await db.exec(
      "drop trigger z_phase13_failure on finished_product_transfer_requests;drop function phase13_late_failure()",
    );
    await login(users.owner);
    await one(move, [
      randomUUID(),
      floor,
      showroom,
      JSON.stringify([ids[0]]),
      "Explicit return through parent",
    ]);
    await one(move, [
      randomUUID(),
      showroom,
      workshop,
      JSON.stringify([ids[0]]),
      "Explicit return to Workshop",
    ]);
    check(
      (await one("select finished_product_inventory()")).find((p) => p.id === ids[0])
        .location_id === workshop,
      "Return follows same hierarchy in reverse",
    );
    check(
      (await one("select finished_product_movement_history($1)", [ids[0]])).length === 5,
      "Complete outward and return history",
    );
    check(
      costSnapshot === JSON.stringify(await one("select owner_production_costs($1)", [job])),
      "Cost versions, material evidence, allocations and SP unchanged",
    );
    check(
      identities === JSON.stringify(await genealogy()),
      "All product identities, barcodes, job genealogy and statuses unchanged",
    );
    for (const role of [
      "owner",
      "counter",
      "tailor",
      "other_tailor",
      "stock_entry",
      "ecommerce_manager",
    ]) {
      await login(users[role]);
      if (role !== "owner") {
        await denied(move, requestArgs);
        await denied("select finished_product_inventory()");
        await denied("select finished_product_movement_history()");
        check(
          await one("select count(*)=0 from finished_product_transfer_requests"),
          "Private transfer request hidden from " + role,
        );
      }
      await denied("delete from finished_product_transfer_requests");
      await denied("truncate finished_product_transfer_requests");
      await denied(
        "update finished_products set current_location_id=$1 where id=$2",
        [showroom, ids[3]],
        "Browser location writes sealed",
      );
    }
    await login(null);
    await denied("update finished_product_transfer_requests set payload='{}'");
    await denied("delete from finished_product_transfer_requests");
    await q("insert into user_roles(user_id,role_key) values($1,'owner')", [
      users.ecommerce_manager,
    ]);
    await login(users.ecommerce_manager);
    await denied(move, requestArgs, "Different Owner cannot adopt old request");
    await login(null);
    await q("update profiles set active=false where id=$1", [users.owner]);
    await login(users.owner);
    await denied(move, requestArgs);
    await denied("select finished_product_inventory()");
    await denied("select finished_product_movement_history()");
    await login(null);
    await db.exec("set role anon");
    await denied(move, requestArgs);
    await denied("select finished_product_inventory()");
    await denied("select finished_product_movement_history()");
    await denied("select * from finished_product_transfer_requests");
    await db.exec("reset role");
    console.log(
      directory +
        (demo ? " demo" : " clean") +
        ": Phase 13 inventory/path/transfer/history/security passed",
    );
  } finally {
    await db.close();
  }
}
console.log("Phase 13: " + checks + " checks passed");
