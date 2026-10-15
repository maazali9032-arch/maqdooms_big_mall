import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSession } from "@/app/providers/session";
import { Panel, StatCard } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryState } from "@/shared/components/query-state";
import { useEvidence } from "./use-evidence";
import {
  categories,
  snapshots,
  indiaDay,
  inRange,
  orderDate,
  paid,
  text,
  title,
  sum,
  quantityTotal,
} from "./evidence-model";
import { reportDateRange, reportMoney, reportQuantity } from "./report-value";
import { RecordTable } from "./EvidenceViews";
import { reportIcons } from "./OwnerVisuals";
import { ChevronRight } from "lucide-react";
import "./owner-workspace.css";
import { MonthlyBusiness } from "./MonthlyBusiness";
import { monthPeriod, previousMonthPeriod } from "./business-period";

function initialFilters() {
  const search = typeof window === "undefined" ? "" : window.location.search,
    p = new URLSearchParams(search);
  const previous = previousMonthPeriod();
  let from = p.get("from") ?? previous.from,
    through = p.get("through") ?? previous.through;
  try {
    reportDateRange(from, through);
  } catch {
    from = previous.from;
    through = previous.through;
  }
  return {
    from,
    through,
    search: "",
    location: "",
    status: p.get("status") ?? "",
    sale: p.get("sale") ?? "",
    payment: p.get("payment") ?? "",
    fabric: "",
    vendor: "",
    movement: "",
    product: "",
    job: "",
    cost: "",
    action: "",
    actor: "",
    record: p.get("channel") ?? "",
  };
}
export function OwnerReports({ initialDataset }: { initialDataset?: string }) {
  const { isOwner } = useSession();
  const queryClient = useQueryClient();
  const all = categories.flatMap((c) => c.reports);
  const start = all.some(([key]) => key === initialDataset) ? initialDataset! : "sales_lines";
  const [dataset, setDataset] = useState(start),
    [filters, setFilters] = useState(initialFilters),
    [applied, setApplied] = useState(initialFilters),
    [validation, setValidation] = useState("");
  const category = categories.find((c) => c.reports.some(([key]) => key === dataset))!;
  const snapshot = snapshots.has(dataset);
  const range = useMemo(
    () => (snapshot ? {} : reportDateRange(applied.from, applied.through)),
    [snapshot, applied.from, applied.through],
  );
  const records = useEvidence(dataset, range);
  const rows = useMemo(
    () =>
      (records.data ?? []).filter((r) => {
        const d = r.data;
        if (dataset === "orders" && !inRange(orderDate(r), applied.from, applied.through))
          return false;
        if (
          applied.search &&
          !JSON.stringify(d).toLowerCase().includes(applied.search.toLowerCase())
        )
          return false;
        if (
          applied.location &&
          !["location", "source", "destination"].some(
            (k) => String(d[k] ?? "") === applied.location,
          ) &&
          !(Array.isArray(d["source_names"]) && d["source_names"].includes(applied.location))
        )
          return false;
        if (applied.status && String(d["status"] ?? d["piece_status"] ?? "") !== applied.status)
          return false;
        if (applied.sale && d["kind"] !== applied.sale) return false;
        if (
          applied.payment &&
          (applied.payment === "payment_confirmed"
            ? !paid(r)
            : applied.payment === "bookings"
              ? d["kind"] !== "customer_tailoring" || d["status"] !== "completed"
              : paid(r) || d["kind"] === "customer_tailoring")
        )
          return false;
        if (
          applied.fabric &&
          String(d["fabric"] ?? (d["kind"] === "fabric" ? d["item"] : "") ?? "") !== applied.fabric
        )
          return false;
        if (applied.vendor && String(d["vendor"] ?? "") !== applied.vendor) return false;
        if (applied.product && String(d["product"] ?? "") !== applied.product) return false;
        if (applied.job && String(d["job"] ?? "") !== applied.job) return false;
        if (applied.movement && String(d["movement_type"] ?? d["kind"] ?? "") !== applied.movement)
          return false;
        if (applied.cost && String(d["finalized"]) !== applied.cost) return false;
        if (applied.action && String(d["action"] ?? "") !== applied.action) return false;
        if (
          applied.actor &&
          String(
            dataset === "sales_lines"
              ? (d["salesperson_id"] ?? "unassigned")
              : (d["actor_id"] ?? d["user_id"] ?? ""),
          ) !== applied.actor
        )
          return false;
        if (
          applied.record &&
          String(dataset === "sales_lines" ? d["channel"] : (d["entity_table"] ?? "")) !==
            applied.record
        )
          return false;
        return true;
      }),
    [records.data, applied, dataset],
  );
  const options = (keys: string[]) =>
    [
      ...new Set(
        (records.data ?? []).flatMap((r) =>
          keys
            .flatMap((k) => (Array.isArray(r.data[k]) ? r.data[k] : [r.data[k]]))
            .filter((v) => typeof v === "string" && v && v !== "Multiple Showroom floors"),
        ),
      ),
    ]
      .map(String)
      .sort();
  const field = (
    key: keyof typeof filters,
    name: string,
    values: string[],
    labels?: Record<string, string>,
  ) =>
    values.length ? (
      <label className="min-w-0 text-xs font-medium">
        {name}
        <select
          aria-label={name}
          className="mt-1 h-11 w-full rounded-lg border bg-background px-2 text-sm"
          value={filters[key]}
          onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
        >
          <option value="">All</option>
          {values.map((v) => (
            <option key={v} value={v}>
              {labels?.[v] ?? title(v)}
            </option>
          ))}
        </select>
      </label>
    ) : null;
  function select(next: string) {
    setDataset(next);
    const reset = {
      ...filters,
      search: "",
      location: "",
      status: "",
      sale: "",
      payment: "",
      fabric: "",
      vendor: "",
      movement: "",
      product: "",
      job: "",
      cost: "",
      action: "",
      actor: "",
      record: "",
    };
    setFilters(reset);
    setApplied({ ...reset, from: applied.from, through: applied.through });
    setValidation("");
  }
  if (!isOwner) return <p>Owner access is required.</p>;
  const paidRows = rows.filter(paid),
    bookings = rows.filter(
      (r) => r.data["kind"] === "customer_tailoring" && r.data["status"] === "completed",
    );
  const moneyField = dataset === "finished_products" ? "production_cost_paise" : null;
  const amounts = moneyField ? sum(rows, moneyField) : null;
  const units = [...new Set(rows.map((r) => String(r.data["unit"] ?? "")).filter(Boolean))];
  return (
    <div className="owner-workspace owner-reports space-y-5">
      <nav
        aria-label="Report categories"
        className="grid grid-cols-2 gap-2 rounded-xl border bg-card p-2 sm:grid-cols-3 xl:grid-cols-7"
      >
        {categories.map((c) => (
          <Button
            key={c.name}
            variant={category.name === c.name ? "default" : "ghost"}
            className="flex h-auto min-h-16 flex-col gap-2 whitespace-normal px-2 text-center text-[10px]"
            onClick={() => select(c.reports[0]![0])}
          >
            {(() => {
              const Icon = reportIcons[c.name]!;
              return <Icon className="size-5" />;
            })()}
            {c.name}
          </Button>
        ))}
      </nav>
      <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside
          className="owner-report-nav panel hidden min-w-0 space-y-3 p-3 lg:block"
          aria-label="Reports in selected category"
        >
          <div className="border-b pb-3">
            <p className="text-sm font-semibold text-primary">{category.name}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Choose the evidence to inspect</p>
          </div>
          {category.reports.map(([key, name]) => (
            <Button
              key={key}
              variant={dataset === key ? "secondary" : "ghost"}
              className="w-full gap-2"
              aria-current={dataset === key ? "page" : undefined}
              onClick={() => select(key)}
            >
              <ChevronRight className="size-3 shrink-0" />
              {name}
            </Button>
          ))}
        </aside>
        <div className="min-w-0 space-y-4">
          <Panel
            title={all.find(([key]) => key === dataset)?.[1] ?? category.name}
            description="Choose a report, apply its relevant filters and inspect the complete recorded evidence."
          >
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  reportDateRange(filters.from, filters.through);
                  setApplied({ ...filters, search: filters.search.trim() });
                  setValidation("");
                } catch (error) {
                  setValidation(error instanceof Error ? error.message : "Invalid dates");
                }
              }}
            >
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-2">
                {!snapshot && (
                  <label className="text-xs font-medium">
                    Month shortcut
                    <input
                      aria-label="Report month"
                      type="month"
                      className="mt-1 h-11 w-full rounded border bg-background px-2 text-sm"
                      max={indiaDay().slice(0, 7)}
                      value={filters.from.slice(0, 7)}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        try {
                          setFilters({ ...filters, ...monthPeriod(e.target.value) });
                        } catch (error) {
                          setValidation((error as Error).message);
                        }
                      }}
                    />
                  </label>
                )}
                <label className="text-xs font-medium lg:hidden">
                  Report
                  <select
                    aria-label="Report"
                    className="mt-1 h-11 w-full rounded-lg border bg-background px-2 text-sm"
                    value={dataset}
                    onChange={(e) => select(e.target.value)}
                  >
                    {category.reports.map(([key, name]) => (
                      <option key={key} value={key}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-medium">
                  From date (India)
                  <Input
                    aria-label="From date"
                    type="date"
                    disabled={snapshot}
                    value={filters.from}
                    onChange={(e) => setFilters({ ...filters, from: e.target.value })}
                  />
                </label>
                <label className="text-xs font-medium">
                  Through date (India)
                  <Input
                    aria-label="Through date"
                    type="date"
                    disabled={snapshot}
                    value={filters.through}
                    onChange={(e) => setFilters({ ...filters, through: e.target.value })}
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <label className="text-xs font-medium">
                  Search recorded evidence
                  <Input
                    aria-label="Search report"
                    placeholder="Barcode, bill, order or reference"
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  />
                </label>
                {field(
                  "location",
                  "Location",
                  options(["location", "source", "destination", "source_names"]),
                )}
                {field("status", "Status", options(["status", "piece_status"]))}
                {["orders", "sales_lines"].includes(dataset) &&
                  field("sale", "Sale type", options(["kind"]))}
                {dataset === "sales_lines" &&
                  field(
                    "actor",
                    "Credited Salesperson",
                    [...options(["salesperson_id"]), "unassigned"],
                    Object.fromEntries([
                      ...(records.data ?? [])
                        .filter((r) => r.data["salesperson_id"])
                        .map((r) => [
                          String(r.data["salesperson_id"]),
                          String(r.data["salesperson"] ?? r.data["salesperson_id"]),
                        ]),
                      ["unassigned", "Unassigned / not recorded"],
                    ]),
                  )}
                {dataset === "sales_lines" &&
                  field("record", "Sales channel", options(["channel"]))}
                {dataset === "orders" &&
                  field(
                    "payment",
                    "Payment / booking state",
                    ["payment_confirmed", "bookings", "not_confirmed"],
                    {
                      payment_confirmed: "Paid fabric/product sales",
                      bookings: "Tailoring bookings",
                      not_confirmed: "Not payment-confirmed",
                    },
                  )}
                {field(
                  "fabric",
                  "Fabric",
                  dataset === "stock"
                    ? [
                        ...new Set(
                          (records.data ?? [])
                            .filter((r) => r.data["kind"] === "fabric")
                            .map((r) => String(r.data["item"])),
                        ),
                      ].sort()
                    : options(["fabric"]),
                )}
                {dataset === "sales_lines" && field("vendor", "Vendor", options(["vendor"]))}
                {field("product", "Product", options(["product"]))}
                {field("job", "Production / job reference", options(["job"]))}
                {dataset === "movements" &&
                  field("movement", "Movement type", options(["movement_type", "kind"]))}
                {dataset === "audit" && field("action", "Recorded action", options(["action"]))}
                {dataset === "audit" &&
                  field("actor", "Recorded user ID", options(["actor_id", "user_id"]))}
                {dataset === "audit" && field("record", "Record table", options(["entity_table"]))}
                {dataset === "production_costs" &&
                  field("cost", "Cost evidence", ["true", "false"], {
                    true: "Finalised recorded revision",
                    false: "Not finalised",
                  })}
              </div>
              {validation && <p role="alert">{validation}</p>}
              <div className="flex flex-wrap gap-2">
                <Button>Apply filters</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const reset = {
                      ...initialFilters(),
                      from: "",
                      through: "",
                      sale: "",
                      payment: "",
                      status: "",
                    };
                    setFilters(reset);
                    setApplied(reset);
                    setValidation("");
                  }}
                >
                  Clear filters
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={records.isFetching}
                  onClick={() => {
                    void records.refetch();
                    void queryClient.invalidateQueries({ queryKey: ["owner-monthly-business"] });
                  }}
                >
                  Refresh report
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Applied period:{" "}
                {snapshot
                  ? "Current state; dates do not apply"
                  : `${applied.from || "All history"} through ${applied.through || "latest recorded activity"} (India)`}
              </p>
              {["sales_lines", "orders"].includes(dataset) && (
                <p className="text-xs text-muted-foreground">
                  Business charts compare the applied date range and location. Search, sale type,
                  channel and Salesperson filters refine the transaction table only.
                </p>
              )}
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Report definitions & limitations</summary>
                <div className="mt-2 space-y-2">
                  {" "}
                  <p className="text-xs text-muted-foreground">
                    {snapshot
                      ? "Current recorded state — date range does not apply; this is not a historical stock snapshot."
                      : dataset === "orders"
                        ? "Paid bills use their recorded collection date. Tailoring bookings use creation date and stay separate from collections."
                        : "Dates filter recorded event/creation time. Current status and any recorded cost evidence are displayed; they are not reconstructed historical values."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Payment methods, due dates and unrecorded margins are unavailable. Material
                    issues are not consumption. Legacy reports are separate evidence.
                  </p>
                </div>
              </details>
            </form>
          </Panel>
          {(dataset === "sales_lines" || dataset === "orders") && (
            <MonthlyBusiness
              from={applied.from}
              through={applied.through}
              location={applied.location}
            />
          )}

          <QueryState
            loading={records.isPending}
            error={records.error}
            retry={() => void records.refetch()}
          />
          {records.data && !records.error && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Matching records"
                  value={rows.length}
                  hint="All matching records after applied filters"
                />
                {dataset === "sales_lines" ? (
                  <>
                    <StatCard
                      label="Filtered collected sales"
                      value={reportMoney(sum(rows, "revenue_paise").total.toString())}
                      hint="Only transaction rows matching all applied filters"
                    />
                    <StatCard
                      label="Filtered paid bills"
                      value={new Set(rows.map((r) => r.data["order_id"])).size}
                      hint="Distinct orders across matching sale lines"
                    />
                    <StatCard
                      label="Filtered recorded margin"
                      value={
                        rows.length && sum(rows, "margin_paise").unknown === rows.length
                          ? "Not recorded"
                          : reportMoney(sum(rows, "margin_paise").total.toString())
                      }
                      hint={`${sum(rows, "margin_paise").unknown} lines have unknown cost`}
                    />
                  </>
                ) : dataset === "orders" ? (
                  <>
                    <StatCard
                      label="Paid sales"
                      value={reportMoney(
                        sum(paidRows, "final_customer_price_paise").total.toString(),
                      )}
                      hint={`${paidRows.length} paid bills · Full bill amounts; local line totals appear in Business performance`}
                    />
                    <StatCard
                      label="Tailoring bookings"
                      value={reportMoney(
                        sum(bookings, "final_customer_price_paise").total.toString(),
                      )}
                      hint="Booked value; not collected sales"
                    />
                  </>
                ) : dataset === "stock" ? (
                  units.map((unit) => (
                    <StatCard
                      key={unit}
                      label={`Current stock · ${unit === "mm" ? "metres" : unit}`}
                      value={reportQuantity(
                        quantityTotal(rows.filter((r) => r.data["unit"] === unit)).value,
                        unit,
                      )}
                      hint="Units remain separate"
                    />
                  ))
                ) : amounts ? (
                  <>
                    <StatCard
                      label="Recorded piece costs"
                      value={reportMoney(amounts.total.toString())}
                      hint="Recorded allocations only"
                    />
                    <StatCard
                      label="Costs not recorded"
                      value={amounts.unknown}
                      hint="No inferred cost or margin"
                    />
                  </>
                ) : (
                  <StatCard
                    label="Report basis"
                    value={snapshot ? "Current state" : "Recorded activity"}
                    hint={snapshot ? "Independent of selected dates" : "Selected event range"}
                  />
                )}
              </div>
              <Panel
                title={all.find(([key]) => key === dataset)?.[1]}
                description="Search and sorting cover all matching records. Full record opens the captured underlying evidence."
              >
                <RecordTable
                  preferred={
                    dataset === "sales_lines"
                      ? ["code", "fabric", "product", "vendor", "salesperson", "revenue_paise"]
                      : undefined
                  }
                  key={dataset + JSON.stringify(applied)}
                  rows={
                    dataset === "orders"
                      ? rows.map((r) => ({
                          ...r,
                          event_at: typeof orderDate(r) === "string" ? String(orderDate(r)) : null,
                        }))
                      : rows
                  }
                />
              </Panel>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
