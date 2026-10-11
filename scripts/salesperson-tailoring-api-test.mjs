import assert from "node:assert/strict";
import fs from "node:fs/promises";
process.loadEnvFile(".env");
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
assert(url && key);
const results = [];
for (const [rpc, body] of [
  ["salesperson_options", {}],
  ["salesperson_work", {}],
  [
    "book_counter_tailoring",
    {
      p_request: null,
      p_source: null,
      p_items: [],
      p_final_price: 1,
      p_customer: null,
      p_assignment: null,
      p_salesperson: null,
      p_garment: "Test",
    },
  ],
  [
    "complete_counter_fabric_sale",
    {
      p_request_id: null,
      p_source: null,
      p_items: [],
      p_customer: null,
      p_payment_confirmed: true,
      p_reference: null,
      p_salesperson: null,
    },
  ],
  [
    "complete_finished_product_sale",
    {
      p_request: null,
      p_source: null,
      p_items: [],
      p_customer: null,
      p_payment_confirmed: true,
      p_reference: null,
      p_salesperson: null,
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
  "docs/SALESPERSON_TAILORING_API_VERIFICATION.json",
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
console.log(`PASS: ${results.length * 2} Salesperson/tailoring live API checks`);
