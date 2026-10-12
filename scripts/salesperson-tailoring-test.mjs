/** Full disposable PostgreSQL replay and populated feature/security integration. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
let checks = 0;
const check = (value, label) => {
  assert(value, label);
  checks++;
};
for (const [directory, demo] of [
  ["supabase/migrations", true],
  ["drizzle/migrations", true],
  ["supabase/migrations", false],
]) {
  const db = new PGlite();
  const q = async (sql, args = []) => {
    try {
      return (await db.query(sql, args)).rows;
    } catch (error) {
      throw new Error(sql + ": " + error.message);
    }
  };
  const one = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const denied = async (sql, args = []) => {
    let failure = false;
    try {
      await q(sql, args);
    } catch {
      failure = true;
    }
    check(failure, "Denied: " + sql);
  };
  const login = async (id) => {
    await db.exec("reset role");
    await q("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
    if (id) await db.exec("set role authenticated");
  };
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`,
    );
    let oldTables, before;
    const snapshot = async () => {
      const result = {};
      for (const row of oldTables)
        result[row.name] = await q(
          `select to_jsonb(t)-'salesperson_user_id' data from public."${row.name}" t order by (to_jsonb(t)-'salesperson_user_id')::text`,
        );
      return JSON.stringify(result);
    };
    for (const file of (await fs.readdir(directory))
      .filter((file) => file.endsWith(".sql") && !file.includes("_labels_first_stock_entry") && !file.includes("_optional_thaan_details") && !file.includes("_live_"))
      .sort()) {
      if (!demo && file.includes("demo_seed")) continue;
      if (file.includes("_salesperson_tailoring_pricing")) {
        oldTables = await q(
          "select tablename name from pg_tables where schemaname='public' and tablename not in ('roles','permissions','role_permissions','erp_audit_records') order by tablename",
        );
        before = await snapshot();
      }
      await db.exec(await fs.readFile(resolve(directory, file), "utf8"));
    }

    check(before === (await snapshot()), "All pre-existing business rows preserved");
    const users = {};
    for (const role of [
      "owner",
      "stock_entry",
      "other_stock",
      "counter",
      "tailor",
      "ecommerce_manager",
      "salesperson",
      "other_salesperson",
    ]) {
      const id = (users[role] = randomUUID());
      await q("insert into auth.users values($1,$2)", [id, role + "@registration.test"]);
      await q("insert into profiles(id,full_name)values($1,$2)", [id, role]);
      await q("insert into user_roles(user_id,role_key)values($1,$2)", [
        id,
        role === "other_stock"
          ? "stock_entry"
          : role === "other_salesperson"
            ? "salesperson"
            : role,
      ]);
    }

    await login(users.owner);
    const customer = randomUUID();
    await q("insert into customers(id,name)values($1,'Attribution customer')", [customer]);
    const assignment = await one(
      "select setup_customer_tailoring_assignment('REV-A','Factory A','REV-S','Section A','REV-T','Tailor A',$1)",
      [users.tailor],
    );
    const workshop = await one("select id from locations where kind='workshop'");
    const floor = await one(
      "select manage_showroom_location(null,'REV-SALES-F','Sales Floor',true)",
    );
    await login(users.stock_entry);
    const batch = await one("select register_delivery_batch($1,'Raymonds')", [randomUUID()]);
    await one("select register_fabric_type($1,$2,'Attribution cloth',$3::jsonb)", [
      randomUUID(),
      batch,
      JSON.stringify([
        { length_mm: 50000, cp_paise_per_m: 12500 },
        { length_mm: 10000, cp_paise_per_m: null },
      ]),
    ]);
    const variants = (await one("select stock_registration_catalog($1)", [batch]))[0]
      .fabric_types[0].variants;
    const ids = [];
    for (const v of variants)
      ids.push(
        (
          await q("select inventory_item_id from inventory_catalog() where item_id=$1", [
            v.thaan_id,
          ])
        )[0].inventory_item_id,
      );
    await one("select post_inventory_transfer($1,$2,$3,$4::jsonb,'Sales allocation')", [
      randomUUID(),
      workshop,
      floor,
      JSON.stringify(
        ids.map((id, i) => ({ inventory_item_id: id, quantity: i === 0 ? 30000 : 10000 })),
      ),
    ]);
    await login(users.counter);
    const options = await one("select salesperson_options()");
    check(
      options.some((p) => p.id === users.salesperson) &&
        options.some((p) => p.id === users.other_salesperson),
      "Separate eligible Salesperson IDs",
    );
    check(!options.some((p) => p.id === users.counter), "Counter alone is not a Salesperson");
    const saleRows = JSON.stringify([
      { inventory_item_id: ids[0], quantity: 2500, sp_paise_per_m: 33333 },
    ]);
    const saleQuery = "select complete_counter_fabric_sale($1,$2,$3::jsonb,null,true,null,$4)";
    const saleRequest = randomUUID();
    const sale = await one(saleQuery, [saleRequest, floor, saleRows, users.salesperson]);
    check(
      sale === (await one(saleQuery, [saleRequest, floor, saleRows, users.salesperson])),
      "Exact priced sale retry",
    );
    await denied(saleQuery, [saleRequest, floor, saleRows, users.other_salesperson]);
    for (const person of [null, users.counter, randomUUID()])
      await denied(saleQuery, [randomUUID(), floor, saleRows, person]);
    const booking =
      "select book_counter_tailoring($1,$2,$3::jsonb,$4,$5,$6,$7,'Suit','Customer notes')";
    const cuts = JSON.stringify([
      { inventory_item_id: ids[0], quantity: 3000 },
      { inventory_item_id: ids[1], quantity: 1000 },
    ]);
    const request = randomUUID();
    const args = [request, floor, cuts, 98765, customer, assignment, users.salesperson];
    const job = await one(booking, args);
    check(job === (await one(booking, args)), "Exact tailoring booking retry");
    await denied(booking, [request, floor, cuts, 98766, customer, assignment, users.salesperson]);
    await denied(booking, [
      request,
      floor,
      cuts,
      98765,
      customer,
      assignment,
      users.other_salesperson,
    ]);
    const history = (await one("select customer_tailoring_history($1)", [job]))[0];
    check(
      history.final_customer_price_paise === 98765,
      "Manual final total, no CP plus charge formula",
    );
    check(
      history.salesperson_user_id === users.salesperson && history.created_by === users.counter,
      "Credited staff distinct from operator",
    );
    check(history.issues.length === 2, "Exactly one issue per initial fabric cut");
    await login(users.owner);
    const bookRow = (
      await q(
        "select salesperson_user_id,created_by from orders where customer_tailoring_job_id=$1",
        [job],
      )
    )[0];
    check(
      bookRow.salesperson_user_id === users.salesperson && bookRow.created_by === users.counter,
      "Bill attribution matches linked job",
    );
    const costs = await one("select owner_customer_tailoring_costs($1)", [job]);
    check(
      costs.fabric_cp_total_paise === null && costs.tailoring_charge_paise === null,
      "Unknown internal cost stays unknown; no fake charge",
    );
    check(
      costs.cuts[0].cp_paise_per_m === 12500 || costs.cuts[1].cp_paise_per_m === 12500,
      "Known CP remains protected snapshot",
    );
    await one("select fill_registered_thaan_cp($1,$2,12345)", [randomUUID(), variants[1].code]);
    check(
      (await one("select owner_customer_tailoring_costs($1)", [job])).fabric_cp_total_paise ===
        null,
      "Later CP fill does not rewrite original unknown tailoring cost",
    );
    check(
      (await one(
        "select count(*)::int from customer_tailoring_quotes where id=(select quote_id from customer_tailoring_jobs where id=$1)",
        [job],
      )) === 0,
      "No CP-derived quote created",
    );
    check(
      Number(
        await one(
          "select sum(quantity) from inventory_location_balances() where inventory_item_id=$1",
          [ids[0]],
        ),
      ) === 44500,
      "Sale plus tailoring deduct each quantity only once",
    );
    check(
      Number(
        await one(
          "select sum(quantity) from inventory_location_balances() where inventory_item_id=$1",
          [ids[1]],
        ),
      ) === 9000,
      "Missing CP fabric may be booked at Counter total",
    );
    const report = await one("select owner_erp_report('customer_tailoring')");
    check(JSON.stringify(report).includes("98765"), "Owner report includes manually priced job");
    const order = (await q("select id from orders where customer_tailoring_job_id=$1", [job]))[0]
      .id;
    await denied("update orders set salesperson_user_id=$1 where id=$2", [
      users.other_salesperson,
      order,
    ]);
    await denied("update customer_tailoring_jobs set salesperson_user_id=$1 where id=$2", [
      users.other_salesperson,
      job,
    ]);
    await denied("delete from counter_tailoring_prices where job_id=$1", [job]);
    await login(users.salesperson);
    const work = await one("select salesperson_work()");
    check(
      work.length === 2 && work.every((w) => w.salesperson_user_id === users.salesperson),
      "Personal work includes own sale and linked job only",
    );
    check(
      !JSON.stringify(work).match(/cp_|cost_|charge_|request_payload/),
      "Personal work has no private cost or retry payload",
    );
    check(
      work.find((w) => w.job_id === job).job_status === "open",
      "Own tailoring progress visible",
    );
    await denied("select salesperson_work($1)", [users.other_salesperson]);
    check(
      (await one("select count(*)::int from orders")) === 0,
      "Pure Salesperson cannot read all raw bills",
    );
    check(
      (await one("select count(*)::int from counter_tailoring_prices")) === 0,
      "Pure Salesperson cannot read internal costs",
    );
    await denied("select owner_customer_tailoring_costs($1)", [job]);
    await denied("select salesperson_options()");
    await denied(saleQuery, [randomUUID(), floor, saleRows, users.salesperson]);
    await login(users.other_salesperson);
    check(
      (await one("select salesperson_work()")).length === 0,
      "Another Salesperson sees no work",
    );
    await login(users.counter);
    await denied("select salesperson_work()");
    for (const badPrice of [-1, null, 9007199254740992])
      await denied(booking, [
        randomUUID(),
        floor,
        cuts,
        badPrice,
        customer,
        assignment,
        users.salesperson,
      ]);
    const tooMuch = JSON.stringify([{ inventory_item_id: ids[0], quantity: 100000 }]);
    await denied(booking, [
      randomUUID(),
      floor,
      tooMuch,
      1,
      customer,
      assignment,
      users.salesperson,
    ]);
    await login(users.owner);
    await one("select owner_set_user_permission($1,'pos.enter_tailoring_total',false)", [
      users.counter,
    ]);
    await login(users.counter);
    await denied(booking, [randomUUID(), floor, cuts, 1, customer, assignment, users.salesperson]);
    await login(users.owner);
    await one("select owner_set_user_permission($1,'pos.enter_tailoring_total',null)", [
      users.counter,
    ]);
    await one("select owner_set_user_permission($1,'salesperson.view_work',false)", [
      users.salesperson,
    ]);
    await login(users.salesperson);
    await denied("select salesperson_work()");
    await login(users.owner);
    await one("select owner_set_user_permission($1,'salesperson.view_work',null)", [
      users.salesperson,
    ]);
    await one("select set_customer_tailoring_status($1,'ready')", [job]);
    await login(users.salesperson);
    check(
      (await one("select salesperson_work()")).find((w) => w.job_id === job).job_status === "ready",
      "Progress updates without changing credit",
    );
    const first = (await one("select salesperson_work(null,null,null,1)"))[0];
    const next = await one("select salesperson_work(null,$1,$2,1)", [first.created_at, first.id]);
    check(next.length === 1 && next[0].id !== first.id, "Keyset work pagination");
    await login(users.owner);
    check((await one("select salesperson_work()")).length === 2, "Owner sees all attributed work");
    await q("update profiles set active=false where id=$1", [users.salesperson]);
    await login(users.counter);
    await denied(saleQuery, [randomUUID(), floor, saleRows, users.salesperson]);
    await login(users.owner);
    check(
      (await one("select salesperson_work()")).length === 2,
      "Deactivation preserves historical credit",
    );
    await login(users.salesperson);
    await denied("select salesperson_work()");
    await login(users.owner);
    const productionProduct = await one(
      "select manage_production_catalog($1,'product',null,'REV-P','Revised Product',true,null,'Test configuration')",
      [randomUUID()],
    );
    const productionDesign = await one(
      "select manage_production_catalog($1,'design',null,'REV-D','Revised Design',true,0,'Explicit zero design charge')",
      [randomUUID()],
    );
    const production = await one(
      "select create_owner_production($1,$2,$3,1,$4,$5,$6::jsonb,null,'One explicit test piece')",
      [
        randomUUID(),
        productionProduct,
        productionDesign,
        assignment,
        workshop,
        JSON.stringify([{ inventory_item_id: ids[0], quantity: 1000 }]),
      ],
    );
    const issueLine = await one(
      "select l.id from material_issue_lines l join material_issues m on m.id=l.material_issue_id where m.production_job_id=$1",
      [production],
    );
    await one("select progress_owner_production($1,$2,'open','in_progress','Start')", [
      randomUUID(),
      production,
    ]);
    await one(
      "select progress_owner_production($1,$2,'in_progress','completed','Physical completion')",
      [randomUUID(), production],
    );
    await one("select receive_finished_products($1,$2,$3::jsonb,'Actual receipt')", [
      randomUUID(),
      production,
      JSON.stringify([
        { piece_number: 1, materials: [{ issue_line_id: issueLine, quantity: 1000 }] },
      ]),
    ]);
    const costId = await one(
      "select id from fabric_stock_costs where fabric_stock_id=$1 order by revision desc limit 1",
      [variants[0].stock_id],
    );
    const version = await one(
      "select finalize_production_cost($1,$2,null,$3::jsonb,10000,'job_total','[]'::jsonb,'Explicit actual test costs')",
      [
        randomUUID(),
        production,
        JSON.stringify([{ issue_line_id: issueLine, quantity: 1000, fabric_cost_id: costId }]),
      ],
    );
    const piece = (await one("select finished_product_catalog(null,$1)", [production]))[0];
    await one(
      "select set_finished_product_sp($1,$2,$3,$4::jsonb,'Owner finished product SP unchanged')",
      [
        randomUUID(),
        production,
        version,
        JSON.stringify([{ piece_id: piece.id, sp_paise: 45000 }]),
      ],
    );
    const productScan = await one("select finished_product_sale_scan($1)", [piece.barcode]);
    await login(users.counter);
    const productRequest = randomUUID();
    const productItems = JSON.stringify([
      { piece_id: piece.id, sp_version_id: productScan.sp_version_id },
    ]);
    const productQuery = "select complete_finished_product_sale($1,$2,$3::jsonb,null,true,null,$4)";
    const productOrder = await one(productQuery, [
      productRequest,
      workshop,
      productItems,
      users.other_salesperson,
    ]);
    check(
      productOrder ===
        (await one(productQuery, [
          productRequest,
          workshop,
          productItems,
          users.other_salesperson,
        ])),
      "Finished Product attributed sale retry",
    );
    await login(users.other_salesperson);
    const productWork = await one("select salesperson_work()");
    check(
      productWork.length === 1 &&
        productWork[0].kind === "finished_product_sale" &&
        productWork[0].final_customer_price_paise === "45000",
      "Finished Product bill credit with unchanged pricing",
    );
    check(
      !JSON.stringify(productWork).match(/cost_|cp_|request_payload/),
      "Finished Product work excludes production cost",
    );
    console.log(directory + (demo ? " demo" : " clean") + ": Salesperson/tailoring verified");
  } finally {
    await db.close();
  }
}
await fs.writeFile(
  "docs/SALESPERSON_TAILORING_DATABASE_VERIFICATION.json",
  JSON.stringify(
    {
      verified_at: new Date().toISOString(),
      checks,
      chains: ["Supabase demo", "Drizzle demo", "Supabase clean"],
    },
    null,
    2,
  ),
);
console.log(`PASS: ${checks} Salesperson/manual tailoring checks`);
