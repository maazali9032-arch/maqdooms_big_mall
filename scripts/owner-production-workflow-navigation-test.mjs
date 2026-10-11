import assert from "node:assert/strict";
import { canAccessPath } from "../src/app/access/modules.ts";
for (const path of ["/inventory/transfers", "/inventory/transfers/history"]) {
  assert(canAccessPath(["owner"], [], path));
  assert(canAccessPath(["stock_entry"], ["stock.transfer_finished"], path));
  assert(canAccessPath(["stock_entry"], ["stock.transfer"], path));
  assert(!canAccessPath(["stock_entry"], [], path));
  assert(!canAccessPath(["counter"], ["stock.transfer_finished"], path));
  assert(!canAccessPath(["salesperson"], ["stock.transfer_finished"], path));
}
console.log("PASS: 12 finished-product transfer navigation checks");
