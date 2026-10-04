import assert from "node:assert/strict";
import {
  reportMoney,
  reportQuantity,
  reportDateRange,
} from "../src/features/reports/report-value.ts";
assert.equal(reportMoney("18014398509481982"), "₹18,01,43,98,50,94,819.82");
assert.equal(reportMoney("0"), "₹0.00");
assert.equal(reportMoney("-101"), "−₹1.01");
assert.equal(reportQuantity("12345.000", "mm"), "12.345 m");
assert.equal(reportQuantity("-1", "mm"), "−0.001 m");
assert.equal(reportQuantity("3.125", "m"), "3.125 m");
assert.deepEqual(reportDateRange("2026-10-04", "2026-10-04"), {
  p_from: "2026-10-03T18:30:00.000Z",
  p_to: "2026-10-04T18:30:00.000Z",
});
assert.deepEqual(reportDateRange("", ""), {});
assert.throws(() => reportDateRange("2026-10-05", "2026-10-04"));
console.log("PASS: 9 exact report money/quantity/India date checks");
