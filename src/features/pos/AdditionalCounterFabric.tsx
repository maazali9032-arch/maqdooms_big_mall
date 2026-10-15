import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SourceLocation } from "@/shared/components/source-picker";
import { quantityInput } from "@/features/inventory/ledger-quantity";
import { definiteDatabaseRejection } from "@/features/inventory/consumable-input";
import { reportQuantity } from "@/features/reports/report-value";
import { ProductionDocument } from "@/features/tailoring/ProductionDocument";
import type { ScanRecord } from "./counter-workspace-model";
import type { CounterJob, CounterWork } from "./counter-barcode";

type Issue = {
  id: string;
  job: CounterJob;
  kind: CounterWork["kind"];
  barcode: string;
  quantity: number;
  source: string;
};
export function AdditionalCounterFabric({
  source,
  work,
  scanned,
  onScannedChange,
  onLocked,
  onIssued,
  disabled,
  canIssue,
}: {
  source: SourceLocation;
  work: CounterWork;
  scanned: ScanRecord | null;
  onScannedChange: (scan: ScanRecord | null) => void;
  onLocked: (locked: boolean) => void;
  onIssued: () => void;
  disabled: boolean;
  canIssue: boolean;
}) {
  const qc = useQueryClient();
  const [job, setJob] = useState(work.jobs.length === 1 ? work.jobs[0]!.id : "");
  const [metres, setMetres] = useState("");
  const [pending, setPending] = useState<Issue | null>(null);
  const issue = useMutation({
    mutationFn: async (args: Issue) => {
      onLocked(true);
      setPending(args);
      const response =
        args.kind === "production"
          ? await supabase.rpc("issue_additional_production_fabric", {
              p_request: args.id,
              p_code: args.job.code,
              p_barcode: args.barcode,
              p_source: args.source,
              p_quantity_mm: args.quantity,
              p_reason: "Additional production fabric requested at Counter",
            })
          : await supabase.rpc("issue_additional_customer_fabric", {
              p_request: args.id,
              p_job: args.job.id,
              p_source: args.source,
              p_barcode: args.barcode,
              p_quantity: args.quantity,
            });
      if (response.error) throw response.error;
    },
    onSuccess: () => {
      setPending(null);
      onScannedChange(null);
      setMetres("");
      void qc.invalidateQueries();
      onIssued();
      toast.success(
        work.kind === "customer"
          ? "Extra fabric issued; the original customer bill is unchanged"
          : "Extra fabric issued against the same Production ID",
      );
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPending(null);
      toast.error(e.message);
    },
  });
  const frozen = issue.isPending || !!pending;
  useEffect(() => onLocked(frozen), [frozen, onLocked]);
  useEffect(() => setMetres(""), [scanned]);
  const selected = work.jobs.find((j) => j.id === job);
  const open = !!selected && ["open", "in_progress"].includes(selected.status);
  const available = Number(
    scanned?.cuts?.flatMap((c) => c.locations).find((l) => l.id === source.id)?.quantity_mm ?? 0,
  );
  function submit() {
    if (issue.isPending || disabled) return;
    try {
      if (pending) {
        issue.mutate(pending);
        return;
      }
      if (!canIssue) throw new Error("Fabric issue permission required");
      if (!open || !selected || !scanned) throw new Error("Select an open job and scan its fabric");
      const quantity = quantityInput(metres, "mm");
      if (quantity > available) throw new Error("Requested metres exceed this floor’s stock");
      issue.mutate({
        id: crypto.randomUUID(),
        job: selected,
        kind: work.kind,
        barcode: scanned.barcode,
        quantity,
        source: source.id,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check the issue details");
    }
  }
  return (
    <Panel
      title={
        work.kind === "customer" ? "Customer tailoring · extra fabric" : "Production · extra fabric"
      }
      description={`Loaded ${work.code}. Scan a Thaan in the field above, then enter the metres to issue from ${source.name}.`}
    >
      <fieldset className="space-y-3" disabled={frozen || disabled}>
        {work.jobs.length > 1 && (
          <label className="block text-sm">
            Tailoring job receiving this fabric
            <select
              aria-label="Existing customer job"
              className="mt-1 min-h-11 w-full rounded border bg-background p-2"
              value={job}
              onChange={(e) => {
                setJob(e.target.value);
                onScannedChange(null);
              }}
            >
              <option value="">Select the customer tailoring job</option>
              {work.jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.garment} · {j.code} · {j.status}
                </option>
              ))}
            </select>
          </label>
        )}
        {selected &&
          (work.kind === "production" ? (
            <ProductionDocument code={selected.code} />
          ) : (
            <div className="space-y-1 rounded-lg border p-3 text-sm">
              <strong>{selected.garment}</strong>
              <p className="break-all font-mono text-xs">
                {selected.code} · {selected.status}
              </p>
              {selected.delivery_date && <p>Delivery: {selected.delivery_date}</p>}
              {(selected.factory || selected.tailor) && (
                <p>
                  {selected.factory} · {selected.tailor}
                </p>
              )}
              {!!selected.fabrics?.length && (
                <details>
                  <summary>Recorded fabric issues</summary>
                  {selected.fabrics.map((f, index) => (
                    <p key={index} className="mt-1 break-words">
                      {f.name} · {f.barcode} · {reportQuantity(String(f.quantity_mm), "mm")} ·{" "}
                      {f.source}
                    </p>
                  ))}
                </details>
              )}
            </div>
          ))}
        {selected && !open && (
          <p role="status" className="text-sm">
            This job is {selected.status}; extra fabric cannot be issued.
          </p>
        )}
        {!canIssue && (
          <p className="text-sm">Your account does not have fabric issue permission.</p>
        )}
        {scanned && (
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <div className="text-sm">
              <strong>{scanned.name}</strong>
              <p className="break-all font-mono text-xs">{scanned.barcode}</p>
              <p>
                Available from {source.name}: {reportQuantity(String(available), "mm")}
              </p>
            </div>
            <label className="text-sm">
              Extra metres
              <Input
                aria-label="Extra metres"
                value={metres}
                onChange={(e) => setMetres(e.target.value)}
                inputMode="decimal"
              />
            </label>
          </div>
        )}
        {scanned && (
          <Button disabled={!open || !canIssue || issue.isPending} onClick={submit}>
            Issue extra fabric
          </Button>
        )}
      </fieldset>
      {pending && !issue.isPending && (
        <div className="mt-3 space-y-2">
          <p role="alert" className="text-sm">
            The result is uncertain. Retry the same issue before changing the job or floor.
          </p>
          <Button onClick={submit}>Retry unchanged issue</Button>
        </div>
      )}
    </Panel>
  );
}
