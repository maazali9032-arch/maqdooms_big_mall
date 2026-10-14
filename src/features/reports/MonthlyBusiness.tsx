import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel, StatCard } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { reportDateRange, reportMoney, reportQuantity } from "./report-value";
import { precedingPeriod, growthLabel } from "./business-period";
import { ColumnChart, DonutChart } from "./OwnerVisuals";
import { RecordTable } from "./EvidenceViews";

type Summary = {
  revenue_paise: string;
  bills: number;
  customers: number;
  unidentified_customer_bills: number;
  fabric_mm: string;
  pieces: string;
  known_margin_paise: string;
  unknown_cost_lines: number;
  lines: number;
  counter_paise: string;
  ecommerce_paise: string;
};
type Ranking = {
  dimension: string;
  identity: string;
  name: string;
  context: string | null;
  revenue_paise: string;
  known_margin_paise: string | null;
  unknown_cost_lines: number;
  lines: number;
  bills: number;
  customers: number;
  unidentified_customer_bills: number;
  fabric_mm: string;
  pieces: string;
};
type Analytics = {
  current: Summary;
  previous: Summary;
  rankings: Ranking[];
  daily_sales: { day: string; revenue_paise: string; bills: number }[];
};
export function MonthlyBusiness({
  from,
  through,
  location = "",
}: {
  from: string;
  through: string;
  location?: string;
}) {
  const { isOwner } = useSession();
  const [dimension, setDimension] = useState("fabric_vendor"),
    [metric, setMetric] = useState("revenue"),
    [search, setSearch] = useState("");
  const valid = !!from && !!through;
  const prior = valid ? precedingPeriod(from, through) : null;
  const query = useQuery({
    queryKey: ["owner-monthly-business", from, through, location],
    enabled: isOwner && valid,
    queryFn: async () => {
      const current = reportDateRange(from, through),
        previous = reportDateRange(prior!.from, prior!.through);
      const { data, error } = await supabase.rpc("owner_monthly_business", {
        p_from: current.p_from!,
        p_to: current.p_to!,
        p_previous_from: previous.p_from!,
        p_previous_to: previous.p_to!,
        ...(location ? { p_location: location } : {}),
      });
      if (error) throw error;
      return data as unknown as Analytics;
    },
  });
  if (!isOwner) return null;
  if (!valid)
    return (
      <p className="text-sm text-muted-foreground">
        Choose a bounded date range to compare business performance.
      </p>
    );
  const rows = (query.data?.rankings ?? []).filter(
    (r) =>
      r.dimension === dimension &&
      `${r.name} ${r.context ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const quantityMetric =
    dimension === "fabric_vendor" || dimension === "vendor"
      ? "fabric_mm"
      : dimension === "product"
        ? "pieces"
        : "bills";
  const ranked = rows
    .filter(
      (r) => metric !== "margin" || (r.unknown_cost_lines === 0 && r.known_margin_paise != null),
    )
    .map((r) => ({
      ...r,
      value: BigInt(
        metric === "revenue"
          ? r.revenue_paise
          : metric === "margin"
            ? r.known_margin_paise!
            : String(r[quantityMetric]),
      ),
    }))
    .sort((a, b) =>
      a.value === b.value ? a.name.localeCompare(b.name) : a.value > b.value ? -1 : 1,
    );
  const money = metric !== "quantity";
  return (
    <div className="space-y-4">
      <Panel
        title="Business performance"
        description={`${from} through ${through} · Compare ${prior!.from} through ${prior!.through}${location ? ` · ${location}` : " · All locations"}`}
      >
        <QueryState
          loading={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
        />
        {query.data && !query.error && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Collected sales"
                value={reportMoney(query.data.current.revenue_paise)}
                hint={growthLabel(
                  query.data.current.revenue_paise,
                  query.data.previous.revenue_paise,
                )}
              />
              <StatCard
                label="Paid bills"
                value={query.data.current.bills}
                hint={`${query.data.previous.bills} in previous period`}
              />
              <StatCard
                label="Fabric sold"
                value={reportQuantity(query.data.current.fabric_mm, "mm")}
                hint={`Previous: ${reportQuantity(query.data.previous.fabric_mm, "mm")}`}
              />
              <StatCard
                label="Finished pieces sold"
                value={query.data.current.pieces}
                hint={`Previous: ${query.data.previous.pieces}`}
              />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold">Daily collected sales</h3>
                <ColumnChart
                  values={query.data.daily_sales.map((d) => ({
                    name: d.day,
                    value: BigInt(d.revenue_paise),
                  }))}
                  money
                />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Counter vs E-commerce</h3>
                <DonutChart
                  values={[
                    { name: "Counter", value: BigInt(query.data.current.counter_paise) },
                    { name: "E-commerce", value: BigInt(query.data.current.ecommerce_paise) },
                  ].filter((r) => r.value > 0n)}
                />
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Recorded margin:{" "}
              {query.data.current.unknown_cost_lines === query.data.current.lines &&
              query.data.current.lines > 0
                ? "Not recorded"
                : reportMoney(query.data.current.known_margin_paise)}{" "}
              · {query.data.current.unknown_cost_lines} of {query.data.current.lines} sale lines
              have unknown cost. Margin uses captured CP and excludes unrecorded expenses. Tailoring
              bookings stay separate from paid sales.
            </p>
          </>
        )}
      </Panel>
      <Panel
        title="Sales rankings"
        description="Rank actual metres, pieces, revenue or recorded margin. Open a row’s full record to inspect its summary; transaction evidence is listed below."
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <label className="text-xs">
            Rank by
            <select
              aria-label="Business ranking"
              className="mt-1 h-11 w-full rounded border bg-background p-2"
              value={dimension}
              onChange={(e) => {
                setDimension(e.target.value);
                setMetric("revenue");
              }}
            >
              <option value="fabric_vendor">Fabric & vendor</option>
              <option value="vendor">Vendor</option>
              <option value="product">Finished product</option>
              <option value="salesperson">Credited Salesperson</option>
              <option value="channel">Sales channel</option>
            </select>
          </label>
          <label className="text-xs">
            Measure
            <select
              aria-label="Ranking measure"
              className="mt-1 h-11 w-full rounded border bg-background p-2"
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
            >
              <option value="revenue">Collected revenue</option>
              <option value="quantity">
                {quantityMetric === "fabric_mm"
                  ? "Metres sold"
                  : quantityMetric === "pieces"
                    ? "Pieces sold"
                    : "Paid bills"}
              </option>
              <option value="margin">Recorded margin (complete cost evidence)</option>
            </select>
          </label>
          <label className="text-xs">
            Search
            <input
              aria-label="Search business rankings"
              className="mt-1 h-11 w-full rounded border bg-background p-2"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {metric === "margin" && (
          <p className="mb-3 text-xs text-muted-foreground">
            {rows.length - ranked.length} groups excluded because their full cost evidence is not
            recorded. Negative margins remain in the table.
          </p>
        )}
        <p className="mb-3 text-xs text-muted-foreground">
          Top 10 matching groups; the table includes all groups. A customer or bill appearing in
          several groups is counted once within each group.
        </p>
        <div className="mb-4 space-y-3" aria-label="Business ranking chart">
          {ranked.slice(0, 10).map((r) => {
            const max = ranked.reduce((m, x) => (x.value > m ? x.value : m), 1n);
            return (
              <div key={r.identity}>
                <div className="mb-1 flex justify-between gap-3 text-sm">
                  <span className="min-w-0 break-words">
                    {r.name}
                    {r.context ? ` · ${r.context}` : ""}
                  </span>
                  <strong className="shrink-0">
                    {money
                      ? reportMoney(r.value.toString())
                      : quantityMetric === "fabric_mm"
                        ? reportQuantity(r.value.toString(), "mm")
                        : r.value.toString()}
                  </strong>
                </div>
                <div className="h-2 rounded bg-muted">
                  <div
                    className="h-2 rounded bg-primary"
                    style={{
                      width: `${r.value > 0n ? Number((r.value * 10000n) / max) / 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {query.data && (
          <RecordTable
            showDate={false}
            initialPageSize={10}
            initialSort={
              metric === "revenue"
                ? "revenue_paise"
                : metric === "margin"
                  ? "known_margin_paise"
                  : quantityMetric
            }
            key={dimension + metric + search + from + through}
            rows={ranked.map((r) => ({
              key: r.identity,
              event_at: null,
              data: {
                name: r.name,
                from,
                through,
                vendor: r.context,
                revenue_paise: r.revenue_paise,
                fabric_mm: r.fabric_mm,
                pieces: r.pieces,
                bills: r.bills,
                customers: r.customers,
                unidentified_customer_bills: r.unidentified_customer_bills,
                known_margin_paise: r.unknown_cost_lines ? null : r.known_margin_paise,
                known_margin_subtotal_paise: r.known_margin_paise,
                unknown_cost_lines: r.unknown_cost_lines,
              },
            }))}
            preferred={[
              "name",
              "vendor",
              "revenue_paise",
              quantityMetric,
              ...(quantityMetric === "bills" ? [] : ["bills"]),
              "known_margin_paise",
            ]}
          />
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Customer counts use saved customer IDs; walk-in bills are counted separately. Older
          descriptions may use current catalogue names; new sales retain snapshots. E-commerce
          totals require completed paid orders recorded through the approved sales workflow.
        </p>
      </Panel>
    </div>
  );
}
