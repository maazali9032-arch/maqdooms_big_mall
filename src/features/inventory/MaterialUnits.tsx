import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackagePlus, Printer } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/shared/components/page";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { BarcodeSticker } from "./BarcodeSticker";
import { printFabricLabel } from "./fabric-label";
import { definiteDatabaseRejection } from "./consumable-input";

type MaterialUnit = {
  id: string;
  barcode: string;
  ordinal: number;
  initial_quantity: number;
  remaining_quantity: number;
  unit: string;
  landed_cost_paise: number;
  cp_per_quantity_paise: number;
  batch_code: string;
  supplier_name: string;
  material_name: string;
  category: string;
  factory_name: string | null;
  tailor_name: string | null;
};
type DraftLine = {
  key: string;
  name: string;
  category: string;
  unit: string;
  unitCount: string;
  quantityEach: string;
  netCostEach: string;
  recoverableGstEach: string;
  nonrecoverableGstEach: string;
  directCostEach: string;
};
const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: Error | null }>;
const blankLine = (): DraftLine => ({
  key: crypto.randomUUID(),
  name: "",
  category: "buttons",
  unit: "pc",
  unitCount: "1",
  quantityEach: "",
  netCostEach: "",
  recoverableGstEach: "0",
  nonrecoverableGstEach: "0",
  directCostEach: "0",
});
const paise = (value: string) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter valid non-negative costs");
  return Math.round(amount * 100);
};

