import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { fabricBarcodeBars } from "../src/features/inventory/fabric-label.ts";
const { Code128Reader, BitArray } = await import(pathToFileURL(resolve(process.argv[2])).href);
let checks = 0;
for (const code of [
  "RDS-31001a",
  "AND-41001b",
  "RDS-12345678z",
  "RDS-12345678aa",
  "RDS-12345678ab",
  "RDS-12345678aaa",
]) {
  const bars = fabricBarcodeBars(code);
  for (const scale of [1, 2, 3]) {
    const bits =
      "0".repeat(20 * scale) +
      [...bars].map((bit) => bit.repeat(scale)).join("") +
      "0".repeat(20 * scale);
    const row = new BitArray(bits.length);
    for (let index = 0; index < bits.length; index++) if (bits[index] === "1") row.set(index);
    assert.equal(new Code128Reader().decodeRow(0, row).getText(), code);
    checks++;
  }
}
console.log("PASS: " + checks + " provider/Than barcode decoding checks");
