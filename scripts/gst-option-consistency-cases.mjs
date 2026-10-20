import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export async function gstOptionConsistencyCases(db, fixture) {
  assert.equal(
    await fs.readFile("supabase/migrations/20261020000300_gst_option_consistency.sql", "utf8"),
    await fs.readFile("drizzle/migrations/0070_gst_option_consistency.sql", "utf8"),
  );
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": resolve("src") } },
  });
  try {
    const { gstPreview } = await server.ssrLoadModule(
      "/src/features/pos/counter-workspace-model.ts",
    );
    const { GstInvoiceSummary, GstTailoringComponents } = await server.ssrLoadModule(
      "/src/features/gst/GstInvoicePresentation.tsx",
    );
    const q = async (sql, args = []) => (await db.query(sql, args)).rows;
    const one = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
    await q("select set_config('request.jwt.claim.sub',$1,false)", [fixture.owner]);
    const baseline = {
      enabled: true,
      legal_name: "GST matrix",
      trading_name: "GST matrix",
      address: "Test",
      contact: "Test",
      gstin: "27ABCDE1234F1Z5",
      state_code: "27",
      price_mode: "exclusive",
      invoice_display: "final_first",
      tailoring_display: "separate",
      purchase_mode: "track_itc",
    };
    const rules = [
      ...["purchase", "fabric_sale", "finished_sale", "tailoring"].map((category) => ({
        category,
        classification_code: "DEFAULT",
        rate_bps: 500,
      })),
      {
        category: "fabric_sale",
        item_ref: "FABRIC:SILK",
        classification_code: "SILK",
        rate_bps: 1200,
      },
      {
        category: "tailoring",
        item_ref: "SERVICE:TEST GARMENT",
        classification_code: "SERVICE",
        rate_bps: 1800,
      },
      {
        category: "purchase",
        item_ref: "FABRIC:COTTON",
        classification_code: "COTTON",
        rate_bps: 1200,
      },
      {
        category: "finished_sale",
        item_ref: "PRODUCT:MATRIX COAT",
        classification_code: "COAT",
        rate_bps: 1800,
      },
    ];
    const save = async (change) =>
      one("select owner_save_gst_configuration($1,$2::jsonb,$3::jsonb)", [
        randomUUID(),
        JSON.stringify({ ...baseline, effective_from: new Date().toISOString(), ...change }),
        JSON.stringify(rules),
      ]);
    await save({});
    const fabrics = [
      {
        name: "Cotton",
        quantity: 2,
        rows: [
          { length_mm: 75000, cp_paise_per_m: 35000 },
          { length_mm: 1000, cp_paise_per_m: 20000 },
        ],
      },
    ];
    const batchRequest = randomUUID();
    const batch = await one(
      "select create_barcode_batch_with_gst($1,$2,$3::date,null,$4::jsonb,null)",
      [batchRequest, "imran", "2026-10-20", JSON.stringify(fabrics)],
    );
    assert.equal(
      await one("select count(*) from gst_purchase_documents where batch_id=$1", [batch]),
      0,
    );
    assert.equal(
      await one("select create_barcode_batch_with_gst($1,$2,$3::date,null,$4::jsonb)", [
        batchRequest,
        "imran",
        "2026-10-20",
        JSON.stringify(fabrics),
      ]),
      batch,
      "Omitted and explicit-null payload both support exact retry",
    );
    const entries = (await one("select stock_registration_catalog($1)", [batch]))[0].fabric_types[0]
      .variants;
    assert.equal(entries.length, 2);
    const cottonItem = await one("select id from inventory_items where thaan_id=$1", [
      entries[0].thaan_id,
    ]);
    const workshop = await one("select id from locations where kind='workshop'");
    await one("select post_inventory_transfer($1,$2,$3,$4::jsonb,null)", [
      randomUUID(),
      workshop,
      fixture.floor,
      JSON.stringify([{ inventory_item_id: cottonItem, quantity: 2000 }]),
    ]);
    const saleItem = {
      inventory_item_id: fixture.item,
      quantity: 100,
      sp_paise_per_m: 100000,
      source_location_id: fixture.floor,
    };
    const firstSnapshot = await one("select counter_bill($1)", [fixture.bill]);
    let combinations = 0;
    for (const price_mode of ["inclusive", "exclusive"])
      for (const invoice_display of ["final_first", "taxable_first"])
        for (const tailoring_display of ["separate", "combined"])
          for (const purchase_mode of ["track_itc", "include_noncreditable"]) {
            const id = await save({
              price_mode,
              invoice_display,
              tailoring_display,
              purchase_mode,
            });
            const config = await one("select gst_transaction_configuration()");
            assert.equal(config.configuration.id, id);
            const group = {
              items: [saleItem, { ...saleItem, inventory_item_id: cottonItem }],
              garment: "Test garment",
              delivery_date: "2030-01-01",
              assignment_id: fixture.assignment,
              stitching_paise: 5000,
            };
            const context = { configuration_id: id, customer_gstin: "", payment_method: "cash" };
            const bill = await one(
              "select complete_counter_bill_gst($1,$2::jsonb,$3::jsonb,true,null,$4,null,null,$5::jsonb)",
              [
                randomUUID(),
                JSON.stringify([{ kind: "fabric", ...saleItem }]),
                JSON.stringify([group]),
                fixture.salesperson,
                JSON.stringify(context),
              ],
            );
            const receipt = await one("select counter_bill($1)", [bill]);
            const expected = price_mode === "inclusive" ? "35000" : "38800";
            assert.equal(receipt.total_paise, expected);
            assert.equal(receipt.paid_amount_paise, expected);
            assert.equal(receipt.tax.invoice_display, invoice_display);
            assert.equal(receipt.tax.tailoring_display, tailoring_display);
            assert(
              receipt.tax.lines.some(
                (l) =>
                  l.component === "fabric_sale" &&
                  l.classification_code === "SILK" &&
                  l.rate_bps === 1200,
              ),
            );
            assert(
              receipt.tax.lines.some((l) => l.component === "tailoring" && l.rate_bps === 1800),
            );
            const row = (key, groupId) => ({
              key,
              scan: { kind: "fabric", name: "Silk", barcode: key },
              cut: {
                inventory_item_id: fixture.item,
                locations: [{ id: fixture.floor, quantity_mm: 10000 }],
              },
              source: { id: fixture.floor, name: "Floor" },
              metres: "0.1",
              price: "1000",
              group: groupId,
            });
            const preview = gstPreview(
              [
                row("direct"),
                row("stitch", "job"),
                {
                  ...row("cotton", "job"),
                  scan: { kind: "fabric", name: "Cotton", barcode: "cotton" },
                },
              ],
              [{ id: "job", keys: ["stitch", "cotton"], garment: "Test garment", stitching: "50" }],
              config,
              "intra_state",
            );
            assert.equal(
              preview.final.toString(),
              receipt.total_paise,
              "Preview and persisted receipt use the same override and component rounding",
            );
            const summary = renderToStaticMarkup(
              createElement(GstInvoiceSummary, { tax: receipt.tax }),
            );
            assert.equal(
              summary.indexOf("Payable") < summary.indexOf("Taxable"),
              invoice_display === "final_first",
            );
            const jobLine = receipt.lines.find((l) => l.kind === "tailoring");
            const components = renderToStaticMarkup(
              createElement(GstTailoringComponents, { tax: receipt.tax, sourceItem: jobLine.id }),
            );
            assert.equal(components.includes("HSN/SAC"), tailoring_display === "separate");
            const purchase = {
              itc_status: "ineligible",
              actual_gst_paise: 317400,
              actual_taxable_paise: 2645000,
              actual_supplier_paise: 2962400,
            };
            const invoiceBatch = await one(
              "select create_barcode_batch_with_gst($1,$2,$3::date,null,$4::jsonb,$5::jsonb)",
              [
                randomUUID(),
                "imran",
                "2026-10-20",
                JSON.stringify(fabrics),
                JSON.stringify(purchase),
              ],
            );
            const [document] = await q("select * from gst_purchase_documents where batch_id=$1", [
              invoiceBatch,
            ]);
            assert.equal(document.purchase_mode, purchase_mode);
            assert.equal(Number(document.calculated_gst_paise), 317400);
            assert.equal(
              Number(document.inventory_cost_adjustment_paise),
              purchase_mode === "include_noncreditable" ? 317400 : 0,
            );
            const lines = await q(
              "select variant_id from gst_purchase_lines where purchase_id=$1",
              [document.id],
            );
            assert.equal(
              new Set(lines.map((l) => l.variant_id)).size,
              2,
              "Each invoice row must attach to its own Thaan",
            );
            combinations++;
          }
    assert.equal(combinations, 16);
    // The tailor's own job alias must resolve to the same customer job before an extra issue.
    const [customerJob] = await q(
      "select j.id,j.code,j.scan_code from customer_tailoring_jobs j join counter_tailoring_details d on d.job_id=j.id where d.bill_id=$1",
      [fixture.mixed],
    );
    for (const code of [customerJob.code, customerJob.scan_code]) {
      const jobs = await one("select customer_tailoring_work($1)", [code]);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].id, customerJob.id);
    }
    const originalReceipt = await one("select counter_bill($1)", [fixture.mixed]);
    const priorStock = Number(
      await one("select inventory_balance($1,$2)", [cottonItem, fixture.floor]),
    );
    const extraRequest = randomUUID();
    const extraArgs = [extraRequest, customerJob.id, fixture.floor, entries[0].code, 100];
    const extraCall = "select issue_additional_customer_fabric($1,$2,$3,$4,$5)";
    assert.equal(
      await one(extraCall, extraArgs),
      await one(extraCall, extraArgs),
      "Retry must not issue extra fabric twice",
    );
    assert.equal(
      Number(await one("select inventory_balance($1,$2)", [cottonItem, fixture.floor])),
      priorStock - 100,
    );
    const afterExtra = await one("select counter_bill($1)", [fixture.mixed]);
    assert.equal(afterExtra.total_paise, originalReceipt.total_paise);
    assert.equal(afterExtra.balance_paise, originalReceipt.balance_paise);
    const workOrder = await one("select tailor_work_order($1)", [fixture.mixed]);
    assert(
      workOrder[0].fabrics.some(
        (f) => f.barcode === entries[0].code && Number(f.quantity_mm) === 100,
      ),
      "Reprinted tailor sheet includes extra fabric",
    );
    const outdated = await save({});
    await save({ price_mode: "inclusive" });
    const beforeStale = await one("select inventory_balance($1,$2)", [fixture.item, fixture.floor]);
    await assert.rejects(
      one(
        "select complete_counter_bill_gst($1,$2::jsonb,'[]'::jsonb,true,null,$3,null,null,$4::jsonb)",
        [
          randomUUID(),
          JSON.stringify([{ kind: "fabric", ...saleItem }]),
          fixture.salesperson,
          JSON.stringify({ configuration_id: outdated, payment_method: "cash" }),
        ],
      ),
      /GST configuration changed/,
    );
    assert.equal(
      await one("select inventory_balance($1,$2)", [fixture.item, fixture.floor]),
      beforeStale,
      "Stale preview rejection rolls back staged stock",
    );
    // Finished-product SP is fixed, but the same inclusive/exclusive choice and product override apply.
    const product = await one(
      "select manage_production_catalog($1,'product',null,$2,'Matrix Coat',true,null,'Disposable GST test')",
      [randomUUID(), "GSTP-" + randomUUID()],
    );
    const job = await one(
      "select create_mixed_production($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,null)",
      [
        randomUUID(),
        workshop,
        JSON.stringify([{ inventory_item_id: cottonItem, quantity: 1000 }]),
        JSON.stringify(
          ["38", "40"].map((size) => ({
            product_id: product,
            custom_design: "GST acceptance",
            size,
          })),
        ),
        JSON.stringify([fixture.assignment]),
      ],
    );
    await one("select progress_owner_production($1,$2,'open','in_progress','GST test')", [
      randomUUID(),
      job,
    ]);
    await one("select progress_owner_production($1,$2,'in_progress','completed','GST test')", [
      randomUUID(),
      job,
    ]);
    await one("select receive_production_barcode_priced($1,$2,$3::jsonb)", [
      randomUUID(),
      job,
      JSON.stringify([
        { piece_number: 1, sp_paise: 10000 },
        { piece_number: 2, sp_paise: 10000 },
      ]),
    ]);
    const pieces = await one("select workshop_production_pieces($1)", [job]);
    await one("select set_workshop_product_sp($1,$2,$3::jsonb,$4)", [
      randomUUID(),
      job,
      JSON.stringify(pieces.map((p) => ({ piece_id: p.id, sp_paise: 10000 }))),
      "GST fixed SP test",
    ]);
    await one("select transfer_finished_products($1,$2,$3,$4::jsonb,null)", [
      randomUUID(),
      workshop,
      fixture.floor,
      JSON.stringify(pieces.map((p) => p.id)),
    ]);
    for (const [index, price_mode] of ["inclusive", "exclusive"].entries()) {
      const configId = await save({ price_mode });
      const scan = await one("select counter_scan_barcode($1,$2)", [
        pieces[index].barcode,
        fixture.floor,
      ]);
      const payload = [
        {
          kind: "product",
          piece_id: scan.id,
          sp_version_id: scan.sp_version_id,
          source_location_id: fixture.floor,
        },
      ];
      const bill = await one(
        "select complete_counter_bill_gst($1,$2::jsonb,'[]'::jsonb,true,null,$3,null,null,$4::jsonb)",
        [
          randomUUID(),
          JSON.stringify(payload),
          fixture.salesperson,
          JSON.stringify({ configuration_id: configId, payment_method: "cash" }),
        ],
      );
      const receipt = await one("select counter_bill($1)", [bill]);
      assert.equal(receipt.total_paise, price_mode === "inclusive" ? "10000" : "11800");
      assert(receipt.tax.lines.some((l) => l.component === "finished_sale" && l.rate_bps === 1800));
      const preview = gstPreview(
        [{ scan, source: { id: fixture.floor } }],
        [],
        await one("select gst_transaction_configuration()"),
        "intra_state",
      );
      assert.equal(preview.final.toString(), receipt.total_paise);
    }
    assert.deepEqual(
      (await one("select counter_bill($1)", [fixture.bill])).tax,
      firstSnapshot.tax,
      "Old snapshots never change with current choices",
    );
    for (const itc_status of ["pending", "eligible", "ineligible", "reversed"]) {
      const result = await one(
        "select create_barcode_batch_with_gst($1,$2,$3::date,null,$4::jsonb,$5::jsonb)",
        [
          randomUUID(),
          "Optional invoice",
          "2026-10-20",
          JSON.stringify(fabrics),
          JSON.stringify({ itc_status }),
        ],
      );
      const [p] = await q(
        "select eligible_itc_paise,ineligible_itc_paise,reversed_itc_paise,inventory_cost_adjustment_paise from gst_purchase_documents where batch_id=$1",
        [result],
      );
      assert(
        Object.values(p).every((v) => Number(v) === 0),
        "Estimated GST must not become verified ITC/cost evidence",
      );
    }
    const report = await one("select owner_gst_report('2020-01-01','2099-12-31',null,null)");
    assert(Number(report.summary.inventory_cost_adjustment_paise) > 0);
    assert(
      report.purchases.some(
        (p) =>
          p.purchase_mode === "include_noncreditable" &&
          p.inventory_cost_adjustment_paise === "317400",
      ),
    );
    assert(
      report.purchases.some(
        (p) => p.purchase_mode === "track_itc" && p.inventory_cost_adjustment_paise === "0",
      ),
    );
    const active = await one("select gst_transaction_configuration()");
    const inter = await one(
      "select complete_counter_bill_gst($1,$2::jsonb,'[]'::jsonb,true,null,$3,null,null,$4::jsonb)",
      [
        randomUUID(),
        JSON.stringify([{ kind: "fabric", ...saleItem }]),
        fixture.salesperson,
        JSON.stringify({
          configuration_id: active.configuration.id,
          customer_gstin: "29ABCDE1234F1Z5",
          payment_method: "upi",
        }),
      ],
    );
    assert.equal((await one("select counter_bill($1)", [inter])).tax.supply_type, "inter_state");
    const oldConfig = active.configuration.id;
    await save({ enabled: false });
    assert.equal(
      (await one("select gst_transaction_configuration()")).configuration,
      null,
      "Disabled newest version must not revive older active settings",
    );
    await assert.rejects(
      one(
        "select complete_counter_bill_gst($1,$2::jsonb,'[]'::jsonb,true,null,$3,null,null,$4::jsonb)",
        [
          randomUUID(),
          JSON.stringify([{ kind: "fabric", ...saleItem }]),
          fixture.salesperson,
          JSON.stringify({ configuration_id: oldConfig, payment_method: "cash" }),
        ],
      ),
      /GST configuration changed/,
    );
    console.log(
      "PASS: no-invoice stock entry, 16 GST option combinations, multi-fabric tailoring, finished-product SP/overrides, rendered receipt preferences, preview overrides, purchases/ITC/cost reports, exact row links, historical reprints, interstate supply and disabled/stale configuration rollback.",
    );
  } finally {
    await server.close();
  }
}
