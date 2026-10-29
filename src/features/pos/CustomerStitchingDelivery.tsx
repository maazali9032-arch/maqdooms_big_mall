import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel, StatusBadge } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reportInteger, reportMoney } from "@/features/reports/report-value";
import { stitchingStatusLabel } from "@/features/tailoring/stitching-status";
import type { CounterJob } from "./counter-barcode";
import type { CounterReceipt } from "./CounterBillReceipt";

const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: Error | null }>;

/**
 * Counter hand-over of customer stitching orders. Delivery needs a zero bill balance;
 * only the Owner can deliver with money still due, and must give a reason (audit-logged).
 */
export function CustomerStitchingDelivery({
  jobs,
  receipt,
  isOwner,
  canDeliver,
  disabled,
  onDelivered,
}: {
  jobs: CounterJob[];
  receipt: CounterReceipt | null;
  isOwner: boolean;
  canDeliver: boolean;
  disabled: boolean;
  onDelivered: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState<Record<string, string>>({});
  const balance = receipt ? reportInteger(receipt.balance_paise ?? "0") : null;
  const due = balance === null || balance > 0n;
  const deliver = useMutation({
    mutationFn: async (args: { job: string; reason?: string }) => {
      const { error } = await rpc("deliver_customer_tailoring", {
        p_request: crypto.randomUUID(),
        p_job: args.job,
        p_override_reason: args.reason?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      toast.success("Order delivered");
      onDelivered();
    },
    onError: (e) => toast.error(e.message),
  });
  if (!jobs.length) return null;
  return (
    <Panel
      title="Stitching delivery"
      description={
        balance === null
          ? "No bill is linked to this order."
          : due
            ? `Balance due ${reportMoney(String(balance))}. Collect it before handing over the garments.`
            : "Bill fully paid. Hand over the garments of orders that are Delivery Ready."
      }
    >
      <div className="space-y-3">
        {jobs.map((job) => {
          const ready = job.status === "ready";
          return (
            <div key={job.id} className="space-y-2 rounded-xl border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <strong>{job.garment}</strong>
                  <p className="break-all font-mono text-xs">{job.scan_code ?? job.code}</p>
                </div>
                <StatusBadge status={job.status} label={stitchingStatusLabel(job.status)} />
              </div>
              {!!job.garments?.length && (
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {job.garments.map((g) => (
                    <li
                      key={g.line_no}
                      className="flex flex-wrap justify-between gap-2 rounded bg-muted/40 px-2 py-1"
                    >
                      <span>
                        #{g.line_no} · Size {g.size}
                        {g.notes ? ` · ${g.notes}` : ""}
                      </span>
                      <span className="font-mono text-xs">
                        {g.barcode ?? "Label not printed"}
                        {g.sp_paise ? ` · ${reportMoney(g.sp_paise)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {ready && canDeliver && !due && (
                <Button
                  disabled={disabled || deliver.isPending}
                  onClick={() => deliver.mutate({ job: job.id })}
                >
                  Deliver garments
                </Button>
              )}
              {ready && canDeliver && due && !isOwner && (
                <p className="text-sm text-muted-foreground">
                  Collect the balance first. Only the Owner can deliver with money due.
                </p>
              )}
              {ready && due && isOwner && (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-56 flex-1 text-sm">
                    Reason for delivering with money due
                    <Input
                      aria-label={`Reason for unpaid delivery of ${job.scan_code ?? job.code}`}
                      maxLength={200}
                      value={reason[job.id] ?? ""}
                      onChange={(e) => setReason({ ...reason, [job.id]: e.target.value })}
                      placeholder="For example: regular customer, pays on Friday"
                    />
                  </label>
                  <Button
                    variant="outline"
                    disabled={
                      disabled || deliver.isPending || (reason[job.id] ?? "").trim().length < 3
                    }
                    onClick={() => deliver.mutate({ job: job.id, reason: reason[job.id] })}
                  >
                    Deliver anyway (Owner)
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
