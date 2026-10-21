/** Two real PostgreSQL sessions; allocations roll back, sequence gaps intentionally remain. */
import assert from "node:assert/strict";
import postgres from "postgres";
process.loadEnvFile(".env");
const db = postgres(process.env.LOVABLE_DB_MIGRATION_URL, {
  ssl: "require",
  max: 2,
  prepare: false,
  connect_timeout: 15,
  onnotice: () => {},
});
const undo = Symbol("allocation-probe-rollback");
let ready = 0,
  release;
const barrier = new Promise((resolve) => {
  release = resolve;
});
const codes = [];
try {
  const allocate = async () => {
    try {
      await db.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout='15s';set local lock_timeout='10s'");
        const [r] = await tx`select public.next_six_barcode('B') code`;
        codes.push(r.code);
        ready++;
        if (ready === 2) release();
        let timer;
        try {
          await Promise.race([
            barrier,
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Parallel allocation barrier timed out")),
                10000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        throw undo;
      });
    } catch (e) {
      if (e !== undo) throw e;
    }
  };
  await Promise.all([allocate(), allocate()]);
  assert.equal(codes.length, 2);
  assert.notEqual(codes[0], codes[1]);
  try {
    await db.begin(async (tx) => {
      const [r] = await tx`select public.next_six_barcode('B') code`;
      assert(!codes.includes(r.code));
      assert.match(r.code, /^B[0-9A-Z]{5}$/);
      throw undo;
    });
  } catch (e) {
    if (e !== undo) throw e;
  }
  console.log(
    JSON.stringify({
      real_database_sessions: 2,
      concurrent_allocations_unique: true,
      rollback_codes_not_reused: true,
      allocations_rolled_back: true,
      business_records_created: 0,
      intentional_sequence_gaps: 3,
    }),
  );
} catch (e) {
  console.error(
    JSON.stringify({
      failed: true,
      code: e.code ?? e.name,
      reason:
        e instanceof assert.AssertionError
          ? e.message
          : "Concurrent allocation check failed; no connection details printed",
    }),
  );
  process.exitCode = 1;
} finally {
  release();
  await db.end({ timeout: 5 });
}
