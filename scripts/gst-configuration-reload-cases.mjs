import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gstLocalDateTime } from "../src/features/gst/configuration-time.ts";

export async function gstConfigurationReloadCases(db) {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "Asia/Kolkata";
  const instant = "2026-10-19T10:00:00.000Z";
  assert.equal(gstLocalDateTime(instant), "2026-10-19T15:30");
  assert.equal(
    new Date(gstLocalDateTime(instant)).toISOString(),
    instant,
    "Local input round trip must not shift effective date",
  );
  if (previousTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = previousTimezone;
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const owner = randomUUID();
  await q("insert into auth.users(id,email) values($1,'gst-reload@test.invalid')", [owner]);
  await q("insert into profiles(id,full_name) values($1,'GST reload test')", [owner]);
  await q("insert into user_roles(user_id,role_key) values($1,'owner')", [owner]);
  await q("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  const config = {
    enabled: true,
    effective_from: "2020-01-02T00:00:00Z",
    legal_name: "Test",
    trading_name: "Test",
    address: "Test address",
    contact: "Test",
    gstin: "27ABCDE1234F1Z5",
    state_code: "27",
    price_mode: "inclusive",
    invoice_display: "final_first",
    tailoring_display: "separate",
    purchase_mode: "track_itc",
  };
  const rules = ["purchase", "fabric_sale", "finished_sale", "tailoring"].map((category) => ({
    category,
    classification_code: "TEST",
    rate_bps: 500,
  }));
  const save = async (draft) =>
    (
      await q("select owner_save_gst_configuration($1,$2::jsonb,$3::jsonb) id", [
        randomUUID(),
        JSON.stringify(draft),
        JSON.stringify(rules),
      ])
    )[0].id;
  const first = await save(config);
  const b = {
    ...config,
    effective_from: "2020-01-01T00:00:00Z",
    price_mode: "exclusive",
    invoice_display: "taxable_first",
    tailoring_display: "combined",
    purchase_mode: "include_noncreditable",
  };
  const second = await save(b);
  const [editor] = await q("select owner_gst_configuration() doc");
  assert.equal(
    editor.doc.configuration.id,
    second,
    "Reload must read latest SAVE, not greatest effective date",
  );
  for (const key of ["price_mode", "invoice_display", "tailoring_display", "purchase_mode"])
    assert.equal(editor.doc.configuration[key], b[key]);
  const [transaction] = await q("select gst_transaction_configuration() doc");
  assert.equal(
    transaction.doc.configuration.id,
    first,
    "Transactions retain effective-date ordering",
  );
  const third = await save({ ...b, effective_from: new Date(Date.now() - 1000).toISOString() });
  assert.equal(
    (await q("select gst_transaction_configuration() doc"))[0].doc.configuration.id,
    third,
  );
  const future = await save({ ...config, effective_from: "2099-01-01T00:00:00Z" });
  assert.equal((await q("select owner_gst_configuration() doc"))[0].doc.configuration.id, future);
  assert.equal(
    (await q("select gst_transaction_configuration() doc"))[0].doc.configuration.id,
    third,
    "Future settings must not leak into Owner POS",
  );
  const [original] = await q(
    "select price_mode,invoice_display,tailoring_display,purchase_mode from gst_configuration_versions where id=$1",
    [first],
  );
  assert.deepEqual(original, {
    price_mode: "inclusive",
    invoice_display: "final_first",
    tailoring_display: "separate",
    purchase_mode: "track_itc",
  });
  const [tax] = await q(
    "select gst_calculate_amount(10000,500,'inclusive','intra_state') inclusive,gst_calculate_amount(10000,500,'exclusive','intra_state') exclusive",
  );
  assert.equal(tax.inclusive.final_paise, "10000");
  assert.equal(tax.exclusive.final_paise, "10500");
  await q("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(q("select owner_gst_configuration()"), /Owner required/);
  console.log(
    "PASS: all four GST choices persist, latest-saved editor, active/future transaction isolation, historical preservation, inclusive/exclusive totals and Owner authorization.",
  );
}
