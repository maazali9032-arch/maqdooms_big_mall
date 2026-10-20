import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
export async function productionPricedReceiptCases(db, fixture) {
  assert.equal(
    await fs.readFile(
      "supabase/migrations/20261020000500_production_sp_before_barcode.sql",
      "utf8",
    ),
    await fs.readFile("drizzle/migrations/0072_production_sp_before_barcode.sql", "utf8"),
  );
  const q = async (s, a = []) => (await db.query(s, a)).rows;
  const one = async (s, a = []) => Object.values((await q(s, a))[0])[0];
  await one("select set_config('request.jwt.claim.sub',$1,false)", [fixture.owner]);
  const product = await one(
    "select manage_production_catalog($1,'product',null,$2,'Priced suit',true,null,'Price-first test')",
    [randomUUID(), "PP-" + randomUUID()],
  );
  const batch = await one(
    "select create_barcode_batch_with_details($1,'Price-first supplier',current_date,null,$2::jsonb)",
    [
      randomUUID(),
      JSON.stringify([
        {
          name: "Price-first fabric",
          quantity: 1,
          rows: [{ length_mm: 10000, cp_paise_per_m: 20000 }],
        },
      ]),
    ],
  );
  const variant = (await one("select stock_registration_catalog($1)", [batch]))[0].fabric_types[0]
    .variants[0];
  const inv = await one("select id from inventory_items where thaan_id=$1", [variant.thaan_id]);
  const workshop = await one("select id from locations where kind='workshop'");
  const job = await one(
    "select create_mixed_production($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,null)",
    [
      randomUUID(),
      workshop,
      JSON.stringify([{ inventory_item_id: inv, quantity: 6000 }]),
      JSON.stringify(
        ["38", "40", "42"].map((size) => ({ product_id: product, custom_design: "Plain", size })),
      ),
      JSON.stringify([fixture.assignment]),
    ],
  );
  const [document] = await q("select code,scan_code from production_jobs where id=$1", [job]);
  const stock = randomUUID();
  await q("insert into auth.users(id,email) values($1,$2)", [stock, stock + "@priced.test"]);
  await q("insert into profiles(id,full_name) values($1,'Stock receiver')", [stock]);
  await q("insert into user_roles(user_id,role_key) values($1,'stock_entry')", [stock]);
  await one("select set_config('request.jwt.claim.sub',$1,false)", [stock]);
  const count = async () => one("select count(*) from barcodes");
  const before = await count();
  await one("select production_job_document($1)", [document.scan_code]);
  assert.equal(await count(), before, "Scanning remains read-only");
  await assert.rejects(
    one("select receive_production_barcode($1,$2)", [randomUUID(), document.scan_code]),
    /Positive SP is required/,
  );
  assert.equal(await one("select status from production_jobs where id=$1", [job]), "open");
  const prices = [
    { piece_number: 1, sp_paise: 100000 },
    { piece_number: 2, sp_paise: 200000 },
    { piece_number: 3, sp_paise: 300000 },
  ];
  const call = "select receive_production_barcode_priced($1,$2,$3::jsonb)";
  for (const invalid of [
    null,
    [],
    prices.slice(0, 2),
    prices.map((p) => ({ ...p, sp_paise: 0 })),
    [prices[0], prices[0], prices[2]],
    prices.map((p) => ({ ...p, sp_paise: -1 })),
    prices.map((p) => ({ ...p, sp_paise: 1.5 })),
    prices.map((p) => ({ piece_number: p.piece_number })),
  ]) {
    await assert.rejects(one(call, [randomUUID(), document.scan_code, JSON.stringify(invalid)]));
    assert.equal(await count(), before);
    assert.equal(
      await one("select count(*) from finished_products where production_job_id=$1", [job]),
      0,
    );
  }
  await q(
    "insert into user_permission_overrides(user_id,permission_key,granted) values($1,'stock.price_finished',false)",
    [stock],
  );
  await assert.rejects(
    one(call, [randomUUID(), document.scan_code, JSON.stringify(prices)]),
    /price permission required/,
  );
  await q(
    "delete from user_permission_overrides where user_id=$1 and permission_key='stock.price_finished'",
    [stock],
  );
  const request = randomUUID();
  const args = [request, document.scan_code, JSON.stringify(prices)];
  assert.equal(await one(call, args), job);
  assert.equal(await one(call, args), job);
  assert.equal(await count(), before + 3);
  const pieces = await one("select workshop_production_pieces($1)", [job]);
  assert.equal(pieces.length, 3);
  for (const p of pieces) {
    assert.equal(Number(p.sp_paise), prices[p.piece_number - 1].sp_paise);
    assert.match(p.barcode, /^\d{12}$/);
  }
  assert.equal(
    await one(
      "select count(*) from finished_product_price_reviews r join finished_product_prices p on p.id=r.price_id join finished_products f on f.id=p.finished_product_id where f.production_job_id=$1",
      [job],
    ),
    3,
  );
  await assert.rejects(
    one(call, [
      request,
      document.scan_code,
      JSON.stringify(prices.map((p) => ({ ...p, sp_paise: 99900 }))),
    ]),
    /same barcode and user/,
  );
  assert.equal(
    await one("select receive_production_barcode($1,$2)", [randomUUID(), document.code]),
    job,
    "Existing receipts remain readable via old scans",
  );
  assert.equal(await count(), before + 3);
  assert.equal(
    await one(
      "select has_function_privilege('authenticated','public.complete_production_batch_priced(uuid,uuid,text,text,jsonb)','execute')",
    ),
    false,
  );
  await one("select set_config('request.jwt.claim.sub',$1,false)", [fixture.salesperson]);
  await assert.rejects(
    one(call, [randomUUID(), document.code, JSON.stringify(prices)]),
    /permission required/,
  );
  await one("select set_config('request.jwt.claim.sub',$1,false)", [fixture.owner]);
  console.log(
    "PASS: no production barcode without positive per-piece SP; read-only scan, invalid/partial/zero prices, permission checks, three distinct saved prices/reviews, atomic receipt, exact retry and old-label preservation.",
  );
}
