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
import { DailyOperations, type DailyBusiness } from "./DailyOperations";
import { shiftDay } from "./evidence-model";
import "./owner-workspace.css";
import { OwnerBarcodeInspector } from "./OwnerBarcodeInspector";

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
  const daily = useQuery({
    queryKey: ["owner-daily-business", day],
    enabled: isOwner,
    staleTime: 30000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_daily_business", { p_day: day });
      if (error) throw error;
      return data as unknown as DailyBusiness;
    },
  });
  const lines = useEvidence("sales_lines", range);
  const orders = useEvidence("orders", range);
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
      daily,
      lines,
      orders,
      stocks,
      jobs,
      customers,
      movements,
      ...(production === "issued" || production === "usage" ? [issues] : []),
      ...(production === "completed" ? [history] : []),
      ...(recent === "reviews" ? [controls] : []),
    ].forEach((q) => void q.refetch());
  const report = (dataset: string, extra = "") =>
    `/reports?from=${day}&through=${day}${extra}#${dataset}`;
  const active = (customers.data ?? []).filter(
    (r) => !["completed", "delivered", "cancelled"].includes(String(r.data["status"])),
  );
  const dueToday = active.filter((r) => r.data["delivery_date"] === indiaDay());
  const overdue = active.filter(
    (r) => typeof r.data["delivery_date"] === "string" && r.data["delivery_date"] < indiaDay(),
  );
  const customerWork =
    tailoring === "today" ? dueToday : tailoring === "overdue" ? overdue : active;
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
      <OwnerBarcodeInspector />
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
            Sales last updated:{" "}
            {daily.dataUpdatedAt
              ? new Date(daily.dataUpdatedAt).toLocaleTimeString("en-IN")
              : "Not loaded"}
          </p>
          <Button variant="outline" onClick={refresh}>
            <RefreshCw className="mr-2 size-4" />
            Refresh dashboard
          </Button>
        </div>
      </div>
      {cardState(daily)}
      {daily.data && !daily.error && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              "Total Sales Collected",
              daily.data.revenue_paise,
              report("orders", "&payment=payment_confirmed"),
              "Paid Counter + E-commerce sales",
            ],
            [
              "Fabric Sales",
              daily.data.fabric_revenue_paise,
              report("sales_lines", "&sale=direct_fabric_sale&payment=payment_confirmed"),
              "Payment-confirmed fabric bills",
            ],
            [
              "Finished Product Sales",
              daily.data.product_revenue_paise,
              report("sales_lines", "&sale=finished_product_sale&payment=payment_confirmed"),
              "Payment-confirmed product bills",
            ],
            [
              "Tailoring Bookings",
              daily.data.tailoring_booked_paise,
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
      {daily.data && !daily.error && <DailyOperations data={daily.data} day={day} />}
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
              {cardState(trend === "type" ? lines : orders)}
              {(trend === "type" ? lines : orders).data &&
                !(trend === "type" ? lines : orders).error && (
                  <ColumnChart
                    values={group(
                      trend === "type" ? (lines.data ?? []) : hourly,
                      trend === "type" ? "kind" : "hour",
                      trend === "bills"
                        ? undefined
                        : trend === "type"
                          ? "revenue_paise"
                          : "final_customer_price_paise",
                    ).sort((a, b) => (trend === "type" ? 0 : a.name.localeCompare(b.name)))}
                    money={trend !== "bills"}
                  />
                )}
            </Panel>
            <Panel
              title="Sales breakdown"
              description="Selected-day collected revenue. Fabric and pieces keep separate quantities; bookings are excluded."
              actions={selector("Sales breakdown", breakdown, setBreakdown, [
                ["kind", "Fabric vs finished products"],
                ["channel", "Counter vs E-commerce"],
                ["products", "Top-selling items by revenue"],
              ])}
            >
              {cardState(lines)}
              {lines.data &&
                !lines.error &&
                (breakdown === "products" ? (
                  <Bars
                    money
                    values={group(
                      lines.data.map((r) => ({
                        ...r,
                        data: {
                          ...r.data,
                          item: r.data["fabric"] ?? r.data["product"] ?? "Not recorded",
                        },
                      })),
                      "item",
                      "revenue_paise",
                    ).slice(0, 10)}
                  />
                ) : (
                  <DonutChart
                    values={group(
                      lines.data,
                      breakdown === "channel" ? "channel" : "kind",
                      "revenue_paise",
                    )}
                  />
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
                ["today", "Customer jobs due today"],
                ["overdue", "Overdue customer jobs"],
                ["production", "Owner production jobs"],
              ])}
            >
              {cardState(tailoring !== "production" ? customers : jobs)}
              {(tailoring !== "production" ? customers : jobs).data &&
                !(tailoring !== "production" ? customers : jobs).error && (
                  <Bars
                    values={group(
                      tailoring !== "production"
                        ? customerWork
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
                href={tailoring !== "production" ? "/tailoring#customer" : "/tailoring#ongoing"}
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
            {customers.data && !customers.error && (
              <div className="mt-3 space-y-1">
                <a href="/tailoring#customer" className="owner-alert-row">
                  <span>Customer jobs due today</span>
                  <strong>{dueToday.length}</strong>
                </a>
                <a href="/tailoring#customer" className="owner-alert-row">
                  <span>Overdue customer jobs</span>
                  <strong>{overdue.length}</strong>
                </a>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Due-date alerts use recorded delivery dates; jobs without a date are excluded.
              Low-stock thresholds and material-shortage alerts remain unavailable without recorded
              rules. Fabric transfers post immediately. Completed production awaiting Workshop
              receipt appears in reviews.
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
