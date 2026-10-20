import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

export async function unifiedFinishedReceiptCases(db, fixtures) {
  assert.equal(
    await fs.readFile(
      "supabase/migrations/20261020000200_unified_finished_receipt_lookup.sql",
      "utf8",
    ),
    await fs.readFile("drizzle/migrations/0069_unified_finished_receipt_lookup.sql", "utf8"),
  );
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const lookup = (code) => one("select resolve_finished_receipt($1)", [code]);
  const [bill] = await q("select code,scan_code from orders where id=$1", [fixtures.mixed]);
  for (const code of [bill.code, bill.scan_code, fixtures.mixed]) {
    const result = await lookup(code);
    assert.equal(result.kind, "customer");
    assert.equal(result.jobs.length, 1);
    assert(result.jobs[0].factory && result.jobs[0].tailor);
    assert(!/cp_paise|total_paise|price_paise/.test(JSON.stringify(result)));
  }
  const job = (await lookup(bill.code)).jobs[0];
  const [customer] = await q("select code,scan_code from customer_tailoring_jobs where id=$1", [
    job.id,
  ]);
  for (const code of [customer.code, customer.scan_code, job.id])
    assert.equal((await lookup(code)).kind, "customer");
  const product = await one(
    "insert into products(code,name) values($1,'Scan test product') returning id",
    ["P-" + randomUUID()],
  );
  const design = await one(
    "insert into designs(code,name) values($1,'Scan test design') returning id",
    ["D-" + randomUUID()],
  );
  const [production] = await q(
    "insert into production_jobs(code,product_id,design_id,quantity,tailor_assignment_id,size) values($1,$2,$3,1,$4,'40') returning id,code,scan_code",
    ["PROD-" + randomUUID(), product, design, fixtures.assignment],
  );
  const before = await one("select count(*) from inventory_movements");
  for (const code of [production.code, production.scan_code, production.id])
    assert.equal((await lookup(code)).kind, "production");
  assert.equal(
    await one("select count(*) from inventory_movements"),
    before,
    "Detection must never post receipt or stock movements",
  );
  await assert.rejects(lookup(fixtures.bill), /no stitching/);
  await assert.rejects(lookup("not-a-document"), /No matching/);
  // A Production receiver can classify customer work without the narrower legacy customer-work RPC.
  const worker = randomUUID();
  await q("insert into auth.users(id,email) values($1,$2)", [worker, worker + "@scan.test"]);
  await q("insert into profiles(id,full_name) values($1,'Receipt worker')", [worker]);
  await q("insert into user_roles(user_id,role_key) values($1,'production')", [worker]);
  await q(
    "insert into user_permission_overrides(user_id,permission_key,granted) values($1,'production.receive',true)",
    [worker],
  );
  await q("select set_config('request.jwt.claim.sub',$1,false)", [worker]);
  assert.equal((await lookup(customer.code)).kind, "customer");
  assert.equal((await lookup(production.code)).kind, "production");
  await q("select set_config('request.jwt.claim.sub',$1,false)", [fixtures.salesperson]);
  await assert.rejects(lookup(bill.code), /access required/);
  await q("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(lookup(production.code), /access required/);
  assert.equal(
    await one(
      "select has_function_privilege('anon','public.resolve_finished_receipt(text)','execute')",
    ),
    false,
  );
  console.log(
    "PASS: automatic bill/job/production detection, old codes, short codes, UUIDs, source labels, receiving-role access, rejection and read-only behavior.",
  );
}
