import assert from "node:assert/strict";
import { createStockBatch } from "../src/features/inventory/stock-batch-request.ts";
import { definiteDatabaseRejection } from "../src/features/inventory/consumable-input.ts";
const calls = [];
const client = {
  rpc(name, args) {
    assert.equal(this, client);
    calls.push({ name, args });
    return Promise.resolve({ data: "batch-id", error: null });
  },
};
const work = {
  provider: "imran",
  date: "2026-10-20",
  remarks: null,
  fabrics: [{ name: "Cotton", quantity: 1, rows: [{ length_mm: 75000, cp_paise_per_m: 35000 }] }],
};
await createStockBatch(client, "retry-id", work);
assert.equal(calls[0].name, "create_barcode_batch_with_details");
assert.equal(calls[0].args.p_request, "retry-id");
assert.equal(JSON.parse(JSON.stringify(calls[0].args)).p_fabrics[0].rows[0].length_mm, 75000);
await createStockBatch(client, "retry-id", { ...work, purchase: null });
assert.equal(calls[1].name, "create_barcode_batch_with_details");
const purchase = { invoice_number: "INV-1", itc_status: "pending" };
await createStockBatch(client, "invoice-id", { ...work, purchase });
assert.equal(calls[2].name, "create_barcode_batch_with_gst");
assert.deepEqual(JSON.parse(JSON.stringify(calls[2].args)).p_purchase, purchase);
assert(definiteDatabaseRejection({ code: "PGRST202" }));
assert(!definiteDatabaseRejection(new Error("Network failure")));
console.log(
  "PASS: no-invoice routing, invoice payload serialization, bound client, request reuse and definite-rejection versus uncertain-result handling.",
);
