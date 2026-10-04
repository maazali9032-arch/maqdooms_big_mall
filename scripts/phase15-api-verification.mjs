/** Read-only anonymous API registration/security check; no live transaction fixtures. */
import fs from "node:fs/promises";
import assert from "node:assert/strict";
process.loadEnvFile(".env");
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
assert(url && key && !key.startsWith("sb_secret_"), "Public API configuration required");
const results = [];
for (const [rpc, payload] of [
  ["owner_erp_report", { p_dataset: "audit" }],
  ["owner_erp_overview", {}],
]) {
  const response = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  assert(
    response.status === 401 && body.code === "42501",
    rpc + " registered and anonymous denied",
  );
  results.push({ rpc, status: response.status, code: body.code, verified: true });
}
await fs.writeFile(
  "docs/PHASE15_API_VERIFICATION.json",
  JSON.stringify({ verified_at: new Date().toISOString(), results }, null, 2),
);
console.log(JSON.stringify(results));
