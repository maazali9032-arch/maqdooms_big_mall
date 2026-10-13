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

function initialFilters() {
  const search = typeof window === "undefined" ? "" : window.location.search,
    p = new URLSearchParams(search);
  let from = p.get("from") ?? indiaDay(),
    through = p.get("through") ?? indiaDay();
  try {
    reportDateRange(from, through);
  } catch {
    from = indiaDay();
    through = indiaDay();
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
    movement: "",
    product: "",
    job: "",
    cost: "",
    action: "",
    actor: "",
    record: "",
  };
}
export function OwnerReports({ initialDataset }: { initialDataset?: string }) {
  const { isOwner } = useSession();
  const all = categories.flatMap((c) => c.reports);
  const start = all.some(([key]) => key === initialDataset) ? initialDataset! : "orders";
  const [dataset, setDataset] = useState(start),
    [filters, setFilters] = useState(initialFilters),
    [applied, setApplied] = useState(initialFilters),
    [validation, setValidation] = useState("");
  const category = categories.find((c) => c.reports.some(([key]) => key === dataset))!;
  const snapshot = snapshots.has(dataset);
  const range = useMemo(
    () => (snapshot || dataset === "orders" ? {} : reportDateRange(applied.from, applied.through)),
    [snapshot, dataset, applied.from, applied.through],
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
          )
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
        if (applied.product && String(d["product"] ?? "") !== applied.product) return false;
        if (applied.job && String(d["job"] ?? "") !== applied.job) return false;
        if (applied.movement && String(d["movement_type"] ?? d["kind"] ?? "") !== applied.movement)
          return false;
        if (applied.cost && String(d["finalized"]) !== applied.cost) return false;
        if (applied.action && String(d["action"] ?? "") !== applied.action) return false;
        if (applied.actor && String(d["actor_id"] ?? d["user_id"] ?? "") !== applied.actor)
          return false;
        if (applied.record && String(d["entity_table"] ?? "") !== applied.record) return false;
        return true;
      }),
    [records.data, applied, dataset],
  );
  const options = (keys: string[]) =>
    [
      ...new Set(
        (records.data ?? []).flatMap((r) =>
          keys.map((k) => r.data[k]).filter((v) => typeof v === "string" && v),
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
      movement: "",
      product: "",
      job: "",
      cost: "",
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
    <div className="space-y-5">
      <nav
        aria-label="Report categories"
        className="grid gap-2 rounded-xl border bg-card p-2 sm:grid-cols-2 xl:grid-cols-4"
      >
        {categories.map((c) => (
          <Button
            key={c.name}
            variant={category.name === c.name ? "default" : "ghost"}
            className="h-auto min-h-11 whitespace-normal text-left"
            onClick={() => select(c.reports[0]![0])}
          >
            {c.name}
          </Button>
        ))}
      </nav>
      <Panel
        title={category.name}
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
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs font-medium">
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
            {field("location", "Location", options(["location", "source", "destination"]))}
            {field("status", "Status", options(["status", "piece_status"]))}
            {dataset === "orders" && field("sale", "Sale type", options(["kind"]))}
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
              onClick={() => void records.refetch()}
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
          <p className="text-xs text-muted-foreground">
            {snapshot
              ? "Current recorded state — date range does not apply; this is not a historical stock snapshot."
              : dataset === "orders"
                ? "Paid fabric/product sales use completion date. Tailoring bookings and other orders use creation date. These amounts stay separate."
                : "Dates filter recorded event/creation time. Current status and any recorded cost evidence are displayed; they are not reconstructed historical values."}
          </p>
          <p className="text-xs text-muted-foreground">
            Payment methods, due dates and unrecorded margins are unavailable. Material issues are
            not consumption. Legacy reports are separate evidence.
          </p>
        </form>
      </Panel>
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
            {dataset === "orders" ? (
              <>
                <StatCard
                  label="Paid sales"
                  value={reportMoney(sum(paidRows, "final_customer_price_paise").total.toString())}
                  hint={`${paidRows.length} payment-confirmed fabric/product bills`}
                />
                <StatCard
                  label="Tailoring bookings"
                  value={reportMoney(sum(bookings, "final_customer_price_paise").total.toString())}
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
  );
}
