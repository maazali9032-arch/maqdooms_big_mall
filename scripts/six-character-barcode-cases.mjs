import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
export async function sixCharacterBarcodeCases(db, fixture, previous) {
  const q = async (s, a = []) => (await db.query(s, a)).rows;
  const one = async (s, a = []) => Object.values((await q(s, a))[0])[0];
  assert.equal(
    await fs.readFile(
      "supabase/migrations/20261021000300_six_character_barcode_identities.sql",
      "utf8",
    ),
    await fs.readFile("drizzle/migrations/0075_six_character_barcode_identities.sql", "utf8"),
  );
  await db.exec("reset role");
  await one("select set_config('request.jwt.claim.sub',$1,false)", [fixture.owner]);
  assert.deepEqual(
    (await q("select id,code,scan_code from orders where id=$1", [previous.id]))[0],
    previous,
    "Long historical alias is byte-for-byte preserved",
  );
  assert.equal(
    await one("select resolve_document_scan_code($1)", [previous.scan_code]),
    previous.code,
  );
  assert.equal(await one("select code from barcodes where code='809999999999'"), "809999999999");
  assert.equal(await one("select code from barcodes where code='T00000'"), "T00000");
  const snapshot = await one("select count(*) from inventory_movements");
  for (const [n, expected] of [
    [0, "00000"],
    [1, "00001"],
    [35, "0000Z"],
    [36, "00010"],
    [1295, "000ZZ"],
    [1296, "00100"],
    [60466175, "ZZZZZ"],
  ])
    assert.equal(await one("select barcode_base36_five($1)", [n]), expected);
  for (const prefix of ["T", "P", "F", "B", "J", "C"]) {
    const codes = await Promise.all(
      Array.from({ length: 40 }, () => one("select next_six_barcode($1)", [prefix])),
    );
    assert.equal(new Set(codes).size, 40);
    assert(codes.every((c) => new RegExp(`^${prefix}[0-9A-Z]{5}$`).test(c)));
    assert(!codes.includes("T00000"), "Preexisting namespace slot is skipped");
    await db.exec("begin");
    const consumed = await one("select next_six_barcode($1)", [prefix]);
    await db.exec("rollback");
    assert.notEqual(
      await one("select next_six_barcode($1)", [prefix]),
      consumed,
      "Rollback cannot reuse an issued ordinal",
    );
  }
  const [t] = await q(
    "select b.code from barcode_identity_bindings b join thaans t on t.id=b.record_id where b.record_table='thaans' and b.code like 'T%' limit 1",
  );
  assert(t);
  const [f] = await q(
    "select b.code from barcodes b join finished_products p on p.barcode_id=b.id where b.code ~ '^F[0-9A-Z]{5}$' limit 1",
  );
  const [c] = await q(
    "select b.code from barcodes b join customer_tailoring_finished_items p on p.barcode_id=b.id where b.code ~ '^C[0-9A-Z]{5}$' limit 1",
  );
  for (const code of [t.code, f.code, c.code])
    assert.equal(
      (await one("select owner_barcode_inspect($1,null,null,50)", [code])).status,
      "found",
      code,
    );
  for (const table of ["orders", "production_jobs", "customer_tailoring_jobs"]) {
    const [r] = await q(
      `select id,code,scan_code from ${table} where scan_code ~ '^[BPJ][0-9A-Z]{5}$' limit 1`,
    );
    assert(r);
    assert.equal(await one("select resolve_document_scan_code($1)", [r.scan_code]), r.code);
    assert.equal(
      (await one("select owner_barcode_inspect($1,null,null,50)", [r.scan_code])).status,
      "found",
      table,
    );
    assert.equal(
      (await q(`select scan_code from ${table} where id=$1`, [r.id]))[0].scan_code,
      r.scan_code,
      "Repeated read retains same ID",
    );
  }
  const [customerJob] = await q(
    "select id,scan_code from customer_tailoring_jobs where scan_code ~ '^J[0-9A-Z]{5}$' limit 1",
  );
  const jobRows = await one("select customer_tailoring_work($1)", [customerJob.scan_code]);
  assert.equal(jobRows[0].scan_code, customerJob.scan_code);
  const classified = await one("select resolve_finished_receipt($1)", [customerJob.scan_code]);
  assert.equal(classified.jobs[0].scan_code, customerJob.scan_code);
  assert(
    (await one("select production_history_base(null,100)")).some((job) =>
      /^P[0-9A-Z]{5}$/.test(job.scan_code),
    ),
  );
  assert.equal(
    (await one("select owner_barcode_inspect($1,null,null,50)", [c.code])).items[0].kind,
    "customer_finished_garment",
  );
  assert.equal(await one("select count(*) from inventory_movements"), snapshot);
  await assert.rejects(
    q("delete from barcode_identity_reservations where code=$1", [f.code]),
    /history|immutable|append|rewrite/i,
  );
  await assert.rejects(
    q("delete from barcode_identity_bindings where code=$1", [f.code]),
    /history|immutable|append|rewrite/i,
  );
  await assert.rejects(
    q("update barcodes set code='FZZZZZ' where code=$1", [f.code]),
    /permanent|append-only/,
  );
  await one("select set_config('request.jwt.claim.sub',$1,false)", [fixture.salesperson]);
  await db.exec("set role authenticated");
  await assert.rejects(one("select next_six_barcode('B')"), /permission denied/);
  await assert.rejects(one("select nextval('public.barcode_six_b')"), /permission denied/);
  await assert.rejects(
    one("select owner_barcode_inspect($1,null,null,50)", [c.code]),
    /Owner required/,
  );
  await db.exec("reset role");
  await one("select set_config('request.jwt.claim.sub',$1,false)", [fixture.owner]);
  // Boundary/exhaustion on this disposable database only; no live sequence is reset.
  await one("select setval('public.barcode_six_c',60466175,false)");
  assert.equal(await one("select next_six_barcode('C')"), "CZZZZZ");
  await assert.rejects(one("select next_six_barcode('C')"), /exhausted/);
  console.log(
    "PASS: all six prefixes, base36 boundaries/exhaustion, parallel queued allocations, rollback gaps, permanent reservation/map guards, historical labels, six inspector roots and unchanged inventory/permissions.",
  );
}
