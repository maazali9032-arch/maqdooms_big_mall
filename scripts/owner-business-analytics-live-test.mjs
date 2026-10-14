/** Read-only acceptance. Uses existing accounts and never posts a sale or creates fixtures. */
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import postgres from "postgres";
process.loadEnvFile(".env");
const sql = postgres(process.env.LOVABLE_DB_MIGRATION_URL, {
  ssl: "require",
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
});
let checks = 0;
const check = (v, label) => {
  assert(v, label);
  checks++;
};
async function asUser(id, query) {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claim.sub',${id ?? ""},true)`;
    await tx.unsafe("set local role authenticated");
    return (await tx.unsafe(query))[0].result;
  });
}
try {
  const users =
    await sql`select distinct on(r.role_key) r.role_key,p.id from user_roles r join profiles p on p.id=r.user_id where p.active order by r.role_key,p.id`;
  const owner = users.find((u) => u.role_key === "owner");
  check(!!owner, "Existing Owner account available");
  const daily = await asUser(
    owner.id,
    "select owner_daily_business((now() at time zone 'Asia/Kolkata')::date) result",
  );
  check(
    typeof daily.revenue_paise === "string" && typeof daily.ecommerce_paise === "string",
    "Live daily totals use exact transport",
  );
  const monthly = await asUser(
    owner.id,
    "select owner_monthly_business('2026-09-01T00:00:00+05:30','2026-10-01T00:00:00+05:30','2026-08-01T00:00:00+05:30','2026-09-01T00:00:00+05:30',null) result",
  );
  check(
    Array.isArray(monthly.rankings) && monthly.current.bills >= 0,
    "Live previous-month analytics available",
  );
  const lines = await asUser(
    owner.id,
    "select owner_erp_report('sales_lines',null,null,null,25) result",
  );
  check(Array.isArray(lines.rows), "Full sales evidence available to Owner");
  for (const role of [
    "stock_entry",
    "counter",
    "ecommerce_manager",
    "tailor",
    "salesperson",
    "production",
  ]) {
    const user = users.find((u) => u.role_key === role);
    if (!user) continue;
    const ownerRole =
      await sql`select exists(select 1 from user_roles where user_id=${user.id} and role_key='owner') owner`;
    if (ownerRole[0].owner) continue;
    let rejected = false;
    try {
      await asUser(user.id, "select owner_daily_business(current_date) result");
    } catch (e) {
      rejected = e.message.includes("Owner required");
    }
    check(rejected, role + " cannot read Owner analytics");
  }
  const signature =
    "public.submit_paid_ecommerce_order(uuid,text,text,timestamptz,bigint,uuid,jsonb,uuid,uuid)";
  const access =
    await sql`select has_function_privilege('anon',${signature},'execute') anon,has_function_privilege('authenticated',${signature},'execute') staff,has_function_privilege('service_role',${signature},'execute') integration`;
  check(
    !access[0].anon && !access[0].staff && access[0].integration,
    "Only trusted service role can submit paid orders",
  );
  const ingress = await sql`select count(*)::integer n from ecommerce_paid_receipts`;
  check(ingress[0].n === 0, "Rollout inserted no artificial online sales");
  await fs.writeFile(
    "docs/OWNER_BUSINESS_ANALYTICS_LIVE_READ_VERIFICATION.json",
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        checks,
        passed: true,
        read_only: true,
        roles_tested: users.map((u) => u.role_key),
      },
      null,
      2,
    ) + "\n",
  );
  console.log("PASS: " + checks + " read-only live analytics checks");
} finally {
  await sql.end();
}
