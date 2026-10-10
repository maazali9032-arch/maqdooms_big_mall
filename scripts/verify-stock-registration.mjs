/** Sequential disposable regressions; no live environment or data. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const runtime = process.argv[2];
if (!runtime) throw new Error("PGlite runtime required");
const suites = [
  "phase1-schema",
  "phase2-security",
  "phase3-ledger",
  "phase4-fabric",
  "phase5-transfer",
  "phase6-sale",
  "phase7-tailoring",
  "phase8-material",
  "phase9-hierarchy",
  "phase10-production",
  "phase11-products",
  "phase12-costing",
  "phase13-inventory",
  "phase14-sales",
  "phase15-reporting",
  "legacy-reconciliation",
  "test-stock-scenarios",
  "stock-registration",
];
const results = [];
for (const name of suites) {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/" + name + "-test.mjs",
      runtime,
      "--include-phase8",
      "--include-phase9",
      "--include-phase10",
      "--include-phase11",
      "--include-phase12",
      "--include-phase13",
      "--include-phase14",
      "--include-phase15",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, NODE_OPTIONS: "--v8-pool-size=1 --max-old-space-size=3072" },
    },
  );
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  fs.writeFileSync(path.join(os.tmpdir(), "stock-registration-" + name + ".log"), output);
  results.push({ suite: name, exit: result.status, output: output.slice(-2400) });
  console.log(name + ": " + result.status + " " + output.slice(-180));
  if (result.status !== 0) break;
}
fs.writeFileSync(
  "docs/STOCK_REGISTRATION_DATABASE_TESTS.json",
  JSON.stringify({ verified_at: new Date().toISOString(), results }, null, 2),
);
if (results.length !== suites.length || results.some((result) => result.exit !== 0))
  process.exitCode = 1;
