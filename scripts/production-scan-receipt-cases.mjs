import { randomUUID } from "node:crypto";
export async function productionScanReceiptCases({
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
  const tables = await q(
    "select tablename from pg_tables where schemaname='public' order by tablename",
  );
  const snapshot = async () => {
    const result = {};
    for (const { tablename } of tables)
      result[tablename] = await q(
        `select to_jsonb(t) row from public."${tablename}" t order by to_jsonb(t)::text`,
      );
    return JSON.stringify(result);
  };
  const before = await snapshot();
  await db.exec(migration);
  check(
    before === (await snapshot()),
    "Scan-receipt migration preserves every existing row and barcode",
  );
  await login(users.owner);
  const product = await one(
    "select manage_production_catalog($1,'product',null,$2,'Scan Receipt Sherwani',true,null,'Disposable test')",
    [randomUUID(), "SCAN-" + randomUUID()],
  );
  const batch = await one(
    "select create_barcode_batch_with_details($1,'Scan Receipt Provider','2026-10-15',null,$2::jsonb)",
    [
      randomUUID(),
      JSON.stringify([
        {
          name: "Scan receipt fabric",
          quantity: 1,
          rows: [{ length_mm: 100000, cp_paise_per_m: 40000 }],
        },
      ]),
    ],
  );
  const variant = (await one("select stock_registration_catalog($1)", [batch]))[0].fabric_types[0]
    .variants[0];
  await login(null);
  const item = await one("select id from inventory_items where thaan_id=$1", [variant.thaan_id]);
  const workshop = await one("select id from locations where kind='workshop'");
  const assignment = await one(
    "select a.id from tailor_assignments a join tailors t on t.id=a.tailor_id join tailoring_factories f on f.id=a.factory_id where a.valid_until is null and t.active and f.active limit 1",
  );
  const create = async (quantity = 5) => {
    await login(users.owner);
    const job = await one(
      "select create_mixed_production($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,null)",
      [
        randomUUID(),
        workshop,
        JSON.stringify([{ inventory_item_id: item, quantity: quantity * 1000 }]),
        JSON.stringify(
          Array.from({ length: quantity }, (_, i) => ({
            product_id: product,
            custom_design: "Custom " + i,
            size: String(38 + i),
          })),
        ),
        JSON.stringify([assignment]),
      ],
    );
    return { id: job, code: (await one("select production_job_document($1)", [job])).code };
  };
  const job = await create();
  await login(null);
  const startBalance = await one("select inventory_balance($1,$2)", [item, workshop]);
  for (const role of ["counter", "production", "tailor", "salesperson", "ecommerce_manager"]) {
    await login(users[role]);
    await denied("select receive_production_barcode($1,$2)", [randomUUID(), job.code]);
  }
  await login(null);
  await q("set role anon");
  await denied("select receive_production_barcode($1,$2)", [randomUUID(), job.code]);
  await login(users.stock_entry);
  const request = randomUUID();
  check(
    (await one("select receive_production_barcode($1,$2)", [request, job.code])) === job.id,
    "Authorized Stock Entry scan receives an open production directly",
  );
  check(
    (await one("select receive_production_barcode($1,$2)", [request, job.code])) === job.id,
    "Identical uncertain-response retry returns the same batch",
  );
  await login(null);
  const afterReceipt = await snapshot();
  await login(users.stock_entry);
  check(
    (await one("select receive_production_barcode($1,$2)", [randomUUID(), job.code])) === job.id,
    "Fresh rescan opens the original pieces",
  );
  await login(null);
  check(
    afterReceipt === (await snapshot()),
    "Rescanning does not add stock, statuses, barcodes or audit rows",
  );
  await login(users.owner);
  check(
    (await one("select production_job_document($1)", [job.id])).status === "completed",
    "Scan marks production finished",
  );
  const [event] = await q(
    "select previous_status,status,actor_id from production_status_events where job_id=$1",
    [job.id],
  );
  check(
    event.previous_status === "open" &&
      event.status === "completed" &&
      event.actor_id === users.stock_entry,
    "Actual scan user and state transition are recorded",
  );
  await login(null);
  check(
    (await one("select inventory_balance($1,$2)", [item, workshop])) === startBalance,
    "Receipt never deducts the already-issued fabric again",
  );
  await login(users.stock_entry);
  const pieces = await one("select workshop_production_pieces($1)", [job.id]);
  check(
    pieces.length === 5 && new Set(pieces.map((p) => p.barcode)).size === 5,
    "Five finished pieces have five unique barcodes",
  );
  check(
    pieces.every(
      (p) => /^80\d{10}$/.test(p.barcode) && p.location_kind === "workshop" && p.sp_paise === null,
    ),
    "New pieces use short numeric barcodes at Workshop awaiting saved SP",
  );
  check(
    pieces.map((p) => p.size).join(",") === "38,39,40,41,42" && pieces[4].design === "Custom 4",
    "Per-piece product, custom design and sizes survive receipt",
  );
  check(
    pieces.reduce((n, p) => n + Number(p.cp_paise), 0) === 200000,
    "Issued CP is allocated exactly over the complete batch",
  );
  await denied("select receive_production_barcode($1,$2)", [request, "UNKNOWN-PRODUCTION"]);
  await login(null);
  const unknownBefore = await snapshot();
  await login(users.stock_entry);
  await denied("select receive_production_barcode($1,$2)", [randomUUID(), "UNKNOWN-PRODUCTION"]);
  await login(null);
  check(unknownBefore === (await snapshot()), "Unknown barcode has no side effects");
  const active = await create(2);
  await one("select progress_owner_production($1,$2,'open','in_progress','Disposable test')", [
    randomUUID(),
    active.id,
  ]);
  await login(users.stock_entry);
  await one("select receive_production_barcode($1,$2)", [randomUUID(), active.code]);
  check(
    (await one("select workshop_production_pieces($1)", [active.id])).length === 2,
    "An in-progress batch also finishes and receives on scan",
  );
  const completed = await create(1);
  await one("select progress_owner_production($1,$2,'open','in_progress','Disposable start')", [
    randomUUID(),
    completed.id,
  ]);
  await one(
    "select progress_owner_production($1,$2,'in_progress','completed','Disposable finish')",
    [randomUUID(), completed.id],
  );
  await login(users.stock_entry);
  await one("select receive_production_barcode($1,$2)", [randomUUID(), completed.code]);
  check(
    (await one("select workshop_production_pieces($1)", [completed.id])).length === 1,
    "Already-finished production is received without another status event",
  );
  await login(null);
  check(
    Number(
      await one("select count(*) from production_status_events where job_id=$1", [completed.id]),
    ) === 2,
    "Previously recorded finish timestamps are preserved",
  );
  const broken = await create(1);
  await login(null);
  const [cost] = await q(
    "select c.issue_line_id from production_issue_fabric_costs c join material_issue_lines l on l.id=c.issue_line_id join material_issues i on i.id=l.material_issue_id where i.production_job_id=$1",
    [broken.id],
  );
  await db.exec(
    "alter table production_issue_fabric_costs disable trigger production_issue_cost_immutable",
  );
  await q("delete from production_issue_fabric_costs where issue_line_id=$1", [cost.issue_line_id]);
  await db.exec(
    "alter table production_issue_fabric_costs enable trigger production_issue_cost_immutable",
  );
  const missingBefore = await snapshot();
  await login(users.stock_entry);
  await denied("select receive_production_barcode($1,$2)", [randomUUID(), broken.code]);
  await login(null);
  check(
    missingBefore === (await snapshot()),
    "Missing cost evidence rolls back completion, receipt and audit together",
  );
  check(
    !(await one(
      "select has_function_privilege('authenticated','new_finished_piece_barcode()','EXECUTE')",
    )) &&
      !(await one(
        "select has_sequence_privilege('authenticated','finished_piece_barcode_number','USAGE')",
      )),
    "Barcode allocator cannot be invoked directly by staff",
  );
  await login(users.stock_entry);
  await one("select set_workshop_product_sp($1,$2,$3::jsonb,$4)", [
    randomUUID(),
    job.id,
    JSON.stringify(pieces.map((p) => ({ piece_id: p.id, sp_paise: 399900 }))),
    "Workshop price entered",
  ]);
  await login(users.owner);
  const floor = await one("select manage_showroom_location(null,$1,'Scan receipt floor',true)", [
    "SCAN-FLOOR-" + randomUUID(),
  ]);
  await one("select transfer_finished_products($1,$2,$3,$4::jsonb,null)", [
    randomUUID(),
    workshop,
    floor,
    JSON.stringify([pieces[0].id]),
  ]);
  await login(users.counter);
  const scanned = await one("select counter_scan_barcode($1,$2)", [pieces[0].barcode, floor]);
  check(
    scanned?.id === pieces[0].id && scanned.sp_paise === 399900,
    "Short piece barcode works in existing floor POS at its saved SP",
  );
  await login(users.owner);
  const inspected = await one("select owner_barcode_inspect($1,null,null,100)", [
    pieces[0].barcode,
  ]);
  check(!!inspected, "Owner lifecycle inspector accepts the new short piece identity");
  await login(null);
}
