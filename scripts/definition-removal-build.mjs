/** Build the exact staged tree; preserve unrelated ongoing workspace changes. No deployment. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const root = process.cwd();
const floorsOnly = process.argv.includes('--showroom-floors');
const counterScan = process.argv.includes('--counter-unified-scan');
const proofName = process.argv.includes('--stitching-pricing') ? 'COUNTER_STITCHING' : process.argv.includes('--counter-details') ? 'COUNTER_BARCODE_DETAILS' : counterScan ? 'COUNTER_UNIFIED_SCAN' : floorsOnly ? 'SHOWROOM_FLOORS_ONLY' : 'DEFINITION_REMOVAL';
const reuse = process.argv[2];
const target = reuse
  ? path.resolve(reuse)
  : path.join(os.tmpdir(), "maqdooms-tanstack-security-" + randomUUID());
assert(
  target.startsWith(path.join(os.tmpdir(), "maqdooms-tanstack-security-")),
  "Disposable build directory required",
);
if (!reuse) fs.mkdirSync(target);
const files = spawnSync("git", ["ls-files", "--cached", "-z"], {
  encoding: "utf8",
  windowsHide: true,
});
assert(files.status === 0, "Workspace inventory failed");
const entries=[...new Set(files.stdout.split('\0').filter(Boolean))].filter(file=>!path.basename(file).startsWith('.env'));
const exported=spawnSync('git',['checkout-index','--force','--prefix='+target.replaceAll('\\','/')+'/','--stdin','-z'],{input:entries.join('\0')+'\0',windowsHide:true,encoding:'utf8'});
assert(exported.status===0,'Staged tree export failed: '+exported.stderr);
if (fs.existsSync(".env")) process.loadEnvFile(".env");
const publicNames = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
];
fs.writeFileSync(
  path.join(target, ".env"),
  publicNames
    .filter((name) => process.env[name])
    .map((name) => {
      assert(!process.env[name].includes("sb_secret"), "Public key required");
      return name + "=" + process.env[name];
    })
    .join("\n") + "\n",
);
const env = {
  ...process.env,
  LOVABLE_DB_MIGRATION_URL: "",
  NODE_OPTIONS: "--v8-pool-size=1 --max-old-space-size=4096",
  NITRO_PRESET: "vercel",
};
const logFile = path.join(os.tmpdir(), "maqdooms-"+proofName.toLowerCase().replaceAll('_','-')+"-build.log");
const log = fs.openSync(logFile, "w");
const install = reuse
  ? { status: 0 }
  : spawnSync("npm.cmd", ["ci", "--no-audit", "--no-fund"], {
      cwd: target,
      shell: true,
      stdio: ["ignore", log, log],
      windowsHide: true,
      env,
    });
const lock = JSON.parse(fs.readFileSync(path.join(target, "package-lock.json"), "utf8"));
const core = Object.entries(lock.packages).filter(([key]) =>
  key.endsWith("node_modules/@tanstack/start-server-core"),
);
assert(
  core.length && core.every(([, value]) => value.version === "1.169.39"),
  "Unpatched server-core found",
);
const build =
  install.status === 0
    ? spawnSync(process.execPath, [path.join(target, "node_modules/vite/bin/vite.js"), "build"], {
        cwd: target,
        stdio: ["ignore", log, log],
        windowsHide: true,
        env,
      })
    : null;
fs.closeSync(log);
const result = {
  verified_at: new Date().toISOString(),
  isolated_directory: target,
  install_exit: install.status,
  build_exit: build?.status ?? null,
  core_versions: core.map(([key, value]) => ({ path: key, version: value.version })),
  log: logFile,
  deployed: false,
  preset: "vercel",
  fresh_install_reused: Boolean(reuse),
  vercel_output_present: fs.existsSync(path.join(target, ".vercel/output/config.json")),
};
fs.writeFileSync('docs/'+proofName+'_BUILD.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exitCode =
  install.status === 0 && build?.status === 0 && result.vercel_output_present ? 0 : 1;
