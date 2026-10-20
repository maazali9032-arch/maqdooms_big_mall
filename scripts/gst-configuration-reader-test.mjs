import assert from "node:assert/strict";
import {
  gstReadWithDeadline,
  readOwnerGstConfiguration,
} from "../src/features/gst/configuration-reader.ts";

const saved = {
  id: "saved-version",
  price_mode: "exclusive",
  invoice_display: "taxable_first",
  tailoring_display: "combined",
  purchase_mode: "include_noncreditable",
};
function mockClient(configurationResult, rulesResult) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(["from", table]);
      const chain = {
        then(resolve, reject) {
          return Promise.resolve(
            table === "gst_configuration_versions" ? configurationResult : rulesResult,
          ).then(resolve, reject);
        },
      };
      for (const method of ["select", "order", "limit", "abortSignal", "maybeSingle", "eq"])
        chain[method] = (...args) => {
          calls.push([method, ...args]);
          return chain;
        };
      return chain;
    },
  };
}
const client = mockClient({ data: saved, error: null }, { data: [{ id: "rule" }], error: null });
const result = await readOwnerGstConfiguration(client, new AbortController().signal);
assert.deepEqual(result, { configuration: saved, rules: [{ id: "rule" }] });
assert(
  client.calls.some(
    ([method, column, options]) =>
      method === "order" && column === "created_at" && options.ascending === false,
  ),
);
assert(
  client.calls.some(
    ([method, column, id]) => method === "eq" && column === "configuration_id" && id === saved.id,
  ),
);
assert(!client.calls.some(([method]) => method === "rpc"));
const empty = mockClient({ data: null, error: null }, null);
assert.deepEqual(await readOwnerGstConfiguration(empty, new AbortController().signal), {
  configuration: null,
  rules: [],
});
assert.equal(empty.calls.filter(([method]) => method === "from").length, 1);
const error = new Error("permission denied");
await assert.rejects(
  readOwnerGstConfiguration(mockClient({ data: null, error }, null), new AbortController().signal),
  /permission denied/,
);
await assert.rejects(
  readOwnerGstConfiguration(
    mockClient({ data: saved, error: null }, { data: null, error }),
    new AbortController().signal,
  ),
  /permission denied/,
);
let requestSignal;
await assert.rejects(
  gstReadWithDeadline(
    (signal) => {
      requestSignal = signal;
      return new Promise(() => {});
    },
    undefined,
    10,
  ),
  /too long/,
);
assert(requestSignal.aborted);
assert.equal(await gstReadWithDeadline(async () => 42, undefined, 100), 42);
const cancel = new AbortController();
cancel.abort();
await assert.rejects(
  gstReadWithDeadline(() => new Promise(() => {}), cancel.signal, 100),
  /cancelled/,
);
console.log(
  "PASS: all four saved choices read without a new RPC; latest-save ordering, version-specific rules, empty config, permission errors, timeout and cancellation.",
);
