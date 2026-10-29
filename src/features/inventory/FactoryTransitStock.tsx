import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  Building2,
  Camera,
  ChevronDown,
  ChevronRight,
  Factory,
  PackageCheck,
  Scissors,
  Shirt,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BarcodeCamera } from "@/shared/components/barcode-camera";
import { EmptyState, Panel, StatCard, StatusBadge } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMetres } from "@/shared/utils/units";

type TransitItem = {
  id: string;
  item_type: "fabric" | "material";
  barcode: string;
  item: string;
  batch: string;
  quantity: string;
  unit: string;
  purpose: "production" | "customer_order" | "custody";
  reference: string;
  issued_at: string;
  stage: "issued" | "work_recorded" | "finished_ready" | "master_tailor_stock";
  tailor: string;
};
type TransitFactory = {
  id: string;
  code: string;
  name: string;
  fabric_mm: string;
  fabric_lines: number;
  material_units: number;
  production_jobs: number;
  customer_orders: number;
  items: TransitItem[];
};
type TransitData = {
  total_fabric_mm: string;
  factories_count: number;
  fabric_lines: number;
  material_units: number;
  production_jobs: number;
  customer_orders: number;
  factories: TransitFactory[];
};

const quantity = (item: TransitItem) =>
  item.unit.toLowerCase() === "mm"
    ? formatMetres(Number(item.quantity))
    : `${Number(item.quantity).toLocaleString("en-IN")} ${item.unit}`;

export function FactoryTransitStock() {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const query = useQuery({
    queryKey: ["factory-transit-inventory"],
    queryFn: async () => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          name: string,
          args?: Record<string, never>,
        ) => Promise<{ data: unknown; error: Error | null }>
      )("factory_transit_inventory", {});
      if (error) throw error;
      return data as TransitData;
    },
  });
  const needle = search.trim().toLowerCase();
  const factories = useMemo(
    () =>
      (query.data?.factories ?? [])
        .map((factory) => ({
          ...factory,
          items: !needle
            ? factory.items
            : factory.items.filter((item) =>
                [item.barcode, item.item, item.batch, item.reference, item.tailor, item.purpose]
                  .join(" ")
                  .toLowerCase()
                  .includes(needle),
              ),
        }))
        .filter(
          (factory) =>
            !needle ||
            factory.items.length ||
            `${factory.code} ${factory.name}`.toLowerCase().includes(needle),
        ),
    [query.data, needle],
  );

  return (
    <div className="space-y-4">
      <Panel
        title="In transit to factories"
        description="Fabric issued for active production or customer orders, plus material units held by each master tailor."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <StatCard
            label="Fabric in transit"
            value={formatMetres(Number(query.data?.total_fabric_mm ?? 0))}
            icon={Scissors}
          />
          <StatCard label="Factories" value={query.data?.factories_count ?? "—"} icon={Factory} />
          <StatCard label="Fabric issues" value={query.data?.fabric_lines ?? "—"} icon={Shirt} />
          <StatCard label="Material units" value={query.data?.material_units ?? "—"} icon={Boxes} />
          <StatCard
            label="Production jobs"
            value={query.data?.production_jobs ?? "—"}
            icon={PackageCheck}
          />
          <StatCard
            label="Customer orders"
            value={query.data?.customer_orders ?? "—"}
            icon={Building2}
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Barcode, item, factory, job or customer order"
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Scan transit barcode"
            onClick={() => setCameraOpen(true)}
          >
            <Camera className="size-4" />
          </Button>
        </div>
      </Panel>

      {query.isPending ? (
        <Panel>
          <p>Loading factory transit…</p>
        </Panel>
      ) : null}
      {query.error ? (
        <Panel>
          <p role="alert" className="text-destructive">
            {query.error.message}
          </p>
        </Panel>
      ) : null}
      {!query.isPending && !query.error && factories.length === 0 ? (
        <Panel>
          <EmptyState
            title="No stock currently in factory custody"
            description="Issued job fabric and transferred material units will appear here."
          />
        </Panel>
      ) : null}
      {factories.map((factory) => {
        const expanded = open.has(factory.id) || Boolean(needle);
        return (
          <section key={factory.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <button
              type="button"
              className="flex w-full flex-wrap items-center gap-3 p-4 text-left hover:bg-muted/40"
              onClick={() =>
                setOpen((current) => {
                  const next = new Set(current);
                  if (next.has(factory.id)) next.delete(factory.id);
                  else next.add(factory.id);
                  return next;
                })
              }
            >
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              <Factory className="size-5 text-primary" />
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold">{factory.name}</h3>
                <p className="font-mono text-xs text-muted-foreground">{factory.code}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <StatusBadge status={`${factory.production_jobs} production`} />
                <StatusBadge status={`${factory.customer_orders} customer`} />
                <span className="font-semibold">
                  {formatMetres(Number(factory.fabric_mm))} · {factory.material_units} material
                  units
                </span>
              </div>
            </button>
            {expanded ? (
              <div className="overflow-x-auto border-t">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      {[
                        "Barcode / item",
                        "Type",
                        "Batch",
                        "Quantity",
                        "Purpose",
                        "Reference",
                        "Master tailor",
                        "Issued",
                        "Stage",
                      ].map((label) => (
                        <th key={label} className="px-3 py-2 font-medium">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {factory.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2">
                          <strong>{item.item}</strong>
                          <span className="block font-mono text-xs">{item.barcode}</span>
                        </td>
                        <td className="px-3 py-2 capitalize">{item.item_type}</td>
                        <td className="px-3 py-2 font-mono text-xs">{item.batch}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-medium">
                          {quantity(item)}
                        </td>
                        <td className="px-3 py-2 capitalize">
                          {item.purpose.replaceAll("_", " ")}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{item.reference}</td>
                        <td className="px-3 py-2">{item.tailor}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {new Date(item.issued_at).toLocaleDateString("en-IN")}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge
                            status={
                              item.stage === "issued"
                                ? "Issued"
                                : item.stage === "work_recorded"
                                  ? "Work Recorded"
                                  : item.stage === "finished_ready"
                                    ? "Finished & Ready"
                                    : "Master Tailor Stock"
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        );
      })}

      <Dialog open={cameraOpen} onOpenChange={setCameraOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Scan transit barcode</DialogTitle>
          </DialogHeader>
          <BarcodeCamera
            onScan={(code) => {
              setSearch(code.trim());
              setCameraOpen(false);
            }}
            onStop={() => setCameraOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
