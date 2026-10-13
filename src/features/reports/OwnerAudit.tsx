import { useMemo, useState } from "react";
import { useSession } from "@/app/providers/session";
import { Panel, StatCard } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { QueryState } from "@/shared/components/query-state";
import { useEvidence, type EvidenceRow } from "./use-evidence";
import {
  auditAction,
  auditModule,
  recordType,
  moduleNames,
  indiaDay,
  shiftDay,
  text,
  title,
} from "./evidence-model";
import { reportDateRange } from "./report-value";
import { fieldText } from "./EvidenceViews";

type Filters = {
  from: string;
  through: string;
  search: string;
  module: string;
  action: string;
  user: string;
  record: string;
};
const blank = (): Filters => ({
  from: indiaDay(),
  through: indiaDay(),
  search: "",
  module: "",
  action: "",
  user: "",
  record: "",
});
export function OwnerAudit() {
  const { isOwner } = useSession();
  const [filters, setFilters] = useState(blank),
    [applied, setApplied] = useState(blank),
    [preset, setPreset] = useState("Today"),
    [validation, setValidation] = useState(""),
    [selected, setSelected] = useState<EvidenceRow | null>(null),
    [page, setPage] = useState(0),
    [size, setSize] = useState(25);
  const range = useMemo(
    () => reportDateRange(applied.from, applied.through),
    [applied.from, applied.through],
  );
  const events = useEvidence("audit", range);
  const rows = useMemo(
    () =>
      (events.data ?? [])
        .filter((r) => {
          if (
            applied.search &&
            !JSON.stringify(r.data).toLowerCase().includes(applied.search.toLowerCase())
          )
            return false;
          if (applied.module && auditModule(r) !== applied.module) return false;
          if (applied.action && auditAction(r) !== applied.action) return false;
          if (applied.user && text(r.data["actor_id"] ?? r.data["user_id"]) !== applied.user)
            return false;
          if (applied.record && recordType(r) !== applied.record) return false;
          return true;
        })
        .sort(
          (a, b) =>
            (b.event_at ?? "").localeCompare(a.event_at ?? "") || b.key.localeCompare(a.key),
        ),
    [events.data, applied],
  );
  const users = [
    ...new Map(
      (events.data ?? []).map((r) => {
        const id = text(r.data["actor_id"] ?? r.data["user_id"]);
        return [id, `${text(r.data["actor"])} · ${id}`];
      }),
    ).entries(),
  ];
  const actions = [
    ...new Set([
      "Created",
      "Updated",
      "Adjusted",
      "Transferred",
      "Completed",
      "Cancelled",
      "Permission Changed",
      ...(events.data ?? []).map(auditAction),
    ]),
  ].sort();
  const types = [
    ...new Set([
      "Barcode/Thaan",
      "Bill",
      "Order",
      "Production Order",
      "Stock Movement",
      "Staff Account",
      ...(events.data ?? []).map(recordType),
    ]),
  ].sort();
  const select = (key: keyof Filters, label: string, options: [string, string][]) => (
    <label className="text-xs font-medium">
      {label}
      <select
        aria-label={label}
        value={filters[key]}
        onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
        className="mt-1 h-11 w-full rounded-lg border bg-background px-2 text-sm"
      >
        <option value="">All</option>
        {options.map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
  const before = selected?.data["previous_value"],
    after = selected?.data["new_value"];
  const beforeObject =
    before && typeof before === "object" && !Array.isArray(before)
      ? (before as Record<string, unknown>)
      : null;
  const afterObject =
    after && typeof after === "object" && !Array.isArray(after)
      ? (after as Record<string, unknown>)
      : null;
  const fields = [
    ...new Set([...Object.keys(beforeObject ?? {}), ...Object.keys(afterObject ?? {})]),
  ];
  const maxPage = Math.max(0, Math.ceil(rows.length / size) - 1),
    current = Math.min(page, maxPage);
  if (!isOwner) return <p>Owner access is required.</p>;
  return (
    <div className="space-y-5">
      <Panel
        title="Search recorded events"
        description="Who changed what, when and which record was affected. Evidence is read-only; missing historical facts are not reconstructed."
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              reportDateRange(filters.from, filters.through);
              setApplied({ ...filters, search: filters.search.trim() });
              setPage(0);
              setValidation("");
            } catch (error) {
              setValidation(error instanceof Error ? error.message : "Invalid dates");
            }
          }}
        >
          <Input
            aria-label="Search audit evidence"
            placeholder="Search user, barcode, bill, production ID or transfer reference"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs font-medium">
              Date range
              <select
                aria-label="Audit date range"
                className="mt-1 h-11 w-full rounded-lg border bg-background px-2 text-sm"
                value={preset}
                onChange={(e) => {
                  const v = e.target.value;
                  setPreset(v);
                  if (v !== "Custom") {
                    const today = indiaDay();
                    setFilters({
                      ...filters,
                      from: shiftDay(
                        today,
                        v === "Yesterday"
                          ? -1
                          : v === "Last 7 days"
                            ? -6
                            : v === "Last 30 days"
                              ? -29
                              : 0,
                      ),
                      through: v === "Yesterday" ? shiftDay(today, -1) : today,
                    });
                  }
                }}
              >
                {["Today", "Yesterday", "Last 7 days", "Last 30 days", "Custom"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium">
              From date (India)
              <Input
                aria-label="Audit from date"
                type="date"
                value={filters.from}
                onChange={(e) => {
                  setPreset("Custom");
                  setFilters({ ...filters, from: e.target.value });
                }}
              />
            </label>
            <label className="text-xs font-medium">
              Through date (India)
              <Input
                aria-label="Audit through date"
                type="date"
                value={filters.through}
                onChange={(e) => {
                  setPreset("Custom");
                  setFilters({ ...filters, through: e.target.value });
                }}
              />
            </label>
            {select("user", "Recorded user", users)}
            {select(
              "module",
              "Module",
              [...moduleNames, "Other / unclassified"].map((v) => [v, v]),
            )}
            {select(
              "action",
              "Action",
              actions.map((v) => [v, v]),
            )}
            {select(
              "record",
              "Record type",
              types.map((v) => [v, v]),
            )}
          </div>
          {validation && <p role="alert">{validation}</p>}
          <div className="flex flex-wrap gap-2">
            <Button>Apply audit filters</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFilters(blank());
                setApplied(blank());
                setPreset("Today");
                setPage(0);
                setValidation("");
              }}
            >
              Reset to today
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={events.isFetching}
              onClick={() => void events.refetch()}
            >
              Refresh audit
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Applied period: {applied.from || "All history"} through{" "}
            {applied.through || "latest recorded activity"} (India).
          </p>
          <p className="text-xs text-muted-foreground">
            Filters classify captured table/action evidence. Generic row updates remain Updated;
            they are not assumed to mean completion or cancellation. Identifiers are searchable only
            where actually captured.
          </p>
        </form>
      </Panel>
      <QueryState
        loading={events.isPending}
        error={events.error}
        retry={() => void events.refetch()}
      />
      {events.data && !events.error && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard
              label="Matching audit events"
              value={rows.length}
              hint="Recorded events in the applied period"
            />
            <StatCard
              label="Permission events"
              value={rows.filter((r) => auditAction(r) === "Permission Changed").length}
              hint="Captured permission changes"
            />
          </div>
          <Panel
            title="Recorded events"
            description="Newest first · India time · select an event to inspect its captured evidence."
          >
            <label className="mb-3 inline-flex items-center gap-2 text-sm">
              Rows per page
              <select
                aria-label="Audit rows per page"
                value={size}
                onChange={(e) => {
                  setSize(Number(e.target.value));
                  setPage(0);
                }}
                className="rounded border bg-background p-2"
              >
                {[10, 25, 50, 100].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            {!rows.length ? (
              <p>No matching recorded events.</p>
            ) : (
              <div className="divide-y">
                {rows.slice(current * size, (current + 1) * size).map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setSelected(r)}
                    className="flex w-full flex-col items-start justify-between sm:flex-row gap-3 rounded-lg p-3 text-left hover:bg-muted/50"
                    aria-label={`Open audit event ${r.key}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {auditAction(r)} · {auditModule(r)}
                      </p>
                      <p className="mt-1 break-words text-sm">
                        {text(r.data["reference"] ?? r.data["entity_id"])} · {recordType(r)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {text(r.data["actor"] ?? r.data["actor_id"] ?? r.data["user_id"])} ·{" "}
                        {text(r.data["source"])} evidence · action: {text(r.data["action"])}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {r.event_at
                        ? new Date(r.event_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
                        : "Timestamp not recorded"}{" "}
                      →
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-4 flex items-center gap-3">
              <Button
                variant="outline"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                Previous events
              </Button>
              <span className="text-sm">
                Page {current + 1} of {maxPage + 1}
              </span>
              <Button
                variant="outline"
                disabled={current === maxPage}
                onClick={() => setPage(current + 1)}
              >
                Next events
              </Button>
            </div>
          </Panel>
        </>
      )}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Audit event details</DialogTitle>
            <DialogDescription>
              Only captured values are evidence. Missing values show Not recorded.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <dl className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Event", auditAction(selected)],
                  ["Recorded action", text(selected.data["action"])],
                  [
                    "Performed by",
                    text(
                      selected.data["actor"] ??
                        selected.data["actor_id"] ??
                        selected.data["user_id"],
                    ),
                  ],
                  ["Actor ID", text(selected.data["actor_id"] ?? selected.data["user_id"])],
                  [
                    "Timestamp",
                    selected.event_at
                      ? new Date(selected.event_at).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })
                      : "Not recorded",
                  ],
                  [
                    "Record reference",
                    text(selected.data["reference"] ?? selected.data["entity_id"]),
                  ],
                  ["Reason", text(afterObject?.["reason"] ?? beforeObject?.["reason"])],
                  ["Evidence source", text(selected.data["source"])],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="break-all text-sm font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              <h3 className="font-semibold">Before and after</h3>
              {fields.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[400px] text-left text-sm">
                    <thead>
                      <tr>
                        <th className="p-2">Captured field</th>
                        <th className="p-2">Previous value</th>
                        <th className="p-2">New value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((k) => (
                        <tr key={k} className="border-t">
                          <th className="p-2 align-top">{title(k)}</th>
                          <td className="max-w-64 whitespace-pre-wrap break-all p-2 align-top">
                            {fieldText(k, beforeObject?.[k], beforeObject ?? {})}
                          </td>
                          <td className="max-w-64 whitespace-pre-wrap break-all p-2 align-top">
                            {fieldText(k, afterObject?.[k], afterObject ?? {})}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <p>Previous value: {text(before)}</p>
                  <p>New value: {text(after)}</p>
                </div>
              )}
              <details>
                <summary className="cursor-pointer text-sm text-primary">
                  Complete captured event
                </summary>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(selected.data, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
