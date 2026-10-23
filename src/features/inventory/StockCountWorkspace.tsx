import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Info,
  Send,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, StatCard, StatusBadge } from "@/shared/components/page";
import { cn } from "@/lib/utils";
import { BarcodeCameraButton } from "@/shared/components/barcode-camera";
import { formatDateTime } from "@/shared/utils/format";

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
  created_at?: string;
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
        <span
          className={
            selectedLabels.length
              ? "flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
              : "text-muted-foreground"
          }
        >
          {selectedLabels.length
            ? selectedLabels.slice(0, 3).map((item) => (
                <span
                  key={item}
                  className="max-w-36 truncate rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground"
                >
                  {item}
                </span>
              ))
            : placeholder}
          {selectedLabels.length > 3 ? (
            <span className="text-xs text-muted-foreground">+{selectedLabels.length - 3}</span>
          ) : null}
        </span>
        <ChevronDown className="ml-3 size-4 shrink-0 text-muted-foreground" />
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
        title="1. Create stock audit"
        description="Define what to audit, where it is held and who will scan it."
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
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex max-w-3xl items-start gap-2 rounded-lg bg-accent/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" />
            Every matching barcode is frozen and grouped by category and location. Choose stock
            names only to limit an audit to garments such as pants, shirts or suits.
          </p>
          <Button
            className="shrink-0"
            disabled={
              create.isPending || !name.trim() || !staff || !locations.length || !kinds.length
            }
            onClick={() => create.mutate()}
          >
            <Send />
            Create and assign audit
          </Button>
        </div>
      </Panel>
      {audits.data?.map((audit) => (
        <AuditCard key={audit.id} audit={audit} onFinish={() => finish.mutate(audit.id)} />
      ))}
    </div>
  );
}
function AuditCard({ audit, onFinish }: { audit: Audit; onFinish: () => void }) {
  const remaining = audit.total - audit.scanned;
  const progress = audit.total ? Math.round((audit.scanned / audit.total) * 100) : 0;
  const groups = audit.items.reduce<Record<string, AuditItem[]>>((all, item) => {
    const key = `${item.details["category"] ?? item.kind} · ${item.details["location"] ?? "Unknown location"}`;
    (all[key] ??= []).push(item);
    return all;
  }, {});

  return (
    <Panel
      title="2. Audit progress"
      description={`${audit.name} · ${audit.assigned_to} · ${audit.created_at ? `created ${formatDateTime(audit.created_at)}` : audit.status}`}
      actions={
        <StatusBadge
          status={audit.status === "active" ? "in_progress" : "completed"}
          label={audit.status === "active" ? "In progress" : "Completed"}
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total items"
          value={audit.total}
          hint="Expected barcodes to scan"
          icon={Boxes}
        />
        <StatCard
          label="Scanned"
          value={audit.scanned}
          hint="Barcodes verified"
          icon={ClipboardCheck}
          tone="success"
        />
        <StatCard
          label="Remaining / missing"
          value={remaining}
          hint="Items not found"
          icon={AlertTriangle}
          tone={remaining ? "danger" : "success"}
        />
        <div className="panel flex min-h-[104px] min-w-0 items-center gap-4 px-4 py-4 sm:px-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
            <ClipboardCheck className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">Progress</p>
            <p className="numeric mt-1 text-2xl font-semibold leading-none">{progress}%</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
      <details className="group mt-4" open>
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg border bg-surface px-3 py-3 text-sm font-semibold">
          <span className="flex items-center gap-2">
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
            3. Expected items and missing details
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            Grouped by item type and location
          </span>
        </summary>
        <div className="mt-3 space-y-3">
          {Object.entries(groups).map(([group, items]) => {
            const groupScanned = items.filter((item) => item.scanned).length;
            const groupProgress = Math.round((groupScanned / items.length) * 100);
            return (
              <section key={group} className="overflow-hidden rounded-lg border">
                <header className="flex flex-wrap items-center justify-between gap-3 bg-surface px-3 py-2.5 text-sm">
                  <span className="font-semibold">{group}</span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    <b className="font-semibold text-foreground">
                      {groupScanned} / {items.length} scanned
                    </b>
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${groupProgress}%` }}
                      />
                    </span>
                    {groupProgress}%
                  </span>
                </header>
                <div className="scrollbar-subtle overflow-x-auto">
                  <table className="w-full min-w-[700px] text-left text-xs">
                    <thead className="border-y bg-card text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Barcode</th>
                        <th className="px-3 py-2 font-medium">Item</th>
                        <th className="px-3 py-2 font-medium">Details</th>
                        <th className="px-3 py-2 font-medium">Location</th>
                        <th className="px-3 py-2 font-medium">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.barcode} className="border-b last:border-0">
                          <td className="px-3 py-2">
                            {item.scanned ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-1 font-medium text-success">
                                <CheckCircle2 className="size-3" />
                                Scanned
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 font-medium text-destructive">
                                <AlertTriangle className="size-3" />
                                Missing
                              </span>
                            )}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 font-medium",
                              item.scanned ? "text-foreground" : "text-destructive",
                            )}
                          >
                            {item.barcode}
                          </td>
                          <td className="px-3 py-2 font-medium">{item.details["name"] ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {[item.details["design"], item.details["size"], item.details["batch"]]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </td>
                          <td className="px-3 py-2">{item.details["location"] ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {item.scanned ? "Verified" : "Not found"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      </details>
      {audit.status === "active" ? (
        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={onFinish}>
            Finish audit
          </Button>
        </div>
      ) : null}
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
        <BarcodeCameraButton
          disabled={scan.isPending}
          onScan={(code) => {
            setBarcode(code);
            window.setTimeout(() => scan.mutate(), 0);
          }}
        />
      </form>
      <p className="mt-3 text-sm">
        Progress: {task.data.scanned} of {task.data.total} scanned.
      </p>
    </Panel>
  );
}
