import { randomUUID } from "node:crypto";
export async function barcodeInspectorCases({ q, one, denied, login, users, check }) {
  const call = "select owner_barcode_inspect($1,null,null,$2)";
  await login(users.owner);
  const testBatch = await one(
    "select create_barcode_batch_with_details($1,'Inspector Provider','2026-10-15',null,$2::jsonb)",
    [
      randomUUID(),
      JSON.stringify([
        {
          name: "Inspector Fabric",
          quantity: 1,
          rows: [{ length_mm: 10000, cp_paise_per_m: 12300, colour: null }],
        },
      ]),
    ],
  );
  const testVariant = (await one("select stock_registration_catalog($1)", [testBatch]))[0]
    .fabric_types[0].variants[0];
  await login(null);
  await q(
    "insert into audit_log(actor_name,action,entity,entity_ref,detail) select 'Historical recorded user','Legacy receipt acceptance','receiving_batch',code,'{}'::jsonb from receiving_batches where id=$1",
    [testBatch],
  );
  const exact = await one(
    'select barcode_inspector_json(\'{"cp_paise":9223372036854775807,"nested":[{"quantity":999999999999999.999}]}\'::jsonb)',
  );
  check(
    exact.cp_paise === "9223372036854775807" && exact.nested[0].quantity === "999999999999999.999",
    "Nested financial and quantity evidence transported exactly",
  );
  const testItem = await one("select id from inventory_items where thaan_id=$1", [
    testVariant.thaan_id,
  ]);
  const workshop = await one("select id from locations where kind='workshop'");
  await login(users.owner);
  for (const [kind, incoming] of [
    ["WASTAGE", false],
    ["RETURN", true],
    ["ADJUSTMENT", true],
  ])
    await one("select record_inventory_correction($1,$2,$3,100,$4,$5)", [
      testItem,
      workshop,
      kind,
      incoming,
      "Disposable inspector acceptance " + kind,
    ]);
  const extra = await one(call, [testVariant.code, 100]);
  check(
    extra.events.some((e) => e.source === "audit_log" && e.actor === "Historical recorded user"),
    "Legacy receipt code and recorded actor name linked without guessing",
  );
  for (const kind of ["INWARD", "WASTAGE", "RETURN", "ADJUSTMENT"])
    check(
      extra.events.some((e) => e.source === "inventory_movements" && e.title === kind),
      "Actual " + kind + " evidence included",
    );
  await login(null);
  const allTables = await q(
    "select tablename from pg_tables where schemaname='public' order by tablename",
  );
  const fingerprint = async () =>
    JSON.stringify(
      await Promise.all(
        allTables.map(async ({ tablename }) => ({
          table: tablename,
          rows: await q(
            `select md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) hash from public."${tablename}" t`,
          ),
        })),
      ),
    );
  const before = await fingerprint();
  const fabric = (
    await q(
      "select b.code,t.id from barcodes b join fabric_stock s on s.barcode_id=b.id join thaans t on t.fabric_stock_id=s.id where exists(select 1 from inventory_movements m where m.thaan_id=t.id and m.kind='TRANSFER') order by t.id limit 1",
    )
  )[0];
  const piece = await one(
    "select b.code from finished_products p join barcodes b on b.id=p.barcode_id where p.status='sold' limit 1",
  );
  const job = await one("select code from production_jobs where status='completed' limit 1");
  const bill = await one("select code from orders where status='completed' limit 1");
  check(!!fabric && !!piece && !!job && !!bill, "Actual disposable workflow fixtures available");
  await login(users.owner);
  const result = await one(call, [fabric.code, 100]);
  check(result.status === "found" && result.items.length === 1, "Exact physical fabric resolved");
  check(result.items[0].latest_cp_paise_per_m !== null, "Owner sees recorded CP");
  check(result.current_stock[0].locations.length > 0, "Current reconciled locations present");
  check(
    result.events.some((e) => e.source === "inventory_movements" && e.title === "TRANSFER"),
    "Posted transfer from current ledger present",
  );
  check(
    result.events.some((e) => e.source === "fabric_stock_costs"),
    "Cost versions present",
  );
  check(
    result.events.some((e) => e.actor_id === users.owner || e.actor_id === users.stock_entry),
    "Recorded responsible identities present",
  );
  check(
    result.events.some((e) => e.source === "erp_audit_records"),
    "Captured audit before/after evidence present",
  );
  const sold = await one(call, [piece, 100]);
  check(
    sold.status === "found" && sold.items[0].kind === "finished_product",
    "Finished product recognized",
  );
  check(
    sold.items[0].latest_cp_paise !== null && sold.items[0].latest_sp_paise !== null,
    "Piece CP/SP saved records",
  );
  check(
    sold.events.some((e) => e.source === "inventory_movements" && e.title === "SALE"),
    "Finished sale linked",
  );
  check(
    sold.events.some((e) => e.source === "finished_product_receipts"),
    "Workshop receipt linked",
  );
  check(
    sold.events.some((e) => e.source === "production_status_events"),
    "Production timestamps/users preserved",
  );
  check(
    sold.events.some((e) => e.source === "production_issue_fabric_costs"),
    "Issue-time CP history preserved",
  );
  check(
    sold.linked_records.some((e) => e.source === "orders"),
    "Underlying order reachable read-only",
  );
  check((await one(call, [job, 100])).status === "found", "Production ID barcode supported");
  check((await one(call, [bill, 100])).status === "found", "Bill ID barcode supported");
  const seen = new Set();
  let page = await one(call, [piece, 3]),
    count = 0;
  do {
    for (const event of page.events) {
      check(!seen.has(event.key), "Cursor never duplicates an event");
      seen.add(event.key);
      count++;
    }
    if (!page.next_cursor) break;
    page = await one("select owner_barcode_inspect($1,$2,$3,3)", [
      piece,
      page.next_cursor.before,
      page.next_cursor.key,
    ]);
  } while (count < 10000);
  check(count === sold.total_events, "All older events reachable, no truncation");
  const unknown = await one(call, [`UNKNOWN-${randomUUID()}`, 100]);
  check(
    unknown.status === "unknown" && !("events" in unknown),
    "Unknown barcode returns no invented history",
  );
  check(
    (await one(call, ["  " + fabric.code + "  ", 100])).status === "found",
    "Whitespace normalized",
  );
  check(
    (await one(call, [fabric.code + "%", 100])).status === "unknown",
    "Exact match, not wildcard search",
  );
  await denied(call, ["", 50]);
  await denied(call, ["x".repeat(201), 50]);
  await denied(call, [fabric.code, 101]);
  await denied("select owner_barcode_inspect($1,now(),null,50)", [fabric.code]);
  for (const role of [
    "stock_entry",
    "counter",
    "tailor",
    "salesperson",
    "ecommerce_manager",
    "production",
  ]) {
    await login(users[role]);
    await denied(call, [fabric.code, 50]);
    await denied(call, ["UNKNOWN", 50]);
  }
  await login(null);
  await q("set role anon");
  await denied(call, [piece, 50]);
  await login(null);
  await q("set role service_role");
  await denied(call, [piece, 50]);
  await login(null);
  check(
    await one(
      "select provolatile='s' and prosecdef from pg_proc where proname='owner_barcode_inspect'",
    ),
    "Stable read-only definer projection",
  );
  check(
    !(await one(
      "select has_function_privilege('anon','owner_barcode_inspect(text,timestamptz,text,integer)','EXECUTE')",
    )),
    "Anonymous grant revoked",
  );
  check(
    before === (await fingerprint()),
    "Every inspection and rejected call preserves all public records",
  );
  const spareOwner = randomUUID();
  await q("insert into auth.users values($1,$2)", [
    spareOwner,
    "inspector-spare-owner@test.invalid",
  ]);
  await q("insert into profiles(id,full_name) values($1,$2)", [
    spareOwner,
    "Inspector spare Owner",
  ]);
  await q("insert into user_roles(user_id,role_key) values($1,'owner')", [spareOwner]);
  await q("update profiles set active=false where id=$1", [users.owner]);
  await login(users.owner);
  await denied(call, [fabric.code, 50]);
  await login(null);
  await q("update profiles set active=true where id=$1", [users.owner]);
}
