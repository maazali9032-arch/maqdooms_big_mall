import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Copy,
  IndianRupee,
  RefreshCw,
  Ruler,
  ShoppingBag,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Panel, StatCard, StatusBadge } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/shared/utils/format";
import { reportInteger, reportMoney, reportQuantity } from "@/features/reports/report-value";
import { useSalespeople } from "./use-salespeople";

type Work = {
  id: string;
  code: string;
  kind: string;
  created_at: string;
  created_by: string;
  operator_name?: string | null;
  salesperson_user_id: string;
  salesperson_name: string;
  source_name: string;
  customer_snapshot: { name: string | null };
  final_customer_price_paise: string;
  fabric_mm: string | null;
  job_id: string | null;
  job_code: string | null;
  job_status: string | null;
  garment: string | null;
  factory_name: string | null;
  section_name: string | null;
  tailor_name: string | null;
  fabrics: { barcode: string; fabric: string; batch: string; quantity_mm: string }[];
  paid?: boolean | null;
  tailoring_jobs?:
    | {
        code: string;
        garment: string;
        status: string;
        delivery_date: string | null;
        factory: string;
        tailor: string;
      }[]
    | null;
};
type Cursor = { after: string; id: string } | undefined;

function dayStart(value: string): number | null {
  return value ? new Date(`${value}T00:00:00`).getTime() : null;
}

