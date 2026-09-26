import { createFileRoute, Link } from "@tanstack/react-router";
import { useDashboardMetrics, useMovements, useThaans } from "@/features/inventory";
import { useRecentSales } from "@/features/pos";
import { useTailoringJobs, lineValue } from "@/features/tailoring";
import { useAuditLog } from "@/features/audit";
import { useOnlineOrders } from "@/features/ecommerce";
import { useSession } from "@/app/providers/session";
import { PageHeader, Panel, StatCard, StatusBadge, EmptyState } from "@/shared/components/page";
import { formatMetres, formatMoney } from "@/shared/utils/units";
import { formatDateTime, relativeTime } from "@/shared/utils/format";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Owner Dashboard — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content: "Live stock, sales, tailoring and audit overview for Maqdoom's Big Mall.",
      },
      { property: "og:title", content: "Owner Dashboard — Maqdoom's Big Mall ERP" },
      { property: "og:description", content: "Live stock, sales, tailoring and audit overview." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { fullName, can } = useSession();
  const metrics = useDashboardMetrics();
  const movements = useMovements(8);
  const sales = useRecentSales(6);
  const jobs = useTailoringJobs();
  const audit = useAuditLog(8);
  const orders = useOnlineOrders();
  const thaans = useThaans(["active"]);

  const m = metrics.data ?? {};
  const lowStock = (thaans.data ?? [])
    .filter((t) => t.available_mm < 3000)
    .sort((a, b) => a.available_mm - b.available_mm)
    .slice(0, 6);

  const jobTotals = (jobs.data ?? []).reduce(
    (acc, job) => {
      for (const line of job.tailoring_job_lines ?? []) {
        const v = lineValue(line);
        acc.cost += v.cost;
        acc.selling += v.selling;
      }
      return acc;
    },
    { cost: 0, selling: 0 },
  );

  return (
    <>
      <PageHeader
        title={`Good day, ${fullName.split(" ")[0]}`}
        description="Operational position across stock, counter, tailoring and online."
        actions={
          <>
            {can("pos.sell") ? (
              <Button asChild size="sm">
                <Link to="/pos">Open counter</Link>
              </Button>
            ) : null}
            {can("inventory.receive") ? (
              <Button asChild size="sm" variant="outline">
                <Link to="/inventory/receiving">Enter new stock</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Active thaans"
          value={m["active_thaans"] ?? "—"}
          hint={`${m["depleted_thaans"] ?? 0} depleted`}
        />
        <StatCard
          label="Available fabric"
          value={formatMetres(m["available_mm"] ?? 0)}
          hint="Derived from the ledger"
        />
        <StatCard
          label="Today's sales"
          value={formatMoney(m["sales_today_paise"] ?? 0)}
          hint={`${m["sales_today_count"] ?? 0} bills`}
        />
        <StatCard label="Tailoring jobs" value={m["open_jobs"] ?? 0} hint="Open / in progress" />
        <StatCard
          label="Online orders"
          value={m["online_orders"] ?? 0}
          hint={`${m["active_listings"] ?? 0} live listings`}
        />
        <StatCard
          label="Low stock"
          value={m["low_stock"] ?? 0}
          hint="Under 3.00 m remaining"
          tone="warning"
        />
        <StatCard
          label="Incomplete stock"
          value={m["incomplete_thaans"] ?? 0}
          hint="Missing length or price"
          tone="warning"
        />
        <StatCard
          label="Active holds"
          value={m["active_holds"] ?? 0}
          hint="Reserved for online checkout"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title="Recent stock movements"
          description="Append-only ledger"
          className="xl:col-span-2"
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border">
            {(movements.data ?? []).length === 0 ? (
              <EmptyState
                title="No movements yet"
                description="Commit a receiving batch to create the first inward entries."
              />
            ) : (
              (movements.data ?? []).map((mv) => (
                <div key={mv.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <StatusBadge
                    status={mv.kind === "INWARD" ? "active" : mv.kind === "SALE" ? "open" : "draft"}
                    label={mv.kind}
                  />
                  <span className="numeric text-xs font-medium">{mv.barcode}</span>
                  <span className="hidden min-w-0 flex-1 truncate text-muted-foreground sm:block">
                    {mv.fabric_name ?? "—"}
                  </span>
                  <span
                    className={`numeric ml-auto text-sm ${mv.delta_mm < 0 ? "text-destructive" : "text-success"}`}
                  >
                    {mv.delta_mm > 0 ? "+" : ""}
                    {formatMetres(mv.delta_mm)}
                  </span>
                  <span className="hidden w-20 text-right text-xs text-muted-foreground sm:block">
                    {relativeTime(mv.created_at)}
                  </span>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel title="Low stock" description="Smallest active pieces" bodyClassName="p-0">
          <div className="divide-y divide-border">
            {lowStock.length === 0 ? (
              <EmptyState title="Nothing running low" />
            ) : (
              lowStock.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="numeric text-xs font-medium">{t.barcode}</p>
                    <p className="truncate text-xs text-muted-foreground">{t.fabric_name}</p>
                  </div>
                  <span className="numeric text-sm text-warning-foreground">
                    {formatMetres(t.available_mm)}
                  </span>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Recent sales" bodyClassName="p-0">
          <div className="divide-y divide-border">
            {(sales.data ?? []).length === 0 ? (
              <EmptyState title="No sales recorded" />
            ) : (
              (sales.data ?? []).map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="numeric text-xs font-medium">{s.bill_no}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {(s.customers as { name?: string } | null)?.name ?? "Walk-in"} ·{" "}
                      {formatDateTime(s.created_at)}
                    </p>
                  </div>
                  <span className="numeric">{formatMoney(s.total_paise)}</span>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel title="Tailoring consumption">
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Jobs on the floor</dt>
              <dd className="numeric">{m["open_jobs"] ?? 0}</dd>
            </div>
            {can("tailoring.view_costs") || can("inventory.view_cost") ? (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Fabric cost consumed</dt>
                <dd className="numeric">{formatMoney(jobTotals.cost)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Selling value consumed</dt>
              <dd className="numeric">{formatMoney(jobTotals.selling)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2.5">
              <dt className="text-muted-foreground">Online orders waiting</dt>
              <dd className="numeric">
                {
                  (orders.data ?? []).filter((o) => o.status === "new" || o.status === "picking")
                    .length
                }
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel
          title="Audit trail"
          description="Most recent attributable actions"
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border">
            {(audit.data ?? []).length === 0 ? (
              <EmptyState
                title="Audit visible to owners"
                description="You do not have audit.view permission."
              />
            ) : (
              (audit.data ?? []).map((a) => (
                <div key={a.id} className="px-4 py-2.5 text-sm">
                  <p className="text-xs">
                    <span className="font-medium">{a.actor_name ?? "System"}</span>{" "}
                    <span className="text-muted-foreground">{a.action.replace(/_/g, " ")}</span>{" "}
                    <span className="numeric">{a.entity_ref}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDateTime(a.created_at)}
                  </p>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
