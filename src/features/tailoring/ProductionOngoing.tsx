import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { Button } from "@/components/ui/button";
import { ProductionDocument, type ProductionRecord } from "./ProductionDocument";
import { definiteDatabaseRejection } from "@/features/inventory/consumable-input";
type Progress = {
  p_request: string;
  p_job: string;
  p_expected_status: string;
  p_status: string;
  p_reason: string;
};
export function ProductionOngoing() {
  const { can, isOwner, roles } = useSession();
  const allowed = isOwner || can("production.view") || roles.includes("tailor");
  const mayProgress =
    isOwner ||
    can("production.progress") ||
    (roles.includes("tailor") && can("tailoring.manage_jobs"));
  const qc = useQueryClient();
  const [selected, setSelected] = useState(""),
    [pending, setPending] = useState<Progress | null>(null);
  const query = useQuery({
    queryKey: ["owner-production", "history"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ongoing_production_work");
      if (error) throw error;
      return data as unknown as ProductionRecord[];
    },
  });
  const progress = useMutation({
    mutationFn: async (args: Progress) => {
      setPending(args);
      const { error } = await supabase.rpc("progress_owner_production", args);
      if (error) throw error;
    },
    onSuccess: () => {
      setPending(null);
      void qc.invalidateQueries();
      toast.success("Production status saved");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPending(null);
      toast.error(e.message);
    },
  });
  if (!allowed) return <p>Production work access required.</p>;
  const rows = (query.data ?? []).filter((j) => ["open", "in_progress"].includes(j.status));
  return (
    <div className="space-y-4">
      <Panel
        title="Ongoing production"
        description="Issued jobs that are not finished yet. All pieces return to Workshop together."
      >
        <QueryState
          loading={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
        />
        <div className="space-y-2">
          {rows.map((j) => (
            <div
              key={j.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 text-sm">
                <strong>
                  {j.product} · {j.quantity} pieces
                </strong>
                <p className="break-all font-mono text-xs">{j.code}</p>
                <p className="text-xs">
                  {j.tailors?.map((t) => t.name).join(", ")} · {j.status.replace("_", " ")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setSelected(j.id)}>
                  Details / barcode
                </Button>
                {mayProgress && (
                  <>
                    <Button
                      variant="outline"
                      disabled={!!pending || progress.isPending || j.status !== "open"}
                      onClick={() =>
                        progress.mutate({
                          p_request: crypto.randomUUID(),
                          p_job: j.id,
                          p_expected_status: j.status,
                          p_status: "in_progress",
                          p_reason: "Production work started",
                        })
                      }
                    >
                      Start
                    </Button>
                    <Button
                      disabled={!!pending || progress.isPending || j.status !== "in_progress"}
                      onClick={() =>
                        progress.mutate({
                          p_request: crypto.randomUUID(),
                          p_job: j.id,
                          p_expected_status: j.status,
                          p_status: "completed",
                          p_reason: "All pieces finished; send complete batch to Workshop",
                        })
                      }
                    >
                      Mark all finished
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        {!query.isPending && !query.error && !rows.length && (
          <p className="text-sm">No ongoing production.</p>
        )}
        {pending && !progress.isPending && (
          <Button className="mt-3" onClick={() => progress.mutate(pending)}>
            Retry unchanged status update
          </Button>
        )}
      </Panel>
      {selected && <ProductionDocument code={selected} />}
    </div>
  );
}
