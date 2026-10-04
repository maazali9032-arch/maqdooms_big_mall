import { WorkflowTabs } from "@/shared/components/workflow-tabs";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  lineValue,
  useActiveTailors,
  useAssignTailor,
  useCreateJob,
  useMaterials,
  useTailoringJobs,
  useUpdateJobStatus,
} from "@/features/tailoring";
import { useSession } from "@/app/providers/session";
import { CustomerTailoring } from "@/features/tailoring/CustomerTailoring";
import { ProductionCosting } from "@/features/tailoring/ProductionCosting";
import { OwnerProduction } from "@/features/tailoring/OwnerProduction";
import { FinishedProductInventory } from "@/features/inventory/FinishedProductInventory";
import { FinishedProducts } from "@/features/tailoring/FinishedProducts";
import { MaterialIssues } from "@/features/tailoring/MaterialIssues";
import { PageHeader, Panel, StatusBadge, EmptyState, StatCard } from "@/shared/components/page";
import { formatMetres, formatMoney } from "@/shared/utils/units";
import { formatDateTime } from "@/shared/utils/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/tailoring")({
  head: () => ({
    meta: [
      { title: "Tailoring — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content: "Tailoring jobs, issued materials and consumption traceability.",
      },
      { property: "og:title", content: "Tailoring — Maqdoom's Big Mall ERP" },
      {
        property: "og:description",
        content: "Tailoring jobs, issued materials and consumption traceability.",
      },
    ],
  }),
  component: TailoringPage,
});

