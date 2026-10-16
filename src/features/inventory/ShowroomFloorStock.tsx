import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, Panel } from "@/shared/components/page";
import { formatMetres } from "@/shared/utils/units";

type Floor = {
  id: string;
  code: string;
  name: string;
  available_mm: string;
  thaans: number;
};

/** A Showroom-only tree: each visible branch is an actual sales floor. */
export function ShowroomFloorStock() {
  const floors = useQuery({
    queryKey: ["showroom-floor-distribution"],
    queryFn: async () => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: Error | null }>
      )("showroom_floor_distribution", {});
      if (error) throw error;
      return (data ?? []) as Floor[];
    },
  });
  return (
    <Panel
      title="Showroom stock by floor"
      description="Only stock currently on showroom floors. Workshop and godown stock are excluded."
    >
      {floors.isPending ? <p>Loading Showroom floors…</p> : null}
      {floors.error ? (
        <p role="alert" className="text-destructive">
          {floors.error.message}
        </p>
      ) : null}
      {!floors.isPending && !floors.error && !floors.data?.length ? (
        <EmptyState
          title="No active Showroom floors"
          description="Create floors in Locations & Floors, then transfer stock to them."
        />
      ) : null}
      <div className="space-y-3" aria-label="Showroom floor stock tree">
        {floors.data?.map((floor) => (
          <section key={floor.id} className="overflow-hidden rounded-xl border bg-card">
            <header className="flex flex-wrap items-center gap-3 bg-primary/5 p-4">
              <Building2 className="size-5 text-primary" />
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold">{floor.name}</h3>
                <p className="font-mono text-xs text-muted-foreground">{floor.code}</p>
              </div>
              <strong>{formatMetres(Number(floor.available_mm))}</strong>
            </header>
            <div className="flex items-center gap-2 px-5 py-3 text-sm text-muted-foreground">
              <ChevronRight className="size-4 text-primary" />
              <Store className="size-4" />
              <span>
                {floor.thaans} active Thaan{floor.thaans === 1 ? "" : "s"} with stock on this floor
              </span>
            </div>
          </section>
        ))}
      </div>
    </Panel>
  );
}
