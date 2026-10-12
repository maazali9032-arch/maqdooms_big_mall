/** Validate the latest Owner-approved module contract after historical-stage tests. */
import { randomUUID } from "node:crypto";
export async function verifyModuleScope({ q, one, denied, login, users, check }) {
  await login(users.owner);
  const batch = await one(
    "select create_barcode_batch($1,'Module Provider','2026-10-13',null,$2::jsonb)",
    [randomUUID(), JSON.stringify([{ name: "Module Cotton", quantity: 2 }])],
  );
  const catalogue = (await one("select stock_registration_catalog($1)", [batch]))[0];
  const group = catalogue.fabric_types[0];
  const [v, draft] = group.variants;
  await one("select save_registered_thaan_details($1,$2,null,null,15000)", [randomUUID(), v.code]);
  await login(users.other_stock);
  check(
    (await one("select stock_registration_catalog($1)", [batch])).length === 1,
    "Stock module sees Owner-created batch without creator grant",
  );
  let scan = await one("select registered_thaan_details($1)", [v.code]);
  check(
    scan.can_complete && scan.can_set_cp && scan.cp_visible && scan.cp_paise_per_m === 15000,
    "Stock defaults expose Owner-created CP and measurements",
  );
  await one("select save_registered_thaan_details($1,$2,'White',10000,null)", [
    randomUUID(),
    v.code,
  ]);
  let row = (await one("select workshop_fabric_inventory()")).find(
    (r) => r.thaan_id === v.thaan_id,
  );
  check(
    row.can_edit && row.cp_visible && row.can_fill_cp && row.original_mm === 10000,
    "Module editing ignores creator and obsolete denied overrides",
  );
  check(
    Number(await one("select domain_stock_entry_cp($1)", [v.stock_id])) === 15000,
    "Legacy stock scanner can read completed Owner-created fabric CP",
  );
  await one("select edit_workshop_thaan($1,$2,$3,$4::jsonb,'Actual colour confirmed')", [
    randomUUID(),
    row.thaan_id,
    row.version,
    JSON.stringify({ colour: "Cream" }),
  ]);
  await one("select save_registered_thaan_details($1,$2,'Red',3000,25000)", [
    randomUUID(),
    draft.code,
  ]);
  await one("select append_registered_thans($1,$2,$3::jsonb)", [
    randomUUID(),
    group.id,
    JSON.stringify([{ length_mm: null, cp_paise_per_m: null }]),
  ]);
  await one("select register_fabric_type($1,$2,'Module Velvet',$3::jsonb)", [
    randomUUID(),
    batch,
    JSON.stringify([{ length_mm: null, cp_paise_per_m: null }]),
  ]);
  check(
    (await one("select stock_registration_catalog($1)", [batch]))[0].fabric_types.length === 2,
    "Another stock user can extend Owner batch with labels and fabric types",
  );
  const own = await one(
    "select create_barcode_batch($1,'Second Module Provider','2026-10-13',null,$2::jsonb)",
    [randomUUID(), JSON.stringify([{ name: "Second stock", quantity: 1 }])],
  );
  await login(users.stock_entry);
  check(
    (await one("select stock_registration_catalog($1)", [own])).length === 1,
    "Peer stock user's batch visible to the same module",
  );
  await login(users.owner);
  check(
    (await one("select count(*)::int from fabric_stock where id=$1 and created_by=$2", [
      v.stock_id,
      users.owner,
    ])) === 1,
    "Original record author remains Owner",
  );
  const workshop = await one("select id from locations where kind='workshop' and active");
  const showroom = await one(
    "select id from locations where kind='showroom_sublocation' and active limit 1",
  );
  const item = await one("select id from inventory_items where thaan_id=$1", [v.thaan_id]);
  if (showroom) {
    await one("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      workshop,
      showroom,
      JSON.stringify([{ inventory_item_id: item, quantity: 1000 }]),
      "Owner's module transfer",
    ]);
    await login(users.other_stock);
    const transfers = await one("select stock_transfer_history($1)", [v.stock_id]);
    check(
      transfers.some((t) => t.created_by === users.owner),
      "Stock staff see Owner-posted transfer history",
    );
  }
  await login(users.owner);
  const listing = await one(
    "insert into listings(title,slug,price_paise) values('Owner module listing',$1,10000) returning id",
    [randomUUID()],
  );
  const order = await one(
    "insert into online_orders(order_no,customer_name,listing_id) values($1,'Module customer',$2) returning id",
    [randomUUID(), listing],
  );
  await login(users.ecommerce_manager);
  check(
    (await one("select count(*)::int from listings where id=$1", [listing])) === 1,
    "E-commerce sees Owner-created listing",
  );
  check(
    (await one("update listings set title='E-commerce module update' where id=$1 returning title", [
      listing,
    ])) === "E-commerce module update",
    "E-commerce can update another actor's module record",
  );
  check(
    (await one("select count(*)::int from online_orders where id=$1", [order])) === 1,
    "E-commerce sees Owner-created online order",
  );
  await one("update online_orders set status='picking' where id=$1 returning id", [order]);
  check(
    (await one("select count(*)::int from fabric_stock_costs")) === 0,
    "E-commerce cannot retrieve fabric CP",
  );
  for (const role of ["counter", "stock_entry", "tailor", "salesperson"]) {
    await login(users[role]);
    check(
      (await one("select count(*)::int from listings where id=$1", [listing])) === 0,
      role + " cannot read E-commerce listing",
    );
    check(
      (await one("select count(*)::int from online_orders where id=$1", [order])) === 0,
      role + " cannot read E-commerce online order",
    );
    check(
      (await q("update online_orders set status='cancelled' where id=$1 returning id", [order]))
        .length === 0,
      role + " cannot alter E-commerce order",
    );
  }
  await login(users.owner);
  check(
    (await one("select title from listings where id=$1", [listing])) === "E-commerce module update",
    "Owner sees staff's module updates without extra roles",
  );
  for (const [user, permission] of [
    [users.other_stock, "ecommerce.manage_listings"],
    [users.counter, "inventory.view_registered_cp"],
    [users.ecommerce_manager, "pos.sell"],
  ]) {
    await denied("select owner_set_user_permission($1,$2,true)", [user, permission]);
  }
  await one("select owner_set_user_permission($1,'inventory.view_registered_cp',false)", [
    users.other_stock,
  ]);
  await login(users.other_stock);
  scan = await one("select registered_thaan_details($1)", [v.code]);
  check(
    scan.cp_paise_per_m === null && !scan.cp_visible && !scan.can_set_cp,
    "CP viewing/entry deny applies across all creators",
  );
  check(
    (await one("select count(*)::int from fabric_stock_costs")) === 0,
    "CP denial also enforced by raw-table RLS",
  );
  await login(users.owner);
  await one("select owner_set_user_permission($1,'inventory.view_registered_cp',null)", [
    users.other_stock,
  ]);
  await one("select owner_set_user_permission($1,'inventory.edit_thaan',false)", [
    users.other_stock,
  ]);
  await login(users.other_stock);
  row = (await one("select workshop_fabric_inventory()")).find((r) => r.thaan_id === v.thaan_id);
  check(
    !row.can_edit && row.cp_visible,
    "Editing and CP viewing remain independent module actions",
  );
  await denied("select save_registered_thaan_details($1,$2,'Blue',5000,null)", [
    randomUUID(),
    v.code,
  ]);
  await login(users.owner);
  await one("select owner_set_user_permission($1,'inventory.edit_thaan',null)", [
    users.other_stock,
  ]);
  await one("select owner_set_user_permission($1,'inventory.correct_cp',true)", [
    users.other_stock,
  ]);
  await login(users.other_stock);
  row = (await one("select workshop_fabric_inventory()")).find((r) => r.thaan_id === v.thaan_id);
  await one("select edit_workshop_thaan($1,$2,$3,$4::jsonb,'Verified module CP')", [
    randomUUID(),
    row.thaan_id,
    row.version,
    JSON.stringify({ cp_paise_per_m: 17000 }),
  ]);
  check(
    (await one("select registered_thaan_details($1)", [v.code])).cp_paise_per_m === 17000,
    "Positive CP correction follows action grant regardless of creator",
  );
  await login(users.owner);
  check(
    (await one(
      "select count(*)::int from inventory_movements where thaan_id=$1 and kind='INWARD'",
      [v.thaan_id],
    )) === 1,
    "Original measurement receipt remains unique",
  );
  const state = await one("select owner_user_permission_state($1)", [users.other_stock]);
  check(
    state.find((s) => s.key === "inventory.view_registered_cp").effective_allowed,
    "Owner permission UI reports actual module CP access",
  );
  check(
    state
      .find((s) => s.key === "inventory.edit_others_thaans")
      .restriction.startsWith("Superseded"),
    "Obsolete creator grant explicitly retired without deleting history",
  );
  await login(users.counter);
  await denied("select registered_thaan_details($1)", [v.code]);
  check(
    (await one("select count(*)::int from fabric_stock_costs")) === 0,
    "POS cannot retrieve stock CP",
  );
  await login(null);
  check(
    (await one("select created_by from fabric_stock where id=$1", [v.stock_id])) === users.owner,
    "Creator not reassigned after all module actions",
  );
  check(
    (await one("select original_mm from thaans where id=$1", [v.thaan_id])) === 10000,
    "Original measured length preserved",
  );
  check(
    (await one("select inventory_balance($1,$2)", [item, workshop])) >= 0,
    "No negative Workshop balance",
  );
}
