/** Disposable PostgreSQL replay. Never reads .env or connects to a live server.
 * Usage: node scripts/phase1-schema-test.mjs /absolute/path/to/pglite/dist/index.js
 * Install @electric-sql/pglite in a temporary directory, not the application.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const runtime = process.argv[2];
if (!runtime) throw new Error("Provide the absolute PGlite module path; no live DB is supported");
const { PGlite } = await import(pathToFileURL(resolve(runtime)).href);
const tables = [
  "locations",
  "tailoring_factories",
  "tailoring_sections",
  "tailors",
  "tailor_assignments",
  "barcodes",
  "fabric_stock",
  "fabric_stock_costs",
  "fabric_stock_prices",
  "domain_reconciliation",
  "tailoring_charges",
  "tailoring_charge_versions",
  "designs",
  "design_charge_versions",
  "products",
  "customer_tailoring_jobs",
  "customer_tailoring_prices",
  "production_jobs",
  "finished_products",
  "finished_product_prices",
  "job_material_requirements",
  "material_issues",
  "material_issue_lines",
  "stock_transfers",
  "stock_transfer_lines",
  "orders",
  "order_items",
  "order_item_financials",
  "inventory_movements",
  "production_cost_versions",
  "production_cost_lines",
  "finished_product_materials",
  "finished_product_cost_allocations",
  "erp_audit_records",
];
let passed = 0;
async function replay(directory, withDemo = true) {
  const db = new PGlite();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const scalar = async (sql, params = []) => Object.values((await q(sql, params))[0])[0];
  const insert = async (table, values) => {
    const keys = Object.keys(values);
    return (
      await q(
        `insert into public.${table} (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning *`,
        Object.values(values),
      )
    )[0];
  };
  const check = (value, label) => {
    assert.ok(value, label);
    passed++;
  };
  const reject = async (sql, params, label, pattern = /./s) => {
    let error;
    try {
      await q(sql, params);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, `${label}: unexpectedly accepted`);
    assert.match(error.message, pattern, label);
    passed++;
  };
  try {
    // Minimal Supabase infrastructure shim; business SQL is replayed unmodified.
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated,anon,service_role;
      grant execute on function auth.uid() to authenticated,anon,service_role;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
    `);
    const files = (await readdir(directory))
      .filter(
        (file) =>
          file.endsWith(".sql") &&
          !file.includes("_live_") &&
          !file.includes("phase2_") &&
          !file.includes("phase3_") &&
          !file.includes("phase4_") &&
          !file.includes("phase5_") &&
          !file.includes("phase6_") &&
          !file.includes("phase7_") &&
          !file.includes("phase8_") &&
          !file.includes("phase9_") &&
          !file.includes("phase10_") &&
          !file.includes("phase11_") &&
          !file.includes("phase12_") &&
          !file.includes("phase13_") &&
          !file.includes("phase14_") &&
          !file.includes("phase15_"),
      )
      .sort();
    assert.equal(files.length, 11, "Expected ten historical migrations and one Phase 1 migration");
    for (const file of files.slice(0, -1)) {
      if (withDemo || !file.includes("demo_seed_data"))
        await db.exec(await readFile(resolve(directory, file), "utf8"));
    }
    if (!withDemo) {
      await db.exec(await readFile(resolve(directory, files.at(-1)), "utf8"));
      check(
        await scalar("select count(*)=2 from locations"),
        "Clean install has only two specified roots",
      );
      check(
        await scalar("select count(*)=0 from fabric_stock"),
        "Clean install fabric inventory not fabricated",
      );
      check(
        await scalar("select count(*)=0 from domain_reconciliation"),
        "Clean install has no invented reconciliation issues",
      );
      check(
        await scalar(
          "select count(*)=3 from pg_constraint where conname in ('profiles_auth_user_fkey','user_roles_profile_fkey','permission_overrides_profile_fkey') and convalidated",
        ),
        "Clean install user FKs fully validated",
      );
      console.log("Fresh chain without demo data: PASS");
      return;
    }
    const oldTables = (
      await q("select tablename from pg_tables where schemaname='public' order by tablename")
    ).map((row) => row.tablename);
    const fabric = await insert("fabrics", {
      code: "TEST-MIXED",
      name: "Conflicting legacy prices",
    });
    const batch = await insert("receiving_batches", { code: "TEST-BATCH" });
    for (const [index, price] of [10000, 15000].entries()) {
      const roll = await insert("thaans", {
        barcode: `TEST-ROLL-${index}`,
        fabric_id: fabric.id,
        batch_id: batch.id,
        original_mm: 10000,
        price_paise: price,
      });
      await insert("thaan_costs", { thaan_id: roll.id, cost_paise: price / 2 });
    }
    const missing = await insert("thaans", { barcode: "TEST-MISSING-IDENTITY" });
    const orphanProfile = await insert("profiles", {
      id: randomUUID(),
      full_name: "Historical orphan",
      active: false,
    });
    const orphanRole = await insert("user_roles", { user_id: randomUUID(), role_key: "counter" });
    await insert("user_permission_overrides", {
      user_id: randomUUID(),
      permission_key: "reports.view",
      granted: false,
    });
    const snapshot = async () => {
      const result = {};
      for (const table of oldTables)
        result[table] = await q(
          `select to_jsonb(t) - 'fabric_stock_id' - 'active' as row from public.${table} t order by (to_jsonb(t) - 'fabric_stock_id' - 'active')::text`,
        );
      // profiles.active existed before Phase 1: verify it separately.
      result.profileActivation = await q("select id,active from public.profiles order by id");
      return result;
    };
    const before = await snapshot();
    await db.exec(await readFile(resolve(directory, files.at(-1)), "utf8"));
    assert.deepEqual(await snapshot(), before, "Migration rewrote historical data");
    passed++;
    check(
      await scalar(
        "select count(*)=1 from domain_reconciliation where legacy_id=$1 and issue='auth_user_reference_unverified'",
        [orphanProfile.id],
      ),
      "Legacy Auth orphan retained and flagged",
    );
    check(
      await scalar(
        "select count(*)=1 from domain_reconciliation where legacy_id=$1 and issue='profile_reference_unverified'",
        [orphanRole.id],
      ),
      "Legacy role orphan retained and flagged",
    );
    check(
      await scalar(
        "select count(*)=3 from pg_constraint where conname in ('profiles_auth_user_fkey','user_roles_profile_fkey','permission_overrides_profile_fkey') and not convalidated",
      ),
      "Orphaned legacy FKs explicitly remain unvalidated",
    );
    await reject(
      "insert into profiles(id,full_name) values($1,'Orphan')",
      [randomUUID()],
      "Profile references Auth user",
      /foreign key/,
    );
    await reject(
      "insert into user_roles(user_id,role_key) values($1,'counter')",
      [randomUUID()],
      "Role assignment references profile",
      /foreign key/,
    );
    const userId = randomUUID();
    await q("insert into auth.users(id,email) values($1,'owner@schema.test')", [userId]);
    await q("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
    await q("select bootstrap_current_user('Schema Owner')");
    check(
      await scalar("select has_role($1,'owner')", [userId]),
      "Existing Owner bootstrap still works with FKs",
    );
    check(
      await scalar(
        "select count(*)=0 from thaans where fabric_id is not null and batch_id is not null and fabric_stock_id is null",
      ),
      "All known legacy identities mapped",
    );
    check(
      await scalar(
        "select not exists (select 1 from fabric_stock group by fabric_id,batch_id having count(*)>1)",
      ),
      "One stock identity per Fabric + Batch",
    );
    check(
      await scalar("select fabric_stock_id is null from thaans where id=$1", [missing.id]),
      "Missing identity not guessed",
    );
    check(
      await scalar(
        "select count(*)=1 from domain_reconciliation where legacy_id=$1 and issue='missing_fabric_or_batch'",
        [missing.id],
      ),
      "Missing identity recorded",
    );
    const mixed = (await q("select * from fabric_stock where fabric_id=$1", [fabric.id]))[0];
    check(
      await scalar("select count(*)=0 from fabric_stock_costs where fabric_stock_id=$1", [
        mixed.id,
      ]),
      "Conflicting CP not selected/averaged",
    );
    check(
      await scalar("select count(*)=0 from fabric_stock_prices where fabric_stock_id=$1", [
        mixed.id,
      ]),
      "Conflicting SP not selected/averaged",
    );
    check(
      await scalar(
        "select count(*)=2 from domain_reconciliation where legacy_id=$1 and issue in ('cp_requires_reconciliation','sp_requires_reconciliation')",
        [mixed.id],
      ),
      "Conflicting financial values recorded",
    );
    check(
      await scalar(
        "select count(*)=1 from fabric_stock s join fabrics f on f.id=s.fabric_id join receiving_batches b on b.id=s.batch_id where f.code='FB-NAVY-PS' and b.code='RB-2601'",
      ),
      "Three demo Navy rolls share one identity",
    );
    check(
      await scalar("select count(*)=0 from inventory_movements"),
      "No guessed opening location movements",
    );
    check(
      await scalar("select count(*)=0 from customer_tailoring_jobs"),
      "No fabricated Customer Tailoring migration",
    );
    check(
      await scalar("select count(*)=0 from production_jobs"),
      "No shop-stock production guessed",
    );
    for (const table of tables) {
      check(
        await scalar("select relrowsecurity from pg_class where oid=$1::regclass", [
          `public.${table}`,
        ]),
        `${table}: RLS enabled`,
      );
      check(
        await scalar(
          "select not has_table_privilege('authenticated',$1,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('anon',$1,'SELECT,INSERT,UPDATE,DELETE')",
          [`public.${table}`],
        ),
        `${table}: browser access sealed`,
      );
    }
    const workshop = (await q("select * from locations where kind='workshop'"))[0];
    const showroom = (await q("select * from locations where kind='showroom'"))[0];
    for (let i = 1; i <= 5; i++)
      await insert("locations", {
        code: `FLOOR-${i}`,
        name: `Floor ${i}`,
        kind: "showroom_sublocation",
        parent_id: showroom.id,
      });
    passed++;
    await reject(
      "insert into locations(code,name,kind) values('SECOND','Second','workshop')",
      [],
      "One Workshop",
      /unique/,
    );
    await reject(
      "insert into locations(code,name,kind,parent_id) values('WRONG','Wrong','showroom_sublocation',$1)",
      [workshop.id],
      "Invalid floor parent",
      /Showroom/,
    );
    await reject(
      "update locations set kind='workshop' where id=$1",
      [showroom.id],
      "Location hierarchy immutable",
      /identity/,
    );
    const factory = await insert("tailoring_factories", { code: "FA", name: "Factory A" });
    const otherFactory = await insert("tailoring_factories", { code: "FB", name: "Factory B" });
    const section = await insert("tailoring_sections", {
      factory_id: factory.id,
      code: "SA",
      name: "Section A",
    });
    const tailor = await insert("tailors", { code: "T-TEST", real_name: "Test Tailor" });
    const assignment = await insert("tailor_assignments", {
      tailor_id: tailor.id,
      factory_id: factory.id,
      section_id: section.id,
    });
    await reject(
      "insert into tailor_assignments(tailor_id,factory_id,section_id,valid_until) values($1,$2,$3,now()+interval '1 day')",
      [tailor.id, otherFactory.id, section.id],
      "Section belongs to Factory",
      /foreign key/,
    );
    const customer = await insert("customers", {
      name: "Schema Test",
      whatsapp_phone: "+910000000001",
    });
    const charge = await insert("tailoring_charges", {
      code: "CH",
      name: "Owner-configured charge",
    });
    const chargeVersion = await insert("tailoring_charge_versions", {
      charge_id: charge.id,
      revision: 1,
      amount_paise: 80000,
    });
    const job = await insert("customer_tailoring_jobs", {
      code: "CJ-TEST",
      customer_id: customer.id,
      garment: "Suit",
      tailor_assignment_id: assignment.id,
      tailoring_charge_version_id: chargeVersion.id,
    });
    await reject(
      "insert into customer_tailoring_jobs(code,garment,tailor_assignment_id) values('NO-CUSTOMER','Suit',$1)",
      [assignment.id],
      "Customer Tailoring requires customer",
      /not-null/,
    );
    const tailoringPrice = await insert("customer_tailoring_prices", {
      job_id: job.id,
      revision: 1,
      fabric_cp_total_paise: 100000,
      tailoring_charge_paise: 80000,
      charge_version_id: chargeVersion.id,
    });
    check(
      Number(tailoringPrice.final_customer_price_paise) === 180000,
      "Customer Tailoring model uses CP + charge without SP",
    );
    const design = await insert("designs", { code: "DESIGN", name: "Test Design" });
    const otherDesign = await insert("designs", { code: "OTHER-DESIGN", name: "Other Design" });
    const designPrice = await insert("design_charge_versions", {
      design_id: design.id,
      revision: 1,
      amount_paise: 30000,
    });
    const product = await insert("products", { code: "PRODUCT", name: "Test Kurta" });
    const production = await insert("production_jobs", {
      code: "PJ-TEST",
      product_id: product.id,
      design_id: design.id,
      design_charge_version_id: designPrice.id,
      quantity: 10,
      tailor_assignment_id: assignment.id,
    });
    await reject(
      "insert into production_jobs(code,product_id,design_id,design_charge_version_id,quantity,tailor_assignment_id) values('WRONG-DESIGN',$1,$2,$3,1,$4)",
      [product.id, otherDesign.id, designPrice.id, assignment.id],
      "Design charge belongs to Design",
      /foreign key/,
    );
    await reject(
      "insert into production_jobs(code,product_id,design_id,quantity,tailor_assignment_id) values('ZERO',$1,$2,0,$3)",
      [product.id, design.id, assignment.id],
      "Production quantity positive",
      /check constraint/,
    );
    check(!Object.hasOwn(production, "customer_id"), "Owner Production has no customer field");
    const fabricBarcode = await insert("barcodes", { code: "FAB-TEST", kind: "fabric" });
    const freshFabric = await insert("fabrics", { code: "FRESH", name: "Fresh Fabric" });
    const stock = await insert("fabric_stock", {
      fabric_id: freshFabric.id,
      batch_id: batch.id,
      barcode_id: fabricBarcode.id,
    });
    const roll = await insert("thaans", {
      fabric_id: freshFabric.id,
      batch_id: batch.id,
      fabric_stock_id: stock.id,
      original_mm: 10000,
    });
    check(
      roll.barcode === null && roll.price_paise === null,
      "Internal Than requires neither roll barcode nor SP",
    );
    await reject(
      "insert into fabric_stock(fabric_id,batch_id,barcode_id) values($1,$2,$3)",
      [freshFabric.id, batch.id, randomUUID()],
      "Duplicate Fabric + Batch",
      /unique|foreign key/,
    );
    await reject(
      "insert into thaans(fabric_id,batch_id,fabric_stock_id) values($1,$2,$3)",
      [fabric.id, batch.id, stock.id],
      "Than belongs to exact identity",
      /foreign key/,
    );
    const pieces = [];
    for (let i = 1; i <= 10; i++) {
      const barcode = await insert("barcodes", { code: `PRODUCT-TEST-${i}`, kind: "product" });
      pieces.push(
        await insert("finished_products", {
          production_job_id: production.id,
          product_id: product.id,
          design_id: design.id,
          piece_number: i,
          barcode_id: barcode.id,
          current_location_id: workshop.id,
        }),
      );
    }
    check(
      pieces.length === 10 && new Set(pieces.map((piece) => piece.barcode_id)).size === 10,
      "Ten piece records / unique Product Barcodes",
    );
    const extraBarcode = await insert("barcodes", { code: "PRODUCT-EXTRA", kind: "product" });
    await reject(
      "insert into finished_products(production_job_id,product_id,design_id,piece_number,barcode_id,current_location_id) values($1,$2,$3,11,$4,$5)",
      [production.id, product.id, design.id, extraBarcode.id, workshop.id],
      "Piece number bounded",
      /quantity/,
    );
    await reject(
      "update production_jobs set quantity=9 where id=$1",
      [production.id],
      "Quantity cannot discard piece genealogy",
      /Finished Products/,
    );
    const secondProduction = await insert("production_jobs", {
      code: "PJ-SECOND",
      product_id: product.id,
      design_id: otherDesign.id,
      quantity: 1,
      tailor_assignment_id: assignment.id,
    });
    await reject(
      "insert into finished_products(production_job_id,product_id,design_id,piece_number,barcode_id,current_location_id) values($1,$2,$3,1,$4,$5)",
      [secondProduction.id, product.id, otherDesign.id, extraBarcode.id, showroom.id],
      "Workshop first",
      /Workshop/,
    );
    await reject(
      "insert into finished_products(production_job_id,product_id,design_id,piece_number,barcode_id,current_location_id) values($1,$2,$3,1,$4,$5)",
      [secondProduction.id, product.id, otherDesign.id, fabricBarcode.id, workshop.id],
      "Product cannot use Fabric Barcode",
      /unique|foreign key/,
    );
    await reject(
      "insert into barcodes(code,kind) values('FAB-TEST','product')",
      [],
      "Global barcode unique",
      /unique/,
    );
    await insert("fabric_stock_costs", {
      fabric_stock_id: stock.id,
      revision: 1,
      cp_paise_per_m: 50000,
    });
    await insert("fabric_stock_prices", {
      fabric_stock_id: stock.id,
      revision: 1,
      sp_paise_per_m: 85000,
    });
    await insert("fabric_stock_prices", {
      fabric_stock_id: stock.id,
      revision: 2,
      sp_paise_per_m: 90000,
    });
    check(
      await scalar("select barcode_id=$2 from fabric_stock where id=$1", [
        stock.id,
        fabricBarcode.id,
      ]),
      "Price revision retains same barcode",
    );
    await reject(
      "update fabric_stock set barcode_id=$2 where id=$1",
      [stock.id, extraBarcode.id],
      "Fabric Barcode identity immutable",
      /identity/,
    );
    await reject(
      "update production_jobs set design_id=$2,design_charge_version_id=null where id=$1",
      [production.id, otherDesign.id],
      "Different design requires different job",
      /different Production Job/,
    );
    await reject(
      "update tailor_assignments set section_id=null where id=$1",
      [assignment.id],
      "Assignment genealogy immutable",
      /new assignment/,
    );
    await reject(
      "update fabric_stock_prices set sp_paise_per_m=1 where fabric_stock_id=$1",
      [stock.id],
      "Financial history immutable",
      /append-only/,
    );
    const material = await insert("materials", { name: "Thread", unit: "spool" });
    const issue = await insert("material_issues", {
      code: "MI-TEST",
      production_job_id: production.id,
      tailor_assignment_id: assignment.id,
      source_location_id: workshop.id,
    });
    const issued = await insert("material_issue_lines", {
      material_issue_id: issue.id,
      thaan_id: roll.id,
      fabric_stock_id: stock.id,
      quantity: 4000,
      unit: "mm",
    });
    await insert("material_issue_lines", {
      material_issue_id: issue.id,
      material_id: material.id,
      quantity: 1,
      unit: "spool",
    });
    await reject(
      "delete from material_issues where id=$1",
      [issue.id],
      "Issue history immutable",
      /append-only/,
    );
    await reject(
      "insert into material_issue_lines(material_issue_id,material_id,quantity,unit) values($1,$2,1,'pc')",
      [issue.id, material.id],
      "Consumable units match",
      /unit/,
    );
    await reject(
      "insert into material_issues(code,production_job_id,customer_tailoring_job_id,tailor_assignment_id,source_location_id) values('MIXED',$1,$2,$3,$4)",
      [production.id, job.id, assignment.id, workshop.id],
      "One issue domain only",
      /check constraint/,
    );
    await insert("finished_product_materials", {
      finished_product_id: pieces[0].id,
      production_job_id: production.id,
      material_issue_line_id: issued.id,
      quantity: 400,
      unit: "mm",
    });
    await reject(
      "insert into finished_product_materials(finished_product_id,production_job_id,material_issue_line_id,quantity,unit) values($1,$2,$3,4000,'mm')",
      [pieces[1].id, production.id, issued.id],
      "Cannot overallocate material genealogy",
      /exceed/,
    );
    await reject(
      "insert into finished_product_materials(finished_product_id,production_job_id,material_issue_line_id,quantity,unit) values($1,$2,$3,0.5,'mm')",
      [pieces[1].id, production.id, issued.id],
      "Fabric units integer mm",
      /check constraint/,
    );
    await reject(
      "insert into production_cost_versions(production_job_id,revision,quantity_snapshot) values($1,2,9)",
      [production.id],
      "Cost quantity snapshot matches job",
      /snapshot/,
    );
    const cost = await insert("production_cost_versions", {
      production_job_id: production.id,
      revision: 1,
      quantity_snapshot: 10,
    });
    const foreignDesignCharge = await insert("design_charge_versions", {
      design_id: otherDesign.id,
      revision: 1,
      amount_paise: 10000,
    });
    await reject(
      "insert into production_cost_lines(cost_version_id,category,amount_paise,design_charge_version_id) values($1,'design_embroidery',10000,$2)",
      [cost.id, foreignDesignCharge.id],
      "Cost design belongs to job",
      /Production Job design/,
    );
    const otherCost = await insert("production_cost_versions", {
      production_job_id: secondProduction.id,
      revision: 1,
      quantity_snapshot: 1,
    });
    await reject(
      "insert into production_cost_lines(cost_version_id,category,amount_paise,material_issue_line_id) values($1,'fabric',10000,$2)",
      [otherCost.id, issued.id],
      "Cost material originates from same job",
      /same Production Job/,
    );
    for (const category of [
      "fabric",
      "tailoring_production",
      "design_embroidery",
      "buttons",
      "thread",
      "padding",
      "other_consumables",
      "other_production",
    ])
      await insert("production_cost_lines", {
        cost_version_id: cost.id,
        category,
        amount_paise: 25000,
      });
    check(
      Number(
        await scalar(
          "select sum(amount_paise)/10 from production_cost_lines where cost_version_id=$1",
          [cost.id],
        ),
      ) === 20000,
      "Cost model holds all eight categories and supports per-piece derivation",
    );
    await insert("finished_product_cost_allocations", {
      finished_product_id: pieces[0].id,
      production_job_id: production.id,
      cost_version_id: cost.id,
      amount_paise: 20000,
    });
    await reject(
      "insert into finished_product_cost_allocations(finished_product_id,production_job_id,cost_version_id,amount_paise) values($1,$2,$3,1)",
      [pieces[1].id, secondProduction.id, cost.id],
      "Allocation belongs to same job",
      /foreign key/,
    );
    const transfer = await insert("stock_transfers", {
      code: "TR-TEST",
      source_location_id: workshop.id,
      destination_location_id: showroom.id,
    });
    const transferLine = await insert("stock_transfer_lines", {
      transfer_id: transfer.id,
      fabric_stock_id: stock.id,
      thaan_id: roll.id,
      quantity: 3000,
      unit: "mm",
    });
    const move = await insert("inventory_movements", {
      kind: "TRANSFER",
      fabric_stock_id: stock.id,
      thaan_id: roll.id,
      quantity: 3000,
      unit: "mm",
      source_location_id: workshop.id,
      destination_location_id: showroom.id,
      stock_transfer_line_id: transferLine.id,
    });
    await reject(
      "insert into inventory_movements(kind,fabric_stock_id,thaan_id,quantity,unit,source_location_id,destination_location_id,stock_transfer_line_id) values('TRANSFER',$1,$2,2000,'mm',$3,$4,$5)",
      [stock.id, roll.id, workshop.id, showroom.id, transferLine.id],
      "Movement matches transfer quantity",
      /must match/,
    );
    await reject(
      "insert into inventory_movements(kind,fabric_stock_id,thaan_id,quantity,unit,source_location_id,destination_location_id,stock_transfer_line_id) values('TRANSFER',$1,$2,3000,'mm',$3,$4,$5)",
      [stock.id, roll.id, workshop.id, showroom.id, transferLine.id],
      "Transfer line cannot post twice",
      /unique/,
    );
    await insert("inventory_movements", {
      kind: "MATERIAL_ISSUE",
      fabric_stock_id: stock.id,
      thaan_id: roll.id,
      quantity: 4000,
      unit: "mm",
      source_location_id: workshop.id,
      production_job_id: production.id,
      material_issue_line_id: issued.id,
    });
    await reject(
      "insert into inventory_movements(kind,fabric_stock_id,thaan_id,quantity,unit,source_location_id,production_job_id,material_issue_line_id) values('MATERIAL_ISSUE',$1,$2,4000,'mm',$3,$4,$5)",
      [stock.id, roll.id, workshop.id, secondProduction.id, issued.id],
      "Issue movement matches job",
      /must match/,
    );
    await reject(
      "delete from inventory_movements where id=$1",
      [move.id],
      "Ledger append-only",
      /append-only/,
    );
    await reject(
      "insert into stock_transfers(code,source_location_id,destination_location_id) values('SAME',$1,$1)",
      [workshop.id],
      "Different transfer locations",
      /check constraint/,
    );
    await reject(
      "insert into inventory_movements(kind,material_id,quantity,unit,source_location_id) values('SALE',$1,-1,'spool',$2)",
      [material.id, workshop.id],
      "Quantity positive",
      /check constraint/,
    );
    const order = await insert("orders", {
      code: "ORD-TEST",
      kind: "customer_tailoring",
      customer_id: customer.id,
      customer_tailoring_job_id: job.id,
      source_location_id: showroom.id,
    });
    const item = await insert("order_items", {
      order_id: order.id,
      customer_tailoring_job_id: job.id,
      quantity: 1,
      unit: "job",
      final_customer_price_paise: 180000,
    });
    await insert("order_item_financials", {
      order_item_id: item.id,
      cp_snapshot_paise: 100000,
      tailoring_charge_snapshot_paise: 80000,
    });
    await reject(
      "update orders set customer_id=null where id=$1",
      [order.id],
      "Order customer history immutable",
      /identity/,
    );
    await reject(
      "insert into customer_tailoring_prices(job_id,revision,fabric_cp_total_paise,tailoring_charge_paise,charge_version_id) values($1,2,1,1,$2)",
      [job.id, chargeVersion.id],
      "Tailoring charge snapshot matches catalogue version",
      /snapshot/,
    );
    await insert("erp_audit_records", {
      action: "schema_fixture",
      entity_table: "production_jobs",
      entity_id: production.id,
    });
    await reject("delete from erp_audit_records", [], "Audit records append-only", /append-only/);
    await reject(
      "insert into order_items(order_id,customer_tailoring_job_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) values($1,$2,1,'job',123,180000)",
      [order.id, job.id],
      "No SP in tailoring order item",
      /check constraint/,
    );
    await reject(
      "insert into order_items(order_id,thaan_id,fabric_stock_id,quantity,unit,final_customer_price_paise) values($1,$2,$3,1000,'mm',85000)",
      [order.id, roll.id, stock.id],
      "Order item must match domain",
      /type\/job/,
    );
    const oldBalance = Number(
      await scalar("select thaan_available_mm(id) from thaans where barcode='TH-0007'"),
    );
    const legacySale = await scalar("select complete_fabric_sale($1::jsonb)", [
      JSON.stringify([{ barcode: "TH-0007", length_mm: 1000 }]),
    ]);
    check(legacySale.item_count === 1, "Existing multi-fabric sale RPC still creates a bill");
    check(
      Number(await scalar("select thaan_available_mm(id) from thaans where barcode='TH-0007'")) ===
        oldBalance - 1000,
      "Legacy sale still deducts old ledger exactly once",
    );
    const legacyTailorId = randomUUID();
    await q("insert into auth.users(id,email) values($1,'tailor@schema.test')", [legacyTailorId]);
    await insert("profiles", { id: legacyTailorId, full_name: "Legacy RPC Tailor" });
    await insert("user_roles", { user_id: legacyTailorId, role_key: "tailor" });
    const legacyJobId = await scalar("select create_tailoring_job('Regression Suit',$1)", [
      legacyTailorId,
    ]);
    await q("select issue_tailoring_fabrics($1,$2::jsonb)", [
      legacyJobId,
      JSON.stringify([{ barcode: "TH-0007", length_mm: 1000 }]),
    ]);
    check(
      Number(await scalar("select thaan_available_mm(id) from thaans where barcode='TH-0007'")) ===
        oldBalance - 2000,
      "Existing assigned-job issue still deducts old ledger",
    );
    await db.exec("set role authenticated");
    await reject(
      "select * from fabric_stock_costs",
      [],
      "New CP denied to browser role",
      /permission denied/,
    );
    await reject(
      "select * from production_cost_lines",
      [],
      "New production costs denied to browser role",
      /permission denied/,
    );
    await db.exec("reset role");
    console.log(
      `${directory}: PASS (${files.length} migrations; ${tables.length} new tables; cumulative ${passed} assertions)`,
    );
    return {
      schema: await q(
        "select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position",
      ),
      constraints: await q(
        "select c.relname,p.conname,pg_get_constraintdef(p.oid) as definition from pg_constraint p join pg_class c on c.oid=p.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,p.conname",
      ),
      indexes: await q(
        "select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by tablename,indexname",
      ),
      triggers: await q(
        "select c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by c.relname,t.tgname",
      ),
    };
  } finally {
    await db.close();
  }
}
const supabase = await replay("supabase/migrations");
const drizzle = await replay("drizzle/migrations");
assert.deepEqual(drizzle, supabase, "Migration mirror schema differs");
const bytes = await readFile("supabase/migrations/20261003000000_phase1_domain_model.sql");
assert.deepEqual(await readFile("drizzle/migrations/0010_phase1_domain_model.sql"), bytes);
await replay("supabase/migrations", false);
console.log(
  `PASS: ${passed + 2} checks; both chains produce equivalent schema; new migration SHA256 ${createHash("sha256").update(bytes).digest("hex")}`,
);
