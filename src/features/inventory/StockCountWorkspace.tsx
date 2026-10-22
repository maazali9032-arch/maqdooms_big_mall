import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, StatCard } from "@/shared/components/page";

type Catalog = {
  staff: { id: string; name: string }[];
  locations: { id: string; name: string; kind: string }[];
  categories: { id: string; label: string; kind: string }[];
};
type AuditItem = {
  barcode: string;
  kind: string;
  details: Record<string, string>;
  scanned: boolean;
};
type Audit = {
  id: string;
  name: string;
  status: string;
  assigned_to: string;
  total: number;
  scanned: number;
  items: AuditItem[];
};
const itemTypeOptions = [
  { id: "fabric", label: "Fabric / Thaans" },
  { id: "production_finished", label: "Shop-produced garments" },
  { id: "vendor_finished", label: "Vendor-purchased garments" },
  { id: "finished_product", label: "All finished garments" },
];
function SelectionField({
  label,
  selected,
  options,
  onChange,
  placeholder,
  open,
  onOpenChange,
}: {
  label: string;
  selected: string[];
  options: { id: string; label: string }[];
  onChange: (items: string[]) => void;
  placeholder: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const selectedLabels = options
    .filter((option) => selected.includes(option.id))
    .map((option) => option.label);
  useEffect(() => {
    if (!open) return;
    const closeIfOutside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) onOpenChange(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onOpenChange(false);
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onOpenChange, open]);
  return (
    <div ref={root} className={`relative space-y-1 ${open ? "z-50" : "z-0"}`}>
      <label className="text-sm font-medium">{label}</label>
      <button
        type="button"
        className="flex h-11 w-full items-center justify-between rounded-md border bg-background px-3 text-left text-sm"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <span className={selectedLabels.length ? "truncate" : "text-muted-foreground"}>
          {selectedLabels.length ? selectedLabels.join(", ") : placeholder}
        </span>
        <span className="ml-3 text-muted-foreground">⌄</span>
      </button>
      {open ? (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover p-2 shadow-lg">
          {options.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, option.id]
                      : selected.filter((id) => id !== option.id),
                  )
                }
              />
              {option.label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function StockCountWorkspace() {
  const { isOwner } = useSession();
  return isOwner ? <OwnerStockCounts /> : <AssignedStockCount />;
}
function OwnerStockCounts() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [staff, setStaff] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([
    "fabric",
    "production_finished",
    "vendor_finished",
  ]);
  const [openSelection, setOpenSelection] = useState<"kinds" | "categories" | "locations" | null>(
    null,
  );
  const catalog = useQuery({
    queryKey: ["stock-count-catalog"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("stock_count_setup_catalog");
      if (error) throw error;
      return data as Catalog;
    },
  });
  const audits = useQuery({
    queryKey: ["stock-count-owner"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("stock_count_owner_view");
      if (error) throw error;
      return data as Audit[];
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)("create_stock_count_audit", {
        p_request: crypto.randomUUID(),
        p_name: name,
        p_kinds: kinds,
        p_locations: locations,
        p_staff: staff,
        p_category_refs: categories,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setName("");
      setLocations([]);
      setCategories([]);
      toast.success("Stock audit assigned");
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
  const locationOptions = (catalog.data?.locations ?? []).map((location) => ({
    id: location.id,
    label: `${location.name} · ${location.kind.replaceAll("_", " ")}`,
  }));
  return (
    <div className="space-y-4">
      <Panel
        className="overflow-visible"
        title="Create stock audit"
        description="Freeze the expected barcode list by item source and location, then assign one staff member to scan it."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="audit-name">
              Audit name
            </label>
            <Input
              id="audit-name"
              placeholder="For example: October Showroom audit"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="audit-staff">
              Assign staff
            </label>
            <select
              id="audit-staff"
              className="h-11 w-full rounded-md border bg-background px-3 text-sm"
              value={staff}
              onChange={(e) => setStaff(e.target.value)}
            >
              <option value="">Select assigned staff</option>
              {catalog.data?.staff.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <SelectionField
            label="Item categories"
            selected={kinds}
            options={itemTypeOptions}
            onChange={setKinds}
            placeholder="Select stock categories"
            open={openSelection === "kinds"}
            onOpenChange={(open) => setOpenSelection(open ? "kinds" : null)}
          />
          <SelectionField
            label="Stock names to audit (optional)"
            selected={categories}
            options={(catalog.data?.categories ?? []).map((category) => ({
              id: category.id,
              label: `${category.label} · ${category.kind}`,
            }))}
            onChange={setCategories}
            placeholder="All matching fabrics and garments"
            open={openSelection === "categories"}
            onOpenChange={(open) => setOpenSelection(open ? "categories" : null)}
          />
          <SelectionField
            label="Locations to include"
            selected={locations}
            options={locationOptions}
            onChange={setLocations}
            placeholder="Select one or more locations"
            open={openSelection === "locations"}
            onOpenChange={(open) => setOpenSelection(open ? "locations" : null)}
          />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Select existing stock names only when the audit is limited to garments such as pants,
          shirts or suits. Leave it blank to include every item from the selected categories. Every
          matching barcode is frozen and grouped by category and location.
        </p>
        <Button
          className="mt-4"
          disabled={
            create.isPending || !name.trim() || !staff || !locations.length || !kinds.length
          }
          onClick={() => create.mutate()}
        >
          Create and assign audit
        </Button>
      </Panel>
      {audits.data?.map((audit) => (
        <AuditCard key={audit.id} audit={audit} onFinish={() => finish.mutate(audit.id)} />
      ))}
    </div>
  );
}
function AuditCard({ audit, onFinish }: { audit: Audit; onFinish: () => void }) {
  const remaining = audit.total - audit.scanned;
  const groups = audit.items.reduce<Record<string, AuditItem[]>>((all, item) => {
    const key = `${item.details["category"] ?? item.kind} · ${item.details["location"] ?? "Unknown location"}`;
    (all[key] ??= []).push(item);
    return all;
  }, {});
  return (
    <Panel
      title={audit.name}
      description={`${audit.assigned_to} · ${audit.status}`}
      actions={
        audit.status === "active" ? (
          <Button variant="outline" onClick={onFinish}>
            Finish audit
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Scanned" value={`${audit.scanned} / ${audit.total}`} />
        <StatCard label="Remaining / missing" value={remaining} />
        <StatCard
          label="Progress"
          value={`${audit.total ? Math.round((audit.scanned / audit.total) * 100) : 0}%`}
        />
      </div>
      <details className="mt-3">
        <summary>See grouped expected items and missing details</summary>
        <div className="mt-3 space-y-3 text-sm">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="rounded-md border p-3">
              <p className="font-medium">
                {group} · {items.filter((item) => item.scanned).length} / {items.length} scanned
              </p>
              {items.map((item) => (
                <p
                  key={item.barcode}
                  className={item.scanned ? "text-emerald-700" : "text-destructive"}
                >
                  {item.scanned ? "Scanned" : "Missing"} · {item.barcode} · {item.details["name"]}
                </p>
              ))}
            </div>
          ))}
        </div>
      </details>
    </Panel>
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
      return data as { id: string; name: string; total: number; scanned: number } | null;
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
      <Panel title="Stock audit">
        <p>No active stock audit is assigned to you.</p>
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
          aria-label="Stock audit barcode"
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
