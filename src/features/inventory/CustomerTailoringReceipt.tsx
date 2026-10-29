import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Panel, StatusBadge } from "@/shared/components/page";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarcodeSticker } from "./BarcodeSticker";
import { printFabricLabel } from "./fabric-label";
import { fabricMoneyInput } from "./fabric-entry-input";
import { reportInteger, reportMoney } from "@/features/reports/report-value";
import { stitchingStatusLabel, type StitchingGarment } from "@/features/tailoring/stitching-status";
import type { ReceiptJob } from "./finished-receipt-lookup";

type Labels = {
  id: string;
  code: string;
  scan_code: string | null;
  garment: string;
  status: string;
  customer: string | null;
  bill_code: string | null;
  design: string | null;
  delivery_date: string | null;
  factory: string | null;
  tailor: string | null;
  work_recorded: boolean;
  labels_created: boolean;
  total_sp_paise: string | null;
  quoted_sp_paise: string | null;
  fabric_cp_paise: string;
  consumables_cp_paise: string;
  stitching_cp_paise: string | null;
  garments: StitchingGarment[];
};
const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: Error | null }>;

/** Money as paise, or null when the text is not a valid amount yet. */
function paise(text: string) {
  try {
    return text.trim() ? BigInt(fabricMoneyInput(text)) : null;
  } catch {
    return null;
  }
}

/**
 * Godown step for customer stitching: review the final CP, then print one C label per garment.
 * The first print creates the labels and marks the order Delivery Ready; reprints reuse them.
 */
