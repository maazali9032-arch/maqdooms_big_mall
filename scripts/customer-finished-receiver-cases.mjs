import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

export async function customerFinishedReceiverCases(db, fixture) {
  assert.equal(
    await fs.readFile("supabase/migrations/20261021000100_tailor_work_order_status.sql", "utf8"),
    await fs.readFile("drizzle/migrations/0073_tailor_work_order_status.sql", "utf8"),
  );
  assert.equal(
    await fs.readFile(
      "supabase/migrations/20261020000400_customer_finished_receiver_access.sql",
      "utf8",
    ),
    await fs.readFile("drizzle/migrations/0071_customer_finished_receiver_access.sql", "utf8"),
  );
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const stock = randomUUID(),
    denied = randomUUID();
  for (const [id, role] of [
    [stock, "stock_entry"],
    [denied, "salesperson"],
  ]) {
    await q("insert into auth.users(id,email) values($1,$2)", [id, `${id}@receiver.test`]);
    await q("insert into profiles(id,full_name) values($1,$2)", [id, `Receiver ${role}`]);
    await q("insert into user_roles(user_id,role_key) values($1,$2)", [id, role]);
  }
  const [job] = await q(
    "select j.id,j.scan_code from customer_tailoring_jobs j join counter_tailoring_details d on d.job_id=j.id where d.bill_id=$1",
    [fixture.unpaid],
  );
  const login = (id) => one("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await login(stock);
  assert.equal(
    await one("select has_perm(auth.uid(),'production.receive')"),
    true,
    "Existing Stock Entry defaults include receiving",
  );
  const matched = await one("select resolve_finished_receipt($1)", [job.scan_code]);
  assert.equal(matched.jobs[0].id, job.id);
  const inventoryBefore = await one("select count(*) from inventory_movements");
  const receiptCount = await one("select count(*) from customer_tailoring_finished_items");
  const request = randomUUID();
  const args = [request, job.id, "Pathani Kurta Pajama", "36", 250000];
  const call = "select receive_customer_tailoring_finished_item($1,$2,$3,$4,$5)";
  const result = await one(call, args);
  assert.equal(result.name, "Pathani Kurta Pajama");
  assert.equal(result.size, "36");
  assert.equal(result.sp_paise, "250000");
  assert.match(result.barcode, /^\d{12}$/);
  assert.equal((await one(call, args)).id, result.id, "Exact retry returns same barcode");
  assert.equal(
    (await one(call, [randomUUID(), ...args.slice(1)])).id,
    result.id,
    "Repeat receiving cannot create another garment",
  );
  assert.equal(
    await one("select count(*) from customer_tailoring_finished_items"),
    receiptCount + 1,
  );
  assert.equal(
    await one("select count(*) from inventory_movements"),
    inventoryBefore,
    "Customer garment is not saleable store stock",
  );
  assert.equal(
    await one("select status from customer_tailoring_jobs where id=$1", [job.id]),
    "ready",
  );
  assert.equal(
    (await one("select customer_tailoring_finished_item($1)", [result.barcode])).id,
    result.id,
  );
  await assert.rejects(
    one(call, [request, job.id, "Changed name", "36", 250000]),
    /reused with different data/,
  );
  await q(
    "insert into user_permission_overrides(user_id,permission_key,granted) values($1,'production.receive',false)",
    [stock],
  );
  await assert.rejects(
    one("select customer_tailoring_finished_item($1)", [result.barcode]),
    /access required/,
  );
  await assert.rejects(one(call, [randomUUID(), ...args.slice(1)]), /permission required/);
  await login(denied);
  await assert.rejects(
    one("select customer_tailoring_finished_item($1)", [result.barcode]),
    /access required/,
  );
  await login("");
  await assert.rejects(
    one("select customer_tailoring_finished_item($1)", [result.barcode]),
    /access required/,
  );
  assert.equal(
    await one(
      "select has_function_privilege('anon','public.customer_tailoring_finished_item(text)','execute')",
    ),
    false,
  );
  await login(fixture.owner);
  const orders = await one("select tailor_work_order($1)", [fixture.unpaid]);
  assert.equal(
    orders[0].status,
    "ready",
    "Workshop copy must show the recorded current job status",
  );
  console.log(
    "PASS: default stock receiver generates/reads/reprints one customer garment barcode; retry, revoked/denied/anonymous access and no store-stock movements.",
  );
}
