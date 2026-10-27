import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  IndianRupee,
  ReceiptText,
  RefreshCw,
  Ruler,
  Search,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { PageBody, PageHeader, Panel, StatCard, StatusBadge } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/shared/utils/format";
import { reportInteger, reportMoney, reportQuantity } from "@/features/reports/report-value";
import { useSalespeople } from "./use-salespeople";

type FabricLine = { barcode: string; fabric: string; batch: string; quantity_mm: string };
type TailoringJob = {
  code: string;
  garment: string;
  status: string;
  delivery_date: string | null;
  factory: string;
  tailor: string;
};
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
  fabrics: FabricLine[];
  paid?: boolean | null;
  tailoring_jobs?: TailoringJob[] | null;
};
type Cursor = { after: string; id: string } | undefined;
type SalespersonGroup = {
  id: string;
  name: string;
  code: string | null;
  total: bigint;
  fabric: bigint;
  pending: bigint;
  bills: Work[];
};

function dayStart(value: string): number | null {
  return value ? new Date(`${value}T00:00:00`).getTime() : null;
}

function downloadCsv(rows: Work[]) {
  const escape = (value: string | number | null | undefined) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = [
    [
      "Bill",
      "Date",
      "Customer",
      "Salesperson",
      "POS operator",
      "Source",
      "Total",
      "Fabric",
      "Payment",
    ],
    ...rows.map((row) => [
      row.code,
      formatDateTime(row.created_at),
      row.customer_snapshot?.name || "Walk-in customer",
      row.salesperson_name,
      row.operator_name || "Recorded staff",
      row.source_name,
      Number(reportInteger(row.final_customer_price_paise)) / 100,
      Number(reportInteger(row.fabric_mm ?? "0")) / 1000,
      row.paid ? "Paid" : "Balance due",
    ]),
  ];
  const blob = new Blob([lines.map((line) => line.map(escape).join(",")).join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "salesperson-work.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function SalespersonWork() {
  const { isOwner, userId, can } = useSession();
  const [salesperson, setSalesperson] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("sales");
  const [expandedPerson, setExpandedPerson] = useState<string | null>();
  const [expandedBills, setExpandedBills] = useState<Set<string>>(new Set());
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
    const pending = visible.reduce(
      (sum, row) => sum + (row.paid ? 0n : reportInteger(row.final_customer_price_paise)),
      0n,
    );
    return { total, fabric, pending };
  }, [visible]);
  const groups = useMemo(() => {
    const map = new Map<string, SalespersonGroup>();
    visible.forEach((row) => {
      const person = people.data?.find((entry) => entry.id === row.salesperson_user_id);
      const current = map.get(row.salesperson_user_id) ?? {
        id: row.salesperson_user_id,
        name: row.salesperson_name,
        code: person?.code ?? null,
        total: 0n,
        fabric: 0n,
        pending: 0n,
        bills: [],
      };
      current.total += reportInteger(row.final_customer_price_paise);
      current.fabric += reportInteger(row.fabric_mm ?? "0");
      if (!row.paid) current.pending += reportInteger(row.final_customer_price_paise);
      current.bills.push(row);
      map.set(row.salesperson_user_id, current);
    });
    const query = search.trim().toLowerCase();
    const result = [...map.values()].filter(
      (group) =>
        !query ||
        group.name.toLowerCase().includes(query) ||
        group.code?.toLowerCase().includes(query),
    );
    return result.sort((a, b) => {
      if (sort === "bills") return b.bills.length - a.bills.length;
      if (sort === "fabric") return b.fabric > a.fabric ? 1 : b.fabric < a.fabric ? -1 : 0;
      if (sort === "name") return a.name.localeCompare(b.name);
      return b.total > a.total ? 1 : b.total < a.total ? -1 : 0;
    });
  }, [people.data, search, sort, visible]);
  const maxSales = groups.reduce((max, group) => (group.total > max ? group.total : max), 0n);
  const daily = useMemo(() => {
    const map = new Map<string, bigint>();
    visible.forEach((row) => {
      const key = new Date(row.created_at).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });
      map.set(key, (map.get(key) ?? 0n) + reportInteger(row.final_customer_price_paise));
    });
    return [...map.entries()].reverse().slice(-10);
  }, [visible]);
  const maxDaily = daily.reduce((max, [, value]) => (value > max ? value : max), 0n);

  async function copyBill(code: string) {
    await navigator.clipboard.writeText(code);
    toast.success("Bill number copied");
  }

  return (
    <PageBody>
      <PageHeader
        title={isOwner ? "Salesperson Work" : "My Work"}
        description="Track credited sales, items and linked tailoring jobs. POS operators and credited salespeople remain recorded separately."
        actions={
          <Button variant="outline" onClick={() => downloadCsv(visible)} disabled={!visible.length}>
            <Download className="mr-2 size-4" /> Export
          </Button>
        }
      />

      <Panel bodyClassName="space-y-4">
        <div className="grid gap-2 xl:grid-cols-[minmax(220px,1fr)_minmax(340px,auto)_auto]">
          {isOwner ? (
            <select
              aria-label="Filter Salesperson"
              className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
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
          <div className="grid min-h-11 grid-cols-[auto_1fr_auto_1fr] items-center gap-2 rounded-md border bg-card px-3">
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
          <Button className="h-11" variant="outline" onClick={() => void work.refetch()}>
            <RefreshCw className="mr-2 size-4" /> Refresh
          </Button>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard
          label="Total sales"
          value={reportMoney(summary.total.toString())}
          hint="Credited bill value"
          icon={IndianRupee}
          tone="success"
        />
        <StatCard
          label="Total bills"
          value={visible.length}
          hint="In the selected period"
          icon={ReceiptText}
        />
        <StatCard
          label="Fabric sold"
          value={reportQuantity(summary.fabric.toString(), "mm")}
          hint="Across credited bills"
          icon={Ruler}
        />
        <StatCard
          label="Average bill"
          value={
            visible.length
              ? reportMoney((summary.total / BigInt(visible.length)).toString())
              : reportMoney("0")
          }
          hint="Average credited value"
          icon={TrendingUp}
        />
        <StatCard
          label="Pending bill value"
          value={reportMoney(summary.pending.toString())}
          hint="Unpaid bills in this view"
          icon={ShoppingBag}
          tone={summary.pending > 0n ? "warning" : "default"}
        />
      </div>

      {!!groups.length && (
        <div className="grid gap-4 xl:grid-cols-[1.15fr_1.35fr_.9fr]">
          <MiniPanel title="Sales by salesperson">
            <div className="space-y-3">
              {groups.slice(0, 6).map((group, index) => (
                <div key={group.id}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                    <span className="truncate font-medium">
                      {group.code ? `${group.code} · ` : ""}
                      {group.name}
                    </span>
                    <strong>{reportMoney(group.total.toString())}</strong>
                  </div>
                  <div className="h-6 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full rounded bg-primary/80"
                      style={{
                        width: `${maxSales ? Math.max(8, Number((group.total * 100n) / maxSales)) : 0}%`,
                        opacity: 1 - index * 0.08,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </MiniPanel>
          <MiniPanel title="Daily sales trend">
            <div className="flex h-48 items-end gap-2 border-b border-l px-3 pt-5">
              {daily.map(([day, value]) => (
                <div
                  key={day}
                  className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                >
                  <span className="text-[10px] font-medium">{reportMoney(value.toString())}</span>
                  <div
                    className="w-full max-w-10 rounded-t bg-primary/75"
                    style={{
                      height: `${maxDaily ? Math.max(10, Number((value * 125n) / maxDaily)) : 0}px`,
                    }}
                  />
                  <span className="truncate text-[9px] text-muted-foreground">{day}</span>
                </div>
              ))}
            </div>
          </MiniPanel>
          <MiniPanel title="Bill count by salesperson">
            <div className="space-y-3">
              {groups.slice(0, 6).map((group, index) => (
                <div key={group.id} className="flex items-center gap-3 text-sm">
                  <span
                    className="size-3 rounded-full bg-primary"
                    style={{ opacity: 1 - index * 0.1 }}
                  />
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <strong>{group.bills.length}</strong>
                  <span className="w-10 text-right text-xs text-muted-foreground">
                    {visible.length ? Math.round((group.bills.length * 100) / visible.length) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </MiniPanel>
        </div>
      )}

      <Panel
        title="Salespeople"
        description="Select a salesperson to review their bills, sold items and linked tailoring work."
        bodyClassName="p-0 sm:p-0"
        actions={
          <div className="flex flex-wrap gap-2">
            <label className="relative min-w-[230px] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search salesperson by ID or name"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <select
              className="h-10 rounded-md border bg-card px-3 text-sm"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              aria-label="Sort salespeople"
            >
              <option value="sales">Sort by sales amount</option>
              <option value="bills">Sort by bill count</option>
              <option value="fabric">Sort by fabric sold</option>
              <option value="name">Sort by name</option>
            </select>
          </div>
        }
      >
        {work.error ? (
          <p className="p-5" role="alert">
            Work could not load. Check access or retry.
          </p>
        ) : work.isPending ? (
          <p className="p-5">Loading work…</p>
        ) : !groups.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {rows.length ? "No work matches the selected filters." : "No attributed work yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[42px_90px_1.4fr_1fr_90px_110px_110px_110px_42px] border-b bg-muted/45 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>#</span>
                <span>ID</span>
                <span>Name</span>
                <span>Total sales</span>
                <span>Bills</span>
                <span>Fabric sold</span>
                <span>Avg. bill</span>
                <span>Pending</span>
                <span />
              </div>
              {groups.map((group, index) => {
                const open =
                  expandedPerson === group.id || (expandedPerson === undefined && index === 0);
                return (
                  <section key={group.id} className="border-b last:border-b-0">
                    <button
                      type="button"
                      className="grid w-full grid-cols-[42px_90px_1.4fr_1fr_90px_110px_110px_110px_42px] items-center px-4 py-3 text-left text-sm hover:bg-muted/30"
                      onClick={() => setExpandedPerson(open ? null : group.id)}
                    >
                      <span>{index + 1}</span>
                      <span className="w-fit rounded-full bg-success/10 px-3 py-1 font-mono font-semibold text-success">
                        {group.code || "—"}
                      </span>
                      <strong>{group.name}</strong>
                      <strong>{reportMoney(group.total.toString())}</strong>
                      <span>{group.bills.length}</span>
                      <span>{reportQuantity(group.fabric.toString(), "mm")}</span>
                      <span>
                        {reportMoney((group.total / BigInt(group.bills.length)).toString())}
                      </span>
                      <span
                        className={
                          group.pending > 0n
                            ? "font-semibold text-destructive"
                            : "text-muted-foreground"
                        }
                      >
                        {reportMoney(group.pending.toString())}
                      </span>
                      {open ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </button>
                    {open && (
                      <SalespersonBills
                        group={group}
                        expandedBills={expandedBills}
                        setExpandedBills={setExpandedBills}
                        copyBill={copyBill}
                      />
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </Panel>
      {work.hasNextPage && (
        <Button disabled={work.isFetchingNextPage} onClick={() => void work.fetchNextPage()}>
          Load more work
        </Button>
      )}
    </PageBody>
  );
}

function MiniPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel overflow-hidden">
      <h2 className="border-b px-4 py-3 text-sm font-semibold">{title}</h2>
      <div className="p-4">{children}</div>
    </section>
  );
}

function SalespersonBills({
  group,
  expandedBills,
  setExpandedBills,
  copyBill,
}: {
  group: SalespersonGroup;
  expandedBills: Set<string>;
  setExpandedBills: Dispatch<SetStateAction<Set<string>>>;
  copyBill: (code: string) => Promise<void>;
}) {
  const toggleBill = (id: string) => {
    const next = new Set(expandedBills);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedBills(next);
  };
  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-lg border border-primary/15 bg-card">
      <div className="flex items-center justify-between bg-accent/55 px-3 py-2">
        <strong className="text-xs">Recent bills ({group.bills.length})</strong>
        <span className="text-xs text-primary">Bill history</span>
      </div>
      <div className="grid grid-cols-[1fr_1.1fr_1.2fr_1fr_90px_1fr_100px_110px_54px] border-b bg-muted/40 px-3 py-2 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Bill no.</span>
        <span>Date & time</span>
        <span>Customer</span>
        <span>Total</span>
        <span>Fabric</span>
        <span>POS operator</span>
        <span>Payment</span>
        <span>Tailoring</span>
        <span />
      </div>
      {group.bills.map((row) => {
        const billOpen = expandedBills.has(row.id);
        const jobs = row.tailoring_jobs?.length ?? (row.job_id ? 1 : 0);
        return (
          <div key={row.id} className="border-b last:border-b-0">
            <div className="grid grid-cols-[1fr_1.1fr_1.2fr_1fr_90px_1fr_100px_110px_54px] items-center px-3 py-2.5 text-xs">
              <button
                type="button"
                className="flex min-w-0 items-center gap-1 font-semibold"
                onClick={() => void copyBill(row.code)}
                title={row.code}
              >
                <span className="truncate">{row.code}</span>
                <Copy className="size-3 shrink-0 text-muted-foreground" />
              </button>
              <span className="text-muted-foreground">{formatDateTime(row.created_at)}</span>
              <span className="truncate">{row.customer_snapshot?.name || "Walk-in customer"}</span>
              <strong>{reportMoney(row.final_customer_price_paise)}</strong>
              <span>{row.fabric_mm !== null ? reportQuantity(row.fabric_mm, "mm") : "—"}</span>
              <span className="truncate">{row.operator_name || "Recorded staff"}</span>
              <StatusBadge
                status={row.paid ? "active" : "draft"}
                label={row.paid ? "Paid" : "Pending"}
              />
              <span>{jobs ? `${jobs} job${jobs === 1 ? "" : "s"}` : "—"}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`View ${row.code}`}
                onClick={() => toggleBill(row.id)}
              >
                <Eye className="size-4" />
              </Button>
            </div>
            {billOpen && <BillDetails row={row} />}
          </div>
        );
      })}
    </div>
  );
}

function BillDetails({ row }: { row: Work }) {
  return (
    <div className="grid gap-3 bg-accent/20 p-3 lg:grid-cols-2">
      <div className="overflow-hidden rounded-md border bg-card">
        <p className="bg-muted px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Items ({row.fabrics.length})
        </p>
        {row.fabrics.length ? (
          row.fabrics.map((fabric, index) => (
            <div
              key={`${fabric.barcode}-${index}`}
              className="grid grid-cols-[32px_1fr_1fr_auto] gap-2 border-t px-3 py-2 text-xs first:border-t-0"
            >
              <span>{index + 1}</span>
              <span>{fabric.fabric}</span>
              <span>
                {fabric.batch} · {fabric.barcode}
              </span>
              <strong>{reportQuantity(fabric.quantity_mm, "mm")}</strong>
            </div>
          ))
        ) : (
          <p className="p-3 text-xs text-muted-foreground">No fabric lines on this bill.</p>
        )}
      </div>
      <div className="overflow-hidden rounded-md border bg-card">
        <p className="bg-muted px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Linked tailoring work
        </p>
        {row.tailoring_jobs?.length ? (
          row.tailoring_jobs.map((job, index) => (
            <div
              key={job.code}
              className="grid grid-cols-[32px_1fr_1fr_auto] gap-2 border-t px-3 py-2 text-xs first:border-t-0"
            >
              <span>{index + 1}</span>
              <span>{job.garment}</span>
              <span>
                {job.factory} → {job.tailor}
              </span>
              <StatusBadge status={job.status} />
            </div>
          ))
        ) : row.job_id ? (
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-3 py-2 text-xs">
            <span>{row.garment}</span>
            <span>
              {row.factory_name} → {row.tailor_name}
            </span>
            <StatusBadge status={row.job_status || "open"} />
          </div>
        ) : (
          <p className="p-3 text-xs text-muted-foreground">No linked tailoring work.</p>
        )}
      </div>
    </div>
  );
}
