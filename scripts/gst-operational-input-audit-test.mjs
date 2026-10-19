import assert from "node:assert/strict";
import fs from "node:fs/promises";
import postgres from "postgres";

const sourcePath = "supabase/migrations/20261019000100_gst_operational_input_audit.sql";
const source = await fs.readFile(sourcePath, "utf8");
const mirror = await fs.readFile("drizzle/migrations/0065_gst_operational_input_audit.sql", "utf8");
assert.equal(source, mirror, "Supabase and Drizzle audit migrations must remain byte-identical");
assert.match(source, /customer_gstin.*payment_method/s);
assert.doesNotMatch(source, /ARRAY\['supply_type'/);
assert.match(source, /p_purchase IS NULL OR p_purchase='\{\}'::jsonb/);
assert.match(source, /left\(supplier_gstin,2\)<>config\.state_code/);

const connection = process.env.LOVABLE_DB_MIGRATION_URL;
if (!connection) throw new Error("LOVABLE_DB_MIGRATION_URL is required");
const sql = postgres(connection, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 15 });
const rollback = Symbol("rollback");
try {
  await sql.begin(async (tx) => {
    await tx.unsafe(source);
    const [functions] = await tx`select
      pg_get_functiondef('public.gst_snapshot_counter_bill(uuid,jsonb)'::regprocedure) like '%customer_gstin%' as sale_context,
      pg_get_functiondef('public.create_barcode_batch_with_gst(uuid,text,date,text,jsonb,jsonb)'::regprocedure) like '%p_purchase IS NULL%' as optional_purchase`;
    assert.deepEqual(functions, { sale_context: true, optional_purchase: true });
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await sql.end();
}
console.log("GST operational-input audit migration syntax and function contracts passed; transaction rolled back.");
