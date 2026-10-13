import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { reportDateRange, reportMoney, reportQuantity } from "./report-value";
import { useEvidence } from "./use-evidence";
import { indiaDay, inRange, group, quantityTotal, paid, title } from "./evidence-model";
import { Bars, RecordTable } from "./EvidenceViews";
import { OwnerKpi, ColumnChart, DonutChart } from "./OwnerVisuals";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Boxes,
  ArrowLeftRight,
  ShoppingCart,
  Scissors,
  Factory,
} from "lucide-react";
import { shiftDay } from "./evidence-model";
import "./owner-workspace.css";

type Overview = {
  paid_sales: { kind: string; orders: string; total_paise: string }[];
  customer_tailoring_bookings: { orders: string; booked_customer_price_paise: string };
  controls: Record<string, number>;
};
export function OwnerDashboard() {
  const { isOwner } = useSession();
  const [day, setDay] = useState(indiaDay()),
    [trend, setTrend] = useState("amount"),
    [breakdown, setBreakdown] = useState("kind"),
    [inventory, setInventory] = useState("location"),
    [production, setProduction] = useState("status"),
    [tailoring, setTailoring] = useState("customer"),
    [recent, setRecent] = useState("bills");
  const range = reportDateRange(day, day);
  const overview = useQuery({
    queryKey: ["owner-report-overview", "dashboard", day],
    enabled: isOwner,
    staleTime: 30000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_erp_overview", range);
      if (error) throw error;
      return data as unknown as Overview;
    },
  });
  const orders = useEvidence("orders");
  const stocks = useEvidence("stock");
  const jobs = useEvidence("production_jobs");
  const customers = useEvidence("customer_tailoring");
  const movements = useEvidence("movements", range);
  const issues = useEvidence(
    "material_issues",
    range,
    production === "issued" || production === "usage",
  );
  const history = useEvidence("production_history", range, production === "completed");
  const controls = useEvidence("controls", {}, recent === "reviews");
  const productNames = useEvidence("finished_products", {}, breakdown === "products");
  const fabricNames = useEvidence("fabric_stock", {}, breakdown === "products");
  if (!isOwner) return <p>Owner access is required.</p>;
  const sales = (orders.data ?? []).filter(
    (r) => paid(r) && inRange(r.data["completed_at"], day, day),
  );
  const hourly = sales.map((r) => ({
    ...r,
    data: {
      ...r.data,
      hour:
        new Date(String(r.data["completed_at"])).toLocaleTimeString("en-GB", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
        }) + ":00",
    },
  }));
  const refresh = () =>
    [
      overview,
      ...(breakdown === "products" ? [productNames, fabricNames] : []),
      orders,
      stocks,
      jobs,
      customers,
      movements,
      ...(production === "issued" || production === "usage" ? [issues] : []),
      ...(production === "completed" ? [history] : []),
      ...(recent === "reviews" ? [controls] : []),
    ].forEach((q) => void q.refetch());
  const total = (overview.data?.paid_sales ?? []).reduce((s, r) => s + BigInt(r.total_paise), 0n);
  const report = (dataset: string, extra = "") =>
    `/reports?from=${day}&through=${day}${extra}#${dataset}`;
  const active = (customers.data ?? []).filter(
    (r) => !["completed", "delivered", "cancelled"].includes(String(r.data["status"])),
  );
  const selector = (
    label: string,
    value: string,
    set: (s: string) => void,
    options: [string, string][],
  ) => (
    <select
      aria-label={label}
      className="max-w-full rounded-lg border bg-background p-2 text-sm"
      value={value}
      onChange={(e) => set(e.target.value)}
    >
      {options.map(([v, n]) => (
        <option key={v} value={v}>
          {n}
        </option>
      ))}
    </select>
  );
  const cardState = (q: { isPending: boolean; error: Error | null; refetch: () => unknown }) => (
    <QueryState loading={q.isPending} error={q.error} retry={() => void q.refetch()} />
  );
  const inventoryRows = (stocks.data ?? []).filter(
    (r) => inventory !== "fabric" || r.data["kind"] === "fabric",
  );
  const stockGroups = group(inventoryRows, inventory === "location" ? "location" : "item");
  const stockDetails = stockGroups.map((g) => {
    const matching = inventoryRows.filter(
      (r) => String(r.data[inventory === "location" ? "location" : "item"]) === g.name,
    );
    const units = [...new Set(matching.map((r) => String(r.data["unit"])))];
    return {
      name: g.name,
      value: g.value,
      units: units.map((unit) => ({
        unit,
        total: quantityTotal(matching.filter((r) => r.data["unit"] === unit)),
      })),
    };
  });
  return (
    <div className="owner-workspace owner-dashboard space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border bg-card p-4">
        <label className="text-sm font-medium">
          Operational date (India)
          <Input
            aria-label="Operational date"
            type="date"
            value={day}
            max={indiaDay()}
            onChange={(e) => {
              if (e.target.value && e.target.value <= indiaDay()) setDay(e.target.value);
            }}
          />
        </label>
        <div className="flex gap-1">
          <Button
            aria-label="Previous dashboard day"
            variant="outline"
            size="icon"
            onClick={() => setDay(shiftDay(day, -1))}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Button
            aria-label="Next dashboard day"
            variant="outline"
            size="icon"
            disabled={day >= indiaDay()}
            onClick={() => setDay(shiftDay(day, 1))}
          >
            <ArrowRight className="size-4" />
          </Button>
          <Button variant="outline" onClick={() => setDay(indiaDay())}>
            Today
          </Button>
        </div>
        <div className="text-right">
          <p className="mb-2 text-xs text-muted-foreground">
            Overview last updated:{" "}
            {overview.dataUpdatedAt
              ? new Date(overview.dataUpdatedAt).toLocaleTimeString("en-IN")
              : "Not loaded"}
          </p>
          <Button variant="outline" onClick={refresh}>
            <RefreshCw className="mr-2 size-4" />
            Refresh dashboard
          </Button>
        </div>
      </div>
      {cardState(overview)}
      {overview.data && !overview.error && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              "Total Sales Collected",
              total.toString(),
              report("orders", "&payment=payment_confirmed"),
              "Paid fabric + finished-product sales",
            ],
            [
              "Fabric Sales",
              overview.data.paid_sales.find((s) => s.kind === "direct_fabric_sale")?.total_paise ??
                "0",
              report("orders", "&sale=direct_fabric_sale&payment=payment_confirmed"),
              "Payment-confirmed fabric bills",
            ],
            [
              "Finished Product Sales",
              overview.data.paid_sales.find((s) => s.kind === "finished_product_sale")
                ?.total_paise ?? "0",
              report("orders", "&sale=finished_product_sale&payment=payment_confirmed"),
              "Payment-confirmed product bills",
            ],
            [
              "Tailoring Bookings",
              overview.data.customer_tailoring_bookings.booked_customer_price_paise,
              report("orders", "&sale=customer_tailoring&status=completed"),
              "Booked value; separate from collected sales",
            ],
          ].map(([name, value, href, hint], index) => (
            <a href={href} key={name}>
              <OwnerKpi index={index} label={name!} value={reportMoney(value!)} hint={hint!} />
            </a>
          ))}
        </div>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-5">
          {" "}
          <div className="owner-dashboard-cards grid items-start gap-4 md:grid-cols-2">
            <Panel
              title="Sales trend"
              description={`Payment-confirmed sales completed on ${day}; India hourly activity.`}
              actions={selector("Sales trend", trend, setTrend, [
                ["amount", "Sales amount"],
                ["bills", "Number of bills"],
                ["type", "Sales by sale type"],
              ])}
            >
              {cardState(orders)}
              {orders.data && !orders.error && (
                <ColumnChart
                  values={group(
                    hourly,
                    trend === "type" ? "kind" : "hour",
                    trend === "bills" ? undefined : "final_customer_price_paise",
                  ).sort((a, b) => (trend === "type" ? 0 : a.name.localeCompare(b.name)))}
                  money={trend !== "bills"}
                />
              )}
            </Panel>
            <Panel
              title="Sales breakdown"
              description="Selected-day paid sales. Payment-method/category charts require recorded classification data. Top items use current catalogue names and bill-line counts, not mixed-unit quantities."
              actions={selector("Sales breakdown", breakdown, setBreakdown, [
                ["kind", "Fabric vs finished products"],
                ["products", "Top-selling items by bill-line count"],
              ])}
            >
              {cardState(orders)}
              {orders.data &&
                !orders.error &&
                (breakdown === "kind" ? (
                  <DonutChart values={group(sales, "kind", "final_customer_price_paise")} />
                ) : (
                  <div>
                    {cardState(productNames)}
                    {cardState(fabricNames)}
                    {productNames.data &&
                      fabricNames.data &&
                      !productNames.error &&
                      !fabricNames.error && (
                        <Bars
                          values={group(
                            sales.flatMap((r) =>
                              (Array.isArray(r.data["items"]) ? r.data["items"] : []).map(
                                (item, index) => {
                                  const data = item as Record<string, unknown>;
                                  return {
                                    key: r.key + ":" + index,
                                    event_at: r.event_at,
                                    data: {
                                      item:
                                        (data["finished_product_id"]
                                          ? (productNames.data?.find(
                                              (p) => p.data["id"] === data["finished_product_id"],
                                            )?.data["product"] ?? data["finished_product_id"])
                                          : (fabricNames.data?.find(
                                              (p) => p.data["id"] === data["fabric_stock_id"],
                                            )?.data["fabric"] ?? data["fabric_stock_id"])) ??
                                        "Unclassified recorded item",
                                    },
                                  };
                                },
                              ),
                            ),
                            "item",
                          )}
                        />
                      )}
                  </div>
                ))}
            </Panel>
            <Panel
              title="Inventory"
              description="Current ledger stock; not a historical snapshot of the selected date."
              actions={selector("Inventory view", inventory, setInventory, [
                ["location", "Stock by location"],
                ["fabric", "Stock by fabric / item"],
                ["movements", "Selected-day movements"],
              ])}
            >
              {inventory === "movements" ? (
                <>
                  {cardState(movements)}
                  {movements.data && !movements.error && (
                    <RecordTable
                      rows={movements.data}
                      preferred={["movement_type", "source", "destination", "quantity", "unit"]}
                    />
                  )}
                </>
              ) : (
                <>
                  {cardState(stocks)}
                  {stocks.data && !stocks.error && (
                    <div className="space-y-2">
                      {!stockDetails.length && (
                        <p className="text-sm text-muted-foreground">
                          No current ledger stock recorded.
                        </p>
                      )}
                      {stockDetails.slice(0, 10).map((s) => (
                        <div key={s.name} className="rounded-lg border p-3 text-sm">
                          <strong>{s.name}</strong>
                          <p className="text-muted-foreground">
                            {s.units
                              .map(
                                (u) =>
                                  reportQuantity(u.total.value, u.unit) +
                                  (u.total.unknown
                                    ? ` · ${u.total.unknown} quantities not recorded`
                                    : ""),
                              )
                              .join(" · ")}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {stocks.data &&
                !stocks.error &&
                stockDetails.length > 10 &&
                inventory !== "movements" && (
                  <a className="mt-3 inline-block text-xs text-primary" href="/reports#stock">
                    Showing 10 of {stockDetails.length} groups · View all stock →
                  </a>
                )}
            </Panel>
            <Panel
              title="Production"
              description={
                production === "status"
                  ? "Current job status across all creation dates."
                  : `Issues/status activity on ${day}; piece allocations are current recorded evidence against those issues, not that day’s consumption.`
              }
              actions={selector("Production view", production, setProduction, [
                ["status", "Current production status"],
                ["issued", "Material issued"],
                ["usage", "Recorded piece allocations"],
                ["completed", "Status changes & Workshop receipts"],
              ])}
            >
              {production === "status" ? (
                <>
                  {cardState(jobs)}
                  {jobs.data && !jobs.error && <Bars values={group(jobs.data, "status")} />}
                </>
              ) : production === "completed" ? (
                <>
                  {cardState(history)}
                  {history.data && !history.error && <RecordTable rows={history.data} />}
                </>
              ) : (
                <>
                  {cardState(issues)}
                  {issues.data && !issues.error && (
                    <RecordTable
                      rows={issues.data.filter((r) => r.data["job_kind"] === "owner_production")}
                      preferred={
                        production === "issued"
                          ? ["job", "item", "quantity_issued", "unit"]
                          : ["job", "item", "actual_piece_usage", "actual_usage_scope", "unit"]
                      }
                    />
                  )}
                </>
              )}
            </Panel>
            <Panel
              title="Tailoring & workload"
              description="Current workload across all creation dates; Customer Tailoring and Owner Production stay separate."
              actions={selector("Tailoring workload", tailoring, setTailoring, [
                ["customer", "Customer tailoring jobs"],
                ["production", "Owner production jobs"],
              ])}
            >
              {cardState(tailoring === "customer" ? customers : jobs)}
              {(tailoring === "customer" ? customers : jobs).data &&
                !(tailoring === "customer" ? customers : jobs).error && (
                  <Bars
                    values={group(
                      tailoring === "customer"
                        ? active
                        : (jobs.data ?? []).filter(
                            (r) =>
                              !["completed", "received", "cancelled"].includes(
                                String(r.data["status"]),
                              ),
                          ),
                      "status",
                    )}
                  />
                )}
              <a
                className="mt-3 inline-block text-sm text-primary"
                href={tailoring === "customer" ? "/tailoring#customer" : "/tailoring#production"}
              >
                Open relevant jobs →
              </a>
            </Panel>
          </div>
          <Panel title="Recent activity">
            <div role="tablist" aria-label="Recent activity" className="mb-4 flex flex-wrap gap-2">
              {[
                ["bills", "Recent Bills"],
                ["tailoring", "Tailoring Jobs"],
                ["movements", "Stock Movements"],
                ["reviews", "Pending Reviews"],
              ].map(([v, n]) => (
                <Button
                  key={v}
                  role="tab"
                  aria-selected={recent === v}
                  variant={recent === v ? "default" : "outline"}
                  onClick={() => setRecent(v!)}
                >
                  {n}
                </Button>
              ))}
            </div>
            {cardState(
              recent === "bills"
                ? orders
                : recent === "tailoring"
                  ? customers
                  : recent === "movements"
                    ? movements
                    : controls,
            )}
            {!(
              recent === "bills"
                ? orders
                : recent === "tailoring"
                  ? customers
                  : recent === "movements"
                    ? movements
                    : controls
            ).error && (
              <RecordTable
                key={recent + day}
                rows={
                  recent === "bills"
                    ? sales
                    : recent === "tailoring"
                      ? (customers.data ?? []).filter((r) => inRange(r.event_at, day, day))
                      : recent === "movements"
                        ? (movements.data ?? [])
                        : (controls.data ?? [])
                }
                initialPageSize={10}
              />
            )}
          </Panel>
        </div>
        <aside className="owner-dashboard-rail min-w-0 space-y-4" aria-label="Dashboard controls">
          {" "}
          <Panel
            title="Today's alerts & current reviews"
            description="Current recorded checks, independent of the selected historical day. No invented thresholds or due dates."
          >
            {overview.error ? (
              <p>Alerts could not load. Refresh to retry.</p>
            ) : overview.data ? (
              <div className="space-y-1">
                {Object.entries(overview.data.controls).map(([key, count]) => (
                  <a href="/reports#controls" key={key} className="owner-alert-row">
                    <span>{title(key)}</span>
                    <strong>{count}</strong>
                  </a>
                ))}
              </div>
            ) : (
              <p>Loading alerts…</p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Low-stock thresholds, tailoring due dates and material-shortage requirements are not
              exposed by the existing reports. Those alerts are unavailable. Transfers post
              immediately; there is no pending-receipt queue.
            </p>
          </Panel>
          <Panel title="Quick actions">
            <div className="grid grid-cols-2 gap-2">
              {[
                ["/inventory/receiving", "Stock Entry"],
                ["/inventory/transfers", "Stock Transfer"],
                ["/pos", "Create Bill"],
                ["/tailoring#customer", "New Tailoring Job"],
                ["/tailoring#production", "Create Production"],
                ["/inventory", "View Inventory"],
              ].map(([href, name], index) => (
                <Button
                  asChild
                  variant="outline"
                  className="h-auto min-h-20 whitespace-normal px-2 py-3 text-[11px]"
                  key={href}
                >
                  <a href={href} className="flex flex-col items-center gap-2 text-center">
                    {(() => {
                      const Icon = [Boxes, ArrowLeftRight, ShoppingCart, Scissors, Factory, Boxes][
                        index
                      ]!;
                      return <Icon className="size-5 text-primary" />;
                    })()}
                    {name}
                  </a>
                </Button>
              ))}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
