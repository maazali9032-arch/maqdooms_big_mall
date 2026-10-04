/** Isolated PostgreSQL: Customer Tailoring price, issue/order atomicity and roles. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
  customerTailoringCut,
  customerTailoringItems,
} from "../src/features/tailoring/customer-tailoring-input.ts";
import { customerTailoringBillHtml } from "../src/features/tailoring/customer-tailoring-bill.ts";
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
let checks = 0;
const check = (v, label) => {
  assert.ok(v, label);
  checks++;
};
check(customerTailoringCut("1.001", 1001) === 1001, "Exact metre conversion");
check(
  customerTailoringItems([
    { inventory_item_id: "B", quantity: 1000 },
    { inventory_item_id: "A", quantity: 1 },
  ])[0].inventory_item_id === "A",
  "Stable retry ordering",
);
for (const fn of [
  () => customerTailoringCut("0", 1000),
  () => customerTailoringCut("1.0001", 2000),
  () => customerTailoringCut("2", 1000),
  () => customerTailoringItems([]),
  () =>
    customerTailoringItems([
      { inventory_item_id: "A", quantity: 1 },
      { inventory_item_id: "A", quantity: 1 },
    ]),
  () => customerTailoringItems([{ inventory_item_id: "A", quantity: 1.5 }]),
]) {
  assert.throws(fn);
  checks++;
}
const html = customerTailoringBillHtml({
  order_code: "<script>alert(1)</script>",
  garment: "Garment",
  source_name: "Workshop",
  created_at: "2026",
  customer_snapshot: { name: "Customer", whatsapp_phone: "123" },
  final_customer_price_paise: 35000,
  issues: [{ fabric_name: "Fabric", batch_code: "Batch", quantity_mm: 1000 }],
  cp_paise_per_m: 12345,
  tailoring_charge_paise: 9999,
});
check(
  !html.includes("<script>") && html.includes("&lt;script&gt;"),
  "Bill escapes untrusted content",
);
check(
  !html.includes("12345") && !html.includes("9999") && !html.includes("CP"),
  "Customer bill projects only final price",
);
assert.throws(() => customerTailoringBillHtml({ final_customer_price_paise: null }));
checks++;
for (const [directory, demo] of [
  ["supabase/migrations", true],
  ["drizzle/migrations", true],
  ["supabase/migrations", false],
]) {
  const db = new PGlite();
  const q = async (sql, args = []) => {
    try {
      return (await db.query(sql, args)).rows;
    } catch (e) {
      throw new Error(sql + ": " + e.message);
    }
  };
  const one = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const denied = async (sql, args = [], label = sql) => {
    let err;
    try {
      await q(sql, args);
    } catch (e) {
      err = e;
    }
    check(err, label);
  };
  const login = async (id) => {
    await db.exec("reset role");
    await q("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
    if (id) await db.exec("set role authenticated");
  };
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`);
    // Capture every existing public table using its pre-migration column list.
    let oldTables;
    const snapshot = async () => {
      const result = {};
      for (const t of oldTables) {
        result[t.name] = await q(
          `select row from (select (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(r)) where key=any($1::text[])) row from public."${t.name}" r) z order by row::text`,
          [t.columns],
        );
      }
      return JSON.stringify(result);
    };
    const files = (await readdir(directory))
      .filter(
        (f) =>
          f.endsWith(".sql") &&
          (process.argv.includes("--include-phase15") || !f.includes("phase15_")) &&
          (process.argv.includes("--include-phase14") || !f.includes("phase14_")) &&
          (process.argv.includes("--include-phase13") || !f.includes("phase13_")) &&
          (process.argv.includes("--include-phase12") || !f.includes("phase12_")) &&
          (process.argv.includes("--include-phase11") || !f.includes("phase11_")) &&
          (process.argv.includes("--include-phase10") || !f.includes("phase10_")) &&
          !f.includes("_live_") &&
          (process.argv.includes("--include-phase10") ||
            process.argv.includes("--include-phase9") ||
            !f.includes("phase9_")) &&
          (process.argv.includes("--include-phase9") ||
            process.argv.includes("--include-phase8") ||
            !f.includes("phase8_")),
      )
      .sort();
    check(
      files.length ===
        (process.argv.includes("--include-phase9") || process.argv.includes("--include-phase8")
          ? process.argv.includes("--include-phase15")
            ? 26
            : process.argv.includes("--include-phase14")
              ? 25
              : process.argv.includes("--include-phase13")
                ? 24
                : process.argv.includes("--include-phase12")
                  ? 23
                  : process.argv.includes("--include-phase11")
                    ? 22
                    : process.argv.includes("--include-phase10")
                      ? 21
                      : process.argv.includes("--include-phase9")
                        ? 20
                        : 19
          : 17),
      "Full requested migration chain",
    );
    let before;
    for (const f of files) {
      if (!demo && f.includes("demo_seed")) continue;
      if (f.includes("phase7_")) {
        oldTables = await q(
          "select table_name name,array_agg(column_name order by ordinal_position) columns from information_schema.columns where table_schema='public' and table_name in(select tablename from pg_tables where schemaname='public') group by table_name order by table_name",
        );
        before = await snapshot();
      }
      try {
        await db.exec(await readFile(resolve(directory, f), "utf8"));
      } catch (e) {
        throw new Error(f + ": " + e.message);
      }
    }
    check(before === (await snapshot()), "Every pre-existing table value preserved by migration");
    const users = {};
    for (const role of ["owner", "stock_entry", "counter", "tailor", "ecommerce_manager"]) {
      const id = (users[role] = randomUUID());
      await q("insert into auth.users(id,email) values($1,$2)", [id, role + "@p7.test"]);
      await q("insert into profiles(id,full_name) values($1,$2)", [id, role]);
      await q("insert into user_roles(user_id,role_key) values($1,$2)", [id, role]);
    }
    const otherTailor = randomUUID();
    await q("insert into auth.users(id,email) values($1,'other@tailor.test')", [otherTailor]);
    await q("insert into profiles(id,full_name) values($1,'Other Tailor')", [otherTailor]);
    await q("insert into user_roles(user_id,role_key) values($1,'tailor')", [otherTailor]);
    const workshop = await one("select id from locations where kind='workshop'");
    const showroom = await one("select id from locations where kind='showroom'");
    const fabric = await one(
      "insert into fabrics(code,name,category) values('P7-F','Customer Fabric','Fabric') returning id",
    );
    await login(users.stock_entry);
    const batch = await one("insert into receiving_batches(code) values('P7-B') returning id");
    const stock = await one("select create_fabric_entry($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      fabric,
      batch,
      "[40000,60000]",
      10000,
    ]);
    await q("select complete_fabric_entry($1)", [stock]);
    await login(users.owner);
    const setupSql = "select setup_customer_tailoring_assignment($1,$2,$3,$4,$5,$6,$7)";
    const setupArgs = ["F1", "Factory One", "S1", "Section One", "T1", "Real Tailor", users.tailor];
    const assignment = await one(setupSql, setupArgs);
    check((await one(setupSql, setupArgs)) === assignment, "Setup same identity idempotent");
    await denied(
      setupSql,
      ["F2", "Factory Two", "S2", "Section Two", "T1", "Real Tailor", users.tailor],
      "Existing Tailor cannot silently move",
    );
    const otherAssignment = await one(setupSql, [
      "F2",
      "Factory Two",
      "S2",
      "Section Two",
      "T2",
      "Other Tailor",
      otherTailor,
    ]);
    const noSection = await one(setupSql, [
      "F1",
      "Factory One",
      null,
      null,
      "T3",
      "Business Tailor",
      null,
    ]);
    check(noSection, "Business Tailor without login/section supported");
    await denied(
      setupSql,
      ["F3", "Factory Three", null, null, "T4", "Wrong Role", users.counter],
      "Counter login cannot become business Tailor login",
    );
    const chargeSql = "select set_customer_tailoring_charge($1,$2,$3)";
    const charge = await one(chargeSql, ["P7-CH", "Applicable Charge", 25000]);
    check(
      (await one(chargeSql, ["P7-CH", "Applicable Charge", 25000])) === charge,
      "Same charge amount does not duplicate revision",
    );
    await denied(chargeSql, ["BAD", "Bad Charge", -1], "Negative charge denied");
    const rows = await q(
      "select i.id,t.id thaan_id from inventory_items i join thaans t on t.id=i.thaan_id where t.fabric_stock_id=$1 order by i.id",
      [stock],
    );
    await q("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      workshop,
      showroom,
      JSON.stringify([
        { inventory_item_id: rows[0].id, quantity: 10000 },
        { inventory_item_id: rows[1].id, quantity: 20000 },
      ]),
      "Customer allocation",
    ]);
    const quoteSql = "select quote_customer_tailoring($1,$2::jsonb,$3)";
    const bookSql = "select create_customer_tailoring($1,$2,$3,$4,$5,$6)";
    const cut = (row, quantity) => ({ inventory_item_id: row.id, quantity });
    const quote = async (cuts, cv = charge, src = showroom) =>
      one(quoteSql, [src, JSON.stringify(cuts), cv]);
    const history = async (job = null) => one("select customer_tailoring_history($1,50)", [job]);
    const balance = async (loc) =>
      Number(
        await one(
          "select coalesce(sum(quantity),0) from inventory_location_balances() where location_id=$1 and inventory_item_id=any($2::uuid[])",
          [loc, rows.map((r) => r.id)],
        ),
      );
    await login(users.counter);
    const customer = await one(
      "select find_or_create_customer('Tailoring Customer','100001','200002',null)",
    );
    check(
      (await one("select find_or_create_customer('Tailoring Customer','100001','200002',null)")) ===
        customer,
      "Customer creation/selection deduplicates existing contact",
    );
    const cat = await one("select customer_tailoring_catalog()");
    check(
      !JSON.stringify(cat).includes("cp_") &&
        !JSON.stringify(cat).includes("amount_paise") &&
        !JSON.stringify(cat).includes("sp_"),
      "Counter options contain no CP/SP/charge amounts",
    );
    check(
      cat.assignments.length === 3 &&
        cat.assignments.some(
          (a) =>
            a.id === assignment &&
            a.factory_name === "Factory One" &&
            a.section_name === "Section One",
        ),
      "Factory Section Tailor genealogy options",
    );
    const quoted = await quote([cut(rows[0], 1000)]);
    check(
      quoted.final_customer_price_paise === 35000,
      "1m CP 10000 + selected charge 25000 = final 35000, no SP set",
    );
    check(
      Object.keys(quoted).sort().join(",") === "final_customer_price_paise,quote_id",
      "Counter quote returns final price only",
    );
    check(
      await one("select count(*)=0 from customer_tailoring_quotes where id=$1", [quoted.quote_id]),
      "Counter raw quote RLS hides breakdown",
    );
    await login(users.owner);
    await q("select owner_set_fabric_sp($1,999999,$2)", [stock, "SP must not price tailoring"]);
    await login(users.counter);
    check(
      (await quote([cut(rows[0], 1000)])).final_customer_price_paise === 35000,
      "Changing SP cannot change Customer Tailoring price",
    );
    const request = randomUUID();
    const bookArgs = [
      request,
      quoted.quote_id,
      customer,
      assignment,
      "Customer garment",
      "Customer notes",
    ];
    const job = await one(bookSql, bookArgs);
    const h = (await history(job))[0];
    check(
      h.final_customer_price_paise === 35000 && h.customer_snapshot.whatsapp_phone === "200002",
      "Final price and WhatsApp in Order history",
    );
    check(
      h.factory_name === "Factory One" &&
        h.section_name === "Section One" &&
        h.tailor_name === "Real Tailor",
      "Assignment history traceable",
    );
    check(
      h.issues.length === 1 &&
        h.issues[0].movement_id &&
        h.issues[0].issued_by === users.counter &&
        h.requirements[0].quantity_mm === 1000,
      "Required quantity and material issue identity",
    );
    check(
      (await balance(showroom)) === 29000 && (await balance(workshop)) === 70000,
      "Exactly required quantity deducted from correct source",
    );
    check(
      h.order_id && h.order_code && h.status === "open",
      "Booked Order distinct from job status",
    );
    check(
      !JSON.stringify(h).includes("cp_") &&
        !JSON.stringify(h).includes("tailoring_charge_paise") &&
        !JSON.stringify(h).includes("sp_"),
      "Counter job/bill excludes internal breakdown/SP",
    );
    check((await one(bookSql, bookArgs)) === job, "Exact booking retry returns same job");
    await denied(
      bookSql,
      [request, quoted.quote_id, customer, assignment, "Changed garment", "Customer notes"],
      "Conflicting retry denied",
    );
    await denied(
      bookSql,
      [randomUUID(), quoted.quote_id, customer, assignment, "Second booking", null],
      "One quote cannot issue twice",
    );
    await denied(
      "select owner_customer_tailoring_costs($1)",
      [job],
      "Counter Owner-cost endpoint denied",
    );
    check(
      await one("select count(*)=0 from customer_tailoring_prices where job_id=$1", [job]),
      "Counter raw job financials hidden",
    );
    const invalidBooking = await quote([cut(rows[0], 1)]);
    await denied(
      bookSql,
      [randomUUID(), invalidBooking.quote_id, randomUUID(), assignment, "Unknown customer", null],
      "Customer must exist",
    );
    await denied(
      bookSql,
      [randomUUID(), invalidBooking.quote_id, customer, randomUUID(), "Unknown assignment", null],
      "Assignment must exist",
    );
    await denied(
      bookSql,
      [randomUUID(), invalidBooking.quote_id, customer, assignment, " ", null],
      "Garment required",
    );
    await login(null);
    const anotherCounter = randomUUID();
    await q("insert into auth.users(id,email) values($1,'second@counter.test')", [anotherCounter]);
    await q("insert into profiles(id,full_name) values($1,'Second Counter')", [anotherCounter]);
    await q("insert into user_roles(user_id,role_key) values($1,'counter')", [anotherCounter]);
    await login(anotherCounter);
    await denied(bookSql, bookArgs, "Different Counter cannot claim original request");
    await denied(
      bookSql,
      [randomUUID(), invalidBooking.quote_id, customer, assignment, "Other actor", null],
      "Different Counter cannot consume private quote",
    );
    await login(users.counter);
    for (const cuts of [
      [cut(rows[0], 0)],
      [cut(rows[0], -1)],
      [cut(rows[0], 0.1)],
      [cut(rows[0], 9001)],
      [cut(rows[0], 1), cut(rows[0], 1)],
      [cut({ id: randomUUID() }, 1)],
    ])
      await denied(
        quoteSql,
        [showroom, JSON.stringify(cuts), charge],
        "Invalid required quantity denied",
      );
    const stale = await quote([cut(rows[0], 1000)]);
    await login(users.owner);
    await q("select open_fabric_cp_correction($1,$2)", [stock, "New CP"]);
    await q("select domain_stock_entry_cp($1,12000)", [stock]);
    await login(users.counter);
    await denied(
      bookSql,
      [randomUUID(), stale.quote_id, customer, assignment, "Stale CP", null],
      "Changed CP requires new final quote",
    );
    const staleCharge = await quote([cut(rows[0], 1000)]);
    await login(users.owner);
    const newCharge = await one(chargeSql, ["P7-CH", "Applicable Charge", 30000]);
    await login(users.counter);
    await denied(
      bookSql,
      [randomUUID(), staleCharge.quote_id, customer, assignment, "Stale charge", null],
      "Changed charge requires new final quote",
    );
    await denied(
      quoteSql,
      [showroom, JSON.stringify([cut(rows[0], 1000)]), charge],
      "Stale charge selection denied",
    );
    check(
      (await one(bookSql, bookArgs)) === job,
      "Booked retry unaffected by later CP/charge/SP changes",
    );
    const multi = await quote([cut(rows[0], 1000), cut(rows[1], 1000)], newCharge);
    const multiArgs = [
      randomUUID(),
      multi.quote_id,
      customer,
      assignment,
      "Atomic multi-cut",
      null,
    ];
    await login(null);
    await db.exec(
      `create function phase7_test_failure() returns trigger language plpgsql as $$begin if NEW.kind='MATERIAL_ISSUE' and NEW.thaan_id='${rows[1].thaan_id}'::uuid then raise exception 'Test-only late-line failure';end if;return NEW;end$$;create trigger z_phase7_test_failure before insert on inventory_movements for each row execute function phase7_test_failure();`,
    );
    const beforeFailure = await snapshot();
    await login(users.counter);
    await denied(bookSql, multiArgs, "Late line failure aborts whole booking");
    await login(null);
    check(
      beforeFailure === (await snapshot()),
      "Rollback preserves all old tables after partial issue attempt",
    );
    check(
      await one("select count(*)=0 from customer_tailoring_jobs where request_id=$1", [
        multiArgs[0],
      ]),
      "No failed job remains",
    );
    await db.exec(
      "drop trigger z_phase7_test_failure on inventory_movements;drop function phase7_test_failure()",
    );
    await login(users.counter);
    const multiJob = await one(bookSql, multiArgs);
    check(multiJob, "Same request succeeds after rolled-back failure");
    await login(users.tailor);
    const assigned = (await history(job))[0];
    check(
      assigned && assigned.final_customer_price_paise === null,
      "Assigned Tailor sees job without price",
    );
    check(
      await one("select count(*)=0 from customer_tailoring_quotes"),
      "Tailor cannot read quote breakdown",
    );
    await denied("select customer_tailoring_catalog()", [], "Tailor cannot open Counter catalogue");
    await denied(
      quoteSql,
      [showroom, JSON.stringify([cut(rows[0], 1)]), newCharge],
      "Tailor cannot quote",
    );
    await denied(bookSql, bookArgs, "Tailor cannot create/book");
    await q("select set_customer_tailoring_status($1,'in_progress')", [job]);
    await q("select set_customer_tailoring_status($1,'ready')", [job]);
    await q("select set_customer_tailoring_status($1,'delivered')", [job]);
    check(
      (await history(job))[0].status === "delivered",
      "Assigned Tailor retains existing job-status permissions",
    );
    await login(otherTailor);
    check((await history(job)).length === 0, "Unrelated Tailor cannot read job");
    await denied(
      "select set_customer_tailoring_status($1,'in_progress')",
      [job],
      "Unrelated Tailor cannot change status",
    );
    await login(users.counter);
    const beforeStatus = await balance(showroom);
    await q("select set_customer_tailoring_status($1,'cancelled')", [job]);
    check((await history(job))[0].status === "cancelled", "Cancellation is an explicit job status");
    check(
      (await balance(showroom)) === beforeStatus,
      "Cancellation does not invent an automatic return",
    );
    check(
      (await history(job))[0].final_customer_price_paise === 35000,
      "Cancellation does not rewrite booked price",
    );
    await q("select set_customer_tailoring_status($1,'delivered')", [job]);
    await q("select set_customer_tailoring_status($1,'open')", [job]);
    check(
      (await history(job))[0].status === "open",
      "Existing reopening semantics retained without inventing transition graph",
    );
    await denied(
      "select set_customer_tailoring_status($1,'unknown')",
      [job],
      "Unknown status rejected",
    );
    await login(users.owner);
    const cost = await one("select owner_customer_tailoring_costs($1)", [job]);
    check(
      cost.fabric_cp_total_paise === 10000 &&
        cost.tailoring_charge_paise === 25000 &&
        cost.cuts[0].cp_paise_per_m === 10000,
      "Owner sees original CP+charge after revisions",
    );
    check(
      await one(
        "select count(*)=1 from order_items where order_id=$1 and sp_snapshot_paise is null and unit=$2 and quantity=1",
        [h.order_id, "job"],
      ),
      "Tailoring Order stores one job with no SP",
    );
    check(
      await one(
        "select count(*)=0 from inventory_movements where fabric_stock_id=$1 and kind in('SALE','WASTAGE')",
        [stock],
      ),
      "Tailoring does not create fabric SALE or automatic WASTAGE",
    );
    check(
      await one(
        "select count(*)=1 from erp_audit_records where entity_id=$1 and action='create_customer_tailoring'",
        [job],
      ),
      "One booking audit after retries",
    );
    const depletedQuote = await quote(
      [
        cut(
          rows[0],
          Number(
            await one(
              "select quantity from inventory_location_balances() where location_id=$1 and inventory_item_id=$2",
              [workshop, rows[0].id],
            ),
          ),
        ),
      ],
      newCharge,
      workshop,
    );
    const depletedArgs = [
      randomUUID(),
      depletedQuote.quote_id,
      customer,
      noSection,
      "Full internal Than",
      null,
    ];
    const depleted = await one(bookSql, depletedArgs);
    check((await one(bookSql, depletedArgs)) === depleted, "Full source issue retry");
    // Drain the remaining Showroom portion as Counter to test Phase 6 depletion safeguard reuse.
    await login(users.counter);
    const remaining = Number(
      await one(
        "select quantity from inventory_location_balances() where location_id=$1 and inventory_item_id=$2",
        [showroom, rows[0].id],
      ),
    );
    const lastQuote = await quote([cut(rows[0], remaining)], newCharge);
    const lastArgs = [randomUUID(), lastQuote.quote_id, customer, assignment, "Last cut", null];
    const lastJob = await one(bookSql, lastArgs);
    check(
      await one("select status='depleted' from thaans where id=$1", [rows[0].thaan_id]),
      "Counter full global issue depletes Than",
    );
    check((await one(bookSql, lastArgs)) === lastJob, "Retry after global depletion");
    await login(null);
    await denied(
      "update customer_tailoring_quotes set fabric_cp_total_paise=0 where id=$1",
      [quoted.quote_id],
      "Quote history immutable",
    );
    await denied(
      "update customer_tailoring_jobs set tailor_assignment_id=$1 where id=$2",
      [otherAssignment, job],
      "Booked job assignment immutable",
    );
    await denied(
      "update orders set final_customer_price_paise=0 where id=$1",
      [h.order_id],
      "Booked Order immutable",
    );
    await denied(
      "delete from order_items where order_id=$1",
      [h.order_id],
      "Booked Order items immutable",
    );
    await denied(
      "update job_material_requirements set quantity=2 where customer_tailoring_job_id=$1",
      [job],
      "Required quantity immutable",
    );
    await denied(
      "insert into job_material_requirements(customer_tailoring_job_id,fabric_stock_id,quantity,unit) values($1,$2,1000,'mm')",
      [job, stock],
      "Cannot append duplicate requirement",
    );
    await denied(
      "delete from material_issues where customer_tailoring_job_id=$1",
      [job],
      "Material issue immutable",
    );
    // Missing legacy CP must block tailoring; it must never substitute SP or zero.
    const legacyBatch = await one(
      "insert into receiving_batches(code,status) values('P7-LEGACY','committed') returning id",
    );
    const legacyBarcode = await one(
      "insert into barcodes(code,kind) values('P7-LEGACY-FAB','fabric') returning id",
    );
    const legacyStock = await one(
      "insert into fabric_stock(fabric_id,batch_id,barcode_id,entry_state) values($1,$2,$3,'legacy_pending') returning id",
      [fabric, legacyBatch, legacyBarcode],
    );
    const legacyThan = await one(
      "insert into thaans(barcode,fabric_id,batch_id,fabric_stock_id,original_mm,price_paise,status) values('P7-LEGACY-TH',$1,$2,$3,1000,999999,'active') returning id",
      [fabric, legacyBatch, legacyStock],
    );
    await q("insert into stock_movements(thaan_id,kind,delta_mm) values($1,'INWARD',1000)", [
      legacyThan,
    ]);
    await login(users.owner);
    const legacyItem = await one("select reconcile_inventory_item('fabric',$1,$2::jsonb,$3)", [
      legacyThan,
      JSON.stringify([{ location_id: workshop, quantity: 1000 }]),
      "Verified legacy location",
    ]);
    await login(users.counter);
    await denied(
      quoteSql,
      [workshop, JSON.stringify([cut({ id: legacyItem }, 1)]), newCharge],
      "Missing CP blocks tailoring quote despite legacy SP",
    );
    // Closed factory must stop fresh bookings, even for a still-valid price quote.
    const disabledQuote = await quote([cut(rows[1], 1)], newCharge, workshop);
    await login(null);
    await q(
      "update tailoring_factories set active=false where id=(select factory_id from tailor_assignments where id=$1)",
      [otherAssignment],
    );
    await login(users.counter);
    await denied(
      bookSql,
      [randomUUID(), disabledQuote.quote_id, customer, otherAssignment, "Closed Factory", null],
      "Inactive Factory assignment denied",
    );
    check(
      !(await one("select customer_tailoring_catalog()")).assignments.some(
        (a) => a.id === otherAssignment,
      ),
      "Inactive hierarchy excluded from picker",
    );
    await login(users.stock_entry);
    const secondBatch = await one(
      "insert into receiving_batches(code) values('P7-SECOND') returning id",
    );
    const secondStock = await one("select create_fabric_entry($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      fabric,
      secondBatch,
      "[2000]",
      20000,
    ]);
    await q("select complete_fabric_entry($1)", [secondStock]);
    await login(users.counter);
    const second = (await one("select customer_tailoring_catalog()")).stocks.find(
      (s) => s.id === secondStock,
    );
    const secondItem = { id: second.cuts[0].inventory_item_id };
    const mixedQuote = await quote(
      [cut(rows[1], 1000), cut(secondItem, 1000)],
      newCharge,
      workshop,
    );
    check(
      mixedQuote.final_customer_price_paise === 62000,
      "Different Fabric + Batch cost rates sum correctly with one selected charge",
    );
    const mixedJob = await one(bookSql, [
      randomUUID(),
      mixedQuote.quote_id,
      customer,
      assignment,
      "Mixed stock garment",
      null,
    ]);
    const mixedHistory = (await history(mixedJob))[0];
    check(
      mixedHistory.requirements.length === 2 && mixedHistory.issues.length === 2,
      "Multi-stock requirements preserve both identities",
    );
    // Quotes do not reserve stock: booking must recheck real availability.
    const movedQuote = await quote([cut(rows[1], 1)], newCharge);
    const movedAmount = Number(
      await one(
        "select quantity from inventory_location_balances() where location_id=$1 and inventory_item_id=$2",
        [showroom, rows[1].id],
      ),
    );
    await login(users.owner);
    await q("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      showroom,
      workshop,
      JSON.stringify([cut(rows[1], movedAmount)]),
      "Stock moved after quote",
    ]);
    await login(users.counter);
    await denied(
      bookSql,
      [randomUUID(), movedQuote.quote_id, customer, assignment, "Changed source stock", null],
      "Booking rejects stock moved after quote",
    );
    await login(users.owner);
    const floor = await one(
      "select manage_showroom_location(null,'P7-FLOOR','Tailoring Floor',true)",
    );
    await q("select post_inventory_transfer($1,$2,$3,$4::jsonb,$5)", [
      randomUUID(),
      workshop,
      floor,
      JSON.stringify([cut(secondItem, 1000)]),
      "Tailoring floor allocation",
    ]);
    const floorQuote = await quote([cut(secondItem, 1000)], newCharge, floor);
    const floorJob = await one(bookSql, [
      randomUUID(),
      floorQuote.quote_id,
      customer,
      assignment,
      "Floor garment",
      null,
    ]);
    check(
      (await history(floorJob))[0].source_name === "Tailoring Floor",
      "Dynamic Showroom sublocation issue supported",
    );
    for (const role of ["stock_entry", "ecommerce_manager"]) {
      await login(users[role]);
      await denied("select customer_tailoring_catalog()", [], role + " catalogue denied");
      await denied("select customer_tailoring_history(null,50)", [], role + " job history denied");
      await denied(bookSql, bookArgs, role + " booking denied");
      await denied("select owner_customer_tailoring_costs($1)", [job], role + " costs denied");
    }
    await login(users.counter);
    await denied(setupSql, setupArgs, "Counter hierarchy setup denied");
    await denied(chargeSql, ["P7-CH", "Applicable Charge", 1], "Counter charge editing denied");
    await login(null);
    await q("update profiles set active=false where id=$1", [users.counter]);
    await login(users.counter);
    await denied(
      "select customer_tailoring_history(null,50)",
      [],
      "Inactive Counter reader denied",
    );
    await denied(bookSql, bookArgs, "Inactive retry denied");
    await login(null);
    await db.exec("set role anon");
    await denied("select customer_tailoring_catalog()", [], "Anonymous execution revoked");
    await denied(bookSql, bookArgs, "Anonymous booking revoked");
    console.log(
      directory + (demo ? " demo" : " clean") + ": Phase 7 Customer Tailoring acceptance passed",
    );
  } finally {
    await db.close();
  }
}
console.log(`PASS: ${checks} Phase 7 customer / tailoring / pricing / security checks`);
