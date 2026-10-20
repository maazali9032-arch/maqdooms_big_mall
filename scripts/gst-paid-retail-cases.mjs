import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function gstPaidRetailCases(db) {
  await db.exec("reset role");
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const owner = randomUUID(),
    salesperson = randomUUID(),
    tailorUser = randomUUID();
  for (const [id, role] of [
    [owner, "owner"],
    [salesperson, "salesperson"],
    [tailorUser, "tailor"],
  ]) {
    await q("insert into auth.users(id,email) values($1,$2)", [id, `${role}-${id}@gst.test`]);
    await q("insert into profiles(id,full_name) values($1,$2)", [id, role]);
    await q("insert into user_roles(user_id,role_key) values($1,$2)", [id, role]);
  }
  await q("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  const config = {
    enabled: true,
    effective_from: new Date().toISOString(),
    legal_name: "GST test",
    trading_name: "GST test",
    address: "Test",
    contact: "Test",
    gstin: "27ABCDE1234F1Z5",
    state_code: "27",
    price_mode: "exclusive",
    invoice_display: "final_first",
    tailoring_display: "separate",
    purchase_mode: "track_itc",
  };
  const rules = ["purchase", "fabric_sale", "finished_sale", "tailoring"].map((category) => ({
    category,
    classification_code: "TEST",
    rate_bps: 500,
  }));
  await one("select owner_save_gst_configuration($1,$2::jsonb,$3::jsonb)", [
    randomUUID(),
    JSON.stringify(config),
    JSON.stringify(rules),
  ]);
  const floor = await one("select manage_showroom_location(null,$1,'GST paid floor',true)", [
    "GST-" + randomUUID(),
  ]);
  const batch = await one(
    "select create_barcode_batch_with_details($1,'GST paid test','2026-10-20',null,$2::jsonb)",
    [
      randomUUID(),
      JSON.stringify([
        { name: "Silk", quantity: 1, rows: [{ length_mm: 25000, cp_paise_per_m: 30000 }] },
      ]),
    ],
  );
  const catalog = await one("select stock_registration_catalog($1)", [batch]);
  const thaan = catalog[0].fabric_types[0].variants[0].thaan_id;
  const item = await one("select id from inventory_items where thaan_id=$1", [thaan]);
  const workshop = await one("select id from locations where kind='workshop'");
  await one("select post_inventory_transfer($1,$2,$3,$4::jsonb,null)", [
    randomUUID(),
    workshop,
    floor,
    JSON.stringify([{ inventory_item_id: item, quantity: 25000 }]),
  ]);
  const payload = (quantity) =>
    JSON.stringify([
      {
        kind: "fabric",
        inventory_item_id: item,
        quantity,
        sp_paise_per_m: 100000,
        source_location_id: floor,
      },
    ]);
  const call =
    "select complete_counter_bill_gst($1,$2::jsonb,'[]'::jsonb,$3,$4,$5,null,null,$6::jsonb)";
  const request = randomUUID();
  const args = [
    request,
    payload(5000),
    true,
    null,
    salesperson,
    JSON.stringify({ customer_gstin: "", payment_method: "cash" }),
  ];
  const bill = await one(call, args);
  const receipt = await one("select counter_bill($1)", [bill]);
  assert.equal(receipt.total_paise, "525000");
  assert.equal(receipt.paid_amount_paise, "525000");
  assert.equal(receipt.balance_paise, "0");
  assert.equal(receipt.tax.payment_method, "cash");
  assert.equal(await one(call, args), bill, "Identical retry returns the original bill");
  assert.equal(await one("select count(*) from counter_bill_payments where bill_id=$1", [bill]), 1);
  assert.equal(Number(await one("select inventory_balance($1,$2)", [item, floor])), 20000);
  for (const payment_method of ["card", "upi"]) {
    const result = await one(call, [
      randomUUID(),
      payload(1000),
      true,
      null,
      salesperson,
      JSON.stringify({ customer_gstin: "", payment_method }),
    ]);
    assert.equal((await one("select counter_bill($1)", [result])).paid, true);
  }
  const balance = await one("select inventory_balance($1,$2)", [item, floor]);
  const orderCount = await one("select count(*) from orders");
  await assert.rejects(
    one(call, [randomUUID(), payload(1000), false, null, salesperson, "{}"]),
    /Unpaid is available only/,
  );
  await assert.rejects(
    one(call, [randomUUID(), payload(1000), true, 100, salesperson, "{}"]),
    /Unpaid is available only/,
  );
  // Invalid tax data fails after staging: bill creation and stock deduction must roll back together.
  await assert.rejects(
    one(call, [randomUUID(), payload(1000), true, null, salesperson, '{"unexpected":true}']),
    /Valid GST sale context/,
  );
  assert.equal(await one("select count(*) from orders"), orderCount);
  assert.equal(await one("select inventory_balance($1,$2)", [item, floor]), balance);
  await assert.rejects(
    one("select complete_counter_bill_multi($1,$2::jsonb,'[]',false,$3,null,null,null)", [
      randomUUID(),
      payload(1000),
      salesperson,
    ]),
    /Unpaid is available only/,
  );
  assert.equal(
    await one(
      "select has_function_privilege('authenticated','public.gst_stage_counter_bill_multi(uuid,jsonb,jsonb,boolean,uuid,uuid,text,text)','execute')",
    ),
    false,
  );
  const factory = await one(
    "insert into tailoring_factories(code,name) values($1,'GST test factory') returning id",
    ["G-" + randomUUID()],
  );
  const tailor = await one(
    "insert into tailors(code,real_name,profile_id) values($1,'GST test tailor',$2) returning id",
    ["T-" + randomUUID(), tailorUser],
  );
  const assignment = await one(
    "insert into tailor_assignments(tailor_id,factory_id) values($1,$2) returning id",
    [tailor, factory],
  );
  const group = JSON.stringify(
    [
      {
        items: JSON.parse(payload(1000)),
        garment: "Test garment",
        delivery_date: "2030-01-01",
        assignment_id: assignment,
        stitching_paise: 50000,
      },
    ].map((g) => ({ ...g, items: g.items.map(({ kind, ...cut }) => cut) })),
  );
  const mixed = await one(
    "select complete_counter_bill_gst($1,$2::jsonb,$3::jsonb,false,100000,$4,null,null,$5::jsonb)",
    [
      randomUUID(),
      payload(1000),
      group,
      salesperson,
      JSON.stringify({ customer_gstin: "", payment_method: "cash" }),
    ],
  );
  const mixedReceipt = await one("select counter_bill($1)", [mixed]);
  assert.equal(mixedReceipt.total_paise, "262500");
  assert.equal(mixedReceipt.paid_amount_paise, "100000");
  assert.equal(mixedReceipt.balance_paise, "162500");
  assert.equal(mixedReceipt.lines.length, 2);
  const unpaid = await one(
    "select complete_counter_bill_gst($1,'[]'::jsonb,$2::jsonb,false,null,$3,null,null,$4::jsonb)",
    [
      randomUUID(),
      group,
      salesperson,
      JSON.stringify({ customer_gstin: "", payment_method: "cash" }),
    ],
  );
  assert.equal((await one("select counter_bill($1)", [unpaid])).paid, false);
  console.log(
    "PASS: GST cash fabric bill pays 5250 on 5000 base, card/UPI, exact retry, single deduction/payment, unpaid rejection, rollback and private staging permissions.",
  );
  return { owner, salesperson, mixed, unpaid, bill, assignment, item, floor };
}
