import assert from "node:assert/strict";
import fs from "node:fs/promises";
process.loadEnvFile(".env");
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
assert(url && key);
const results = [];
for (const [rpc, body] of [
  [
    "create_owner_production_shared",
    {
      p_request: null,
      p_product: null,
      p_design: null,
      p_quantity: 1,
      p_assignments: [],
      p_source: null,
      p_items: [],
      p_notes: null,
      p_reason: "Anonymous probe",
    },
  ],
  ["finished_product_transfer_scan", { p_barcode: "NO-SUCH-PRODUCT" }],
  ["owns_production_job", { p_job: null }],
  ["finished_product_inventory", {}],
  ["finished_product_movement_history", {}],
  [
    "transfer_finished_products",
    {
      p_request: null,
      p_source: null,
      p_destination: null,
      p_pieces: [],
      p_reason: "Anonymous probe",
    },
  ],
]) {
  const response = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, 401, rpc);
  assert.equal(data.code, "42501", rpc);
  results.push({ rpc, status: response.status, code: data.code });
}
await fs.writeFile(
  "docs/OWNER_PRODUCTION_WORKFLOW_API_VERIFICATION.json",
  JSON.stringify(
    {
      verified_at: new Date().toISOString(),
      checks: results.length * 2,
      results,
      mode: "anonymous invalid-input discovery/denial; no live transaction fixtures",
    },
    null,
    2,
  ),
);
console.log(`PASS: ${results.length * 2} Owner Production workflow live API checks`);
