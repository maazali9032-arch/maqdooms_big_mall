/** Read-only live verification. No fixture users, jobs, sales, or stock are created. */
import postgres from "postgres";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
process.loadEnvFile(".env");
const sql = postgres(process.env.LOVABLE_DB_MIGRATION_URL, {
  ssl: "require",
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
});
const results = [];
let checks = 0;
const check = (value, label) => {
  assert(value, label);
  checks++;
};
const denied = async (tx, query, label) => {
  let rejected = false;
  try {
    await tx.savepoint(async (sp) => sp.unsafe(query));
  } catch (error) {
    rejected = ["42501", "P0001"].includes(error.code);
  }
  check(rejected, label);
};
try {
  const people =
    await sql`select p.id,array_agg(r.role_key order by r.role_key) as roles from public.profiles p join public.user_roles r on r.user_id=p.id where p.active group by p.id`;
  for (const role of ["owner", "counter", "tailor", "stock_entry"]) {
    const person = people.find(
      (p) =>
        p.roles.includes(role) &&
        (role === "owner" || !p.roles.includes("owner")) &&
        (role !== "tailor" || !p.roles.includes("counter")),
    );
    assert(person, "No suitable existing active staff for " + role);
    await sql.begin("read only", async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${person.id},true)`;
      await tx.unsafe("set local role authenticated");
      check((await tx`select public.has_role(auth.uid(),${role}) as ok`)[0].ok, role + " identity");
      const costs = Number((await tx`select count(*) as n from public.fabric_stock_costs`)[0].n);
      const legacyCosts = Number((await tx`select count(*) as n from public.thaan_costs`)[0].n);
      if (role === "owner")
        check(costs === 10 && legacyCosts === 16, "Owner sees preserved CP rows");
      else check(costs === 0 && legacyCosts === 0, role + " cannot read CP rows");
      check(
        !(
          await tx`select has_table_privilege(current_user,'public.inventory_movements','INSERT') as allowed`
        )[0].allowed,
        role + " cannot directly post ledger",
      );
      check(
        !(
          await tx`select has_table_privilege(current_user,'public.customer_tailoring_quotes','INSERT') as allowed`
        )[0].allowed,
        role + " cannot directly write quote",
      );
      check(
        !(
          await tx`select has_table_privilege(current_user,'public.thaans','TRUNCATE') as allowed`
        )[0].allowed,
        role + " cannot truncate stock",
      );
      if (role !== "owner") {
        await denied(
          tx,
          "select public.owner_customer_tailoring_costs('00000000-0000-0000-0000-000000000000')",
          role + " Owner cost API denied",
        );
        await denied(
          tx,
          "select public.owner_direct_fabric_order_costs(null)",
          role + " direct sale cost API denied",
        );
      }
      if (role === "owner" || role === "counter") {
        const catalog = (await tx`select public.customer_tailoring_catalog() as data`)[0].data;
        check(catalog && typeof catalog === "object", role + " live Phase 7 catalog works");
        await tx`select public.direct_fabric_sale_catalog()`;
        await tx`select public.direct_fabric_order_history(null,50)`;
        await tx`select public.customer_tailoring_history(null,50)`;
        checks += 3;
      }
      if (role === "tailor") {
        await tx`select public.customer_tailoring_history(null,50)`;
        checks++;
      }
      if (role === "stock_entry") {
        const target = (await tx`select id from public.thaans where status<>'draft' limit 1`)[0];
        if (target)
          await denied(
            tx,
            "select public.stock_entry_cp('" + target.id + "')",
            "Stock Entry cannot access committed legacy CP",
          );
      }
      check(
        !(
          await tx`select has_table_privilege(current_user,'public.consumable_receipts','INSERT') as allowed`
        )[0].allowed,
        role + " raw receipt write sealed",
      );
      await denied(
        tx,
        "select request_payload from public.consumable_receipts",
        role + " private receipt retry payload denied",
      );
      if (role !== "owner")
        check(
          (await tx`select count(*)::int as n from public.consumable_receipt_costs`)[0].n === 0,
          role + " receipt CP hidden",
        );
      if (role !== "tailor") {
        const consumables = (await tx`select public.consumable_catalog() as data`)[0].data;
        check(
          consumables.length === 4 &&
            consumables.every((m) => m.inventory_item_id && !("cost_paise" in m)),
          role + " four reconciled consumables with no cost projection",
        );
      } else
        await denied(
          tx,
          "select public.consumable_catalog()",
          "Tailor general stock catalog denied",
        );
      if (role !== "stock_entry") {
        await tx`select public.material_issue_jobs()`;
        await tx`select public.material_issue_history(null,100)`;
        checks += 2;
      } else
        await denied(tx, "select public.material_issue_jobs()", "Stock Entry job catalog denied");
      if (role === "owner" || role === "stock_entry") {
        await tx`select public.consumable_receipt_history(100)`;
        checks++;
      } else
        await denied(
          tx,
          "select public.consumable_receipt_history(100)",
          role + " receipt history denied",
        );
      check(
        !(
          await tx`select has_table_privilege(current_user,'public.tailor_assignments','INSERT') as allowed`
        )[0].allowed,
        role + " raw assignment creation sealed",
      );
      check(
        !(
          await tx`select has_table_privilege(current_user,'public.tailoring_management_requests','INSERT') as allowed`
        )[0].allowed,
        role + " private management writes sealed",
      );
      if (role === "owner") {
        const hierarchy = (await tx`select public.owner_tailoring_hierarchy() as data`)[0].data;
        check(
          Array.isArray(hierarchy.factories) && Array.isArray(hierarchy.assignments),
          "Owner dynamic hierarchy API",
        );
      } else {
        await denied(
          tx,
          "select public.owner_tailoring_hierarchy()",
          role + " hierarchy management read denied",
        );
        check(
          (await tx`select count(*)::int as n from public.tailoring_management_requests`)[0].n ===
            0,
          role + " management request RLS",
        );
      }
      if (role === "stock_entry")
        await denied(
          tx,
          "select public.tailoring_assignment_options()",
          role + " hierarchy options denied",
        );
      else {
        await tx`select public.tailoring_assignment_options()`;
        checks++;
      }
      if (role === "owner") {
        const production = (await tx`select public.owner_production_catalog() as data`)[0].data;
        check(
          Array.isArray(production.products) && Array.isArray(production.designs),
          "Owner production catalogue API",
        );
      } else {
        await denied(
          tx,
          "select public.owner_production_catalog()",
          role + " production financial catalogue denied",
        );
        check(
          (await tx`select count(*)::int as n from public.production_requests`)[0].n === 0,
          role + " production request RLS",
        );
        check(
          (await tx`select count(*)::int as n from public.design_charge_versions`)[0].n === 0,
          role + " Design charge RLS",
        );
      }
      if (role === "owner" || person.roles.includes("tailor")) {
        const production = (await tx`select public.owner_production_history() as data`)[0].data;
        check(Array.isArray(production), role + " production operational history works");
        check(
          !JSON.stringify(production).includes("paise"),
          role + " production history has no financial projection",
        );
      } else
        await denied(
          tx,
          "select public.owner_production_history()",
          role + " production history denied",
        );
      for (const table of [
        "production_jobs",
        "products",
        "designs",
        "production_requests",
        "production_status_events",
      ]) {
        check(
          !(
            await tx.unsafe(
              "select has_table_privilege(current_user,'public." +
                table +
                "','INSERT,UPDATE,DELETE,TRUNCATE') as allowed",
            )
          )[0].allowed,
          role + " raw production writes sealed: " + table,
        );
      }
      if (role === "owner" || person.roles.includes("counter") || person.roles.includes("tailor")) {
        const pieces = (await tx`select public.finished_product_catalog() as data`)[0].data;
        check(Array.isArray(pieces), role + " finished product catalogue works");
        check(
          !JSON.stringify(pieces).includes("amount_paise"),
          role + " piece scan has no internal charge/cost projection",
        );
      } else
        await denied(
          tx,
          "select public.finished_product_catalog()",
          role + " finished product catalogue denied",
        );
      for (const table of [
        "finished_products",
        "finished_product_materials",
        "finished_product_receipts",
        "finished_product_receipt_pieces",
      ])
        check(
          !(
            await tx.unsafe(
              "select has_table_privilege(current_user,'public." +
                table +
                "','INSERT,UPDATE,DELETE,TRUNCATE') as allowed",
            )
          )[0].allowed,
          role + " raw finished-product writes sealed: " + table,
        );
      if (role !== "owner")
        check(
          (await tx`select count(*)::int as n from public.finished_product_receipts`)[0].n === 0,
          role + " receipt payload RLS",
        );
      if (role !== "owner") {
        for (const call of [
          "select public.owner_production_costs(null)",
          "select public.finalize_production_cost(null,null,null,null,null,null,null,null)",
          "select public.set_finished_product_sp(null,null,null,null,null)",
        ])
          await denied(tx, call, role + " Phase 12 Owner financial API denied");
        for (const table of [
          "production_cost_versions",
          "production_cost_lines",
          "finished_product_cost_allocations",
          "production_cost_inputs",
          "production_cost_requests",
          "finished_product_price_reviews",
        ])
          check(
            (await tx.unsafe("select count(*)::int as n from public." + table))[0].n === 0,
            role + " Phase 12 financial rows hidden: " + table,
          );
      }
      for (const table of [
        "production_cost_inputs",
        "production_cost_requests",
        "finished_product_price_reviews",
      ])
        check(
          !(
            await tx.unsafe(
              "select has_table_privilege(current_user,'public." +
                table +
                "','INSERT,UPDATE,DELETE,TRUNCATE') as allowed",
            )
          )[0].allowed,
          role + " Phase 12 raw writes sealed: " + table,
        );
      if (role === "owner") {
        for (const call of [
          "select public.finished_product_inventory() as data",
          "select public.finished_product_movement_history() as data",
        ]) {
          const rows = (await tx.unsafe(call))[0].data;
          check(Array.isArray(rows), "Owner Phase 13 operational API works");
          check(
            !/cp_paise|sp_paise|production_cost|amount_paise/.test(JSON.stringify(rows)),
            "Phase 13 operational projection excludes finance",
          );
        }
      } else {
        for (const call of [
          "select public.finished_product_inventory()",
          "select public.finished_product_movement_history()",
          "select public.transfer_finished_products(null,null,null,null,null)",
        ])
          await denied(tx, call, role + " Phase 13 Owner API denied");
        check(
          (
            await tx.unsafe(
              "select count(*)::int as n from public.finished_product_transfer_requests",
            )
          )[0].n === 0,
          role + " Phase 13 request RLS",
        );
      }
      check(
        !(
          await tx.unsafe(
            "select has_table_privilege(current_user,'public.finished_product_transfer_requests','INSERT,UPDATE,DELETE,TRUNCATE') as allowed",
          )
        )[0].allowed,
        role + " Phase 13 raw writes sealed",
      );
      if (role === "owner" || person.roles.includes("counter")) {
        check(
          (
            await tx.unsafe(
              "select public.finished_product_sale_scan('PHASE14-UNKNOWN-READONLY') as data",
            )
          )[0].data === null,
          role + " Phase 14 barcode lookup works",
        );
        const orders = (
          await tx.unsafe("select public.finished_product_order_history() as data")
        )[0].data;
        check(Array.isArray(orders), role + " Phase 14 order history works");
        if (role !== "owner")
          check(
            !/production_cost|cost_evidence|cost_version|cp_snapshot/.test(JSON.stringify(orders)),
            role + " Phase 14 financial projection sealed",
          );
      } else
        for (const call of [
          "select public.finished_product_sale_scan('unknown')",
          "select public.finished_product_order_history()",
          "select public.complete_finished_product_sale(null,null,null,null,true,null)",
        ])
          await denied(tx, call, role + " Phase 14 API denied");
      if (role !== "owner")
        check(
          (await tx.unsafe("select count(*)::int n from public.finished_product_sale_snapshots"))[0]
            .n === 0,
          role + " Phase 14 snapshot RLS",
        );
      check(
        !(
          await tx.unsafe(
            "select has_table_privilege(current_user,'public.finished_product_sale_snapshots','INSERT,UPDATE,DELETE,TRUNCATE') allowed",
          )
        )[0].allowed,
        role + " Phase 14 raw writes sealed",
      );
      if (role === "owner") {
        const overview = (await tx.unsafe("select public.owner_erp_overview() data"))[0].data;
        check(
          Array.isArray(overview.stock) && overview.controls.negative_location_balances === 0,
          "Owner Phase 15 canonical summary/controls work",
        );
        for (const dataset of [
          "stock",
          "fabric_stock",
          "batches",
          "thans",
          "consumables",
          "consumable_receipts",
          "customer_tailoring",
          "configuration",
          "material_issues",
          "tailor_usage",
          "production_jobs",
          "production_costs",
          "finished_products",
          "transfers",
          "movements",
          "orders",
          "production_history",
          "reconciliation",
          "controls",
          "access",
          "audit",
          "legacy_sales",
          "legacy_tailoring",
          "legacy_movements",
        ]) {
          const result = (await tx.unsafe("select public.owner_erp_report($1) data", [dataset]))[0]
            .data;
          check(Array.isArray(result.rows), "Owner Phase 15 dataset: " + dataset);
        }
      } else {
        await denied(
          tx,
          "select public.owner_erp_overview()",
          role + " Phase 15 Owner totals denied",
        );
        for (const dataset of ["orders", "audit", "fabric_stock", "production_costs", "access"])
          await denied(
            tx,
            "select public.owner_erp_report('" + dataset + "')",
            role + " Phase 15 private report denied: " + dataset,
          );
      }
      check(
        !(
          await tx.unsafe(
            "select has_table_privilege(current_user,'public.audit_log','INSERT,UPDATE,DELETE,TRUNCATE') allowed",
          )
        )[0].allowed,
        role + " Phase 15 legacy audit writes sealed",
      );
      results.push({
        role,
        effective_roles: person.roles,
        verified: true,
        visible_fabric_cost_rows: costs,
        visible_legacy_cost_rows: legacyCosts,
      });
    });
  }
  await sql.begin("read only", async (tx) => {
    await tx.unsafe("set local role anon");
    await denied(tx, "select * from public.thaans limit 1", "Anonymous stock table denied");
    await denied(tx, "select public.customer_tailoring_catalog()", "Anonymous Phase 7 API denied");
    await denied(
      tx,
      "select * from supabase_migrations.erp_execution_history",
      "Anonymous migration ledger denied",
    );
    await denied(tx, "select public.consumable_catalog()", "Anonymous consumables API denied");
    await denied(
      tx,
      "select public.material_issue_history(null,100)",
      "Anonymous issue history denied",
    );
    await denied(
      tx,
      "select public.owner_tailoring_hierarchy()",
      "Anonymous hierarchy management denied",
    );
    await denied(
      tx,
      "select public.tailoring_assignment_options()",
      "Anonymous hierarchy options denied",
    );
  });
  await sql.begin("read only", async (tx) => {
    await tx.unsafe("set local role anon");
    for (const call of [
      "select public.owner_production_catalog()",
      "select public.owner_production_history()",
      "select * from public.production_requests",
      "select * from public.production_status_events",
    ])
      await denied(tx, call, "Anonymous Phase 10 denied: " + call);
  });
  await sql.begin("read only", async (tx) => {
    await tx.unsafe("set local role anon");
    for (const call of [
      "select public.finished_product_catalog()",
      "select public.receive_finished_products(null,null,null,null)",
      "select * from public.finished_product_receipts",
      "select * from public.finished_product_receipt_pieces",
    ])
      await denied(tx, call, "Anonymous Phase 11 denied: " + call);
  });
  await sql.begin("read only", async (tx) => {
    await tx.unsafe("set local role anon");
    for (const call of [
      "select public.owner_production_costs(null)",
      "select public.finalize_production_cost(null,null,null,null,null,null,null,null)",
      "select public.set_finished_product_sp(null,null,null,null,null)",
      "select * from public.production_cost_requests",
    ])
      await denied(tx, call, "Anonymous Phase 12 denied: " + call);
  });
  await sql.begin("read only", async (tx) => {
    await tx.unsafe("set local role anon");
    for (const call of [
      "select public.finished_product_inventory()",
      "select public.finished_product_movement_history()",
      "select public.transfer_finished_products(null,null,null,null,null)",
      "select * from public.finished_product_transfer_requests",
    ])
      await denied(tx, call, "Anonymous Phase 13 denied");
  });
  await sql.begin("read only", async (tx) => {
    await tx.unsafe("set local role anon");
    for (const call of [
      "select public.finished_product_sale_scan('unknown')",
      "select public.finished_product_order_history()",
      "select public.complete_finished_product_sale(null,null,null,null,true,null)",
      "select * from public.finished_product_sale_snapshots",
    ])
      await denied(tx, call, "Anonymous Phase 14 denied");
  });
  await sql.begin("read only", async (tx) => {
    await tx.unsafe("set local role anon");
    for (const call of [
      "select public.owner_erp_report('audit')",
      "select public.owner_erp_overview()",
      "select public.capture_owner_domain_audit()",
    ])
      await denied(tx, call, "Anonymous Phase 15 denied");
  });
  const unresolved =
    await sql`select issue,count(*)::integer as records from public.domain_reconciliation where resolved_at is null group by issue order by issue`;
  const ledger =
    await sql`select version,filename,mode,sha256 from supabase_migrations.erp_execution_history order by version`;
  const migrationFiles = (await fs.readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  check(ledger.length === migrationFiles.length, "All repository migration versions recorded");
  for (const file of migrationFiles) {
    const entry = ledger.find((r) => r.filename === file);
    check(
      entry &&
        entry.sha256 ===
          createHash("sha256")
            .update(await fs.readFile("supabase/migrations/" + file))
            .digest("hex"),
      "Recorded file hash: " + file,
    );
  }
  const fixtureManifest = (
    await sql`select to_regclass('supabase_migrations.erp_test_stock_fixtures') as rel`
  )[0].rel;
  check(
    (await sql`select count(*)::int as n from public.inventory_items`)[0].n ===
      (fixtureManifest ? 18 : 0),
    fixtureManifest
      ? "18 explicitly authorized test inventory items"
      : "No guessed legacy opening stock",
  );
  check(
    (
      await sql`select count(*)::int as n from public.locations where kind in ('workshop','showroom')`
    )[0].n === 2,
    "Two canonical roots",
  );
  const report = {
    verified_at: new Date().toISOString(),
    checks,
    results,
    unresolved,
    ledger,
    limitations: [
      "No business transaction fixtures executed live",
      "No live multi-connection race tests",
      "Four legacy job domain/assignment decisions remain for explicit Owner reconciliation",
    ],
  };
  await fs.writeFile(
    path.join(os.tmpdir(), "maqdooms-live-security-results.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ checks, results, unresolved }));
} catch (error) {
  console.error(
    JSON.stringify({
      code: error.code,
      message: error.message.replace(/postgres(?:ql)?:\/\/\S+/g, "[REDACTED]"),
    }),
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
