import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Panel, StatCard, EmptyState } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { reportMoney, reportQuantity, reportDateRange } from "./report-value";

type Overview = {
  stock: { location_id: string; location: string; unit: string; quantity: string }[];
  paid_sales: { kind: string; orders: string; total_paise: string }[];
  controls: Record<string, number>;
};
export function OwnerDashboard() {
  const { isOwner } = useSession();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const overview = useQuery({
    queryKey: ["owner-report-overview", "dashboard", today],
    enabled: isOwner,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "owner_erp_overview",
        reportDateRange(today, today),
      );
      if (error) throw error;
      return data as unknown as Overview;
    },
  });
  if (!isOwner) return <p>Owner access is required.</p>;
  const data = overview.data;
  return (
    <div className="space-y-5">
      <QueryState
        loading={overview.isPending}
        error={overview.error}
        retry={() => void overview.refetch()}
      />
      {data && !overview.error ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.paid_sales.map((sale) => (
              <StatCard
                key={sale.kind}
                label={
                  sale.kind === "direct_fabric_sale"
                    ? "Today's Direct Fabric Sales"
                    : "Today's Finished Product Sales"
                }
                value={reportMoney(sale.total_paise)}
                hint={`${sale.orders} payment-confirmed orders · India date`}
              />
            ))}
            <StatCard
              label="Owner review exceptions"
              value={Object.values(data.controls).reduce((sum, value) => sum + value, 0)}
              hint="Exception checks may reference the same record"
              tone="warning"
            />
          </div>
          {!data.paid_sales.length ? (
            <p className="text-sm text-muted-foreground">
              No payment-confirmed canonical sales today (India date).
            </p>
          ) : null}
          <Panel
            title="Current stock by location"
            description="Canonical ledger balances. Quantities retain separate units; current stock is independent of today's sales range."
          >
            {data.stock.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {data.stock.map((stock) => (
                  <div key={`${stock.location_id}:${stock.unit}`} className="rounded-lg border p-3">
                    <p className="text-sm text-muted-foreground">{stock.location}</p>
                    <p className="mt-1 text-lg font-semibold">
                      {reportQuantity(stock.quantity, stock.unit)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No located stock recorded"
                description="Use the controlled receiving workflow to record new stock."
              />
            )}
          </Panel>
          <Panel
            title="Owner review"
            description="Recorded exceptions, with exact affected records available in Reports."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(data.controls).map(([key, count]) => (
                <p key={key} className="flex justify-between gap-3 text-sm">
                  <span>{key.replace(/_/g, " ")}</span>
                  <strong>{count}</strong>
                </p>
              ))}
            </div>
          </Panel>
        </>
      ) : null}
      <Panel title="Workflows">
        <div className="flex flex-wrap gap-2">
          {[
            ["/inventory", "Stock & transfers"],
            ["/pos", "Counter"],
            ["/tailoring", "Tailoring & production"],
            ["/reports", "Reports & Owner review"],
            ["/audit", "Audit history"],
          ].map(([to, title]) => (
            <Button key={to} asChild variant="outline">
              <Link to={to}>{title}</Link>
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          className="mt-3"
          disabled={overview.isFetching}
          onClick={() => void overview.refetch()}
        >
          {overview.isFetching ? "Refreshing…" : "Refresh dashboard"}
        </Button>
      </Panel>
    </div>
  );
}
