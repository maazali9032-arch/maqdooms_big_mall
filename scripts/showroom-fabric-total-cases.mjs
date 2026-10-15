import { randomUUID } from "node:crypto";

export async function showroomFabricTotalCases({
  db,
  q,
  one,
  denied,
  login,
  users,
  check,
  migration,
}) {
  await login(null);
  const before = JSON.stringify(
    await q("select to_jsonb(t) row from public.inventory_items t order by to_jsonb(t)::text"),
  );
  await db.exec(migration);
  check(
    before ===
      JSON.stringify(
        await q("select to_jsonb(t) row from public.inventory_items t order by to_jsonb(t)::text"),
      ),
    "Showroom total migration preserves inventory rows",
  );
  await login(users.owner);
  const batch = await one(
    "select create_barcode_batch_with_details($1,'Showroom Card Provider','2026-10-15',null,$2::jsonb)",
    [
      randomUUID(),
      JSON.stringify([
        {
          name: "Showroom total fabric",
          quantity: 1,
          rows: [{ length_mm: 12000, cp_paise_per_m: 10000 }],
        },
      ]),
    ],
  );
  const variant = (await one("select stock_registration_catalog($1)", [batch]))[0].fabric_types[0]
    .variants[0];
  await login(null);
  const item = await one("select id from inventory_items where thaan_id=$1", [variant.thaan_id]);
  const workshop = await one("select id from locations where kind='workshop'");
  await login(users.owner);
  const existingTotal = Number(await one("select showroom_fabric_available_total()"));
  const floor = await one("select manage_showroom_location(null,$1,'Showroom Card Floor',true)", [
    "CARD-" + randomUUID(),
  ]);
  await one("select post_inventory_transfer($1,$2,$3,$4::jsonb,null)", [
    randomUUID(),
    workshop,
    floor,
    JSON.stringify([{ inventory_item_id: item, quantity: 5000 }]),
  ]);
  check(
    Number(await one("select showroom_fabric_available_total()")) === existingTotal + 5000,
    "Showroom card counts fabric at active physical floors only",
  );
  await login(users.stock_entry);
  check(
    Number(await one("select showroom_fabric_available_total()")) === existingTotal + 5000,
    "Stock Entry can view Showroom available total",
  );
  for (const role of ["counter", "production", "tailor", "salesperson", "ecommerce_manager"]) {
    await login(users[role]);
    await denied("select showroom_fabric_available_total()");
  }
  await login(null);
  await q("set role anon");
  await denied("select showroom_fabric_available_total()");
  await login(null);
}
