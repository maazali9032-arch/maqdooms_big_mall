import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Barcode, FolderOpen, Layers, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel, EmptyState } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fabricBarcodeBars, printFabricLabel } from "./fabric-label";
import { quantityInput } from "./ledger-quantity";
import { fabricMoneyInput } from "./fabric-entry-input";
import { definiteDatabaseRejection } from "./consumable-input";
import { loadStockImageUrls } from "./stock-images";
import { StockImage } from "./StockImage";
import { ExistingStockImageEditor } from "./ExistingStockImageEditor";
export type WorkshopRow = {
  thaan_id: string;
  stock_id: string;
  batch_id: string;
  batch_code: string;
  batch_created_at: string;
  arrival_date: string;
  supplier: string;
  group_id: string;
  type_name: string;
  rack?: string | null;
  design?: string | null;
  ordinal: number | null;
  barcode: string;
  registered: boolean;
  name: string;
  colour: string | null;
  original_mm: number | null;
  saved_length_mm: number | null;
  workshop_mm: number | null;
  status: string;
  unlocated: boolean;
  cp_visible: boolean;
  cp_paise_per_m: number | null;
  incomplete: boolean;
  can_edit: boolean;
  can_correct_cp: boolean;
  can_correct_length: boolean;
  can_fill_cp: boolean;
  version: string;
};
export function useWorkshopInventory() {
  const { userId } = useSession();
  return useQuery({
    queryKey: ["workshop-fabric-inventory", userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("workshop_fabric_inventory", {});
      if (error) throw error;
      return data as unknown as WorkshopRow[];
    },
  });
}
const metres = (value: number | null) =>
  value === null ? "Not recorded" : `${(value / 1000).toFixed(3)} m`;
