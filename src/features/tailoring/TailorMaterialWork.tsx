import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, StatCard } from "@/shared/components/page";
import { stitchingStatusLabel } from "./stitching-status";

type Work = {
  id: string;
  code: string;
  kind: "production" | "customer_tailoring";
  status: string;
  title: string;
  staff: { assignment_id: string; profile_id: string; name: string }[];
  units: { id: string; barcode: string; material: string; remaining: number; unit: string }[];
};
type Line = { key: string; barcode: string; quantity: string };
type StaffSummary = {
  month_count: number;
  work: {
    submitted_at: string;
    job_code: string;
    kind: string;
    materials: { barcode: string; material: string; quantity: number; unit: string }[];
  }[];
};
const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: Error | null }>;
export function TailorMaterialWork() {
  const { roles } = useSession();
  const staffOnly = roles.includes("tailor_staff") && !roles.includes("tailor");
  if (staffOnly) return <TailorStaffSummary />;
  return <MasterTailorConsumption />;
}
function MasterTailorConsumption() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState("");
  const [staff, setStaff] = useState("");
  const [noMaterial, setNoMaterial] = useState(false);
  const [lines, setLines] = useState<Line[]>([
    { key: crypto.randomUUID(), barcode: "", quantity: "" },
  ]);
  const job = useQuery({
    queryKey: ["tailor-material-work", lookup],
    enabled: !!lookup,
    queryFn: async () => {
      const { data, error } = await rpc("tailor_material_scan", { p_code: lookup });
      if (error) throw error;
      return data as Work;
    },
  });
  const submit = useMutation({
    mutationFn: async () => {
      if (!job.data || !staff)
        throw new Error("Scan a job and choose the Tailor Staff who completed it");
      // Material is optional: tick "No material used" to submit without any M unit.
      const p_lines = noMaterial
        ? []
        : lines
            .filter((line) => line.barcode.trim() || line.quantity.trim())
            .map((line) => ({
              barcode: line.barcode.trim().toUpperCase(),
              quantity: Number(line.quantity),
            }));
      if (!noMaterial && !p_lines.length)
        throw new Error('Scan the M units used, or tick "No material was used for this job"');
      if (
        p_lines.some(
          (line) =>
            !/^M[0-9A-Z]{5}$/.test(line.barcode) ||
            !Number.isFinite(line.quantity) ||
            line.quantity <= 0,
        )
      )
        throw new Error("Scan each M unit and enter its exact positive consumption");
      const { error } = await rpc("submit_job_material_consumption", {
        p_request: crypto.randomUUID(),
        p_job_kind: job.data.kind,
        p_job: job.data.id,
        p_staff_assignment: staff,
        p_lines,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setLookup("");
      setCode("");
      setStaff("");
      setNoMaterial(false);
      setLines([{ key: crypto.randomUUID(), barcode: "", quantity: "" }]);
      void qc.invalidateQueries();
      toast.success(
        job.data?.kind === "customer_tailoring"
          ? "Submitted. The customer order is now Completed and can go to the godown."
          : "Job consumption submitted permanently",
      );
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Panel
      title="Record completed work"
      description="Scan the P production slip or J customer-stitching slip. Credit the Tailor Staff, then scan the exact M units consumed, or tick No material used."
    >
      <BarcodeEntry
        value={code}
        onChange={setCode}
        onScan={(value) => {
          setLookup(value);
          setStaff("");
        }}
        label="Production or customer-tailoring slip"
        placeholder="Scan P##### or J#####"
        disabled={submit.isPending}
      />
      {job.error && (
        <p className="mt-3" role="alert">
          {job.error.message}
        </p>
      )}
      {job.data && (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border p-3">
            <strong>
              {job.data.code} · {job.data.title}
            </strong>
            <p className="text-sm text-muted-foreground">
              {job.data.kind === "production" ? "Own production" : "Customer stitching"} ·{" "}
              {job.data.kind === "production"
                ? job.data.status
                : stitchingStatusLabel(job.data.status)}
            </p>
          </div>
          <label className="block text-sm">
            Tailor Staff
            <select
              className="mt-1 min-h-11 w-full rounded-md border bg-background px-3"
              value={staff}
              onChange={(e) => setStaff(e.target.value)}
            >
              <option value="">Choose Tailor Staff</option>
              {job.data.staff.map((row) => (
                <option key={row.assignment_id} value={row.assignment_id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={noMaterial}
              onChange={(e) => setNoMaterial(e.target.checked)}
            />
            No material was used for this job
          </label>
          <div className={noMaterial ? "hidden" : "space-y-2"}>
            <h3 className="font-semibold">Consumed material units</h3>
            {lines.map((line, index) => (
              <div
                key={line.key}
                className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_12rem_auto]"
              >
                <div>
                  <BarcodeEntry
                    value={line.barcode}
                    onChange={(value) =>
                      setLines((rows) =>
                        rows.map((row) =>
                          row.key === line.key ? { ...row, barcode: value } : row,
                        ),
                      )
                    }
                    onScan={(value) =>
                      setLines((rows) =>
                        rows.map((row) =>
                          row.key === line.key ? { ...row, barcode: value } : row,
                        ),
                      )
                    }
                    label={`Material unit ${index + 1}`}
                    placeholder="Scan M##### unit"
                    disabled={submit.isPending}
                    action="Use unit"
                  />
                </div>
                <label className="text-sm">
                  Quantity consumed
                  <Input
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(e) =>
                      setLines((rows) =>
                        rows.map((row) =>
                          row.key === line.key ? { ...row, quantity: e.target.value } : row,
                        ),
                      )
                    }
                  />
                </label>
                {lines.length > 1 && (
                  <Button
                    className="self-end"
                    variant="ghost"
                    onClick={() => setLines((rows) => rows.filter((row) => row.key !== line.key))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() =>
                setLines((rows) => [
                  ...rows,
                  { key: crypto.randomUUID(), barcode: "", quantity: "" },
                ])
              }
            >
              <Plus className="mr-2 size-4" />
              Add another material unit
            </Button>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 text-sm">
            After submission, this record cannot be edited. Any correction requires the Owner or a
            specifically authorized user.
          </div>
          <Button disabled={submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? "Submitting…" : "Submit completed work"}
          </Button>
        </div>
      )}
    </Panel>
  );
}
function TailorStaffSummary() {
  const query = useQuery({
    queryKey: ["tailor-staff-work"],
    queryFn: async () => {
      const { data, error } = await rpc("tailor_staff_work_summary", {});
      if (error) throw error;
      return data as StaffSummary;
    },
  });
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2">
        <StatCard label="Completed this month" value={query.data?.month_count ?? "—"} />
      </div>
      <Panel title="My credited work" description="Only work submitted under your name is shown.">
        {query.error && <p role="alert">{query.error.message}</p>}
        {!query.isPending && !query.data?.work.length && <p>No completed work credited yet.</p>}
        {query.data?.work.map((row) => (
          <div key={`${row.job_code}-${row.submitted_at}`} className="mb-2 rounded-lg border p-3">
            <strong>{row.job_code}</strong>
            <p className="text-sm text-muted-foreground">
              {row.kind.replace("_", " ")} · {new Date(row.submitted_at).toLocaleString()}
            </p>
            <p className="text-sm">
              {row.materials
                ?.map((item) => `${item.material}: ${item.quantity} ${item.unit}`)
                .join(" · ")}
            </p>
          </div>
        ))}
      </Panel>
    </div>
  );
}
