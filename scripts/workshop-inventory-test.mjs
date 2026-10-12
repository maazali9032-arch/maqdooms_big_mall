/** Full disposable PostgreSQL replay and populated feature/security integration. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { verifyDelegation } from "./delegated-thaan-cases.mjs";
import { verifyModuleScope } from "./module-role-scope-cases.mjs";
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
          `select to_jsonb(t)-'colour'-'details_recorded_at'-'label_position'-'draft_details' data from public."${row.name}" t order by (to_jsonb(t)-'colour'-'details_recorded_at'-'label_position'-'draft_details')::text`,
        );
      return JSON.stringify(result);
    };
    for (const file of (await fs.readdir(directory))
      .filter((file) => file.endsWith(".sql") && !file.includes("_live_"))
      .sort()) {
      if (!demo && file.includes("demo_seed")) continue;
      if (file.includes("_module_role_scope")) continue; // Verify prior approved contract before the new revision.
      if (file.includes("_labels_first_stock_entry")) {
        oldTables = await q(
          "select tablename name from pg_tables where schemaname='public' and tablename not in ('roles','permissions','role_permissions','erp_audit_records') order by tablename",
        );
        before = await snapshot();
      }
      await db.exec(await fs.readFile(resolve(directory, file), "utf8"));
    }

    check(before === (await snapshot()), "All pre-existing business rows preserved");

    const users = {};
    for (const role of [
      "owner",
      "stock_entry",
      "other_stock",
      "counter",
      "tailor",
      "salesperson",
      "ecommerce_manager",
    ]) {
      const id = (users[role] = randomUUID());
      await q("insert into auth.users values($1,$2)", [id, role + "@labels.test"]);
      await q("insert into profiles(id,full_name)values($1,$2)", [id, role]);
      await q("insert into user_roles(user_id,role_key)values($1,$2)", [
        id,
        role === "other_stock" ? "stock_entry" : role,
      ]);
    }
    const create = "select create_barcode_batch($1,$2,$3::date,$4,$5::jsonb)";
    await login(users.stock_entry);
    const req = randomUUID(),
      groups = JSON.stringify([
        { name: "Velvet", quantity: 3 },
        { name: "Cotton", quantity: 2 },
      ]);
    const batch = await one(create, [
      req,
      "Raymonds",
      "2026-10-12",
      "Truck actual arrival",
      groups,
    ]);
    check(
      (await one(create, [req, "Raymonds", "2026-10-12", "Truck actual arrival", groups])) ===
        batch,
      "Exact retry creates no second batch",
    );
    await denied(create, [req, "Raymonds", "2026-10-12", "Changed", groups]);
    const catalog = (await one("select stock_registration_catalog($1)", [batch]))[0];
    check(
      catalog.arrival_date === "2026-10-12" && catalog.remarks === "Truck actual arrival",
      "Arrival date and remarks persisted",
    );
    check(
      catalog.fabric_types.map((g) => g.name).join(",") === "Velvet,Cotton",
      "Fabric print sequence matches entered rows",
    );
    check(
      catalog.fabric_types[0].variants.length === 3 &&
        catalog.fabric_types[1].variants.length === 2,
      "Counts create correct grouped labels",
    );
    const variants = catalog.fabric_types.flatMap((g) => g.variants),
      v = variants[0];
    check(new Set(variants.map((v) => v.code)).size === 5, "All physical identities unique");
    check(
      variants.every(
        (v) => v.original_mm === null && v.available_mm === null && v.status === "draft",
      ),
      "Unmeasured stock stays unknown, not fabricated length",
    );
    check(
      variants[0].code.endsWith("a") &&
        variants[1].code.endsWith("b") &&
        variants[2].code.endsWith("c"),
      "Fixed auto-increasing suffixes",
    );
    await login(users.counter);
    check(
      (await one("select direct_fabric_sale_catalog($1)", [v.code])).length === 0,
      "Pending barcode cannot be sold",
    );
    await login(users.stock_entry);
    let detail = await one("select registered_thaan_details($1)", [v.code]);
    check(
      detail.measured === false && detail.available_mm === null && detail.cp_missing,
      "Scan shows genuine pending details",
    );
    check(
      detail.can_complete && detail.supplier === "Raymonds" && detail.fabric_type === "Velvet",
      "Owned stock identification and edit rights",
    );
    await login(users.owner);
    check(
      (await one("select count(*)::int from inventory_items where thaan_id=any($1::uuid[])", [
        variants.map((v) => v.thaan_id),
      ])) === 0,
      "No inventory authority before actual measurement",
    );
    check(
      (await one("select count(*)::int from inventory_movements where thaan_id=any($1::uuid[])", [
        variants.map((v) => v.thaan_id),
      ])) === 0,
      "Label generation posts no stock receipt",
    );
    await denied("update thaans set original_mm=1000,status='active' where id=$1", [v.thaan_id]);
    await denied("update thaans set status='active' where id=$1", [v.thaan_id]);
    await login(users.stock_entry);
    const measurement = randomUUID(),
      complete = "select complete_barcode_thaan($1,$2,$3,$4,$5)";
    const th = await one(complete, [measurement, v.code, "Maroon", 12500, 12345]);
    check(th === v.thaan_id, "Same physical Than ID completed");
    check(
      (await one(complete, [measurement, v.code, "Maroon", 12500, 12345])) === th,
      "Exact detail retry returns same result",
    );
    detail = await one("select registered_thaan_details($1)", [v.code]);
    check(
      detail.measured &&
        detail.original_mm === 12500 &&
        Number(detail.available_mm) === 12500 &&
        detail.colour === "Maroon",
      "Actual measurement and colour recorded",
    );
    check(
      detail.cp_visible && Number(detail.cp_paise_per_m) === 12345,
      "Authorized staff sees its own CP",
    );
    check(
      detail.locations.length === 1 && detail.locations[0].name === "Workshop",
      "Actual stock received into Workshop",
    );
    await denied(complete, [measurement, v.code, "Maroon", 12501, 12345]);
    await denied(complete, [randomUUID(), v.code, "Maroon", 12501, 12345]);
    await denied(complete, [randomUUID(), v.code, "Blue", 12500, 12345]);
    await denied(complete, [randomUUID(), v.code, "Maroon", 12500, 12346]);
    await one(complete, [randomUUID(), v.code, "Maroon", 12500, 12345]);
    await login(users.owner);
    check(
      (await one(
        "select count(*)::int from inventory_movements where thaan_id=$1 and kind='INWARD'",
        [th],
      )) === 1,
      "No repeated stock receipt even with a fresh matching request",
    );
    const item = await one("select id from inventory_items where thaan_id=$1", [th]);
    const floor = await one("select manage_showroom_location(null,'LABEL-F','Label Floor',true)");
    const workshop = await one("select id from locations where kind='workshop'");
    await login(users.stock_entry);
    await one("select post_inventory_transfer($1,$2,$3,$4::jsonb,'Measured stock transfer')", [
      randomUUID(),
      workshop,
      floor,
      JSON.stringify([{ inventory_item_id: item, quantity: 2500 }]),
    ]);
    detail = await one("select registered_thaan_details($1)", [v.code]);
    check(
      Number(detail.available_mm) === 12500 && detail.locations.length === 2,
      "Same barcode tracks divided stock across locations",
    );
    check(
      Number(detail.locations.find((l) => l.id === workshop).quantity_mm) === 10000 &&
        Number(detail.locations.find((l) => l.id === floor).quantity_mm) === 2500,
      "Exact source and floor balances",
    );
    await login(users.other_stock);
    const foreign = await one("select registered_thaan_details($1)", [v.code]);
    check(
      foreign &&
        foreign.can_complete === false &&
        foreign.cp_visible === false &&
        foreign.cp_paise_per_m === null,
      "Other staff can scan identification/stock without CP or edit rights",
    );
    await denied(complete, [randomUUID(), variants[1].code, "Green", 5000, null]);
    await login(users.stock_entry);
    await one(complete, [randomUUID(), variants[1].code, "Green", 5000, null]);
    check(
      (await one("select registered_thaan_details($1)", [variants[1].code])).cp_missing,
      "CP may be left unknown after actual length",
    );
    await one("select fill_registered_thaan_cp($1,$2,$3)", [randomUUID(), variants[1].code, 2200]);
    check(
      Number(
        (await one("select registered_thaan_details($1)", [variants[1].code])).cp_paise_per_m,
      ) === 2200,
      "Existing delayed missing-CP flow retained",
    );
    const again = await one(create, [
      randomUUID(),
      "Raymonds",
      "2026-10-12",
      null,
      JSON.stringify([{ name: "Velvet", quantity: 1 }]),
    ]);
    check(again !== batch, "Same supplier later delivery has different batch");
    const extendedBatch = await one(create, [
      randomUUID(),
      "Raymonds",
      "2026-10-12",
      null,
      JSON.stringify([{ name: "Extended fabric", quantity: 28 }]),
    ]);
    const extendedVariants = (
      await one("select stock_registration_catalog($1)", [extendedBatch])
    )[0].fabric_types[0].variants;
    check(
      extendedVariants.length === 28 &&
        extendedVariants[25].code.endsWith("z") &&
        extendedVariants[26].code.endsWith("aa") &&
        extendedVariants[27].code.endsWith("ab"),
      "Labels-first generation preserves z -> aa -> ab suffix sequence",
    );
    const appended = JSON.stringify([{ length_mm: null, cp_paise_per_m: null }]);
    await one("select append_registered_thans($1,$2,$3::jsonb)", [
      randomUUID(),
      catalog.fabric_types[0].id,
      appended,
    ]);
    const extended = (await one("select stock_registration_catalog($1)", [batch]))[0];
    check(
      extended.fabric_types[0].variants.length === 4 &&
        extended.fabric_types[0].variants[3].code.endsWith("d"),
      "Appending continues original fabric suffix",
    );
    for (const quantity of [0, -1, 1.5, 501, null])
      await denied(create, [
        randomUUID(),
        "Raymonds",
        "2026-10-12",
        null,
        JSON.stringify([{ name: "Invalid", quantity }]),
      ]);
    await denied(create, [randomUUID(), "Raymonds", null, null, groups]);
    await denied(create, [
      randomUUID(),
      "Raymonds",
      "2026-10-12",
      null,
      JSON.stringify([
        { name: "Cotton", quantity: 1 },
        { name: " cotton ", quantity: 1 },
      ]),
    ]);
    for (const args of [
      [randomUUID(), variants[2].code, "", 1000, null],
      [randomUUID(), variants[2].code, "White", 0, null],
      [randomUUID(), variants[2].code, "White", 1000, -1],
    ])
      await denied(complete, args);
    await login(users.owner);
    await one("select owner_set_user_permission($1,'stock.generate_labels',false)", [
      users.stock_entry,
    ]);
    await login(users.stock_entry);
    await denied(create, [randomUUID(), "Raymonds", "2026-10-12", null, groups]);
    await denied("select append_registered_thans($1,$2,$3::jsonb)", [
      randomUUID(),
      catalog.fabric_types[0].id,
      appended,
    ]);
    await login(users.owner);
    await one("select owner_set_user_permission($1,'stock.generate_labels',null)", [
      users.stock_entry,
    ]);
    await one("select owner_set_user_permission($1,'stock.measure_thaan',false)", [
      users.stock_entry,
    ]);
    await login(users.stock_entry);
    check(
      (await one("select registered_thaan_details($1)", [variants[2].code])).can_complete === false,
      "Owner measurement denial removes edit rights",
    );
    await denied(complete, [randomUUID(), variants[2].code, "White", 1000, null]);
    await login(users.owner);
    await one("select owner_set_user_permission($1,'stock.measure_thaan',null)", [
      users.stock_entry,
    ]);
    await one("select owner_set_user_permission($1,'inventory.view_registered_cp',false)", [
      users.stock_entry,
    ]);
    await login(users.stock_entry);
    check(
      (await one("select registered_thaan_details($1)", [v.code])).cp_paise_per_m === null,
      "Individual CP view denial enforced",
    );
    await login(users.owner);
    await one("select owner_set_user_permission($1,'inventory.receive',false)", [
      users.stock_entry,
    ]);
    await login(users.stock_entry);
    await denied("select registered_thaan_details($1)", [v.code]);
    await denied(create, [randomUUID(), "Raymonds", "2026-10-12", null, groups]);
    for (const user of [users.counter, users.tailor, users.salesperson, users.ecommerce_manager]) {
      await login(user);
      await denied("select registered_thaan_details($1)", [v.code]);
      await denied(create, [randomUUID(), "Raymonds", "2026-10-12", null, groups]);
      await denied(complete, [randomUUID(), variants[2].code, "White", 1000, null]);
    }
    await login(users.owner);
    await one("select owner_set_user_permission($1,'inventory.receive',null)", [users.stock_entry]);
    await one("select owner_set_user_permission($1,'inventory.view_registered_cp',null)", [
      users.stock_entry,
    ]);
    await login(users.stock_entry);
    const detailed = "select create_barcode_batch_with_details($1,$2,$3,$4,$5::jsonb)";
    const save = "select save_registered_thaan_details($1,$2,$3,$4,$5)";
    const detailedRows = [
      {
        name: "Optional Velvet",
        quantity: 5,
        rows: [
          { colour: "Blue", length_mm: 12000, cp_paise_per_m: 15000 },
          { colour: "Red", length_mm: null, cp_paise_per_m: null },
          { colour: null, length_mm: 7000, cp_paise_per_m: null },
          { colour: null, length_mm: null, cp_paise_per_m: 12000 },
          {},
        ],
      },
    ];
    const detailedRequest = randomUUID();
    const detailedBatch = await one(detailed, [
      detailedRequest,
      "Raymonds",
      "2026-10-12",
      "Optional details",
      detailedRows,
    ]);
    check(
      (await one(detailed, [
        detailedRequest,
        "Raymonds",
        "2026-10-12",
        "Optional details",
        detailedRows,
      ])) === detailedBatch,
      "Detailed batch exact retry",
    );
    const detailedCatalog = (
      await one("select stock_registration_catalog($1)", [detailedBatch])
    )[0];
    const dv = detailedCatalog.fabric_types[0].variants;
    const get = (code) => one("select registered_thaan_details($1)", [code]);
    let d = await get(dv[0].code);
    check(
      d.measured && d.available_mm === 12000 && d.colour === "Blue" && d.cp_paise_per_m === 15000,
      "Complete creation details activate exact actual stock",
    );
    d = await get(dv[1].code);
    check(
      !d.measured && d.colour === "Red" && d.available_mm === null,
      "Colour-only retained without stock",
    );
    d = await get(dv[2].code);
    check(
      !d.measured &&
        d.saved_length_mm === 7000 &&
        d.original_mm === null &&
        d.available_mm === null,
      "Length-only retained without receipt",
    );
    d = await get(dv[3].code);
    check(
      !d.measured && d.cp_paise_per_m === 12000 && d.available_mm === null && !d.cp_missing,
      "CP-only retained privately",
    );
    await denied("select fill_registered_thaan_cp($1,$2,$3)", [randomUUID(), dv[3].code, 13000]);
    await denied(complete, [randomUUID(), dv[3].code, "Cream", 5000, 13000]);
    await login(users.other_stock);
    check(
      (await get(dv[3].code)).cp_paise_per_m === null,
      "Unmeasured draft CP hidden from foreign staff",
    );
    await denied(save, [randomUUID(), dv[3].code, "Cream", 5000, null]);
    await login(users.stock_entry);

    const beforeBadVariants = await one(
      "select count(*) from jsonb_array_elements(stock_registration_catalog())",
    );
    await denied(detailed, [
      randomUUID(),
      "Raymonds",
      "2026-10-12",
      null,
      [
        {
          name: "Atomic invalid",
          quantity: 2,
          rows: [{ colour: "Blue", length_mm: 1000 }, { cp_paise_per_m: -1 }],
        },
      ],
    ]);
    check(
      (await one("select count(*) from jsonb_array_elements(stock_registration_catalog())")) ===
        beforeBadVariants,
      "Invalid later detail rolls back entire batch",
    );
    d = await get(dv[4].code);
    check(
      !d.measured && d.colour === null && d.saved_length_mm === null && d.cp_missing,
      "Unopened row remains blank",
    );
    const partialRequest = randomUUID();
    await one(save, [partialRequest, dv[4].code, "Green", null, null]);
    await one(save, [partialRequest, dv[4].code, "Green", null, null]);
    check(
      (await get(dv[4].code)).colour === "Green" && !(await get(dv[4].code)).measured,
      "Independent partial scan persists and retries",
    );
    await denied(save, [partialRequest, dv[4].code, "Black", null, null]);
    await denied(save, [randomUUID(), dv[1].code, "Black", null, null]);
    await denied(complete, [randomUUID(), dv[2].code, "Blue", 8000, null]);
    await one(save, [randomUUID(), dv[1].code, null, 6000, null]);
    check((await get(dv[1].code)).available_mm === 6000, "Missing length activates saved colour");
    await one(save, [randomUUID(), dv[2].code, "White", null, null]);
    check((await get(dv[2].code)).available_mm === 7000, "Missing colour activates saved length");
    await one(save, [randomUUID(), dv[3].code, "Cream", 5000, null]);
    check(
      (await get(dv[3].code)).cp_paise_per_m === 12000 &&
        (await get(dv[3].code)).available_mm === 5000,
      "Prior CP carried into first receipt",
    );
    await one(save, [randomUUID(), dv[4].code, null, 4000, null]);
    await one(save, [randomUUID(), dv[4].code, null, 4000, null]);
    check(
      Number(
        await one("select count(*) from inventory_movements where thaan_id=$1 and kind='INWARD'", [
          dv[4].thaan_id,
        ]),
      ) === 1,
      "Fresh partial completion never duplicates receipt",
    );
    await denied(detailed, [
      randomUUID(),
      "Raymonds",
      "2026-10-12",
      null,
      [{ name: "Bad", quantity: 2, rows: [{}] }],
    ]);
    await denied(detailed, [
      randomUUID(),
      "Raymonds",
      "2026-10-12",
      null,
      [{ name: "Bad", quantity: 1, rows: [{ length_mm: -1 }] }],
    ]);
    await denied(save, [randomUUID(), dv[4].code, null, null, null]);
    await denied("select fill_registered_thaan_cp($1,$2,$3)", [randomUUID(), dv[3].code, 13000]);
    await denied(complete, [randomUUID(), dv[3].code, "Cream", 5000, 13000]);
    await login(users.other_stock);
    check(
      (await get(dv[3].code)).cp_paise_per_m === null,
      "Foreign staff cannot see draft or actual CP",
    );
    await denied(save, [randomUUID(), dv[4].code, null, null, 9000]);
    await login(users.owner);
    await one("select owner_set_user_permission($1,'stock.measure_thaan',false)", [
      users.stock_entry,
    ]);
    await login(users.stock_entry);
    await denied(detailed, [randomUUID(), "Raymonds", "2026-10-12", null, detailedRows]);
    await denied(save, [randomUUID(), dv[4].code, null, null, 9000]);
    // Count-only creation remains permitted without measurement action.
    check(
      Boolean(
        await one(detailed, [
          randomUUID(),
          "Raymonds",
          "2026-10-12",
          null,
          [{ name: "Blank permitted", quantity: 1, rows: [{}] }],
        ]),
      ),
      "No measurements required for blank identity generation",
    );
    await login(users.counter);
    await denied(save, [randomUUID(), dv[4].code, "Black", null, null]);
    await denied(detailed, [randomUUID(), "Raymonds", "2026-10-12", null, detailedRows]);
    await login(users.owner);
    await one("select owner_set_user_permission($1,'stock.measure_thaan',null)", [
      users.stock_entry,
    ]);
    await login(users.stock_entry);
    const rows = await one("select workshop_fabric_inventory()");
    check(
      rows.some((r) => r.thaan_id === dv[0].thaan_id),
      "Workshop hierarchy includes registered Thaans",
    );
    check(
      rows.find((r) => r.thaan_id === dv[4].thaan_id).incomplete,
      "Missing CP marks row incomplete",
    );
    check(
      rows.every((r) => !("sp_paise_per_m" in r)),
      "No SP in inventory response",
    );
    const zeroBatch = await one(detailed, [
      randomUUID(),
      "Arvind",
      "2026-10-13",
      null,
      [
        {
          name: "Zero CP",
          quantity: 1,
          rows: [{ colour: "Blue", length_mm: 10000, cp_paise_per_m: 0 }],
        },
      ],
    ]);
    let row = (await one("select workshop_fabric_inventory()")).find(
      (r) => r.batch_id === zeroBatch,
    );
    check(row.incomplete && row.cp_paise_per_m === 0, "Zero CP is incomplete");
    const edit = "select edit_workshop_thaan($1,$2,$3,$4::jsonb,$5)";
    const request = randomUUID();
    await one(edit, [
      request,
      row.thaan_id,
      row.version,
      { cp_paise_per_m: 10000 },
      "Actual purchase cost",
    ]);
    await one(edit, [
      request,
      row.thaan_id,
      row.version,
      { cp_paise_per_m: 10000 },
      "Actual purchase cost",
    ]);
    let fresh = (await one("select workshop_fabric_inventory()")).find(
      (r) => r.thaan_id === row.thaan_id,
    );
    check(
      !fresh.incomplete && fresh.cp_paise_per_m === 10000,
      "Zero CP corrected with version history",
    );
    await login(users.owner);
    check(
      Number(
        await one("select count(*) from fabric_stock_costs where fabric_stock_id=$1", [
          row.stock_id,
        ]),
      ) === 2,
      "Old zero cost preserved, no duplicate cost on retry",
    );
    await login(users.stock_entry);
    await denied(edit, [randomUUID(), row.thaan_id, row.version, { colour: "Black" }, "Stale"]);
    await denied(edit, [
      randomUUID(),
      fresh.thaan_id,
      fresh.version,
      { cp_paise_per_m: 15000 },
      "Denied positive CP correction",
    ]);
    await denied(edit, [
      randomUUID(),
      fresh.thaan_id,
      fresh.version,
      { length_mm: 8000 },
      "Denied stock correction",
    ]);
    await one(edit, [
      randomUUID(),
      fresh.thaan_id,
      fresh.version,
      { name: "Blue Thaan", type_name: "Cotton revised", colour: "Navy" },
      "Correct descriptions",
    ]);
    fresh = (await one("select workshop_fabric_inventory()")).find(
      (r) => r.thaan_id === row.thaan_id,
    );
    check(
      fresh.name === "Blue Thaan" &&
        fresh.type_name === "Cotton revised" &&
        fresh.colour === "Navy" &&
        fresh.barcode === row.barcode,
      "Metadata edit retains permanent barcode and grouping IDs",
    );
    await login(users.owner);
    await one("select owner_set_user_permission($1,'inventory.correct_cp',true)", [
      users.stock_entry,
    ]);
    await one("select owner_set_user_permission($1,'inventory.correct_workshop',true)", [
      users.stock_entry,
    ]);
    await login(users.stock_entry);
    const correction = randomUUID();
    await one(edit, [
      correction,
      fresh.thaan_id,
      fresh.version,
      { length_mm: 8000, cp_paise_per_m: 15000 },
      "Measured Workshop remainder",
    ]);
    await one(edit, [
      correction,
      fresh.thaan_id,
      fresh.version,
      { length_mm: 8000, cp_paise_per_m: 15000 },
      "Measured Workshop remainder",
    ]);
    fresh = (await one("select workshop_fabric_inventory()")).find(
      (r) => r.thaan_id === row.thaan_id,
    );
    check(
      fresh.workshop_mm === 8000 && fresh.original_mm === 10000,
      "Workshop correction preserves original received length",
    );
    await login(users.owner);
    check(
      Number(
        await one(
          "select count(*) from inventory_movements where thaan_id=$1 and kind='ADJUSTMENT'",
          [fresh.thaan_id],
        ),
      ) === 1,
      "Adjustment retry creates one appended movement",
    );
    await login(users.stock_entry);
    check(fresh.cp_paise_per_m === 15000, "Owner-granted positive CP correction");
    await denied(edit, [
      randomUUID(),
      fresh.thaan_id,
      fresh.version,
      { barcode: "OTHER" },
      "Invalid key",
    ]);
    await denied(edit, [
      randomUUID(),
      fresh.thaan_id,
      fresh.version,
      { length_mm: -1 },
      "Invalid length",
    ]);
    await denied(edit, [randomUUID(), fresh.thaan_id, fresh.version, { colour: "Red" }, ""]);
    await login(users.other_stock);
    const foreignInventory = (await one("select workshop_fabric_inventory()")).find(
      (r) => r.thaan_id === fresh.thaan_id,
    );
    check(
      foreignInventory.cp_paise_per_m === null &&
        !foreignInventory.cp_visible &&
        !foreignInventory.can_edit,
      "Foreign staff CP/edit isolation",
    );
    await denied(edit, [randomUUID(), fresh.thaan_id, fresh.version, { colour: "Red" }, "Foreign"]);
    await login(users.owner);
    const owned = (await one("select workshop_fabric_inventory()")).find(
      (r) => r.thaan_id === fresh.thaan_id,
    );
    check(owned.cp_visible && owned.cp_paise_per_m === 15000, "Owner can read all CP");
    await login(users.counter);
    await denied("select workshop_fabric_inventory()");
    await denied(edit, [randomUUID(), fresh.thaan_id, fresh.version, { colour: "Red" }, "Counter"]);
    await login(null);
    await db.exec("set role anon");
    await denied("select registered_thaan_details($1)", [v.code]);
    await denied(create, [randomUUID(), "Raymonds", "2026-10-12", null, groups]);
    await db.exec("reset role");
    check(
      !(await one(
        "select has_table_privilege('authenticated','stock_registration_variants','UPDATE')",
      )),
      "No raw variant writes",
    );
    await verifyDelegation({ q, one, denied, login, users, check });
    const scopeFile = (await fs.readdir(directory)).find((f) =>
      f.endsWith("_module_role_scope.sql"),
    );
    await db.exec(await fs.readFile(resolve(directory, scopeFile), "utf8"));
    await verifyModuleScope({ db, q, one, denied, login, users, check });
    console.log(
      directory + " " + (demo ? "demo" : "clean") + ": Labels-first Stock Entry verified",
    );
  } finally {
    await db.close();
  }
}
await fs.writeFile(
  "docs/MODULE_ROLE_SCOPE_DATABASE_VERIFICATION.json",
  JSON.stringify({ verified_at: new Date().toISOString(), checks, passed: true }, null, 2),
);
console.log(`PASS: ${checks} cumulative optional-detail Stock Entry checks`);
