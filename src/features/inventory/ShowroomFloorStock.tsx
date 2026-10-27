import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronDown, ChevronRight, ListFilter, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, Panel } from "@/shared/components/page";
import { formatMetres } from "@/shared/utils/units";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    barcode: "",
    fabric: "",
    batch: "",
    colour: "",
    available: "",
  });
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

  function matchingItems(items: FloorThaan[]) {
    const term = search.trim().toLowerCase();
    return [...items]
      .filter((item) => {
        const available = formatMetres(Number(item.available_mm)).toLowerCase();
        return (
          (!term ||
            [item.barcode, item.fabric, item.batch, item.colour, available]
              .join(" ")
              .toLowerCase()
              .includes(term)) &&
          item.barcode.toLowerCase().includes(filters.barcode.trim().toLowerCase()) &&
          item.fabric.toLowerCase().includes(filters.fabric.trim().toLowerCase()) &&
          item.batch.toLowerCase().includes(filters.batch.trim().toLowerCase()) &&
          (item.colour ?? "Not recorded")
            .toLowerCase()
            .includes(filters.colour.trim().toLowerCase()) &&
          available.includes(filters.available.trim().toLowerCase())
        );
      })
      .sort((a, b) => {
        const time = new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
        return time || b.barcode.localeCompare(a.barcode);
      });
  }

  return (
    <Panel
      title="Showroom stock by floor"
      description="Only stock currently on showroom floors. Workshop and godown stock are excluded."
    >
      <div className="mb-4 grid gap-2 lg:grid-cols-[1fr_auto]">
        <BarcodeEntry
          value={search}
          onChange={setSearch}
          onScan={setSearch}
          label="Search or scan Showroom stock"
          placeholder="Search Thaan, barcode, fabric, batch or colour"
          showCameraOnDesktop
        />
        <Button
          type="button"
          variant={showFilters ? "default" : "outline"}
          onClick={() => setShowFilters((value) => !value)}
        >
          <ListFilter className="size-4" /> Filters
        </Button>
      </div>
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
          const items = matchingItems(floor.items ?? []);
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
                  {!items.length ? (
                    <p className="text-sm text-muted-foreground">
                      {floor.items?.length
                        ? "No stock on this floor matches the current search or filters."
                        : "No active Thaans on this floor."}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[660px] text-left text-sm">
                        <thead className="bg-muted/60 text-xs text-muted-foreground">
                          <tr>
                            {["Thaan / barcode", "Fabric", "Batch", "Colour", "Available"].map(
                              (label, index) => (
                                <th
                                  key={label}
                                  className={`px-3 py-2 font-medium ${index === 4 ? "text-right" : ""}`}
                                >
                                  <span className="inline-flex items-center gap-1">
                                    {label}
                                    <ListFilter className="size-3" aria-hidden="true" />
                                  </span>
                                </th>
                              ),
                            )}
                          </tr>
                          {showFilters && (
                            <tr className="border-t bg-background">
                              {(["barcode", "fabric", "batch", "colour", "available"] as const).map(
                                (key) => (
                                  <th key={key} className="p-1.5">
                                    <Input
                                      aria-label={`Filter by ${key}`}
                                      value={filters[key]}
                                      onChange={(event) =>
                                        setFilters((current) => ({
                                          ...current,
                                          [key]: event.target.value,
                                        }))
                                      }
                                      placeholder="Filter…"
                                      className="h-8 min-w-24 text-xs"
                                    />
                                  </th>
                                ),
                              )}
                            </tr>
                          )}
                        </thead>
                        <tbody className="divide-y">
                          {items.map((item) => (
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
