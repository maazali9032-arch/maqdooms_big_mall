/** Independent CODE128 decoder verifies the actual UI encoder's symbols. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fabricBarcodeBars } from "../src/features/inventory/fabric-label.ts";
const { Code128Reader, BitArray } = await import(pathToFileURL(resolve(process.argv[2])).href);
let checks = 0;
for (const code of [
  "PRD-0123456789abcdef0123456789abcdef",
  "PRD-ffffffffffffffffffffffffffffffff",
  "PRD-00000000000000000000000000000000",
]) {
  const bars = fabricBarcodeBars(code);
  assert.match(bars, /^[01]+$/);
  checks++;
  for (const scale of [1, 2, 3]) {
    const bits =
      "0".repeat(10 * scale) +
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
console.log(`PASS: ${checks} Product Barcode decoding checks`);
