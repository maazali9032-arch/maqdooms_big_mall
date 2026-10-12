import assert from "node:assert/strict";
import fs from "node:fs/promises";
process.loadEnvFile(".env");
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
assert(url && key);
const results = [];
for (const [rpc, body] of [
  ["workshop_fabric_inventory", {}],
  [
    "edit_workshop_thaan",
    { p_request: null, p_thaan: null, p_version: null, p_changes: {}, p_reason: null },
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
  "docs/WORKSHOP_INVENTORY_API_VERIFICATION.json",
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