export function SalespersonWork() {
  const { isOwner, userId, can } = useSession();
  const [salesperson, setSalesperson] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const people = useSalespeople();
  const work = useInfiniteQuery({
    queryKey: ["salesperson-work", userId, salesperson],
    enabled: isOwner || can("salesperson.view_work"),
    initialPageParam: undefined as Cursor,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("salesperson_work", {
        ...(salesperson ? { p_salesperson: salesperson } : {}),
        ...(pageParam ? { p_after: pageParam.after, p_after_id: pageParam.id } : {}),
        p_limit: 50,
      });
      if (error) throw error;
      return data as unknown as Work[];
    },
    getNextPageParam: (last) => {
      const end = last.at(-1);
      return last.length === 50 && end ? { after: end.created_at, id: end.id } : undefined;
    },
  });
  const rows = useMemo(() => work.data?.pages.flat() ?? [], [work.data?.pages]);
  const visible = useMemo(() => {
    const start = dayStart(from);
    const end = dayStart(to);
    return rows.filter((row) => {
      const time = new Date(row.created_at).getTime();
      return (start === null || time >= start) && (end === null || time < end + 86_400_000);
    });
  }, [from, rows, to]);
  const summary = useMemo(() => {
    const total = visible.reduce(
      (sum, row) => sum + reportInteger(row.final_customer_price_paise),
      0n,
    );
    const fabric = visible.reduce((sum, row) => sum + reportInteger(row.fabric_mm ?? "0"), 0n);
    return {
      total,
      fabric,
      salespeople: new Set(visible.map((row) => row.salesperson_user_id)).size,
    };
  }, [visible]);
  const salespersonCode = (id: string) => people.data?.find((person) => person.id === id)?.code;

  async function copyBill(code: string) {
    await navigator.clipboard.writeText(code);
    toast.success("Bill number copied");
  }

  return (
    <Panel
      title={isOwner ? "Salesperson work" : "My Work"}
      description="Attributed bills, fabric quantities and linked stitching progress. The POS operator and credited Salesperson are recorded separately."
    >
      <div className="mb-4 grid gap-2 lg:grid-cols-[minmax(220px,1fr)_minmax(280px,auto)_auto]">
        {isOwner ? (
          <select
            aria-label="Filter Salesperson"
            className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
            value={salesperson}
            onChange={(event) => setSalesperson(event.target.value)}
          >
            <option value="">All Salespeople</option>
            {people.data?.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.code ? ` · #${person.code}` : ""}
              </option>
            ))}
          </select>
        ) : (
          <div />
        )}
        <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-2 rounded-md border bg-card px-3">
          <CalendarDays className="size-4 text-muted-foreground" />
          <Input
            aria-label="Sales from date"
            type="date"
            className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            aria-label="Sales to date"
            type="date"
            min={from || undefined}
            className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <Button variant="outline" onClick={() => void work.refetch()}>
          <RefreshCw className="mr-2 size-4" />
          Refresh work
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
        <StatCard
          label="Bills"
          value={visible.length}
          hint="In the current view"
          icon={ShoppingBag}
        />
        <StatCard
          label="Attributed sales"
          value={reportMoney(summary.total.toString())}
          hint="Completed bill value"
          icon={IndianRupee}
          tone="success"
        />
        <StatCard
          label="Fabric sold"
          value={reportQuantity(summary.fabric.toString(), "mm")}
          hint="Across visible bills"
          icon={Ruler}
        />
        <StatCard
          label="Salespeople"
          value={summary.salespeople}
          hint={isOwner ? "Credited in this view" : "Your attributed work"}
          icon={Users}
        />
      </div>

      {work.error ? (
        <p role="alert">Work could not load. Check access or retry.</p>
      ) : work.isPending ? (
        <p>Loading work…</p>
      ) : !visible.length ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {rows.length ? "No work matches the selected dates." : "No attributed work yet."}
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((row) => (
            <article key={row.id} className="overflow-hidden rounded-lg border bg-card shadow-sm">
              <header className="flex flex-wrap items-start justify-between gap-2 border-b px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="max-w-[220px] truncate font-semibold" title={row.code}>
                      {row.code}
                    </h3>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Copy ${row.code}`}
                      onClick={() => void copyBill(row.code)}
                    >
                      <Copy className="size-3.5" />
                    </button>
                    <StatusBadge
                      status={row.paid ? "active" : "draft"}
                      label={row.paid ? "Paid" : "Balance due"}
                    />
                    <span className="rounded-md border bg-muted px-2 py-1 text-[11px] font-medium capitalize">
                      {row.kind.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.customer_snapshot?.name || "Walk-in customer"}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(row.created_at)} · {row.source_name}
                </p>
              </header>

              <div className="grid gap-3 bg-surface/30 px-3 py-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr_1.2fr_1.5fr]">
                <Metric
                  label="Bill total"
                  value={reportMoney(row.final_customer_price_paise)}
                  prominent
                />
                <Metric
                  label="Fabric"
                  value={row.fabric_mm !== null ? reportQuantity(row.fabric_mm, "mm") : "—"}
                  prominent
                />
                <Metric
                  label="Salesperson"
                  value={`${row.salesperson_name}${salespersonCode(row.salesperson_user_id) ? ` · #${salespersonCode(row.salesperson_user_id)}` : ""}`}
                />
                <Metric label="POS operator" value={row.operator_name || "Recorded staff"} />
                <Metric
                  label="Payment"
                  value={
                    row.kind === "counter_bill"
                      ? "Combined bill; linked tailoring totals included once"
                      : row.paid
                        ? "Payment confirmed"
                        : "Not marked paid"
                  }
                />
              </div>

              {!!row.fabrics.length && (
                <div className="mx-3 mb-3 overflow-hidden rounded-md border">
                  <p className="bg-muted px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Items
                  </p>
                  <div className="divide-y text-sm">
                    {row.fabrics.map((fabric, index) => (
                      <div
                        key={`${fabric.barcode}-${index}`}
                        className="grid gap-1 px-3 py-2 sm:grid-cols-[1fr_auto]"
                      >
                        <span>
                          {fabric.fabric} · Batch {fabric.batch} · SKU {fabric.barcode}
                        </span>
                        <strong>{reportQuantity(fabric.quantity_mm, "mm")}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!!row.tailoring_jobs?.length && (
                <details className="mx-3 mb-3 rounded-md border px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-medium">Linked tailoring work</summary>
                  <div className="mt-2 divide-y">
                    {row.tailoring_jobs.map((job) => (
                      <p className="py-2" key={job.code}>
                        {job.code} · {job.garment} · {job.status} · Due{" "}
                        {job.delivery_date || "Not recorded"} · {job.factory} → {job.tailor}
                      </p>
                    ))}
                  </div>
                </details>
              )}

              {row.job_id && (
                <p className="mx-3 mb-3 rounded-md bg-muted px-3 py-2 text-sm">
                  {row.job_code} · {row.garment} · {row.job_status} · {row.factory_name} →{" "}
                  {row.section_name || "No Section"} → {row.tailor_name}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
      {work.hasNextPage && (
        <Button
          className="mt-4"
          disabled={work.isFetchingNextPage}
          onClick={() => void work.fetchNextPage()}
        >
          Load more work
        </Button>
      )}
    </Panel>
  );
}

function Metric({
  label,
  value,
  prominent = false,
}: {
  label: string;
  value: string;
  prominent?: boolean;
}) {
  return (
    <div className="min-w-0 border-l pl-3 first:border-l-0 first:pl-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={prominent ? "numeric mt-1 text-2xl font-semibold" : "mt-1 text-sm"}>{value}</p>
    </div>
  );
}
