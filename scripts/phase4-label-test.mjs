/** Independent CODE128 decoder verifies the actual UI encoder's symbols. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fabricBarcodeBars } from "../src/features/inventory/fabric-label.ts";
import { fabricMoneyInput } from "../src/features/inventory/fabric-entry-input.ts";
const { Code128Reader, BitArray } = await import(pathToFileURL(resolve(process.argv[2])).href);
let checks = 0;
for (const code of [
  "FAB-000184",
  "FAB-8a43f677d9a3475ea2ae0fcf43780e73",
  "FAB-8a43f677-d9a3-475e-a2ae-0fcf43780e73",
]) {
  const bars = fabricBarcodeBars(code);
  assert.match(bars, /^[01]+$/);
  checks++;
  for (const scale of [1, 2, 3]) {
    const bits =
      "0".repeat(20 * scale) +
      Array.from(bars, (b) => b.repeat(scale)).join("") +
      "0".repeat(20 * scale);
    const row = new BitArray(bits.length);
    for (let i = 0; i < bits.length; i++) if (bits[i] === "1") row.set(i);
    assert.equal(new Code128Reader().decodeRow(0, row).getText(), code);
    checks++;
  }
  assert.equal(fabricBarcodeBars(code), bars);
  checks++;
}
for (const [input, paise] of [
  ["0", 0],
  ["0.01", 1],
  ["500.05", 50005],
  ["123.1", 12310],
]) {
  assert.equal(fabricMoneyInput(input), paise);
  checks++;
}
for (const invalid of ["", "-1", "1.001", "1e3", "Infinity", "9007199254740993"]) {
  assert.throws(() => fabricMoneyInput(invalid));
  checks++;
}
console.log(`PASS: ${checks} barcode decoding / exact money input checks`);