export function MaterialUnits({
  showReceiving = true,
  showInventory = true,
  onCancel,
}: {
  showReceiving?: boolean;
  showInventory?: boolean;
  onCancel?: () => void;
}) {
  const { isOwner, can, roles } = useSession();
  const mayReceive = isOwner || (roles.includes("stock_entry") && can("materials.receive_units"));
  const qc = useQueryClient();
  const labels = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [sharedExpense, setSharedExpense] = useState("0");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [correctionReason, setCorrectionReason] = useState<Record<string, string>>({});
  const units = useQuery({
    queryKey: ["material-units", search],
    enabled: showInventory,
    queryFn: async () => {
      const { data, error } = await rpc("material_unit_catalog", { p_search: search || null });
      if (error) throw error;
      return data as MaterialUnit[];
    },
  });
  const correctionsAllowed = isOwner || can("materials.correct_consumption");
  const consumption = useQuery({
    queryKey: ["material-consumption-history"],
    enabled: showInventory && correctionsAllowed,
    queryFn: async () => {
      const { data, error } = await rpc("material_consumption_history", { p_limit: 100 });
      if (error) throw error;
      return data as {
        id: string;
        job_code: string;
        kind: string;
        staff_name: string;
        submitted_at: string;
        reversed_at: string | null;
        reversal_reason: string | null;
        lines: { barcode: string; material: string; quantity: number; unit: string }[];
      }[];
    },
  });
  const reverse = useMutation({
    mutationFn: async (id: string) => {
      const reason = correctionReason[id]?.trim();
      if (!reason) throw new Error("Enter the correction reason");
      const { error } = await rpc("reverse_job_material_consumption", {
        p_consumption: id,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["material-consumption-history"] });
      void qc.invalidateQueries({ queryKey: ["material-units"] });
      toast.success("Consumption reversed and unit balances restored");
    },
    onError: (error) => toast.error(error.message),
  });
  const grouped = useMemo(() => {
    const result = new Map<string, MaterialUnit[]>();
    for (const unit of units.data ?? []) {
      const key = `${unit.batch_code} · ${unit.material_name}`;
      result.set(key, [...(result.get(key) ?? []), unit]);
    }
    return result;
  }, [units.data]);
  const receive = useMutation({
    mutationFn: async (args: Record<string, unknown>) => {
      setPending(args);
      const { error } = await rpc("receive_material_unit_batch", args);
      if (error) throw error;
    },
    onSuccess: () => {
      setPending(null);
      setSupplier("");
      setReference("");
      setSharedExpense("0");
      setLines([blankLine()]);
      void qc.invalidateQueries({ queryKey: ["material-units"] });
      toast.success("Material batch saved and M barcodes generated");
    },
    onError: (error) => {
      if (definiteDatabaseRejection(error)) setPending(null);
      toast.error(error.message);
    },
  });
  const submit = () => {
    try {
      if (pending) return receive.mutate(pending);
      if (!supplier.trim()) throw new Error("Enter the supplier");
      const names = lines.map((line) => line.name.trim().toLowerCase());
      if (names.some((name) => !name) || new Set(names).size !== names.length)
        throw new Error("Each material type needs a unique name");
      const p_lines = lines.map((line) => {
        const count = Number(line.unitCount);
        const quantity = Number(line.quantityEach);
        if (!Number.isInteger(count) || count < 1 || count > 500 || quantity <= 0)
          throw new Error("Enter a valid unit count and quantity for every material");
        const unit = {
          quantity,
          net_purchase_paise: paise(line.netCostEach),
          recoverable_gst_paise: paise(line.recoverableGstEach),
          nonrecoverable_gst_paise: paise(line.nonrecoverableGstEach),
          direct_cost_paise: paise(line.directCostEach),
        };
        return {
          name: line.name.trim(),
          category: line.category,
          unit: line.unit.trim(),
          units: Array.from({ length: count }, () => unit),
        };
      });
      receive.mutate({
        p_request: crypto.randomUUID(),
        p_supplier: supplier.trim(),
        p_reference: reference.trim() || null,
        p_shared_expense_paise: paise(sharedExpense),
        p_lines,
      });
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  return (
    <div className="space-y-4">
      {showReceiving && mayReceive && (
        <Panel
          title="Receive material-unit batch"
          description="Create one purchase batch with multiple material types. Every physical container or roll receives its own permanent M barcode."
          actions={
            onCancel ? (
              <Button variant="outline" onClick={onCancel} disabled={receive.isPending}>
                Cancel batch
              </Button>
            ) : undefined
          }
        >
          <fieldset disabled={receive.isPending || !!pending} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm">
                Supplier
                <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
              </label>
              <label className="text-sm">
                Supplier invoice / reference
                <Input value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
              <label className="text-sm">
                Shared expenses ₹
                <Input
                  inputMode="decimal"
                  value={sharedExpense}
                  onChange={(e) => setSharedExpense(e.target.value)}
                />
              </label>
            </div>
            {lines.map((line, index) => (
              <div key={line.key} className="rounded-xl border p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="font-semibold">Material type {index + 1}</h3>
                  {lines.length > 1 && (
                    <Button
                      variant="ghost"
                      onClick={() => setLines((rows) => rows.filter((row) => row.key !== line.key))}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="text-sm">
                    Material name
                    <Input
                      value={line.name}
                      onChange={(e) =>
                        setLines((rows) =>
                          rows.map((row) =>
                            row.key === line.key ? { ...row, name: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="text-sm">
                    Category
                    <select
                      className="block min-h-10 w-full rounded-md border bg-background px-3"
                      value={line.category}
                      onChange={(e) =>
                        setLines((rows) =>
                          rows.map((row) =>
                            row.key === line.key ? { ...row, category: e.target.value } : row,
                          ),
                        )
                      }
                    >
                      <option value="buttons">Buttons</option>
                      <option value="thread">Thread</option>
                      <option value="padding">Shoulder pads / padding</option>
                      <option value="other">Fusing / other</option>
                    </select>
                  </label>
                  <label className="text-sm">
                    Measurement unit
                    <Input
                      value={line.unit}
                      onChange={(e) =>
                        setLines((rows) =>
                          rows.map((row) =>
                            row.key === line.key ? { ...row, unit: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="text-sm">
                    Physical units
                    <Input
                      inputMode="numeric"
                      value={line.unitCount}
                      onChange={(e) =>
                        setLines((rows) =>
                          rows.map((row) =>
                            row.key === line.key ? { ...row, unitCount: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="text-sm">
                    Quantity in each unit
                    <Input
                      inputMode="decimal"
                      value={line.quantityEach}
                      onChange={(e) =>
                        setLines((rows) =>
                          rows.map((row) =>
                            row.key === line.key ? { ...row, quantityEach: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="text-sm">
                    Net purchase per unit ₹
                    <Input
                      inputMode="decimal"
                      value={line.netCostEach}
                      onChange={(e) =>
                        setLines((rows) =>
                          rows.map((row) =>
                            row.key === line.key ? { ...row, netCostEach: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="text-sm">
                    Recoverable GST per unit ₹
                    <Input
                      inputMode="decimal"
                      value={line.recoverableGstEach}
                      onChange={(e) =>
                        setLines((rows) =>
                          rows.map((row) =>
                            row.key === line.key
                              ? { ...row, recoverableGstEach: e.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="text-sm">
                    Nonrecoverable GST per unit ₹
                    <Input
                      inputMode="decimal"
                      value={line.nonrecoverableGstEach}
                      onChange={(e) =>
                        setLines((rows) =>
                          rows.map((row) =>
                            row.key === line.key
                              ? { ...row, nonrecoverableGstEach: e.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="text-sm">
                    Direct cost per unit ₹
                    <Input
                      inputMode="decimal"
                      value={line.directCostEach}
                      onChange={(e) =>
                        setLines((rows) =>
                          rows.map((row) =>
                            row.key === line.key ? { ...row, directCostEach: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setLines((rows) => [...rows, blankLine()])}>
                <PackagePlus className="mr-2 size-4" />
                Add material type
              </Button>
              <Button onClick={submit}>
                {receive.isPending
                  ? "Saving…"
                  : pending
                    ? "Retry unchanged batch"
                    : "Save batch and generate M barcodes"}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Shared expenses are allocated by each unit’s net purchase value. Recoverable GST is
              tracked outside inventory CP; nonrecoverable GST and direct costs are included.
            </p>
          </fieldset>
        </Panel>
      )}
      {showInventory && (
        <Panel
          title="Material units"
          description="Search a material, MB batch or scan its M barcode. Balances remain with the assigned Master Tailor until consumed."
        >
          <div className="mb-4">
            <BarcodeEntry
              value={search}
              onChange={setSearch}
              onScan={(value) => setSearch(value)}
              label="Material-unit search or barcode"
              placeholder="Material, MB batch or M barcode"
            />
          </div>
          {units.error && <p role="alert">{units.error.message}</p>}
          {!units.isPending && !units.error && !units.data?.length && (
            <p>No material units found.</p>
          )}
          <div ref={labels} className="space-y-4">
            {[...grouped.entries()].map(([name, rows]) => (
              <details key={name} open className="rounded-xl border p-3">
                <summary className="cursor-pointer font-semibold">
                  {name} ({rows.length})
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {rows.map((unit) => (
                    <div key={unit.id} className="rounded-lg border p-3">
                      <BarcodeSticker
                        barcode={unit.barcode}
                        name={unit.material_name}
                        description={`${unit.initial_quantity} ${unit.unit} · ${unit.batch_code}`}
                        price={`CP ₹${(Number(unit.landed_cost_paise) / 100).toFixed(2)}`}
                      />
                      <p className="mt-2 text-sm">
                        Remaining:{" "}
                        <strong>
                          {unit.remaining_quantity} / {unit.initial_quantity} {unit.unit}
                        </strong>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {unit.tailor_name
                          ? `${unit.factory_name} · ${unit.tailor_name}`
                          : "Unassigned · Workshop custody"}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
          {!!units.data?.length && (
            <Button
              className="mt-4"
              variant="outline"
              onClick={() =>
                labels.current && printFabricLabel(labels.current, "Material unit barcodes")
              }
            >
              <Printer className="mr-2 size-4" />
              Print visible M barcodes
            </Button>
          )}
        </Panel>
      )}
      {showInventory && correctionsAllowed && (
        <Panel
          title="Consumption corrections"
          description="Submitted work is immutable. Reversal restores every M-unit balance; the Master Tailor can then submit a corrected record."
        >
          {consumption.data?.map((row) => (
            <div key={row.id} className="mb-3 rounded-xl border p-3">
              <strong>
                {row.job_code} · {row.staff_name}
              </strong>
              <p className="text-sm text-muted-foreground">
                {row.kind.replace("_", " ")} · {new Date(row.submitted_at).toLocaleString()}
              </p>
              <p className="text-sm">
                {row.lines
                  ?.map((line) => `${line.barcode} ${line.material}: ${line.quantity} ${line.unit}`)
                  .join(" · ")}
              </p>
              {row.reversed_at ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Reversed: {row.reversal_reason}
                </p>
              ) : (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <Input
                    placeholder="Required correction reason"
                    value={correctionReason[row.id] ?? ""}
                    onChange={(e) =>
                      setCorrectionReason((current) => ({ ...current, [row.id]: e.target.value }))
                    }
                  />
                  <Button
                    variant="destructive"
                    disabled={reverse.isPending}
                    onClick={() => reverse.mutate(row.id)}
                  >
                    Reverse submission
                  </Button>
                </div>
              )}
            </div>
          ))}
          {!consumption.isPending && !consumption.data?.length && (
            <p>No consumption submissions recorded.</p>
          )}
        </Panel>
      )}
    </div>
  );
}
