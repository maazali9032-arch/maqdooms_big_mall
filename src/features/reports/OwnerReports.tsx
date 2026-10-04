import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/shared/utils/format";
import { reportDateRange, reportMoney, reportQuantity } from "./report-value";
import { QueryState } from "@/shared/components/query-state";

const datasets = [
  ["stock", "Current stock by location"],
  ["fabric_stock", "Fabric + Batch / CP / SP"],
  ["batches", "Batches"],
  ["thans", "Internal Thans"],
  ["consumables", "Consumables"],
  ["consumable_receipts", "Consumable receipts / CP"],
  ["customer_tailoring", "Customer Tailoring Jobs / charges"],
  ["configuration", "Factories / Sections / Tailors / assignments / charges / Designs"],
  ["material_issues", "Material Issues"],
  ["tailor_usage", "Tailor issued materials / recorded piece usage"],
  ["production_jobs", "Owner Production Jobs"],
  ["production_costs", "Complete Production Cost revisions"],
  ["finished_products", "Finished Products / SP / cost"],
  ["transfers", "Stock Transfers"],
  ["movements", "Stock / material movement history"],
  ["orders", "Order history / financial snapshots"],
  ["production_history", "Production status / Workshop receipt history"],
  ["reconciliation", "Legacy reconciliation records"],
  ["controls", "Records requiring Owner review"],
  ["access", "Staff access / roles / overrides"],
  ["audit", "Canonical + legacy audit"],
  ["legacy_sales", "Legacy sales (separate history)"],
  ["legacy_tailoring", "Legacy tailoring (separate history)"],
  ["legacy_movements", "Legacy movements (separate history)"],
] as const;
type Row = { key: string; event_at: string | null; data: Record<string, unknown> };
type Report = { rows: Row[]; total_rows: string; next_cursor: string | null };
type Overview = {
  stock: {
    location_id: string;
    location: string;
    kind: string;
    parent_id: string | null;
    unit: string;
    quantity: string;
  }[];
  paid_sales: { kind: string; orders: string; total_paise: string }[];
  customer_tailoring_bookings: { orders: string; booked_customer_price_paise: string };
  controls: Record<string, number>;
};
const label = (key: string) => key.replace(/_/g, " ");
function valueText(key: string, value: unknown, row: Record<string, unknown>) {
  if (value === null || value === undefined) return "Not recorded";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  if (key.includes("paise") && /^-?\d+$/.test(String(value))) return reportMoney(String(value));
  if (
    (key.endsWith("_mm") || (key.includes("quantity") && row["unit"] === "mm")) &&
    /^-?\d+(?:\.0+)?$/.test(String(value))
  )
    return reportQuantity(String(value), "mm");
  if (key.endsWith("_at") && typeof value === "string") return formatDateTime(value);
  return String(value);
}

