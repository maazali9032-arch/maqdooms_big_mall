import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
const js = ts.transpileModule(await fs.readFile("src/features/reports/evidence-model.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const m = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const valueJs = ts.transpileModule(
  await fs.readFile("src/features/reports/report-value.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const v = await import("data:text/javascript;base64," + Buffer.from(valueJs).toString("base64"));
let checks = 0;
const check = (value, label) => {
  assert(value, label);
  checks++;
};
const row = (data) => ({ key: "test", event_at: null, data });
check(
  new Set(m.categories.flatMap((c) => c.reports.map((r) => r[0]))).size === 24,
  "24 unique report datasets",
);
check(m.snapshots.has("stock") && m.snapshots.has("thans"), "Current state metadata");
check(!m.snapshots.has("movements"), "Historical event dataset");
check(m.inRange("2026-10-12T18:30:00Z", "2026-10-13", "2026-10-13"), "India day inclusive start");
check(!m.inRange("2026-10-13T18:30:00Z", "2026-10-13", "2026-10-13"), "India day exclusive end");
check(!m.inRange(null, "2026-10-13", "2026-10-13"), "Unknown timestamp not invented");
check(m.integer("999999999999999999999") === 999999999999999999999n, "Exact financial integer");
check(m.integer("12500.000") === 12500n, "SQL numeric zero-decimal transport");
check(m.integer("12.5") === null, "No money rounding");
check(m.integer(Number.MAX_SAFE_INTEGER + 1) === null, "Reject unsafe numeric transport");
check(
  m.quantityTotal([row({ quantity: "1.125" }), row({ quantity: "2.875" })]).value === "4.000",
  "Exact mixed fractional quantities",
);
check(
  m.quantityTotal([row({ quantity: "-1500.000" }), row({ quantity: "1000" })]).value === "-500.000",
  "Negative stock balance preserved",
);
check(m.quantityTotal([row({ quantity: null })]).unknown === 1, "Missing quantity not zero");
check(m.sum([row({ cp: null }), row({ cp: "123" })], "cp").unknown === 1, "Unknown cost preserved");
check(v.reportQuantity("-500.000", "mm") === "−0.500 m", "Correct negative metre display");
check(
  v.reportMoney("9007199254740993123").includes("90,07,19,92,54,74,09,931.23"),
  "Exact large financial display",
);
check(
  m.paid(row({ kind: "direct_fabric_sale", status: "completed", payment_confirmed_at: "now" })),
  "Paid sales gate",
);
check(
  !m.paid(row({ kind: "customer_tailoring", status: "completed", payment_confirmed_at: "now" })),
  "Bookings not sales collections",
);
check(
  !m.paid(row({ kind: "direct_fabric_sale", status: "completed" })),
  "Unconfirmed bills excluded",
);
check(
  m.orderDate(
    row({
      kind: "direct_fabric_sale",
      status: "completed",
      payment_confirmed_at: "paid",
      completed_at: "completion",
      created_at: "creation",
    }),
  ) === "completion",
  "Paid drilldown completion date",
);
check(
  m.auditAction(
    row({
      action: "row_update",
      entity_table: "production_jobs",
      new_value: { status: "completed" },
    }),
  ) === "Updated",
  "Generic row update not reconstructed completion",
);
check(
  m.auditAction(
    row({
      action: "progress_owner_production",
      entity_table: "production_jobs",
      new_value: { status: "completed" },
    }),
  ) === "Completed",
  "Explicit status evidence classified",
);
check(
  m.auditAction(row({ action: "set_user_permission", entity_table: "profiles" })) ===
    "Permission Changed",
  "Explicit permission action",
);
check(
  m.auditAction(row({ action: "post_inventory_transfer", entity_table: "stock_transfers" })) ===
    "Transferred",
  "Explicit transfer action",
);
check(
  m.auditModule(
    row({ entity_table: "material_issues", new_value: { customer_tailoring_job_id: "ct" } }),
  ) === "Customer Tailoring",
  "Customer issued materials not owner production",
);
check(
  m.auditModule(
    row({ entity_table: "material_issue_lines", new_value: { material_issue_id: "unknown" } }),
  ) === "Other / unclassified",
  "Ambiguous material event not guessed",
);
check(m.text(null) === "Not recorded", "Missing evidence explicit");
assert.throws(() => v.reportDateRange("2026-02-30", "2026-03-01"));
checks++;
assert.throws(() => v.reportDateRange("2026-10-14", "2026-10-13"));
checks++;
check(
  v.reportDateRange("2026-10-13", "2026-10-13").p_from === "2026-10-12T18:30:00.000Z",
  "Half-open API range",
);
check(m.compareEvidence("10.000", "2.500") > 0, "Exact numeric sorting of SQL decimals");
check(m.compareEvidence("-0.500", "0") < 0, "Negative numeric sorting");
await fs.writeFile(
  "docs/OWNER_WORKSPACE_MODEL_VERIFICATION.json",
  JSON.stringify({ verified_at: new Date().toISOString(), checks, passed: true }, null, 2),
);
console.log("PASS: " + checks + " evidence model checks");