export function CustomerTailoringReceipt({
  embedded = false,
  resolvedJobs,
  onBusyChange,
}: {
  embedded?: boolean;
  resolvedJobs?: ReceiptJob[];
  onBusyChange?: (busy: boolean) => void;
}) {
  const { isOwner, roles, can } = useSession();
  const allowed =
    isOwner ||
    (roles.includes("counter") && can("pos.issue_to_tailoring")) ||
    can("production.receive");
  const qc = useQueryClient();
  const sheet = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState("");
  const [jobId, setJobId] = useState(resolvedJobs?.length === 1 ? resolvedJobs[0]!.id : "");
  const [stitchingCost, setStitchingCost] = useState("");
  const [printNow, setPrintNow] = useState(false);
  const jobs = useQuery({
    queryKey: ["customer-tailoring", "workshop-receipt", lookup],
    enabled: allowed && !!lookup && !resolvedJobs,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customer_tailoring_work", { p_code: lookup });
      if (error) throw error;
      return (data ?? []) as unknown as ReceiptJob[];
    },
  });
  const jobRows = resolvedJobs ?? jobs.data;
  const labels = useQuery({
    queryKey: ["customer-tailoring", "labels", jobId],
    enabled: allowed && !!jobId,
    queryFn: async () => {
      const { data, error } = await rpc("customer_tailoring_labels", { p_job: jobId });
      if (error) throw error;
      return data as Labels;
    },
  });
  const order = labels.data;
  const generate = useMutation({
    mutationFn: async () => {
      const cp = paise(stitchingCost);
      if (cp === null) throw new Error("Enter the stitching CP for the whole order (0 if none)");
      const { data, error } = await rpc("generate_customer_tailoring_labels", {
        p_request: crypto.randomUUID(),
        p_job: jobId,
        p_stitching_cp_paise: Number(cp),
      });
      if (error) throw error;
      return data as Labels;
    },
    onSuccess: (result) => {
      qc.setQueryData(["customer-tailoring", "labels", jobId], result);
      void qc.invalidateQueries({ queryKey: ["customer-tailoring", "work"] });
      toast.success("Labels created. The order is Delivery Ready.");
      setPrintNow(true);
    },
    onError: (error) => toast.error(error.message),
  });
  useEffect(() => {
    onBusyChange?.(generate.isPending);
  }, [generate.isPending, onBusyChange]);
  // Open the print dialog once the new labels have rendered.
  useEffect(() => {
    if (!printNow || !order?.labels_created || !sheet.current) return;
    setPrintNow(false);
    printFabricLabel(sheet.current, "Customer garment labels");
  }, [printNow, order]);
  if (!allowed) return null;

  const count = order?.garments.length ?? 0;
  const stitchingPaise = order?.labels_created
    ? order.stitching_cp_paise === null
      ? null
      : reportInteger(order.stitching_cp_paise)
    : paise(stitchingCost);
  const totalCp =
    order && stitchingPaise !== null
      ? reportInteger(order.fabric_cp_paise) +
        reportInteger(order.consumables_cp_paise) +
        stitchingPaise
      : null;
  const content = (
    <div className="space-y-3">
      {!resolvedJobs && (
        <BarcodeEntry
          value={code}
          onChange={setCode}
          label="Customer bill or tailoring ID"
          placeholder="Scan bill or tailoring ID"
          disabled={generate.isPending}
          onScan={(value) => {
            setLookup(value);
            setJobId("");
          }}
        />
      )}
      {jobs.error ? <p role="alert">{jobs.error.message}</p> : null}
      {jobRows && !jobRows.length ? <p>No matching customer tailoring job.</p> : null}
      {!!jobRows && jobRows.length > 1 && (
        <select
          aria-label="Customer stitching order"
          className="w-full rounded-md border bg-background p-2"
          value={jobId}
          onChange={(event) => {
            setJobId(event.target.value);
            setStitchingCost("");
          }}
        >
          <option value="">Choose the stitching order</option>
          {jobRows.map((job) => (
            <option key={job.id} value={job.id}>
              {job.scan_code ?? job.code} · {job.garment} · {stitchingStatusLabel(job.status)}
            </option>
          ))}
        </select>
      )}
      {labels.error ? (
        <p role="alert" className="text-sm text-destructive">
          {labels.error.message}
        </p>
      ) : null}
      {labels.isPending && !!jobId && <p className="text-sm">Loading order…</p>}
      {order && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-muted/30 p-3 text-sm">
            <div className="min-w-0">
              <strong>
                {order.garment} · {count} {count === 1 ? "garment" : "garments"}
              </strong>
              <p className="break-all font-mono text-xs">
                {order.scan_code ?? order.code}
                {order.bill_code ? ` · Bill ${order.bill_code}` : ""}
              </p>
              <p>
                {order.customer || "Customer not recorded"}
                {order.design ? ` · ${order.design}` : ""}
                {order.factory ? ` · ${order.factory}` : ""}
                {order.tailor ? ` → ${order.tailor}` : ""}
              </p>
            </div>
            <StatusBadge status={order.status} label={stitchingStatusLabel(order.status)} />
          </div>

          {!order.labels_created && ["open", "in_progress"].includes(order.status) && (
            <p role="status" className="rounded-lg border border-warning/30 p-3 text-sm">
              Started. The Master Tailor must scan this order, record the Tailor Staff and
              consumables, and submit it before the godown can make it Delivery Ready.
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs">
                <tr>
                  <th className="p-2">#</th>
                  <th className="p-2">Size</th>
                  <th className="p-2">Notes</th>
                  <th className="p-2 text-right">SP</th>
                  <th className="p-2">Label</th>
                </tr>
              </thead>
              <tbody>
                {order.garments.map((g) => (
                  <tr key={g.line_no} className="border-t">
                    <td className="p-2">{g.line_no}</td>
                    <td className="p-2">{g.size}</td>
                    <td className="p-2">{g.notes || "—"}</td>
                    <td className="p-2 text-right">{g.sp_paise ? reportMoney(g.sp_paise) : "—"}</td>
                    <td className="p-2 font-mono text-xs">{g.barcode ?? "Not created"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm">
            Final order SP after the bill discount:{" "}
            <strong>
              {order.total_sp_paise ? reportMoney(order.total_sp_paise) : "Not recorded"}
            </strong>
            {count > 1 ? " · split equally across the garments" : ""}
            {order.quoted_sp_paise && order.quoted_sp_paise !== order.total_sp_paise
              ? ` · quoted at billing ${reportMoney(order.quoted_sp_paise)}`
              : ""}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Stitching CP for the whole order ₹
              <Input
                inputMode="decimal"
                aria-label="Stitching CP for the whole order"
                disabled={order.labels_created || generate.isPending}
                value={
                  order.labels_created
                    ? order.stitching_cp_paise
                      ? String(Number(order.stitching_cp_paise) / 100)
                      : ""
                    : stitchingCost
                }
                onChange={(event) => setStitchingCost(event.target.value)}
                placeholder="0 if none"
              />
            </label>
          </div>
          <p className="rounded-lg bg-muted/40 p-3 text-sm">
            Final CP: fabric {reportMoney(order.fabric_cp_paise)} + consumables{" "}
            {reportMoney(order.consumables_cp_paise)} + stitching{" "}
            {stitchingPaise === null ? "—" : reportMoney(String(stitchingPaise))} ={" "}
            <strong>{totalCp === null ? "—" : reportMoney(String(totalCp))}</strong>
            {totalCp !== null && count > 1 && (
              <> · {reportMoney(String(totalCp / BigInt(count)))} per garment</>
            )}
          </p>

          {!order.labels_created && order.status === "completed" && (
            <Button
              disabled={generate.isPending || paise(stitchingCost) === null}
              onClick={() => generate.mutate()}
            >
              {generate.isPending
                ? "Creating labels…"
                : `Create & print ${count} ${count === 1 ? "label" : "labels"} · mark Delivery Ready`}
            </Button>
          )}
          {order.labels_created && (
            <div className="space-y-2">
              <div ref={sheet} className="grid gap-2 sm:grid-cols-2">
                {order.garments
                  .filter((g) => g.barcode)
                  .map((g) => (
                    <BarcodeSticker
                      key={g.line_no}
                      barcode={g.barcode!}
                      name={order.garment}
                      description={`Size ${g.size}${order.customer ? ` · ${order.customer}` : ""}`}
                      detail={`Customer order ${order.scan_code ?? order.code}`}
                      price={g.sp_paise ? reportMoney(g.sp_paise) : ""}
                    />
                  ))}
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  sheet.current && printFabricLabel(sheet.current, "Customer garment labels")
                }
              >
                Reprint labels (same codes)
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
  if (embedded) return content;
  return (
    <Panel
      title="Customer stitching receipt"
      description="Scan the customer bill or tailoring ID when the stitched garments reach the godown. Labels belong to this customer only and are never shop stock."
    >
      {content}
    </Panel>
  );
}
