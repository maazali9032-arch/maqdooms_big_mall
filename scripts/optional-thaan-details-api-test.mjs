import assert from "node:assert/strict";
import fs from "node:fs/promises";
process.loadEnvFile(".env");
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
assert(url && key);
const results = [];
for (const [rpc, body] of [
  [
    "create_barcode_batch_with_details",
    {
      p_request: null,
      p_provider: "Raymonds",
      p_arrival_date: "2026-10-12",
      p_remarks: null,
      p_fabrics: [],
    },
  ],
  [
    "save_registered_thaan_details",
    { p_request: null, p_barcode: "NO-SUCH-CODE", p_colour: null, p_length_mm: null, p_cp: null },
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
  "docs/OPTIONAL_THAAN_DETAILS_API_VERIFICATION.json",
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
console.log(`PASS: ${results.length * 2} Labels-first Stock Entry live API checks`);