export function WorkshopFabricStock({
  search = "",
  incompleteOnly = false,
  onSearchChange,
  onIncompleteChange,
}: {
  search?: string;
  incompleteOnly?: boolean;
  onSearchChange?: (value: string) => void;
  onIncompleteChange?: (value: boolean) => void;
}) {
  const catalog = useWorkshopInventory();
  const imageUrls = useQuery({
    queryKey: ["stock-item-images", "thaan", (catalog.data ?? []).map((row) => row.thaan_id)],
    enabled: !!catalog.data?.length,
    queryFn: () => loadStockImageUrls("thaan", (catalog.data ?? []).map((row) => row.thaan_id)),
  });
  const { can, isOwner } = useSession();
  const qc = useQueryClient();
  const [localSearch, setLocalSearch] = useState("");
  const text = onSearchChange ? search : localSearch;
  const setSearch = onSearchChange ?? setLocalSearch;
  const incompleteFilter = onIncompleteChange ? (
    <label className="ml-auto flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
      <Checkbox
        checked={incompleteOnly}
        onCheckedChange={(value) => onIncompleteChange(Boolean(value))}
      />
      Incomplete only
    </label>
  ) : null;
  const [editing, setEditing] = useState<WorkshopRow | null>(null);
  const [label, setLabel] = useState<WorkshopRow | null>(null);
  const [fields, setFields] = useState({
    name: "",
    type_name: "",
    colour: "",
    length: "",
    cp: "",
    reason: "",
  });
  const [pending, setPending] = useState<{
    request: string;
    row: WorkshopRow;
    changes: Record<string, string | number>;
    reason: string;
  } | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const save = useMutation({
    mutationFn: async (args: NonNullable<typeof pending>) => {
      setPending(args);
      const { error } = await supabase.rpc("edit_workshop_thaan", {
        p_request: args.request,
        p_thaan: args.row.thaan_id,
        p_version: args.row.version,
        p_changes: args.changes,
        p_reason: args.reason,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setPending(null);
      setEditing(null);
      await qc.invalidateQueries();
      toast.success("Thaan details saved with audit history");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPending(null);
      toast.error(e.message || "Result uncertain; retry the same request");
    },
  });
  const frozen = save.isPending || pending !== null;
  const visible = (catalog.data ?? []).filter(
    (r) =>
      (!incompleteOnly || r.incomplete) &&
      [r.batch_code, r.supplier, r.type_name, r.name, r.colour, r.barcode, r.rack, r.design]
        .join(" ")
        .toLowerCase()
        .includes(text.trim().toLowerCase()),
  );
  const batches = new Map<string, { row: WorkshopRow; groups: Map<string, WorkshopRow[]> }>();
  for (const r of visible) {
    if (!batches.has(r.batch_id)) batches.set(r.batch_id, { row: r, groups: new Map() });
    const g = batches.get(r.batch_id)!.groups;
    g.set(r.group_id, [...(g.get(r.group_id) ?? []), r]);
  }
  function open(row: WorkshopRow) {
    setEditing(row);
    setFields({
      name: row.name,
      type_name: row.type_name,
      colour: row.colour ?? "",
      length:
        row.original_mm === null
          ? row.saved_length_mm === null
            ? ""
            : String(row.saved_length_mm / 1000)
          : row.workshop_mm === null
            ? ""
            : String(row.workshop_mm / 1000),
      cp: row.cp_paise_per_m === null ? "" : String(row.cp_paise_per_m / 100),
      reason: "",
    });
  }
  function submit() {
    if (!editing) return;
    try {
      const changes: Record<string, string | number> = {};
      if (fields.name.trim() !== editing.name) changes["name"] = fields.name.trim();
      if (fields.type_name.trim() !== editing.type_name)
        changes["type_name"] = fields.type_name.trim();
      if (fields.colour.trim() !== (editing.colour ?? "")) changes["colour"] = fields.colour.trim();
      const currentLength =
        editing.original_mm === null ? editing.saved_length_mm : editing.workshop_mm;
      const length = fields.length.trim()
        ? /^0(?:\.0{1,3})?$/.test(fields.length.trim())
          ? 0
          : quantityInput(fields.length, "mm")
        : null;
      if (
        length !== currentLength ||
        (editing.original_mm === null && length !== null && length > 0)
      ) {
        if (length === null) throw new Error("Recorded length cannot be cleared");
        changes["length_mm"] = length;
      }
      if (editing.cp_visible) {
        const cp = fields.cp.trim() ? fabricMoneyInput(fields.cp) : null;
        if (cp !== editing.cp_paise_per_m) {
          if (cp === null) throw new Error("Recorded CP cannot be cleared");
          changes["cp_paise_per_m"] = cp;
        }
      }
      if (!Object.keys(changes).length) throw new Error("No changes to save");
      save.mutate({
        request: crypto.randomUUID(),
        row: editing,
        changes,
        reason: fields.reason.trim(),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check the entered details");
    }
  }
  return (
    <div className="space-y-4">
      <Panel
        title="Search or scan Workshop stock"
        description="Search a batch, fabric or Thaan, or scan its existing barcode. Matching rows keep their batch and fabric context."
      >
        <BarcodeEntry
          value={text}
          onChange={setSearch}
          onScan={setSearch}
          label="Search or scan Workshop stock"
          placeholder="Search batch, supplier, fabric or scan a barcode"
        >
          {text && (
            <Button type="button" variant="outline" onClick={() => setSearch("")}>
              Clear
            </Button>
          )}
        </BarcodeEntry>
      </Panel>
      {catalog.isPending ? (
        <p>Loading Workshop stock...</p>
      ) : catalog.error ? (
        <p role="alert">{catalog.error.message}</p>
      ) : !visible.length ? (
        <div>
          {incompleteFilter}
          <EmptyState
            title="No matching Workshop Thaans"
            description="Clear the search or incomplete filter to see other rows."
          />
        </div>
      ) : (
        <div className="space-y-5" aria-label="Workshop inventory hierarchy">
          {[...batches.values()].map(({ row, groups }) => (
            <section key={row.batch_id} className="overflow-hidden rounded-xl border bg-card">
              <header className="flex flex-wrap items-center gap-3 border-b bg-primary/5 p-4">
                <FolderOpen className="size-5 text-primary" />
                <div>
                  <h2 className="font-semibold">
                    {row.batch_code} - {row.supplier}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Arrival: {row.arrival_date} |{" "}
                    {Array.from(groups.values()).reduce((sum, g) => sum + g.length, 0)} matching
                    Thaans
                  </p>
                </div>
                {row.batch_id === visible[0]?.batch_id ? incompleteFilter : null}
              </header>
              <div className="space-y-4 p-3 sm:p-4">
                {[...groups.entries()].map(([id, rows]) => (
                  <section key={id} className="border-l-2 border-primary/20 pl-3 sm:pl-4">
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <Layers className="size-4 text-primary" />
                      {rows[0]!.type_name}
                      <span className="font-normal text-muted-foreground">({rows.length})</span>
                    </h3>
                    <div className="hidden overflow-x-auto sm:block">
                      <table className="w-full min-w-[650px] text-left text-sm">
                        <thead className="bg-muted/50 text-xs text-muted-foreground">
                          <tr>
                            <th className="p-2">Thaan</th>
                            <th>Image</th>
                            <th>Colour</th>
                            <th>Recorded length</th>
                            <th>Workshop available</th>
                            <th>CP / metre</th>
                            <th>State</th>
                            <th className="text-right">Barcode</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.thaan_id} className="border-b last:border-0">
                              <td className="p-2">
                                <Button
                                  variant="link"
                                  className="h-auto justify-start whitespace-normal p-0 text-left"
                                  onClick={() => open(r)}
                                >
                                  {r.name} {r.ordinal === null ? "" : `- Thaan ${r.ordinal}`}
                                </Button>
                                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                                  {r.barcode}
                                </p>
                              </td>
                              <td>
                                <StockImage
                                  src={imageUrls.data?.get(r.thaan_id)}
                                  alt={`${r.name} ${r.barcode}`}
                                />
                                <div className="mt-1">
                                  <ExistingStockImageEditor
                                    itemId={r.thaan_id}
                                    kind="thaan"
                                    name={r.name}
                                    barcode={r.barcode}
                                    imageUrl={imageUrls.data?.get(r.thaan_id)}
                                    canManage={isOwner || can("inventory.receive")}
                                  />
                                </div>
                              </td>
                              <td>{r.colour || "Not recorded"}</td>
                              <td>{metres(r.saved_length_mm)}</td>
                              <td>
                                {r.unlocated ? "Needs reconciliation" : metres(r.workshop_mm)}
                              </td>
                              <td>
                                {r.cp_visible
                                  ? r.cp_paise_per_m === null
                                    ? "Not recorded"
                                    : `Rs. ${(r.cp_paise_per_m / 100).toFixed(2)}`
                                  : "Restricted"}
                              </td>
                              <td>
                                <span
                                  className={
                                    r.incomplete ? "text-amber-700" : "text-muted-foreground"
                                  }
                                >
                                  {r.incomplete
                                    ? "Incomplete"
                                    : r.original_mm === null
                                      ? "Awaiting stock activation"
                                      : r.status}
                                </span>
                              </td>
                              <td className="text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  aria-label={`Barcode for ${r.barcode}`}
                                  onClick={() => setLabel(r)}
                                >
                                  <Barcode className="size-4" />
                                  Barcode
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="space-y-2 sm:hidden">
                      {rows.map((r) => (
                        <article key={r.thaan_id} className="rounded-lg border bg-card p-3">
                          <div className="flex gap-3">
                            <StockImage
                              src={imageUrls.data?.get(r.thaan_id)}
                              alt={`${r.name} ${r.barcode}`}
                            />
                            <div className="min-w-0 flex-1">
                              <Button
                                variant="link"
                                className="h-auto justify-start whitespace-normal p-0 text-left font-semibold"
                                onClick={() => open(r)}
                              >
                                {r.name} {r.ordinal === null ? "" : `- Thaan ${r.ordinal}`}
                              </Button>
                              <p className="mt-1 font-mono text-xs text-muted-foreground">{r.barcode}</p>
                              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                                <div><dt className="text-muted-foreground">Colour</dt><dd>{r.colour || "Not recorded"}</dd></div>
                                <div><dt className="text-muted-foreground">Recorded</dt><dd>{metres(r.saved_length_mm)}</dd></div>
                                <div><dt className="text-muted-foreground">Available</dt><dd>{r.unlocated ? "Needs reconciliation" : metres(r.workshop_mm)}</dd></div>
                                <div><dt className="text-muted-foreground">State</dt><dd className={r.incomplete ? "text-amber-700" : ""}>{r.incomplete ? "Incomplete" : r.original_mm === null ? "Awaiting activation" : r.status}</dd></div>
                              </dl>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <ExistingStockImageEditor
                              itemId={r.thaan_id}
                              kind="thaan"
                              name={r.name}
                              barcode={r.barcode}
                              imageUrl={imageUrls.data?.get(r.thaan_id)}
                              canManage={isOwner || can("inventory.receive")}
                            />
                            <Button variant="outline" size="sm" onClick={() => setLabel(r)}>
                              <Barcode className="size-4" /> Barcode
                            </Button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <Dialog
        open={!!label}
        onOpenChange={(open) => {
          if (!open) setLabel(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thaan barcode</DialogTitle>
            <DialogDescription>
              Print only this existing label.{" "}
              {label && !label.registered
                ? "Historical shared labels remain unchanged."
                : "The barcode identity stays unchanged."}
            </DialogDescription>
          </DialogHeader>
          {label && (
            <>
              <div
                ref={printRef}
                data-barcode-label=""
                data-code={label.barcode}
                data-name={`${label.type_name} / ${label.name}`}
                data-description={`${label.batch_code} / ${label.supplier}`}
                className="bg-white p-4 text-black"
              >
                <p>
                  {label.batch_code} / {label.supplier}
                </p>
                <p>
                  {label.type_name} / {label.name}
                </p>
                <svg
                  role="img"
                  aria-label={`Barcode ${label.barcode}`}
                  viewBox={`0 0 ${fabricBarcodeBars(label.barcode).length + 40} 65`}
                  className="h-24 w-full"
                >
                  <rect width="100%" height="65" fill="white" />
                  {[...fabricBarcodeBars(label.barcode)].map((b, i) =>
                    b === "1" ? (
                      <rect key={i} x={20 + i} y="4" width="1" height="55" fill="black" />
                    ) : null,
                  )}
                </svg>
                <p className="break-all font-mono">{label.barcode}</p>
              </div>
              <Button
                disabled={!isOwner && !can("stock.print_barcode")}
                onClick={() => {
                  try {
                    if (printRef.current) printFabricLabel(printRef.current);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Print failed");
                  }
                }}
              >
                <Printer className="size-4" />
                Print this barcode
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !frozen) setEditing(null);
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto"
          onEscapeKeyDown={(e) => {
            if (frozen) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (frozen) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Thaan details</DialogTitle>
            <DialogDescription>
              {editing?.barcode}. Received length and historical transactions stay preserved.
              Quantity corrections affect Workshop only. Type-name changes apply to the entire
              fabric group.
            </DialogDescription>
          </DialogHeader>
          {editing?.original_mm === null && (editing.saved_length_mm ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              This measurement is saved but has not been received into Workshop. Save details to
              activate its recorded length.
            </p>
          )}
          {editing && (
            <>
              <fieldset disabled={frozen || !editing.can_edit} className="space-y-3">
                {(["name", "type_name", "colour", "length", "cp", "reason"] as const).map((key) => (
                  <div key={key}>
                    <Label htmlFor={`inventory-${key}`}>
                      {
                        {
                          name: "Thaan name",
                          type_name: "Fabric type name",
                          colour: "Colour",
                          length:
                            editing.original_mm === null
                              ? "Actual length (metres)"
                              : "Workshop available length (metres)",
                          cp: "CP per metre",
                          reason: "Correction reason (optional)",
                        }[key]
                      }
                    </Label>
                    <Input
                      id={`inventory-${key}`}
                      value={key === "cp" && !editing.cp_visible ? "Restricted" : fields[key]}
                      onChange={(e) => setFields((old) => ({ ...old, [key]: e.target.value }))}
                      disabled={
                        (key === "type_name" && !editing.registered) ||
                        (key === "cp" &&
                          (!editing.cp_visible ||
                            (!editing.can_correct_cp &&
                              !(editing.can_fill_cp && (editing.cp_paise_per_m ?? 0) === 0)))) ||
                        (key === "length" &&
                          (editing.unlocated ||
                            (editing.original_mm !== null && !editing.can_correct_length)))
                      }
                    />
                  </div>
                ))}
              </fieldset>
              {editing.can_edit &&
                (!pending ? (
                  <Button disabled={save.isPending} onClick={submit}>
                    Save details
                  </Button>
                ) : (
                  <Button disabled={save.isPending} onClick={() => save.mutate(pending)}>
                    Retry same request
                  </Button>
                ))}
            </>
          )}
          {editing && !editing.can_edit && (
            <p className="text-sm text-muted-foreground">
              Your access permits viewing these details.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
