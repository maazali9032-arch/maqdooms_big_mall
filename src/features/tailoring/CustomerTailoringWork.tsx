import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/shared/utils/format";
import { reportInteger, reportMoney, reportQuantity } from "@/features/reports/report-value";
import { CounterBillReceipt, type CounterReceipt } from "@/features/pos/CounterBillReceipt";
type Job = {
  id: string;
  code: string;
  scan_code?: string | null;
  bill_scan_code?: string | null;
  bill_id: string | null;
  bill_code: string | null;
  garment: string;
  status: string;
  created_at: string;
  creator: string | null;
  delivery_date: string | null;
  customer: string | null;
  contact: string | null;
  factory: string;
  tailor: string;
  design: string | null;
  source: string;
  total_paise: string | null;
  cp_paise: string | null;
  paid: boolean | null;
  fabrics: {
    barcode: string;
    name: string;
    quantity_mm: string;
    source: string;
    issue_type: string;
    issued_at: string;
    issued_by: string | null;
    issue: string;
  }[];
};
export function CustomerTailoringWork() {
  const { isOwner, roles, can } = useSession();
  const allowed = isOwner || roles.includes("counter") || roles.includes("tailor");
  const mayBill = isOwner || roles.includes("counter");
  const mayProgress =
    isOwner ||
    can("tailoring.manage_jobs") ||
    (roles.includes("counter") && can("pos.issue_to_tailoring"));
  const qc = useQueryClient();
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [receipt, setReceipt] = useState<CounterReceipt | null>(null);
  const query = useQuery({
    queryKey: ["customer-tailoring", "work"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customer_tailoring_work", {});
      if (error) throw error;
      return data as unknown as Job[];
    },
  });
  const status = useMutation({
    mutationFn: async (args: { p_job: string; p_status: string }) => {
      const { error } = await supabase.rpc("set_customer_tailoring_status", args);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      toast.success("Job status saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const print = useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await supabase.rpc("counter_bill", { p_code: code });
      if (error) throw error;
      if (!data) throw new Error("No combined receipt recorded for this job");
      return data as unknown as CounterReceipt;
    },
    onSuccess: setReceipt,
    onError: (e) => toast.error(e.message),
  });
  if (!allowed) return <p>Customer Tailoring access required.</p>;
  const rows = (query.data ?? []).filter((j) =>
    [j.code, j.scan_code, j.bill_code, j.bill_scan_code, j.customer, j.contact, j.garment].some(
      (v) => v?.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  const job = query.data?.find((j) => j.id === selected);
  return (
    <div className="space-y-4">
      <Panel
        title="Customer Tailoring"
        description={
          mayBill
            ? "Jobs created through POS bills. Review their work, delivery and linked bill."
            : "Your assigned customer tailoring jobs."
        }
      >
        <QueryState
          loading={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
        />
        <Input
          aria-label="Search tailoring jobs"
          placeholder="Search job, bill, customer or garment"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="mt-3 space-y-2">
          {rows.map((j) => (
            <button
              type="button"
              key={j.id}
              onClick={() => setSelected(j.id)}
              className="flex w-full flex-wrap justify-between gap-2 rounded-lg border p-3 text-left text-sm"
            >
              <span>
                <strong>{j.garment}</strong>
                <span className="block break-all font-mono text-xs">
                  {j.scan_code ?? j.code}
                  {(j.bill_scan_code ?? j.bill_code)
                    ? " · " + (j.bill_scan_code ?? j.bill_code)
                    : ""}
                </span>
              </span>
              <span>
                {j.status.replace("_", " ")}
                {j.delivery_date ? " · Due " + j.delivery_date : ""}
              </span>
            </button>
          ))}
        </div>
        {!query.isPending && !query.error && !rows.length && (
          <p className="mt-3 text-sm">No matching jobs.</p>
        )}
      </Panel>
      {job && (
        <Panel
          title={job.scan_code ?? job.code}
          description={`${job.garment}${job.design ? " · " + job.design : ""}`}
        >
          <div className="space-y-3 text-sm">
            <p>
              Customer: {job.customer || "Not provided"} · Contact: {job.contact || "Not provided"}
            </p>
            <p>
              {job.factory} → {job.tailor}
            </p>
            <p>
              Created {formatDateTime(job.created_at)} · {job.creator || "User not recorded"}
            </p>
            <p>
              Delivery: {job.delivery_date || "Not recorded"} · Source: {job.source}
            </p>
            {mayBill && (
              <p>
                Customer total{" "}
                {job.total_paise === null ? "Not recorded" : reportMoney(job.total_paise)} · Payment{" "}
                {job.paid === null ? "No combined payment record" : job.paid ? "Paid" : "Unpaid"}
              </p>
            )}
            {isOwner && (
              <p>
                Recorded fabric CP {job.cp_paise === null ? "Unknown" : reportMoney(job.cp_paise)} ·
                Fabric margin{" "}
                {job.cp_paise === null || job.total_paise === null
                  ? "Unknown"
                  : reportMoney(
                      String(reportInteger(job.total_paise) - reportInteger(job.cp_paise)),
                    )}{" "}
                <span className="block text-xs text-muted-foreground">
                  Includes later fabric issues. Labour and other unrecorded costs are excluded.
                </span>
              </p>
            )}
            <details open className="rounded border p-3">
              <summary className="font-semibold">Issued fabric</summary>
              <div className="mt-2 ml-2 space-y-2 border-l pl-3">
                {job.fabrics.map((f, i) => (
                  <div key={i}>
                    <strong>
                      {f.name} · {reportQuantity(f.quantity_mm, "mm")}
                    </strong>
                    <p className="break-all font-mono text-xs">{f.barcode}</p>
                    <p className="text-xs">
                      {f.source} · {f.issue_type} · {formatDateTime(f.issued_at)} ·{" "}
                      {f.issued_by || "User not recorded"}
                    </p>
                  </div>
                ))}
              </div>
            </details>
            {mayProgress && (
              <label className="block">
                Job status
                <select
                  aria-label="Customer job status"
                  disabled={status.isPending}
                  className="ml-3 min-h-11 rounded border bg-background p-2"
                  value={job.status}
                  onChange={(e) => status.mutate({ p_job: job.id, p_status: e.target.value })}
                >
                  {["open", "in_progress", "ready", "delivered", "cancelled"].map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {mayBill && job.bill_id && (
              <Button
                variant="outline"
                disabled={print.isPending}
                onClick={() => print.mutate(job.bill_id!)}
              >
                View / print bill
              </Button>
            )}
          </div>
        </Panel>
      )}
      {receipt && <CounterBillReceipt receipt={receipt} />}
    </div>
  );
}
