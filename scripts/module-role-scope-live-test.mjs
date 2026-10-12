/** Read-only live verification; no grants, measurements or business fixtures. */
import postgres from "postgres";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
process.loadEnvFile(".env");
const sql = postgres(process.env.LOVABLE_DB_MIGRATION_URL, {
  ssl: "require",
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
});
const results = [];
const check = (ok, label) => {
  assert(ok, label);
  results.push(label);
};
try {
  const filename = "20261013000100_module_role_scope.sql";
  const bytes = await fs.readFile("supabase/migrations/" + filename);
  check(
    bytes.equals(await fs.readFile("drizzle/migrations/0038_module_role_scope.sql")),
    "Identical canonical and Drizzle migration bytes",
  );
  const hash = createHash("sha256").update(bytes).digest("hex");
  await sql.begin(async (tx) => {
    await tx`set transaction read only`;
    const ledger = (
      await tx`select sha256,mode from supabase_migrations.erp_execution_history where filename=${filename}`
    )[0];
    check(
      ledger?.sha256 === hash && ledger.mode === "applied",
      "Applied migration ledger and SHA256 match",
    );
    const keys = [
      "inventory.edit_others_thaans",
      "inventory.view_others_cp",
      "inventory.correct_others_cp",
    ];
    check(
      (await tx`select count(*)::int n from public.permissions where key=any(${keys})`)[0].n === 3,
      "All three independent permissions exist",
    );
    check(
      (
        await tx`select count(*)::int n from public.role_permissions where permission_key=any(${keys})`
      )[0].n === 0,
      "No automatic role grants",
    );
    for (const name of [
      "permission_role_restriction(uuid,text)",
      "can_edit_thaan_registration(uuid)",
      "can_view_thaan_cp(uuid)",
      "can_change_others_thaan_cp(uuid)",
    ]) {
      check(
        !(
          await tx`select has_function_privilege('authenticated',${"public." + name},'EXECUTE') allowed`
        )[0].allowed,
        "Private helper: " + name,
      );
    }
    check(
      !(
        await tx`select has_function_privilege('anon','public.owner_user_permission_state(uuid)','EXECUTE') allowed`
      )[0].allowed,
      "Anonymous permission-state access denied",
    );
    const stock = (await tx`select id from public.profiles where email='stock_ent@example.com'`)[0];
    const modulePeople =
      await tx`select p.id,array_agg(r.role_key) roles from public.profiles p join public.user_roles r on r.user_id=p.id where p.active group by p.id`;
    const listingCount = (await tx`select count(*)::int n from public.listings`)[0].n;
    const orderCount = (await tx`select count(*)::int n from public.online_orders`)[0].n;
    const owner = (
      await tx`select user_id id from public.user_roles u join public.profiles p on p.id=u.user_id where role_key='owner' and p.active limit 1`
    )[0];
    check(Boolean(stock && owner), "Affected staff and active Owner present");
    await tx`select set_config('request.jwt.claim.sub',${owner.id},true)`;
    await tx`set local role authenticated`;
    const state = (await tx`select public.owner_user_permission_state(${stock.id}::uuid) state`)[0]
      .state;
    for (const key of ["inventory.view_cost", "stock.adjust"]) {
      const entry = state.find((r) => r.key === key);
      check(
        entry.role_default === false &&
          entry.effective_allowed === false &&
          entry.restriction.startsWith("Owner-only"),
        "Truthful enforced restriction: " + key,
      );
    }
    await tx`select set_config('request.jwt.claim.sub',${stock.id},true)`;
    const row = (await tx`select public.workshop_fabric_inventory() rows`)[0].rows.find(
      (r) => r.barcode === "AND-47650840a",
    );
    check(
      row?.original_mm === null && row?.status === "draft",
      "Reported draft preserved without invented measurements",
    );
    check(
      row.can_edit === true && row.cp_visible === true,
      "Stock module access applies to Owner-created record without creator grants",
    );
    const scan = (await tx`select public.registered_thaan_details('AND-47650840a') detail`)[0]
      .detail;
    check(
      scan.can_complete === true && scan.can_set_cp === true,
      "Stock module can complete Owner-created barcode and enter CP",
    );
    for (const role of ["ecommerce_manager", "counter", "tailor"]) {
      const person = modulePeople.find(
        (p) =>
          p.roles.includes(role) &&
          !p.roles.includes("owner") &&
          (role !== "tailor" || !p.roles.includes("counter")),
      );
      check(Boolean(person), "Existing live module account: " + role);
      await tx`select set_config('request.jwt.claim.sub',${person.id},true)`;
      check(
        (await tx`select count(*)::int n from public.fabric_stock_costs`)[0].n === 0,
        role + " cannot read fabric CP",
      );
      const listings = (await tx`select count(*)::int n from public.listings`)[0].n;
      const orders = (await tx`select count(*)::int n from public.online_orders`)[0].n;
      check(
        listings === (role === "ecommerce_manager" ? listingCount : 0),
        role + " listing access follows module",
      );
      check(
        orders === (role === "ecommerce_manager" ? orderCount : 0),
        role + " online-order access follows module",
      );
    }
  });
  await fs.writeFile(
    "docs/MODULE_ROLE_SCOPE_LIVE_VERIFICATION.json",
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        migration: filename,
        sha256: hash,
        checks: results.length,
        results,
        operations: "Read-only; existing account grants and business data unchanged",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ checks: results.length, passed: true, sha256: hash }));
} finally {
  await sql.end();
}