function LegacyTailoringPage() {
  const { can, isOwner } = useSession();
  const jobs = useTailoringJobs();
  const materials = useMaterials();
  const tailors = useActiveTailors(isOwner);
  const createJob = useCreateJob();
  const assignTailor = useAssignTailor();
  const updateStatus = useUpdateJobStatus();
  const [garment, setGarment] = useState("");
  const [tailorId, setTailorId] = useState("");
  const [notes, setNotes] = useState("");
  const showCost = can("tailoring.view_costs") || can("inventory.view_cost");

  async function submitJob(e: React.FormEvent) {
    e.preventDefault();
    if (!garment.trim() || !tailorId) {
      toast.error("Enter a garment and select an active Tailor");
      return;
    }
    try {
      await createJob.mutateAsync({ garment, tailor_id: tailorId, notes });
      setGarment("");
      setTailorId("");
      setNotes("");
      toast.success("Tailoring job created and assigned");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create tailoring job");
    }
  }

  async function changeAssignment(jobId: string, nextTailorId: string) {
    try {
      await assignTailor.mutateAsync({ jobId, tailorId: nextTailorId });
      toast.success("Tailoring job reassigned");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not assign Tailor");
    }
  }

  async function changeStatus(jobId: string, status: string) {
    try {
      await updateStatus.mutateAsync({ id: jobId, status });
      toast.success("Tailoring status updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update status");
    }
  }

  const totals = (jobs.data ?? []).reduce(
    (acc, job) => {
      for (const line of job.tailoring_job_lines ?? []) {
        const v = lineValue(line);
        acc.cost += v.cost;
        acc.selling += v.selling;
      }
      return acc;
    },
    { cost: 0, selling: 0 },
  );

  return (
    <>
      <PageHeader
        title="Tailoring"
        description="Customer Tailoring jobs, assigned work, orders and material traceability."
      />

      {isOwner ? (
        <Panel
          title="Create legacy tailoring job"
          description="Assign the job to an active staff account with the Tailor role."
        >
          <form className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={submitJob}>
            <div className="space-y-1.5">
              <Label htmlFor="job-garment">Garment</Label>
              <Input
                id="job-garment"
                value={garment}
                onChange={(e) => setGarment(e.target.value)}
                placeholder="e.g. Two-piece suit"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Assigned Tailor</Label>
              <Select value={tailorId} onValueChange={setTailorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select active Tailor" />
                </SelectTrigger>
                <SelectContent>
                  {(tailors.data ?? []).map((tailor) => (
                    <SelectItem key={tailor.id} value={tailor.id}>
                      {tailor.full_name}
                      {tailor.email ? ` · ${tailor.email}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-notes">Notes (optional)</Label>
              <Input
                id="job-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Measurements or instructions"
              />
            </div>
            <Button
              type="submit"
              className="self-end"
              disabled={
                createJob.isPending ||
                !garment.trim() ||
                !tailorId ||
                (tailors.data ?? []).length === 0
              }
            >
              Create job
            </Button>
          </form>
          {!tailors.isLoading && (tailors.data ?? []).length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed border-border bg-surface/50 px-3 py-2 text-xs text-muted-foreground">
              No active Tailor accounts are available. Assign the Tailor role in Manage Access
              first.
            </p>
          ) : null}
        </Panel>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Legacy jobs" value={(jobs.data ?? []).length} />
        <StatCard
          label="Legacy active jobs"
          value={
            (jobs.data ?? []).filter((j) => j.status === "open" || j.status === "in_progress")
              .length
          }
        />
        {showCost ? (
          <StatCard label="Legacy fabric cost consumed" value={formatMoney(totals.cost)} />
        ) : null}
        {showCost ? (
          <StatCard label="Legacy selling value consumed" value={formatMoney(totals.selling)} />
        ) : null}
      </div>

      <h2 className="font-semibold">Legacy tailoring jobs</h2>
      <div className="space-y-4">
        {(jobs.data ?? []).length === 0 ? (
          <Panel>
            <EmptyState
              title={isOwner ? "No tailoring jobs" : "No jobs assigned to you"}
              description={
                isOwner
                  ? "Create and assign a job above before issuing fabric from the counter."
                  : "Ask the Owner to create a job and assign it to your Tailor account."
              }
            />
          </Panel>
        ) : (
          (jobs.data ?? []).map((job) => {
            const lines = job.tailoring_job_lines ?? [];
            const assignedProfile = job.tailor as {
              full_name?: string;
              email?: string | null;
            } | null;
            const assignedLabel = assignedProfile
              ? `${assignedProfile.full_name ?? job.tailor_name ?? "Tailor"}${assignedProfile.email ? ` · ${assignedProfile.email}` : ""}`
              : job.tailor_name
                ? `${job.tailor_name} · legacy/unlinked assignment`
                : "Unassigned";
            const jobTotals = lines.reduce(
              (acc, l) => {
                const v = lineValue(l);
                return { cost: acc.cost + v.cost, selling: acc.selling + v.selling };
              },
              { cost: 0, selling: 0 },
            );
            return (
              <Panel
                key={job.id}
                title={`${job.code} · ${job.garment}`}
                description={`${assignedLabel} · ${(job.customers as { name?: string | null } | null)?.name ?? "Shop stock"} · ${formatDateTime(job.created_at)}`}
                actions={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <StatusBadge status={job.status} />
                    {isOwner ? (
                      <Select
                        value={job.tailor_id ?? ""}
                        onValueChange={(nextTailorId) =>
                          void changeAssignment(job.id, nextTailorId)
                        }
                        disabled={assignTailor.isPending || (tailors.data ?? []).length === 0}
                      >
                        <SelectTrigger className="h-9 w-60">
                          <SelectValue placeholder="Assign active Tailor" />
                        </SelectTrigger>
                        <SelectContent>
                          {(tailors.data ?? []).map((tailor) => (
                            <SelectItem key={tailor.id} value={tailor.id}>
                              {tailor.full_name}
                              {tailor.email ? ` · ${tailor.email}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    <Select
                      value={job.status}
                      onValueChange={(status) => void changeStatus(job.id, status)}
                      disabled={updateStatus.isPending}
                    >
                      <SelectTrigger className="h-9 w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["open", "in_progress", "ready", "delivered", "cancelled"].map((s) => (
                          <SelectItem key={s} value={s}>
                            {s.replace("_", " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                }
                bodyClassName="p-0"
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left">
                    <thead className="border-b border-border bg-surface">
                      <tr className="label-eyebrow">
                        <th className="px-3 py-2 font-semibold">Material</th>
                        <th className="px-3 py-2 font-semibold">Category</th>
                        <th className="px-3 py-2 text-right font-semibold">Quantity</th>
                        {showCost ? (
                          <th className="px-3 py-2 text-right font-semibold">Cost</th>
                        ) : null}
                        {showCost ? (
                          <th className="px-3 py-2 text-right font-semibold">Selling value</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => {
                        const v = lineValue(l);
                        const thaanBarcode = (l.thaans as { barcode?: string } | null)?.barcode;
                        const material = (l.materials as { name?: string; unit?: string } | null)
                          ?.name;
                        return (
                          <tr key={l.id} className="border-b border-border last:border-0">
                            <td className="numeric px-3 py-2 text-xs">
                              {thaanBarcode ?? material ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-sm capitalize">{l.category}</td>
                            <td className="numeric px-3 py-2 text-right text-sm">
                              {l.length_mm !== null ? formatMetres(l.length_mm) : `${l.qty ?? 0}`}
                            </td>
                            {showCost ? (
                              <td className="numeric px-3 py-2 text-right text-sm">
                                {formatMoney(v.cost)}
                              </td>
                            ) : null}
                            {showCost ? (
                              <td className="numeric px-3 py-2 text-right text-sm">
                                {formatMoney(v.selling)}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                      <tr className="bg-surface">
                        <td className="px-3 py-2 text-xs font-semibold" colSpan={showCost ? 3 : 2}>
                          Job total
                        </td>
                        {showCost ? (
                          <td className="numeric px-3 py-2 text-right text-sm font-semibold">
                            {formatMoney(jobTotals.cost)}
                          </td>
                        ) : null}
                        {showCost ? (
                          <td className="numeric px-3 py-2 text-right text-sm font-semibold">
                            {formatMoney(jobTotals.selling)}
                          </td>
                        ) : null}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Panel>
            );
          })
        )}
      </div>

      <Panel title="Non-fabric materials" bodyClassName="p-0">
        <div className="divide-y divide-border">
          {(materials.data ?? []).map((m) => (
            <div key={m.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>{m.name}</span>
              <span className="numeric text-muted-foreground">
                {m.qty_on_hand} {m.unit}
                {showCost ? ` · ${formatMoney(m.cost_paise)}` : ""}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

function TailoringPage() {
  const { isOwner } = useSession();
  return (
    <>
      <PageHeader
        title="Tailoring & production"
        description="Customer Tailoring and Owner Production remain separate workflows."
      />
      <WorkflowTabs
        items={[
          { id: "customer", label: "Customer Tailoring", content: <CustomerTailoring /> },
          { id: "production", label: "Owner Production", content: <OwnerProduction /> },
          ...(isOwner
            ? [{ id: "cost", label: "Production Costing", content: <ProductionCosting /> }]
            : []),
          { id: "products", label: "Finished Products", content: <FinishedProducts /> },
          ...(isOwner
            ? [
                {
                  id: "inventory",
                  label: "Product inventory",
                  content: <FinishedProductInventory />,
                },
              ]
            : []),
          { id: "issues", label: "Material Issues", content: <MaterialIssues /> },
          { id: "legacy", label: "Legacy records", content: <LegacyTailoringPage /> },
        ]}
      />
    </>
  );
}
