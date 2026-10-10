import assert from "node:assert/strict";
import fs from "node:fs/promises";
process.loadEnvFile(".env");
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
assert(url && key);
const results = [];
for (const [rpc, body] of [
  [
    "complete_counter_fabric_sale",
    {
      p_request_id: null,
      p_source: null,
      p_items: [],
      p_customer: null,
      p_payment_confirmed: true,
    },
  ],
  ["owner_set_user_permission", { p_user: null, p_permission: "stock.transfer", p_granted: true }],
  [
    "post_inventory_transfer",
    { p_request_id: null, p_source: null, p_destination: null, p_items: [], p_reason: "invalid" },
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
  "docs/STOCK_TRANSFER_PRICING_API_VERIFICATION.json",
  JSON.stringify(
    {
      verified_at: new Date().toISOString(),
      checks: results.length * 2,
      results,
      mode: "anonymous invalid-input API calls; no live business writes",
    },
    null,
    2,
  ),
);
console.log(`PASS: ${results.length * 2} live API checks`);
