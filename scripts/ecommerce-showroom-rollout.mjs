/** Actual-schema release: default rolls back; --apply commits only the reviewed migration. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import postgres from "postgres";
process.loadEnvFile(".env");
const file = "20261021000200_ecommerce_showroom_scanning.sql",
  version = file.split("_")[0];
const source = await fs.readFile("supabase/migrations/" + file, "utf8");
assert.equal(
  source,
  await fs.readFile("drizzle/migrations/0074_ecommerce_showroom_scanning.sql", "utf8"),
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
const seeded = [
  "55555555-5555-5555-5555-555555555501",
  "55555555-5555-5555-5555-555555555502",
  "55555555-5555-5555-5555-555555555503",
  "55555555-5555-5555-5555-555555555504",
];
async function fingerprints(tx) {
  const result = {};
  const tables =
    await tx`select tablename from pg_tables where schemaname='public' order by tablename`;
  for (const { tablename } of tables) {
    if (tablename === "listings") continue;
    const [r] = await tx.unsafe(
      `select count(*)::text rows,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) checksum from public."${tablename.replaceAll('"', '""')}" t`,
    );
    result[tablename] = r;
  }
  const rows = await tx`select to_jsonb(l) payload from public.listings l order by id`;
  result.listings = rows.map(({ payload }) => {
    delete payload.archived_at;
    if (seeded.includes(payload.id)) delete payload.published;
    return payload;
  });
  return result;
}
async function verify(tx) {
  const [r] =
    await tx`select count(*)::integer n from public.listings where id=any(${seeded}::uuid[]) and archived_at is not null and not published`;
  assert.equal(r.n, 4, "Only four known demo listings must be archived");
  const [stock] = await tx`select public.showroom_stock_projection(null) data`;
  assert(
    stock.data.every((x) => !JSON.stringify(x).includes("cp_paise")),
    "CP must not leak",
  );
  const [ecom] =
    await tx`select user_id from public.user_roles where role_key='ecommerce_manager' and public.has_perm(user_id,'ecommerce.link_stock') order by user_id limit 1`;
  assert(ecom, "Active e-commerce role required");
  await tx`select set_config('request.jwt.claim.sub',${ecom.user_id},true)`;
  await tx.unsafe("set local role authenticated");
  for (const kind of ["fabric", "product"]) {
    const item = stock.data.find((x) => x.kind === kind);
    if (item) {
      const [r] = await tx`select public.ecommerce_scan_stock(${item.barcode}) item`;
      assert.equal(r.item.id, item.id);
    }
  }
  const [availability] =
    await tx`select count(*)::integer n from public.listing_showroom_availability() where listing_id=any(${seeded}::uuid[])`;
  assert.equal(availability.n, 0);
  await tx.unsafe("reset role");
  return { archived_demo_listings: 4, live_read_only_scans: true, physical_tables_preserved: true };
}
try {
  await sql.begin("isolation level repeatable read", async (tx) => {
    await tx.unsafe("set local lock_timeout='10s';set local statement_timeout='60s'");
    await tx`select pg_advisory_xact_lock(hashtext('maqdooms-ecommerce-showroom-release'))`;
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
      await tx`insert into supabase_migrations.erp_execution_history(version,filename,sha256,mode,verification) values(${version},${file},${hash},'applied',${tx.json({ release: "Showroom e-commerce scanning", seeded_catalog: "four exact demo IDs archived; history retained" })})`;
    }
    console.log(JSON.stringify(await verify(tx)));
    assert.deepEqual(await fingerprints(tx), before, "Unexpected business record change");
    if (!apply) throw rollback;
  });
  console.log("COMMITTED: 0074, four demo listings archived; all other business values preserved.");
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
