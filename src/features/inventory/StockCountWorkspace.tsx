import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, StatCard } from "@/shared/components/page";

type Catalog = { staff: { id: string; name: string }[]; locations: { id: string; name: string }[] };
type Audit = {
  id: string;
  name: string;
  status: string;
  assigned_to: string;
  total: number;
  scanned: number;
  items: { barcode: string; kind: string; details: Record<string, string>; scanned: boolean }[];
};

export function StockCountWorkspace() {
  const { isOwner } = useSession();
  return isOwner ? <OwnerStockCounts /> : <AssignedStockCount />;
}
function OwnerStockCounts() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [staff, setStaff] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [fabric, setFabric] = useState(true);
  const [products, setProducts] = useState(true);
  const catalog = useQuery({
    queryKey: ["stock-count-catalog"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("stock_count_setup_catalog");
      if (error) throw error;
      return data as unknown as Catalog;
    },
  });
  const audits = useQuery({
    queryKey: ["stock-count-owner"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("stock_count_owner_view");
      if (error) throw error;
      return data as unknown as Audit[];
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const kinds = [...(fabric ? ["fabric"] : []), ...(products ? ["finished_product"] : [])];
      const { error } = await (supabase.rpc as any)("create_stock_count_audit", {
        p_request: crypto.randomUUID(),
        p_name: name,
        p_kinds: kinds,
        p_locations: locations,
        p_staff: staff,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setName("");
      setLocations([]);
      toast.success("Stock count assigned");
      void qc.invalidateQueries({ queryKey: ["stock-count-owner"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const finish = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("complete_stock_count_audit", { p_audit: id });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["stock-count-owner"] }),
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <Panel
        title="Create stock count"
        description="Freeze the expected barcode list for selected locations, then assign one staff member to scan it."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            placeholder="For example: October Showroom count"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            aria-label="Assigned stock-count staff"
            className="h-11 rounded border bg-background p-2"
            value={staff}
            onChange={(e) => setStaff(e.target.value)}
          >
            <option value="">Assign staff</option>
            {catalog.data?.staff.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <div className="flex gap-4">
            <label>
              <input
                type="checkbox"
                checked={fabric}
                onChange={(e) => setFabric(e.target.checked)}
              />{" "}
              Fabric thaans
            </label>
            <label>
              <input
                type="checkbox"
                checked={products}
                onChange={(e) => setProducts(e.target.checked)}
              />{" "}
              Finished products
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {catalog.data?.locations.map((l) => (
              <label key={l.id} className="rounded border px-2 py-1">
                <input
                  type="checkbox"
                  checked={locations.includes(l.id)}
                  onChange={(e) =>
                    setLocations(
                      e.target.checked ? [...locations, l.id] : locations.filter((x) => x !== l.id),
                    )
                  }
                />{" "}
                {l.name}
              </label>
            ))}
          </div>
        </div>
        <Button
          className="mt-3"
          disabled={
            create.isPending ||
            !name.trim() ||
            !staff ||
            !locations.length ||
            (!fabric && !products)
          }
          onClick={() => create.mutate()}
        >
          Create and assign count
        </Button>
      </Panel>
      {audits.data?.map((a) => {
        const remaining = a.total - a.scanned;
        return (
          <Panel
            key={a.id}
            title={a.name}
            description={`${a.assigned_to} · ${a.status}`}
            actions={
              a.status === "active" ? (
                <Button variant="outline" onClick={() => finish.mutate(a.id)}>
                  Finish audit
                </Button>
              ) : undefined
            }
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Scanned" value={`${a.scanned} / ${a.total}`} />
              <StatCard label="Remaining / missing" value={remaining} />
              <StatCard
                label="Progress"
                value={`${a.total ? Math.round((a.scanned / a.total) * 100) : 0}%`}
              />
            </div>
            <details className="mt-3">
              <summary>See all expected items and missing details</summary>
              <div className="mt-2 space-y-1 text-sm">
                {a.items.map((i) => (
                  <p
                    key={i.barcode}
                    className={i.scanned ? "text-emerald-700" : "text-destructive"}
                  >
                    {i.scanned ? "Scanned" : "Missing"} · {i.barcode} · {i.details["name"]} ·{" "}
                    {i.details["location"]}
                  </p>
                ))}
              </div>
            </details>
          </Panel>
        );
      })}
    </div>
  );
}
function AssignedStockCount() {
  const qc = useQueryClient();
  const [barcode, setBarcode] = useState("");
  const task = useQuery({
    queryKey: ["my-stock-count"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("stock_count_my_task");
      if (error) throw error;
      return data as unknown as { id: string; name: string; total: number; scanned: number } | null;
    },
  });
  const scan = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("stock_count_scan", {
        p_audit: task.data!.id,
        p_barcode: barcode.trim(),
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data) => {
      setBarcode("");
      toast.success(data.already_scanned ? "Already scanned" : "Marked scanned");
      void qc.invalidateQueries({ queryKey: ["my-stock-count"] });
    },
    onError: (e) => toast.error(e.message),
  });
  if (!task.data)
    return (
      <Panel title="Stock count">
        <p>No active stock count is assigned to you.</p>
      </Panel>
    );
  return (
    <Panel
      title={task.data.name}
      description="Scan each assigned barcode. Item names and expected stock remain hidden from the counter."
    >
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (barcode.trim()) scan.mutate();
        }}
      >
        <Input
          aria-label="Stock count barcode"
          autoFocus
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          placeholder="Scan barcode"
        />
        <Button disabled={scan.isPending || !barcode.trim()}>Scan</Button>
      </form>
      <p className="mt-3 text-sm">
        Progress: {task.data.scanned} of {task.data.total} scanned.
      </p>
    </Panel>
  );
}
