import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronDown, ChevronRight, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, Panel } from "@/shared/components/page";
import { formatMetres } from "@/shared/utils/units";

type FloorThaan = {
  inventory_item_id: string;
  thaan_id: string;
  barcode: string;
  fabric: string;
  batch: string;
  colour: string | null;
  rack: string | null;
  available_mm: string;
  created_at?: string;
};

type Floor = {
  id: string;
  code: string;
  name: string;
  available_mm: string;
  thaans: number;
  items: FloorThaan[];
};

/** A Showroom-only tree: each visible branch is an actual sales floor. */
export function ShowroomFloorStock() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
        {floors.data?.map((floor) => {
          const open = expanded.has(floor.id);
          return (
            <section key={floor.id} className="overflow-hidden rounded-xl border bg-card">
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-3 bg-primary/5 p-4 text-left transition-colors hover:bg-primary/10"
                aria-expanded={open}
                aria-controls={`floor-${floor.id}`}
                onClick={() => toggle(floor.id)}
              >
                {open ? (
                  <ChevronDown className="size-4 shrink-0 text-primary" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-primary" />
                )}
                <Building2 className="size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold">{floor.name}</h3>
                  <p className="font-mono text-xs text-muted-foreground">{floor.code}</p>
                </div>
                <strong>{formatMetres(Number(floor.available_mm))}</strong>
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 border-t px-5 py-3 text-left text-sm text-muted-foreground hover:bg-muted/40"
                aria-expanded={open}
                onClick={() => toggle(floor.id)}
              >
                <Store className="size-4" />
                <span>
                  {floor.thaans} active Thaan{floor.thaans === 1 ? "" : "s"} with stock on this
                  floor
                </span>
              </button>
              {open && (
                <div id={`floor-${floor.id}`} className="border-t bg-background p-3 sm:p-4">
                  {!floor.items?.length ? (
                    <p className="text-sm text-muted-foreground">No active Thaans on this floor.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[660px] text-left text-sm">
                        <thead className="bg-muted/60 text-xs text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 font-medium">Thaan / barcode</th>
                            <th className="px-3 py-2 font-medium">Fabric</th>
                            <th className="px-3 py-2 font-medium">Batch</th>
                            <th className="px-3 py-2 font-medium">Colour</th>
                            <th className="px-3 py-2 text-right font-medium">Available</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {[...floor.items]
                            .sort((a, b) => {
                              const time =
                                new Date(b.created_at ?? 0).getTime() -
                                new Date(a.created_at ?? 0).getTime();
                              return time || b.barcode.localeCompare(a.barcode);
                            })
                            .map((item) => (
                              <tr key={`${floor.id}-${item.inventory_item_id}`}>
                                <td className="px-3 py-2 font-mono text-xs">{item.barcode}</td>
                                <td className="px-3 py-2 font-medium">{item.fabric}</td>
                                <td className="px-3 py-2">{item.batch}</td>
                                <td className="px-3 py-2">{item.colour || "Not recorded"}</td>
                                <td className="px-3 py-2 text-right font-medium">
                                  {formatMetres(Number(item.available_mm))}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </Panel>
  );
}
