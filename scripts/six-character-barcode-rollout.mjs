/** Actual-schema release: default rolls back; --apply commits only the reviewed migration. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import postgres from "postgres";
process.loadEnvFile(".env");
const file = "20261021000300_six_character_barcode_identities.sql",
  version = file.split("_")[0];
const source = await fs.readFile("supabase/migrations/" + file, "utf8");
assert.equal(
  source,
  await fs.readFile("drizzle/migrations/0075_six_character_barcode_identities.sql", "utf8"),
);
const hash = createHash("sha256").update(source).digest("hex");
const sql = postgres(process.env.LOVABLE_DB_MIGRATION_URL, {
  ssl: "require",
  max: 1,
  prepare: false,
  connect_timeout: 15,
  onnotice: () => {},
});
const rollback = Symbol("dry-run");
const apply = process.argv.includes("--apply");
async function fingerprints(tx) {
  const result = {};
  const tables =
    await tx`select tablename from pg_tables where schemaname='public' and tablename not in ('barcode_identity_reservations','barcode_identity_bindings') order by tablename`;
  for (const { tablename } of tables) {
    const [row] = await tx.unsafe(
      `select count(*)::text rows,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) checksum from public."${tablename.replaceAll('"', '""')}" t`,
    );
    result[tablename] = row;
  }
  return result;
}
async function verify(tx) {
  const sequences =
    await tx`select sequencename,min_value::text,max_value::text,cycle from pg_sequences where schemaname='public' and sequencename like 'barcode_six_%' order by sequencename`;
  assert.equal(sequences.length, 6);
  assert(sequences.every((x) => x.min_value === "0" && x.max_value === "60466175" && !x.cycle));
  for (const fn of [
    "next_six_barcode(text)",
    "new_typed_finished_barcode(text)",
    "barcode_base36_five(bigint)",
  ]) {
    const [r] =
      await tx`select has_function_privilege('authenticated',${"public." + fn},'EXECUTE') allowed`;
    assert.equal(r.allowed, false);
  }
  const [r] =
    await tx`select position('customer_finished_garment' in pg_get_functiondef('public.owner_barcode_inspect(text,timestamptz,text,integer)'::regprocedure))>0 inspector_extended, position('new_typed_finished_barcode(''C'')' in pg_get_functiondef('public.receive_customer_tailoring_finished_item(uuid,uuid,text,text,bigint)'::regprocedure))>0 customer_prefix,position('next_six_barcode(''T'')' in pg_get_functiondef('public.registration_insert_thans(uuid,jsonb)'::regprocedure))>0 fabric_prefix`;
  assert(Object.values(r).every(Boolean));
  const [owner] =
    await tx`select user_id from user_roles where role_key='owner' order by user_id limit 1`;
  assert(owner);
  await tx`select set_config('request.jwt.claim.sub',${owner.user_id},true)`;
  const [old] =
    await tx`select scan_code,code from orders where scan_code is not null order by created_at limit 1`;
  if (old) {
    const [resolved] =
      await tx`select public.resolve_document_scan_code(${old.scan_code}) code, public.counter_bill(${old.scan_code}) receipt`;
    assert.equal(resolved.code, old.code);
  }
  return { ...r, six_noncycling_namespaces: true, historical_values_preserved: true };
}

try {
  await sql.begin("isolation level repeatable read", async (tx) => {
    await tx.unsafe("set local lock_timeout='10s';set local statement_timeout='60s'");
    await tx`select pg_advisory_xact_lock(hashtext('maqdooms-six-character-barcode-release'))`;
    const before = await fingerprints(tx);
    const tracked =
      await tx`select sha256 from supabase_migrations.erp_execution_history where version=${version}`;
    if (tracked.length) {
      assert.equal(tracked[0].sha256, hash);
      assert.equal(
        (
          await tx`select version from supabase_migrations.schema_migrations where version=${version}`
        ).length,
        1,
      );
    } else {
      assert.equal(
        (
          await tx`select version from supabase_migrations.schema_migrations where version=${version}`
        ).length,
        0,
      );
      await tx.unsafe(source);
      await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values(${version},${file.slice(15, -4)},${[source]})`;
      await tx`insert into supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) values(${version},${file},${hash},'applied',${tx.json({ release: "Six-character barcode identities", historical_records: "unchanged; labels grandfathered" })})`;
    }
    console.log(JSON.stringify(await verify(tx)));
    assert.deepEqual(await fingerprints(tx), before, "Unexpected business record change");
    if (!apply) throw rollback;
  });
  console.log("COMMITTED: 0075; no historical barcode or business record was changed.");
  await sql.begin("read only", async (tx) =>
    console.log(JSON.stringify({ post_commit: await verify(tx) })),
  );
} catch (e) {
  if (e === rollback) console.log("DRY RUN PASSED: all changes rolled back");
  else {
    console.error(
      JSON.stringify({
        failed: true,
        code: e.code ?? "ASSERTION",
        reason:
          e instanceof assert.AssertionError
            ? e.message
            : "Database verification failed; no connection details printed",
      }),
    );
    process.exitCode = 1;
  }
} finally {
  await sql.end({ timeout: 5 });
}
