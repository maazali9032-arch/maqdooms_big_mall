import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
export async function ecommerceShowroomCases(db, fixture) {
  const q = async (s, a = []) => (await db.query(s, a)).rows;
  const one = async (s, a = []) => Object.values((await q(s, a))[0])[0];
  assert.equal(
    await fs.readFile("supabase/migrations/20261021000200_ecommerce_showroom_scanning.sql", "utf8"),
    await fs.readFile("drizzle/migrations/0074_ecommerce_showroom_scanning.sql", "utf8"),
  );
  await db.exec("reset role");
  await one("select set_config('request.jwt.claim.sub',$1,false)", [fixture.owner]);
  assert.equal(Number(await one("select count(*) from listings where archived_at is not null")), 4);
  assert.equal(
    Number(await one("select count(*) from listings where archived_at is not null and published")),
    0,
  );
  assert.equal(
    Number(
      await one(
        "select count(*) from online_orders where order_no in ('ON-2041','ON-2042','ON-2043')",
      ),
    ),
    3,
    "Historical demo orders are preserved",
  );
  const floors = [];
  for (const n of [1, 2, 3])
    floors.push(
      await one("select manage_showroom_location(null,$1,$2,true)", [
        "EC" + randomUUID(),
        "Ecommerce floor " + n,
      ]),
    );
  const workshop = await one("select id from locations where kind='workshop'");
  const batch = await one(
    "select create_barcode_batch_with_details($1,'Ecommerce test',current_date,null,$2::jsonb)",
    [
      randomUUID(),
      JSON.stringify([
        {
          name: "Scan cotton",
          quantity: 4,
          rows: Array.from({ length: 4 }, () => ({ length_mm: 10000, cp_paise_per_m: 20000 })),
        },
      ]),
    ],
  );
  const variants = (await one("select stock_registration_catalog($1)", [batch]))[0].fabric_types[0]
    .variants;
  for (let n = 0; n < 3; n++) {
    const inv = await one("select id from inventory_items where thaan_id=$1", [
      variants[n].thaan_id,
    ]);
    await one("select post_inventory_transfer($1,$2,$3,$4::jsonb,null)", [
      randomUUID(),
      workshop,
      floors[n],
      JSON.stringify([{ inventory_item_id: inv, quantity: 5000 }]),
    ]);
  }
  const [piece] = await q(
    "select p.id,b.code,p.current_location_id from finished_products p join barcodes b on b.id=p.barcode_id join finished_product_prices price on price.finished_product_id=p.id where p.status='available' and p.current_location_id=$1 order by p.id limit 1",
    [workshop],
  );
  assert(piece, "Priced workshop fixture required");
  await one("select transfer_finished_products($1,$2,$3,$4::jsonb,null)", [
    randomUUID(),
    workshop,
    floors[2],
    JSON.stringify([piece.id]),
  ]);
  const ecom = randomUUID();
  await q("insert into auth.users(id,email) values($1,$2)", [ecom, ecom + "@ecom.test"]);
  await q("insert into profiles(id,full_name) values($1,'Ecom staff')", [ecom]);
  await q("insert into user_roles(user_id,role_key) values($1,'ecommerce_manager')", [ecom]);
  const listing = randomUUID();
  await q(
    "insert into listings(id,title,slug,stock_mode) values($1::uuid,'Before','scan-test-'||$1::text,'linked')",
    [listing],
  );
  await one("select set_config('request.jwt.claim.sub',$1,false)", [ecom]);
  await db.exec("set role authenticated");
  const baseline = await one("select count(*) from inventory_movements");
  const scanned = [];
  for (let n = 0; n < 3; n++) {
    const row = await one("select ecommerce_scan_stock($1)", [variants[n].code]);
    assert.equal(row.kind, "fabric");
    assert.equal(row.available_mm, 5000);
    assert(!JSON.stringify(row).includes("cp_paise"));
    scanned.push(row);
  }
  const product = await one("select ecommerce_scan_stock($1)", [piece.code]);
  assert.equal(product.kind, "product");
  assert(BigInt(product.sp_paise) > 0n);
  await assert.rejects(
    one("select ecommerce_scan_stock($1)", [variants[3].code]),
    /No available showroom/,
  );
  await assert.rejects(one("select ecommerce_scan_stock('UNKNOWN')"), /No available showroom/);
  const details = {
    title: "Cotton online",
    description: "Description kept",
    tags: ["cotton", "summer"],
    category: "Fabric",
    collection: "New",
    seo_title: "SEO",
    seo_description: "Search",
    price_paise: 45000,
    sale_price_paise: 40000,
    images: ["listing/test.jpg"],
  };
  const payload = scanned.map(({ id, kind }) => ({ id, kind }));
  await one("select save_ecommerce_listing_details($1,$2::jsonb,$3::jsonb)", [
    listing,
    JSON.stringify(details),
    JSON.stringify(payload),
  ]);
  assert.equal((await one("select ecommerce_listing_links($1)", [listing])).length, 3);
  assert.equal(
    (await one("select ecommerce_listing_stock()")).find((r) => r.listing_id === listing).stock
      .length,
    3,
  );
  await assert.rejects(
    one("select save_ecommerce_listing_details($1,$2::jsonb,$3::jsonb)", [
      listing,
      JSON.stringify({ ...details, title: "Must roll back" }),
      JSON.stringify([...payload, { id: product.id, kind: "product" }]),
    ]),
    /separate listings/,
  );
  assert.equal(await one("select title from listings where id=$1", [listing]), "Cotton online");
  assert.equal((await one("select ecommerce_listing_links($1)", [listing])).length, 3);
  await assert.rejects(
    one("select save_ecommerce_listing_details($1,$2::jsonb,$3::jsonb)", [
      listing,
      JSON.stringify({ ...details, title: "Rollback unavailable" }),
      JSON.stringify([{ id: variants[3].thaan_id, kind: "fabric" }]),
    ]),
    /Stock must be available/,
  );
  assert.equal(await one("select title from listings where id=$1", [listing]), "Cotton online");
  assert.equal(
    (await one("select ecommerce_listing_links($1)", [listing])).length,
    3,
    "Deletion before invalid replacement is rolled back",
  );
  const available = (
    await q("select * from listing_showroom_availability() where listing_id=$1", [listing])
  )[0];
  assert.equal(available.largest_piece_mm, 5000);
  assert.equal(available.total_linked_mm, 15000);
  await one("select save_ecommerce_listing_details($1,$2::jsonb,$3::jsonb)", [
    listing,
    JSON.stringify(details),
    JSON.stringify(payload),
  ]);
  assert.equal(
    (await one("select ecommerce_listing_links($1)", [listing])).length,
    3,
    "Repeat save is idempotent",
  );
  assert.equal(
    await one("select count(*) from inventory_movements"),
    baseline,
    "Scanning and saving do not deduct stock",
  );
  await one("select set_config('request.jwt.claim.sub',$1,false)", [fixture.salesperson]);
  await assert.rejects(one("select ecommerce_scan_stock($1)", [piece.code]), /permission required/);
  await assert.rejects(
    one("select save_ecommerce_listing_details($1,$2::jsonb,null)", [
      listing,
      JSON.stringify(details),
    ]),
    /permission required/,
  );
  await db.exec("reset role");
  await one("select set_config('request.jwt.claim.sub',$1,false)", [fixture.owner]);
  // Transferring one linked Thaan fully back out of a showroom must remove it immediately.
  const inv = await one("select id from inventory_items where thaan_id=$1", [variants[0].thaan_id]);
  await one("select post_inventory_transfer($1,$2,$3,$4::jsonb,null)", [
    randomUUID(),
    floors[0],
    workshop,
    JSON.stringify([{ inventory_item_id: inv, quantity: 5000 }]),
  ]);
  await assert.rejects(
    one("select ecommerce_scan_stock($1)", [variants[0].code]),
    /No available showroom/,
  );
  assert.equal(
    (await one("select ecommerce_listing_stock()")).find((r) => r.listing_id === listing).stock
      .length,
    2,
  );
  assert.equal(
    (await q("select * from listing_showroom_availability() where listing_id=$1", [listing]))[0]
      .total_linked_mm,
    10000,
  );
  console.log(
    "PASS: seeded catalog archived without deleting history; all-floor physical scans, saved product SP, fabric without SP, safe stock projection, atomic metadata/links, retry, staff authorization and immediate transfer availability.",
  );
}
