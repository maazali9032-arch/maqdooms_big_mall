import { ecommercePaidCases } from "./ecommerce-paid-cases.mjs";
import { randomUUID } from "node:crypto";
export async function businessAnalyticsCases({ db, q, one, denied, login, users, check }) {
  await login(users.owner);
  const facts = await q("select * from business_sale_facts()").catch(() => null);
  check(facts === null, "Private finance helper unavailable even to browser Owner");
  const reports = await one("select owner_erp_report('sales_lines',null,null,null,200)");
  check(reports.rows.length >= 2, "Historical completed Counter sales included without backfill");
  for (const row of reports.rows) {
    check(row.data.channel === "counter", "Existing canonical sales remain Counter");
    check(
      row.data.dimension_basis === "historical_bill_snapshot_or_current_catalogue",
      "Older names labelled honestly",
    );
  }
  const daily = await one("select owner_daily_business((now() at time zone 'Asia/Kolkata')::date)");
  check(BigInt(daily.revenue_paise) > 0n, "Daily real completed sales");
  check(
    daily.production_finished > 0 && daily.finished_pieces_received > 0,
    "Finished jobs and receipts counted separately",
  );
  const custom = await one("select owner_erp_report('production_jobs',null,null,null,200)");
  check(
    custom.rows.some((r) => r.data.design === "Hand embroidered"),
    "Custom design is not omitted from existing reports",
  );
  const monthly = await one(
    "select owner_monthly_business(now()-interval '1 day',now()+interval '1 day',now()-interval '3 days',now()-interval '1 day',null)",
  );
  check(
    monthly.rankings.some((r) => r.dimension === "fabric_vendor"),
    "Fabric/vendor ranking exists",
  );
  check(
    monthly.rankings.some((r) => r.dimension === "salesperson" && r.identity === users.salesperson),
    "Revenue credited to Salesperson, not Counter operator",
  );
  check(monthly.current.unidentified_customer_bills > 0, "Walk-in customers not invented");
  check(
    BigInt(monthly.current.fabric_mm) > 0n && BigInt(monthly.current.pieces) > 0n,
    "Metres and pieces kept separate",
  );
  check(
    monthly.previous.revenue_paise === "0",
    "No previous sales means zero without invented comparison",
  );
  await denied(
    "select owner_monthly_business(now(),now()-interval '1 day',now()-interval '2 days',now()-interval '1 day',null)",
  );
  await login(null);
  users.production = await one("select id from profiles where full_name='Production Staff'");
  for (const role of [
    "stock_entry",
    "counter",
    "ecommerce_manager",
    "tailor",
    "salesperson",
    "production",
  ]) {
    await login(users[role]);
    await denied("select owner_daily_business(current_date)");
    await denied("select owner_erp_report('sales_lines',null,null,null,200)");
    await denied(
      "select owner_monthly_business(now()-interval '1 day',now(),now()-interval '2 days',now()-interval '1 day',null)",
    );
    check(
      (await q("select * from sale_analysis_dimensions")).length === 0,
      "Staff cannot read sale dimensions",
    );
  }
  await login(null);
  await q("set role anon");
  await denied("select owner_daily_business(current_date)");
  await denied("select business_sale_facts()");
  await login(users.owner);
  await ecommercePaidCases({ q, one, denied, login, users, check });
  await historicalCostCases({ q, one, denied, login, users, check });
}

async function historicalCostCases({ q, one, denied, login, users, check }) {
  await login(null);
  const id = randomUUID();
  const stock = (
    await q(
      "select th.id thaan_id,th.fabric_stock_id,loc.id source_id from thaans th cross join locations loc where loc.kind='showroom' and th.status='active' limit 1",
    )
  )[0];
  await q(
    "insert into orders(id,code,kind,source_location_id,created_by,salesperson_user_id,created_at,payment_confirmed_at) values($1,'HISTORICAL-COST-GAP','direct_fabric_sale',$2,$3,$4,'2026-06-01','2026-07-10T18:30:00Z')",
    [id, stock.source_id, users.counter, users.salesperson],
  );
  // Disposable imported history deliberately lacks a financial snapshot.
  await q(
    "insert into order_items(order_id,fabric_stock_id,thaan_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) values($1,$2,$3,1000,'mm',12345,12345)",
    [id, stock.fabric_stock_id, stock.thaan_id],
  );
  await q(
    "update orders set status='completed',completed_at='2026-07-10T18:30:00Z',final_customer_price_paise=12345 where id=$1",
    [id],
  );
  await login(users.owner);
  const data = await one(
    "select owner_erp_report('sales_lines','2026-07-01','2026-08-01',null,200)",
  );
  const row = data.rows.find((r) => r.data.order_id === id);
  check(
    row.data.cost_paise === null && row.data.margin_paise === null,
    "Current recorded CP never substitutes missing sale-time CP",
  );
  const july = await one(
    "select owner_monthly_business('2026-07-01','2026-08-01','2026-06-01','2026-07-01',null)",
  );
  check(july.current.unknown_cost_lines === 1, "Unknown costs counted honestly in monthly totals");
  check(
    july.rankings
      .filter((r) => r.dimension === "fabric_vendor")
      .every((r) => r.known_margin_paise === null),
    "Unknown group margin remains null",
  );
  const julyOrders = await one(
    "select owner_erp_report('orders','2026-07-01','2026-08-01',null,200)",
  );
  check(
    julyOrders.rows.some((r) => r.key === id),
    "Paid order reported by completion time despite older creation date",
  );
  const juneOrders = await one(
    "select owner_erp_report('orders','2026-06-01','2026-07-01',null,200)",
  );
  check(
    !juneOrders.rows.some((r) => r.key === id),
    "No duplicate historical bill in creation month",
  );
  await denied("update sale_analysis_dimensions set fabric_type='Wrong' where order_item_id=$1", [
    row.key,
  ]);
}
