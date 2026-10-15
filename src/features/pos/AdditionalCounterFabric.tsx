import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/shared/components/page";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SourceLocation } from "@/shared/components/source-picker";
import { quantityInput } from "@/features/inventory/ledger-quantity";
import { definiteDatabaseRejection } from "@/features/inventory/consumable-input";
import { reportQuantity } from "@/features/reports/report-value";
import type { ScanRecord } from "./counter-workspace-model";
type Job = { id: string; code: string; garment?: string; product?: string; status: string };
type Issue = {
  id: string;
  job: Job;
  kind: string;
  barcode: string;
  quantity: number;
  source: string;
};
export function AdditionalCounterFabric({ source }: { source: SourceLocation }) {
  const qc = useQueryClient();
  const [code, setCode] = useState(""),
    [jobs, setJobs] = useState<Job[]>([]),
    [kind, setKind] = useState(""),
    [job, setJob] = useState("");
  const [barcode, setBarcode] = useState(""),
    [scanned, setScanned] = useState<ScanRecord | null>(null),
    [metres, setMetres] = useState(""),
    [pending, setPending] = useState<Issue | null>(null);
  const load = useMutation({
    mutationFn: async (value: string) => {
      const customer = await supabase.rpc("customer_tailoring_work", { p_code: value });
      if (customer.error) throw customer.error;
      const list = customer.data as unknown as Job[];
      if (list.length) return { kind: "customer", jobs: list };
      const production = await supabase.rpc("production_job_document", { p_code: value });
      if (production.error) throw production.error;
      if (!production.data) throw new Error("No customer bill/job or Production ID matches");
      return { kind: "production", jobs: [production.data as unknown as Job] };
    },
    onSuccess: (data) => {
      setKind(data.kind);
      setJobs(data.jobs);
      setJob(data.jobs.length === 1 ? data.jobs[0]!.id : "");
      setScanned(null);
    },
    onError: (e) => {
      setJobs([]);
      setJob("");
      toast.error(e.message);
    },
  });
  const scan = useMutation({
    mutationFn: async (value: string) => {
      const { data, error } = await supabase.rpc("counter_scan_barcode", {
        p_barcode: value,
        p_source: source.id,
      });
      if (error) throw error;
      const row = data as unknown as ScanRecord;
      if (!row || row.kind !== "fabric") throw new Error("Scan an available fabric Thaan");
      const available = row.cuts?.filter(
        (c) => Number(c.locations.find((l) => l.id === source.id)?.quantity_mm ?? 0) > 0,
      );
      if (available?.length !== 1)
        throw new Error("Scan the physical Thaan’s unique barcode on this floor");
      return row;
    },
    onSuccess: setScanned,
    onError: (e) => toast.error(e.message),
  });
  const issue = useMutation({
    mutationFn: async (args: Issue) => {
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
      setBarcode("");
      setScanned(null);
      setMetres("");
      void qc.invalidateQueries();
      toast.success("Extra fabric issued against the same job; customer total unchanged");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPending(null);
      toast.error(e.message);
    },
  });
  const frozen = issue.isPending || !!pending;
  const selected = jobs.find((j) => j.id === job);
  function submit() {
    try {
      if (pending) {
        issue.mutate(pending);
        return;
      }
      if (!selected || !scanned) throw new Error("Load the existing job and scan its fabric");
      const quantity = quantityInput(metres, "mm");
      const available = Number(
        scanned.cuts?.flatMap((c) => c.locations).find((l) => l.id === source.id)?.quantity_mm ?? 0,
      );
      if (quantity > available) throw new Error("Requested metres exceed this floor’s stock");
      issue.mutate({
        id: crypto.randomUUID(),
        job: selected,
        kind,
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
      title="Extra fabric for an existing ID"
      description={`Issue from ${source.name}. Scan the customer bill/job or Production ID; its material cost updates without changing the original customer total.`}
    >
      <fieldset className="space-y-3" disabled={frozen}>
        <BarcodeEntry
          label="Existing bill or production ID"
          value={code}
          onChange={(v) => {
            setCode(v);
            setJobs([]);
            setJob("");
            setScanned(null);
          }}
          onScan={(v) => load.mutate(v)}
          action="Load ID"
          disabled={load.isPending || frozen}
        />
        {jobs.length > 1 && (
          <select
            aria-label="Existing customer job"
            className="min-h-11 w-full rounded border bg-background p-2"
            value={job}
            onChange={(e) => setJob(e.target.value)}
          >
            <option value="">Select the customer tailoring job</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.garment} · {j.code}
              </option>
            ))}
          </select>
        )}
        {selected && (
          <>
            <div className="rounded-lg border p-3 text-sm">
              <strong>{selected.garment ?? selected.product}</strong>
              <p className="break-all font-mono text-xs">
                {selected.code} · {selected.status}
              </p>
            </div>
            <BarcodeEntry
              label="Extra fabric barcode"
              value={barcode}
              onChange={(v) => {
                setBarcode(v);
                setScanned(null);
              }}
              onScan={(v) => scan.mutate(v)}
              disabled={scan.isPending || frozen}
            />
          </>
        )}
        {scanned && (
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <p className="text-sm">
              {scanned.name}
              <br />
              Available{" "}
              {reportQuantity(
                String(
                  scanned.cuts?.flatMap((c) => c.locations).find((l) => l.id === source.id)
                    ?.quantity_mm ?? 0,
                ),
                "mm",
              )}
            </p>
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
          <Button disabled={issue.isPending} onClick={submit}>
            Issue extra fabric
          </Button>
        )}
      </fieldset>
      {pending && !issue.isPending && (
        <Button className="mt-3" onClick={submit}>
          Retry unchanged issue
        </Button>
      )}
    </Panel>
  );
}
