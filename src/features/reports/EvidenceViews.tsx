import { useState } from "react";
import type { EvidenceRow } from "./use-evidence";
import { text, title, compareEvidence } from "./evidence-model";
import { reportMoney, reportQuantity } from "./report-value";
import { Button } from "@/components/ui/button";
export function fieldText(key: string, value: unknown, data: Record<string, unknown>) {
  if (value === null || value === undefined) return "Not recorded";
  if (key.includes("paise") && /^-?\d+$/.test(String(value))) return reportMoney(String(value));
  if (
    (key.endsWith("_mm") ||
      ((key.includes("quantity") || key === "actual_piece_usage") && data["unit"] === "mm")) &&
    /^-?\d+(?:\.0+)?$/.test(String(value))
  )
    return reportQuantity(String(value), "mm");
  return text(value);
}
export function Bars({
  values,
  money = false,
}: {
  values: { name: string; value: bigint }[];
  money?: boolean;
}) {
  const max = values.reduce((v, r) => (r.value > v ? r.value : v), 1n);
  return (
    <div className="space-y-3">
      {!values.length ? (
        <p className="text-sm text-muted-foreground">No matching recorded activity.</p>
      ) : (
        values.map((r) => (
          <div key={r.name}>
            <div className="mb-1 flex justify-between gap-3 text-sm">
              <span className="break-words">{r.name}</span>
              <strong>{money ? reportMoney(r.value.toString()) : r.value.toString()}</strong>
            </div>
            <div className="h-2 overflow-hidden rounded bg-muted" aria-hidden="true">
              <div
                className="h-full rounded bg-primary"
                style={{ width: Math.max(0, Number((r.value * 10000n) / max) / 100) + "%" }}
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
export function RecordTable({
  rows,
  preferred,
  initialPageSize = 25,
}: {
  rows: EvidenceRow[];
  preferred?: string[];
  initialPageSize?: number;
}) {
  const [page, setPage] = useState(0),
    [size, setSize] = useState(initialPageSize),
    [sort, setSort] = useState("event_at"),
    [descending, setDescending] = useState(true);
  const available = [...new Set(rows.flatMap((r) => Object.keys(r.data)))];
  const columns = (
    preferred ?? [
      "code",
      "barcode",
      "item",
      "fabric",
      "batch",
      "location",
      "source",
      "destination",
      "kind",
      "status",
      "action",
      "actor",
      "quantity",
      "unit",
    ]
  )
    .filter((k) => available.includes(k))
    .slice(0, 6);
  if (!columns.length) columns.push(...available.slice(0, 6));
  const ordered = [...rows].sort((a, b) => {
    const av = sort === "event_at" ? a.event_at : a.data[sort],
      bv = sort === "event_at" ? b.event_at : b.data[sort];
    const result = compareEvidence(av, bv);
    return (descending ? -result : result) || a.key.localeCompare(b.key);
  });
  const last = Math.max(0, Math.ceil(rows.length / size) - 1),
    current = Math.min(page, last);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span role="status">{rows.length} matching records</span>
        <label>
          Rows per page{" "}
          <select
            aria-label="Rows per page"
            value={size}
            onChange={(e) => {
              setSize(Number(e.target.value));
              setPage(0);
            }}
            className="rounded border bg-background p-2"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      {!rows.length ? (
        <p>No matching records.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[650px] text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                {["event_at", ...columns].map((k) => (
                  <th
                    key={k}
                    className="p-2"
                    aria-sort={sort === k ? (descending ? "descending" : "ascending") : "none"}
                  >
                    <button
                      onClick={() => {
                        setSort(k);
                        setDescending(sort === k ? !descending : false);
                        setPage(0);
                      }}
                      aria-label={`Sort by ${title(k)}`}
                    >
                      {k === "event_at" ? "Recorded date" : title(k)}{" "}
                      {sort === k ? (descending ? "↓" : "↑") : ""}
                    </button>
                  </th>
                ))}
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {ordered.slice(current * size, (current + 1) * size).map((r) => (
                <tr key={r.key} className="border-b">
                  <td className="p-2">
                    {r.event_at
                      ? new Date(r.event_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
                      : "Current state"}
                  </td>
                  {columns.map((k) => (
                    <td key={k} className="max-w-60 break-words p-2">
                      {typeof r.data[k] === "object" && r.data[k] !== null
                        ? "View evidence"
                        : fieldText(k, r.data[k], r.data)}
                    </td>
                  ))}
                  <td className="p-2">
                    <details>
                      <summary className="cursor-pointer text-primary">Full record</summary>
                      <dl className="min-w-64 space-y-2 py-3">
                        {Object.entries(r.data).map(([key, value]) => (
                          <div key={key}>
                            <dt className="font-medium">{title(key)}</dt>
                            <dd className="whitespace-pre-wrap break-all text-xs">
                              {typeof value === "object" && value !== null
                                ? JSON.stringify(value, null, 2)
                                : fieldText(key, value, r.data)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button variant="outline" disabled={current === 0} onClick={() => setPage(current - 1)}>
          Previous
        </Button>
        <span className="text-sm">
          Page {current + 1} of {last + 1}
        </span>
        <Button variant="outline" disabled={current === last} onClick={() => setPage(current + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
