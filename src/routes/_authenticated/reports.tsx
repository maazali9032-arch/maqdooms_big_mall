import { createFileRoute } from "@tanstack/react-router";
import { useMovements, useThaans, useDashboardMetrics } from "@/features/inventory";
import { useRecentSales } from "@/features/pos";
import { lineValue, useTailoringJobs } from "@/features/tailoring";
import { useSession } from "@/app/providers/session";
import { PageHeader, Panel, StatCard, EmptyState } from "@/shared/components/page";
import { formatMetres, formatMoney } from "@/shared/utils/units";
import { formatDate } from "@/shared/utils/format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content: "Inventory, sales and tailoring reporting for Maqdoom's Big Mall.",
      },
      { property: "og:title", content: "Reports — Maqdoom's Big Mall ERP" },
      { property: "og:description", content: "Inventory, sales and tailoring reporting." },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const metrics = useDashboardMetrics();
  const thaans = useThaans(["active"]);
  const sales = useRecentSales(100);
  const movements = useMovements(100);
  const jobs = useTailoringJobs();
  const { can } = useSession();
  const m = metrics.data ?? {};

  const byFabric = new Map<string, { metres: number; count: number }>();
  for (const t of thaans.data ?? []) {
    const key = t.fabric_name ?? "Unassigned";
    const prev = byFabric.get(key) ?? { metres: 0, count: 0 };
    byFabric.set(key, { metres: prev.metres + t.available_mm, count: prev.count + 1 });
  }

  const byDay = new Map<string, number>();
  for (const s of sales.data ?? []) {
    const key = formatDate(s.created_at);
    byDay.set(key, (byDay.get(key) ?? 0) + s.total_paise);
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description="Derived entirely from the ledger — no separate totals are maintained."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Available fabric" value={formatMetres(m["available_mm"] ?? 0)} />
        <StatCard label="Sales (7 days)" value={formatMoney(m["sales_week_paise"] ?? 0)} />
        <StatCard label="Sales (30 days)" value={formatMoney(m["sales_month_paise"] ?? 0)} />
        <StatCard label="Movements logged" value={(movements.data ?? []).length} />
      </div>

      <Tabs defaultValue="inventory">
        <TabsList className="w-full overflow-x-auto sm:w-auto">
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="tailoring">Tailoring</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="mt-4">
          <Panel title="Available metres by fabric" bodyClassName="p-0">
            <div className="divide-y divide-border">
              {[...byFabric.entries()].map(([name, v]) => (
                <div key={name} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>{name}</span>
                  <span className="numeric">
                    {formatMetres(v.metres)}{" "}
                    <span className="text-muted-foreground">· {v.count} thaans</span>
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="sales" className="mt-4">
          <Panel title="Sales by day" bodyClassName="p-0">
            <div className="divide-y divide-border">
              {byDay.size === 0 ? (
                <EmptyState title="No sales in range" />
              ) : (
                [...byDay.entries()].map(([day, total]) => (
                  <div key={day} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span>{day}</span>
                    <span className="numeric">{formatMoney(total)}</span>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="tailoring" className="mt-4">
          <Panel title="Material consumption by job" bodyClassName="p-0">
            <div className="divide-y divide-border">
              {(jobs.data ?? []).map((j) => {
                const totals = (j.tailoring_job_lines ?? []).reduce(
                  (acc, l) => {
                    const v = lineValue(l);
                    return { cost: acc.cost + v.cost, selling: acc.selling + v.selling };
                  },
                  { cost: 0, selling: 0 },
                );
                return (
                  <div key={j.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="numeric text-xs">
                      {j.code} · {j.garment}
                    </span>
                    <span className="numeric">
                      {can("tailoring.view_costs") || can("inventory.view_cost")
                        ? `${formatMoney(totals.cost)} → `
                        : ""}
                      {formatMoney(totals.selling)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
    </>
  );
}
