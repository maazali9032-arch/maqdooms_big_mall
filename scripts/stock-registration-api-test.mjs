/** Anonymous, invalid-input requests only: no live stock or user fixtures. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
process.loadEnvFile(".env");
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
assert(url && key, "Public Supabase frontend configuration required");
const requests = [
  ["register_delivery_batch", { p_request: null, p_provider: "Raymonds" }],
  ["register_fabric_type", { p_request: null, p_batch: null, p_name: "Fabric", p_rows: [] }],
  ["append_registered_thans", { p_request: null, p_fabric_type: null, p_rows: [] }],
  ["fill_registered_thaan_cp", { p_request: null, p_barcode: "NONE", p_cp: 1 }],
  ["stock_registration_catalog", {}],
];
const results = [];
for (const [rpc, body] of requests) {
  const response = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, 401, `${rpc}: anonymous request rejected`);
  assert.equal(result.code, "42501", `${rpc}: registered RPC denied by permissions`);
  results.push({ rpc, status: response.status, code: result.code });
}
await fs.writeFile(
  "docs/STOCK_REGISTRATION_API_VERIFICATION.json",
  JSON.stringify(
    {
      verified_at: new Date().toISOString(),
      checks: results.length * 2,
      mode: "anonymous invalid-input requests; no business writes",
      results,
    },
    null,
    2,
  ),
);
console.log(`PASS: ${results.length * 2} live PostgREST permission/discovery checks`);
