import assert from "node:assert/strict";
import {
  allowedModules,
  canAccessPath,
  homePath,
  moduleForPath,
} from "../src/app/access/modules.ts";
assert(allowedModules(["stock_entry"]).has("stock_entry"));
assert.equal(homePath(["stock_entry"], ["inventory.receive"]), "/inventory/receiving");
assert.equal(homePath(["stock_entry"], []), "/inventory");
assert.equal(homePath(["owner"], []), "/dashboard");
assert.equal(moduleForPath("/inventory/receiving"), "stock_entry");
assert.equal(moduleForPath("/inventory"), "inventory");
assert(canAccessPath(["stock_entry"], ["inventory.receive"], "/inventory/receiving"));
assert(!canAccessPath(["stock_entry"], [], "/inventory/receiving"));
assert(!canAccessPath(["counter"], ["inventory.receive"], "/inventory/receiving"));
assert(!canAccessPath(["ecommerce_manager"], ["inventory.receive"], "/inventory/receiving"));
assert(canAccessPath(["owner"], [], "/inventory/receiving"));
console.log("PASS: 11 Stock Entry navigation/permission checks");
