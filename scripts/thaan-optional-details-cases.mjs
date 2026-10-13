import { randomUUID } from "node:crypto";
export async function optionalCases({ q, one, denied, login, users, check, legacy }) {
  const edit = "select edit_workshop_thaan($1,$2,$3,$4::jsonb,$5)";
  const find = async (id) =>
    (await one("select workshop_fabric_inventory()")).find((r) => r.thaan_id === id);
  await login(users.owner);
  let row = await find(legacy.thaan_id);
  check(
    row.saved_length_mm === 9000 && row.original_mm === null && !row.incomplete,
    "Known prior length/CP no longer incomplete because colour is absent",
  );
  check(row.workshop_mm === null, "No silent backfill of prior draft into stock");
  const receipt = randomUUID(),
    args = [receipt, row.thaan_id, row.version, JSON.stringify({ length_mm: 9000 }), ""];
  await one(edit, args);
  check((await one(edit, args)) === row.thaan_id, "Blank reason exact retry returns same receipt");
  row = await find(legacy.thaan_id);
  check(
    row.original_mm === 9000 && row.workshop_mm === 9000 && row.colour === null && !row.incomplete,
    "Saved recorded length explicitly activated without colour",
  );
  check(
    (await one(
      "select count(*)::int from inventory_movements where thaan_id=$1 and kind='INWARD'",
      [row.thaan_id],
    )) === 1,
    "No duplicate first measurement",
  );
  check(
    (await one("select payload->'reason' from stock_registration_requests where request_id=$1", [
      receipt,
    ])) === null,
    "Missing user reason stored null, not invented",
  );
  const batch = await one(
    "select create_barcode_batch_with_details($1,'Optional Colour Provider','2026-10-13',null,$2::jsonb)",
    [
      randomUUID(),
      JSON.stringify([
        {
          name: "Optional Cotton",
          quantity: 2,
          rows: [
            { colour: null, length_mm: 9000, cp_paise_per_m: 40000 },
            { colour: null, length_mm: 9000, cp_paise_per_m: 0 },
          ],
        },
      ]),
    ],
  );
  const variants = (await one("select stock_registration_catalog($1)", [batch]))[0].fabric_types[0]
    .variants;
  for (const v of variants) {
    const r = await find(v.thaan_id);
    check(
      r.original_mm === 9000 && r.workshop_mm === 9000 && r.colour === null,
      "Colour-free batch row really received",
    );
  }
  check(!(await find(variants[0].thaan_id)).incomplete, "Positive length and CP complete");
  check((await find(variants[1].thaan_id)).incomplete, "Zero CP still incomplete");
  row = await find(variants[0].thaan_id);
  await one(edit, [
    randomUUID(),
    row.thaan_id,
    row.version,
    JSON.stringify({ length_mm: 8000 }),
    null,
  ]);
  row = await find(row.thaan_id);
  check(
    row.original_mm === 9000 && row.workshop_mm === 8000,
    "Optional reason corrections preserve original length",
  );
  check(
    (
      await one(
        "select reason from inventory_movements where thaan_id=$1 and kind='ADJUSTMENT' order by occurred_at desc limit 1",
        [row.thaan_id],
      )
    ).includes("user reason not recorded"),
    "Required movement description explicitly records absent user reason",
  );
  await one(edit, [
    randomUUID(),
    row.thaan_id,
    row.version,
    JSON.stringify({ cp_paise_per_m: 45000 }),
    "",
  ]);
  row = await find(row.thaan_id);
  check(row.cp_paise_per_m === 45000, "Owner CP correction without reason");
  check(
    (await one(
      "select reason from fabric_stock_costs where fabric_stock_id=$1 order by revision desc limit 1",
      [row.stock_id],
    )) === null,
    "CP reason absent is null",
  );
  check(
    (await one("select count(*)::int from fabric_stock_costs where fabric_stock_id=$1", [
      row.stock_id,
    ])) === 2,
    "CP revisions retained",
  );
  await denied(edit, [randomUUID(), row.thaan_id, "stale", JSON.stringify({ colour: "Blue" }), ""]);
  await denied(edit, [
    randomUUID(),
    row.thaan_id,
    row.version,
    JSON.stringify({ length_mm: -1 }),
    "",
  ]);
  await denied(edit, [
    randomUUID(),
    row.thaan_id,
    row.version,
    JSON.stringify({ cp_paise_per_m: -1 }),
    "",
  ]);
  await denied(edit, [
    randomUUID(),
    row.thaan_id,
    row.version,
    JSON.stringify({ sp_paise_per_m: 100 }),
    "",
  ]);
  await login(null);
  const staff = randomUUID();
  await q("insert into auth.users values($1,$2)", [staff, "optional-" + staff + "@test.invalid"]);
  await q("insert into profiles(id,full_name)values($1,'Optional Staff')", [staff]);
  await q("insert into user_roles(user_id,role_key)values($1,'stock_entry')", [staff]);
  await login(staff);
  row = await find(variants[1].thaan_id);
  await one(edit, [
    randomUUID(),
    row.thaan_id,
    row.version,
    JSON.stringify({ cp_paise_per_m: 30000 }),
    "",
  ]);
  row = await find(row.thaan_id);
  check(
    !row.incomplete && row.cp_paise_per_m === 30000 && row.colour === null,
    "Stock staff fills zero CP without required colour/reason",
  );
  await one(edit, [
    randomUUID(),
    row.thaan_id,
    row.version,
    JSON.stringify({ colour: "Navy" }),
    "",
  ]);
  row = await find(row.thaan_id);
  check(row.colour === "Navy", "Optional colour can be recorded later without reason");
  await denied(edit, [
    randomUUID(),
    row.thaan_id,
    row.version,
    JSON.stringify({ cp_paise_per_m: 35000 }),
    "",
  ]);
  await denied(edit, [
    randomUUID(),
    row.thaan_id,
    row.version,
    JSON.stringify({ length_mm: 7000 }),
    "",
  ]);
  const sparse = await one(
    "select create_barcode_batch_with_details($1,'Unknown Values Provider','2026-10-13',null,$2::jsonb)",
    [
      randomUUID(),
      JSON.stringify([
        {
          name: "Unknown Cotton",
          quantity: 2,
          rows: [
            { colour: null, length_mm: null, cp_paise_per_m: 10000 },
            { colour: null, length_mm: 5000, cp_paise_per_m: null },
          ],
        },
      ]),
    ],
  );
  const drafts = (await one("select stock_registration_catalog($1)", [sparse]))[0].fabric_types[0]
    .variants;
  check(
    (await find(drafts[0].thaan_id)).original_mm === null,
    "CP-only row does not invent stock length",
  );
  check(
    (await find(drafts[1].thaan_id)).original_mm === 5000 &&
      (await find(drafts[1].thaan_id)).incomplete,
    "Missing CP incomplete, positive measurement still available",
  );
  const req = randomUUID();
  await one("select complete_barcode_thaan($1,$2,null,5000,null)", [req, drafts[1].code]);
  check(
    (await one(
      "select count(*)::int from inventory_movements where thaan_id=$1 and kind='INWARD'",
      [drafts[1].thaan_id],
    )) === 1,
    "Completion retry does not duplicate stock",
  );
  for (const role of ["counter", "tailor", "ecommerce_manager", "salesperson"]) {
    await login(users[role]);
    await denied(edit, [
      randomUUID(),
      row.thaan_id,
      row.version,
      JSON.stringify({ colour: "Other" }),
      "",
    ]);
    await denied("select complete_barcode_thaan($1,$2,null,5000,null)", [
      randomUUID(),
      drafts[1].code,
    ]);
  }
  await login(null);
  await q(
    "insert into user_permission_overrides(user_id,permission_key,granted)values($1,'inventory.edit_thaan',false) on conflict(user_id,permission_key) do update set granted=false",
    [staff],
  );
  await login(staff);
  await denied(edit, [
    randomUUID(),
    row.thaan_id,
    row.version,
    JSON.stringify({ colour: "Denied" }),
    "",
  ]);
  await login(null);
  check(
    (await one("select created_by from fabric_stock where id=$1", [variants[0].stock_id])) ===
      users.owner,
    "Creator metadata remains unchanged",
  );
  check(
    (await one("select original_mm from thaans where id=$1", [variants[0].thaan_id])) === 9000,
    "Original quantity preserved after revisions",
  );
  check(
    !(await one(
      "select has_function_privilege('anon','edit_workshop_thaan(uuid,uuid,text,jsonb,text)','execute')",
    )),
    "Anonymous edit denied",
  );
}
