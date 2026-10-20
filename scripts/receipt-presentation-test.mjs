/** Pure receipt renders and synthetic browser previews. No database or live customer data. */
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import os from "node:os";
import { counterPayment } from "../src/features/pos/counter-payment.ts";

for (const [input, received, balance, paid] of [
  ["0", 0n, 315000n, false],
  ["1500", 150000n, 165000n, false],
  ["3150", 315000n, 0n, true],
  ["", 0n, 315000n, false],
]) {
  const p = counterPayment(315000n, true, input);
  assert.equal(p.received, received);
  assert.equal(p.balance, balance);
  assert.equal(p.paid, paid);
  assert.equal(p.advancePaise, paid ? undefined : Number(received));
}
assert.equal(counterPayment(236250n, false, "0").paid, true);
for (const input of ["-1", "3500", "1.001"])
  assert.throws(() => counterPayment(315000n, true, input));
assert.throws(() => counterPayment(null, true, "1500"));

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  resolve: { alias: { "@": resolve("src") } },
});
let browser;
try {
  const { CustomerReceiptContent, TailorWorkOrderContent } = await server.ssrLoadModule(
    "/src/features/pos/ReceiptContent.tsx",
  );
  const { receiptPrintStyles } = await server.ssrLoadModule("/src/features/pos/receipt-format.ts");
  const tax = {
    invoice_number: "BILL-accounting-reference",
    price_mode: "exclusive",
    invoice_display: "final_first",
    tailoring_display: "separate",
    supply_type: "intra_state",
    payment_method: "cash",
    business: {
      trading_name: "MAQDOOM’S Big Mall",
      address: "Hyderabad, Telangana, India",
      gstin: "36ABCDE1234F1Z5",
      contact: "9000000000",
    },
    customer: {},
    taxable_paise: "225000",
    cgst_paise: "5625",
    sgst_paise: "5625",
    igst_paise: "0",
    gst_paise: "11250",
    final_paise: "236250",
    lines: [
      {
        id: "t1",
        source_item_id: "l1",
        description: "Cotton",
        classification_code: "5208",
        rate_bps: 500,
        taxable_paise: "225000",
        gst_paise: "11250",
        final_paise: "236250",
      },
    ],
  };
  const base = {
    id: "bill",
    code: "BILL-accounting-reference",
    scan_code: "BL-E2F67HG73GEB",
    created_at: "2026-10-20T11:00:00Z",
    total_paise: "236250",
    paid_amount_paise: "236250",
    balance_paise: "0",
    paid: true,
    paid_at: "2026-10-20T11:00:00Z",
    source: "Showroom F1",
    pos_code: "F3-POS1",
    customer: { name: "Sample customer", phone: null },
    lines: [
      {
        id: "l1",
        kind: "fabric",
        name: "Cotton",
        quantity: "5000",
        unit: "mm",
        price_paise: "45000",
        amount_paise: "225000",
        barcode: "TST-23340169a",
        source: "Showroom F1",
        size: null,
      },
    ],
    tax,
  };
  const render = (receipt) =>
    renderToStaticMarkup(createElement(CustomerReceiptContent, { receipt }));
  const retail = render(base);
  assert(retail.includes("Paid in full"));
  for (const hidden of [
    "Showroom",
    "F3-POS1",
    "Stock source",
    "Advance",
    "Balance",
    "TST-23340169a",
  ])
    assert(!retail.includes(hidden), `Retail customer receipt exposes ${hidden}`);
  assert.equal(retail.match(/Payable/g).length, 1);
  assert(retail.includes("BILL-accounting-reference"), "Keep the accounting invoice number");
  const stitched = {
    ...base,
    total_paise: "315000",
    paid_amount_paise: "150000",
    balance_paise: "165000",
    paid: false,
    lines: [
      {
        ...base.lines[0],
        kind: "tailoring",
        name: "Pathani Kurta Pajama",
        job_code: "CT-internal-job-uuid",
        delivery_date: "2026-10-25",
        design: "Custom collar",
        fabric_amount_paise: "250000",
        stitching_paise: "50000",
        fabrics: [
          { name: "Cotton", barcode: "TST-23340169a", quantity_mm: "5000", source: "Showroom F2" },
        ],
      },
    ],
    tax: {
      ...tax,
      taxable_paise: "300000",
      gst_paise: "15000",
      cgst_paise: "7500",
      sgst_paise: "7500",
      final_paise: "315000",
      lines: [
        {
          ...tax.lines[0],
          description: "Cotton fabric",
          taxable_paise: "250000",
          gst_paise: "12500",
          final_paise: "262500",
        },
        {
          ...tax.lines[0],
          id: "t2",
          description: "Pathani Kurta Pajama stitching",
          classification_code: "9988",
          taxable_paise: "50000",
          gst_paise: "2500",
          final_paise: "52500",
        },
      ],
    },
  };
  const tailoring = render(stitched);
  assert(
    tailoring.includes("Advance received") &&
      tailoring.includes("Balance due") &&
      tailoring.includes("1,650.00"),
  );
  assert(!tailoring.includes("CT-internal-job-uuid") && !tailoring.includes("Showroom F2"));
  const combined = render({
    ...stitched,
    tax: { ...stitched.tax, tailoring_display: "combined", invoice_display: "taxable_first" },
  });
  assert(!combined.includes("HSN/SAC"));
  assert(combined.indexOf("Taxable") < combined.indexOf("Payable"));
  assert(
    render({ ...stitched, paid_amount_paise: "0", balance_paise: "315000" }).includes(
      "Advance received",
    ),
  );
  const full = render({ ...stitched, paid: true, paid_amount_paise: "315000", balance_paise: "0" });
  assert(full.includes("Amount paid") && !full.includes("Advance received"));
  const jobs = [
    {
      job_code: "CT-internal-job-uuid",
      scan_code: "TJ-3DBEGG2CH89H",
      garment: "Pathani Kurta Pajama",
      delivery_date: "2026-10-25",
      factory: "Factory B",
      tailor: "Nadeem",
      design: "Custom collar",
      notes: "Use matching thread\nKeep the remaining fabric",
      fabrics: [{ name: "Cotton", quantity_mm: "5000", barcode: "TST-23340169a" }],
    },
  ];
  const tailor = renderToStaticMarkup(
    createElement(TailorWorkOrderContent, { receipt: stitched, jobs }),
  );
  for (const required of [
    "TAILOR WORK ORDER",
    "TJ-3DBEGG2CH89H",
    "Factory B",
    "Nadeem",
    "Custom collar",
    "matching thread",
    "TST-23340169a",
  ])
    assert(tailor.includes(required));
  for (const forbidden of ["₹", "GST", "3150", "1500", "CT-internal-job-uuid", "Showroom"])
    assert(!tailor.includes(forbidden), `Tailor sheet leaks ${forbidden}`);
  if (process.argv[2]) {
    const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
    browser = await chromium.launch({ headless: true });
    const folder = await fs.mkdtemp(join(os.tmpdir(), "maqdooms-receipt-preview-"));
    for (const [name, content, width] of [
      ["retail", retail, 58],
      ["tailoring", tailoring, 58],
      ["tailor-work-order", tailor, 80],
    ]) {
      const page = await browser.newPage({
        viewport: { width: 340, height: 900 },
        deviceScaleFactor: 2,
      });
      await page.setContent(
        `<html><head><meta charset="utf-8"><style>${receiptPrintStyles(width)}body{margin:12px;border:1px solid #ddd;padding:8px;width:${width}mm}</style></head><body>${content}</body></html>`,
      );
      const overflow = await page
        .locator("body")
        .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflow, false, `${name} overflows paper`);
      await page.locator("body").screenshot({ path: join(folder, `${name}.png`) });
      await page.close();
    }
    console.log("Synthetic previews:", folder);
  }
  console.log(
    "PASS: amount-only zero/partial/full payments, receipt privacy/content, saved GST presentation, price-free tailor order and paper-width layout.",
  );
} finally {
  await browser?.close();
  await server.close();
}