export function OwnerReports({ auditOnly = false }: { auditOnly?: boolean }) {
  const { isOwner } = useSession();
  const qc = useQueryClient();
  const [dataset, setDataset] = useState(auditOnly ? "audit" : "stock");
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState<{ p_from?: string; p_to?: string; p_search?: string }>({});
  const [validation, setValidation] = useState("");
  const overview = useQuery({
    queryKey: ["owner-report-overview", applied.p_from, applied.p_to],
    enabled: isOwner && !auditOnly,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_erp_overview", {
        ...(applied.p_from ? { p_from: applied.p_from } : {}),
        ...(applied.p_to ? { p_to: applied.p_to } : {}),
      });
      if (error) throw error;
      return data as unknown as Overview;
    },
  });
  const records = useInfiniteQuery({
    queryKey: ["owner-report", dataset, applied],
    enabled: isOwner,
    initialPageParam: "",
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("owner_erp_report", {
        p_dataset: dataset,
        p_limit: 50,
        ...applied,
        ...(pageParam ? { p_after: pageParam } : {}),
      });
      if (error) throw error;
      return data as unknown as Report;
    },
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const rows = useMemo(
    () => records.data?.pages.flatMap((page) => page.rows) ?? [],
    [records.data],
  );
  const columns = useMemo(() => {
    const available = new Set(rows.flatMap((row) => Object.keys(row.data)));
    const preferred = [
      "code",
      "barcode",
      "fabric",
      "batch",
      "item",
      "location",
      "quantity",
      "unit",
      "status",
      "action",
      "entity_table",
      "actor",
      "occurred_at",
      "created_at",
      "control",
      "job",
      "customer",
      "sp_paise",
      "cp_paise_per_m",
      "sp_paise_per_m",
    ];
    const selected = preferred.filter((key) => available.has(key));
    return (selected.length ? selected : [...available]).slice(0, 8);
  }, [rows]);
  if (!isOwner) return <p>Owner access is required.</p>;
  const summary = overview.error ? undefined : overview.data;
  return (
    <div className="space-y-4">
      <Panel
        title={auditOnly ? "Complete audit history" : "Owner reports"}
        description="Reports read recorded data. Financial and audit details are restricted to Owner access."
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              setApplied({
                ...reportDateRange(from, through),
                ...(search.trim() ? { p_search: search.trim() } : {}),
              });
              setValidation("");
            } catch (err) {
              setValidation(err instanceof Error ? err.message : "Invalid date range");
            }
          }}
        >
          {!auditOnly ? (
            <div>
              <Label htmlFor="owner-report-dataset">Report</Label>
              <select
                id="owner-report-dataset"
                className="h-11 w-full rounded border bg-background p-2"
                value={dataset}
                onChange={(e) => setDataset(e.target.value)}
              >
                {datasets.map(([key, title]) => (
                  <option key={key} value={key}>
                    {title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor={`${dataset}-from`}>From date (India)</Label>
              <Input
                id={`${dataset}-from`}
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={`${dataset}-through`}>Through date (India)</Label>
              <Input
                id={`${dataset}-through`}
                type="date"
                value={through}
                onChange={(e) => setThrough(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={`${dataset}-search`}>Record / barcode / keyword</Label>
              <Input
                id={`${dataset}-search`}
                value={search}
                maxLength={200}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          {validation ? <p role="alert">{validation}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button>Apply filters</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFrom("");
                setThrough("");
                setSearch("");
                setValidation("");
                setApplied({});
              }}
            >
              Clear filters
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void qc.invalidateQueries({ queryKey: ["owner-report"] });
                void qc.invalidateQueries({ queryKey: ["owner-report-overview"] });
              }}
            >
              Refresh reports
            </Button>
          </div>
          <p className="text-sm">
            Stock, catalogue, access and control reports show current recorded state. Dates filter
            transaction/history reports; undated records remain visible. Search applies to report
            records; overview totals use the date range.
          </p>
        </form>
      </Panel>
      {!auditOnly ? (
        <>
          <Panel
            title="Canonical stock and sales totals"
            description="Totals include every matching canonical record, independently of the pages loaded below. Stock quantities use their own units; legacy history is separate."
          >
            {overview.error ? (
              <QueryState error={overview.error} retry={() => void overview.refetch()} />
            ) : overview.isPending ? (
              <p>Loading totals…</p>
            ) : summary ? (
              <div className="space-y-3">
                {summary.stock.map((s) => (
                  <p key={`${s.location_id}-${s.unit}`}>
                    {s.location}: {reportQuantity(s.quantity, s.unit)}
                  </p>
                ))}
                {!summary.stock.length ? <p>No located canonical stock recorded.</p> : null}
                {summary.paid_sales.map((s) => (
                  <p key={s.kind}>
                    {label(s.kind)} · {s.orders} payment-confirmed orders ·{" "}
                    {reportMoney(s.total_paise)}
                  </p>
                ))}
                {!summary.paid_sales.length ? (
                  <p>No payment-confirmed canonical sales in this range.</p>
                ) : null}
                <p>
                  Customer Tailoring bookings: {summary.customer_tailoring_bookings.orders} · booked
                  customer price{" "}
                  {reportMoney(summary.customer_tailoring_bookings.booked_customer_price_paise)}.
                  Booking values are separate from paid sales.
                </p>
              </div>
            ) : null}
          </Panel>
          <Panel
            title="Owner review and controls"
            description="Checks identify recorded exceptions without guessing a correction. Use the existing controlled workflows to make changes."
          >
            {summary ? (
              <div className="space-y-2">
                {Object.entries(summary.controls).map(([key, count]) => (
                  <p key={key}>
                    {label(key)}: {count}
                  </p>
                ))}
                <Button
                  variant="outline"
                  onClick={() => {
                    setDataset("controls");
                    setFrom("");
                    setThrough("");
                    setSearch("");
                    setValidation("");
                    setApplied({});
                  }}
                >
                  Review exact records
                </Button>
              </div>
            ) : (
              <p>Load the overview to see checks.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-3">
              <Link to="/inventory">Inventory / locations</Link>
              <Link to="/tailoring">Tailoring / production / pricing</Link>
              <Link to="/access">Staff access</Link>
              <Link to="/audit">Audit</Link>
            </div>
          </Panel>
        </>
      ) : null}
      <Panel
        title={datasets.find(([key]) => key === dataset)?.[1] ?? "Records"}
        description={
          auditOnly
            ? "Newest events first. Row events show actual previous/new values; legacy details remain identified as legacy evidence."
            : "Every matching row is accessible through pagination. Nested evidence can be expanded."
        }
      >
        {records.error ? (
          <QueryState error={records.error} retry={() => void records.refetch()} />
        ) : records.isPending ? (
          <p>Loading records…</p>
        ) : (
          <>
            <p role="status" aria-live="polite">
              {rows.length} loaded of {records.data?.pages[0]?.total_rows ?? "0"} matching records.
            </p>
            {!rows.length ? (
              <p>No matching records.</p>
            ) : (
              <div
                className="max-h-[65vh] overflow-auto"
                tabIndex={0}
                aria-label="Report records; scroll for more columns"
              >
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr>
                      {columns.map((key) => (
                        <th key={key} className="min-w-32 px-2 py-2 capitalize">
                          {label(key)}
                        </th>
                      ))}
                      <th className="px-2 py-2">Complete record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-t">
                        {columns.map((key) => (
                          <td key={key} className="max-w-sm px-2 py-2 align-top">
                            {typeof r.data[key] === "object" && r.data[key] !== null ? (
                              <details>
                                <summary>View {label(key)}</summary>
                                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
                                  {valueText(key, r.data[key], r.data)}
                                </pre>
                              </details>
                            ) : (
                              <span className="break-words">
                                {valueText(key, r.data[key], r.data)}
                              </span>
                            )}
                          </td>
                        ))}
                        <td className="max-w-sm px-2 py-2">
                          <details>
                            <summary className="cursor-pointer">View all fields</summary>
                            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
                              {JSON.stringify(r.data, null, 2)}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {records.hasNextPage ? (
              <Button
                className="mt-3"
                variant="outline"
                disabled={records.isFetchingNextPage}
                onClick={() => records.fetchNextPage()}
              >
                {records.isFetchingNextPage ? "Loading records…" : "Load more records"}
              </Button>
            ) : null}
          </>
        )}
      </Panel>
    </div>
  );
}
