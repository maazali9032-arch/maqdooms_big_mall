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
import { PickOrTypeInput } from "@/shared/components/pick-or-type";
import { useSuppliers } from "@/features/inventory";
import { printFabricLabel } from "./fabric-label";
import { definiteDatabaseRejection } from "./consumable-input";
import { inclusivePurchaseAmounts } from "./purchase-invoice";

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
  purchaseCostEach: string;
  units: DraftUnit[];
};
type DraftUnit = { key: string; quantity: string; purchaseCost: string };
type MaterialCategory = {
  id: string;
  code: string;
  name: string;
  measurement_unit: string;
};
const defaultMaterialCategories: MaterialCategory[] = [
  { id: "buttons", code: "buttons", name: "Buttons", measurement_unit: "pc" },
  { id: "thread", code: "thread", name: "Thread", measurement_unit: "spool" },
  { id: "padding", code: "padding", name: "Shoulder pads / padding", measurement_unit: "pc" },
  { id: "other", code: "other", name: "Fusing / other", measurement_unit: "m" },
];
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
  purchaseCostEach: "",
  units: [{ key: crypto.randomUUID(), quantity: "", purchaseCost: "" }],
});
const today = () => new Date().toLocaleDateString("en-CA");
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
  const suppliers = useSuppliers();
  const labels = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [supplier, setSupplier] = useState("");
  const [supplierGstin, setSupplierGstin] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [hasSupplierInvoice, setHasSupplierInvoice] = useState(false);
  const [arrivalDate, setArrivalDate] = useState(today);
  const [transportCharges, setTransportCharges] = useState("0");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [correctionReason, setCorrectionReason] = useState<Record<string, string>>({});
  const categories = useQuery({
    queryKey: ["material-categories"],
    enabled: showReceiving && mayReceive,
    queryFn: async () => {
      const { data, error } = await rpc("material_category_catalog", {});
      if (error) throw error;
      return data as MaterialCategory[];
    },
  });
  const categoryOptions = categories.data?.length ? categories.data : defaultMaterialCategories;
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
      const { error } = await rpc(
        Object.prototype.hasOwnProperty.call(args, "p_purchase")
          ? "receive_material_unit_batch_with_purchase"
          : "receive_material_unit_batch",
        args,
      );
      if (error) throw error;
    },
    onSuccess: () => {
      setPending(null);
      setSupplier("");
      setSupplierGstin("");
      setSupplierPhone("");
      setSupplierEmail("");
      setSupplierAddress("");
      setInvoiceNumber("");
      setHasSupplierInvoice(false);
      setArrivalDate(today());
      setTransportCharges("0");
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
      if (hasSupplierInvoice && !/^[0-9]{2}[A-Z0-9]{13}$/.test(supplierGstin.trim()))
        throw new Error("Enter the supplier's valid 15-character GSTIN");
      if (hasSupplierInvoice && !invoiceNumber.trim())
        throw new Error("Supplier invoice number is required");
      const names = lines.map((line) => line.name.trim().toLowerCase());
      if (names.some((name) => !name) || new Set(names).size !== names.length)
        throw new Error("Each material type needs a unique name");
      const p_lines = lines.map((line) => {
        const count = Number(line.unitCount);
        if (!Number.isInteger(count) || count < 1 || count > 500 || line.units.length !== count)
          throw new Error("Enter one to 500 physical units for every material type");
        const units = line.units.map((unit, index) => {
          const quantity = Number(unit.quantity);
          if (!Number.isFinite(quantity) || quantity <= 0)
            throw new Error(`Enter a positive quantity for unit ${index + 1} of ${line.name}`);
          return {
            quantity,
            net_purchase_paise: paise(unit.purchaseCost),
            recoverable_gst_paise: 0,
            nonrecoverable_gst_paise: 0,
            direct_cost_paise: 0,
          };
        });
        return {
          name: line.name.trim(),
          category: line.category,
          unit: line.unit.trim(),
          units,
        };
      });
      const purchaseTotalPaise = lines.reduce(
        (sum, line) =>
          sum + line.units.reduce((unitSum, unit) => unitSum + paise(unit.purchaseCost), 0),
        0,
      );
      const baseRequest = {
        p_request: crypto.randomUUID(),
        p_supplier: supplier.trim(),
        p_reference: hasSupplierInvoice ? invoiceNumber.trim() : null,
        p_shared_expense_paise: paise(transportCharges),
        p_lines,
      };
      receive.mutate(
        hasSupplierInvoice
          ? {
              ...baseRequest,
              p_purchase: {
                supplier_gstin: supplierGstin.trim(),
                supplier_phone: supplierPhone.trim(),
                supplier_email: supplierEmail.trim(),
                supplier_address: supplierAddress.trim(),
                invoice_number: invoiceNumber.trim(),
                invoice_date: arrivalDate,
                itc_status: "eligible",
                ...inclusivePurchaseAmounts(purchaseTotalPaise),
                transport_paise: paise(transportCharges),
                arrival_date: arrivalDate,
              },
            }
          : baseRequest,
      );
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const selectSupplier = (value: string) => {
    setSupplier(value);
    setHasSupplierInvoice(false);
    setSupplierGstin("");
    setSupplierPhone("");
    setSupplierEmail("");
    setSupplierAddress("");
    setInvoiceNumber("");
  };
  const chooseSupplierInvoice = (enabled: boolean) => {
    setHasSupplierInvoice(enabled);
    const matched = (suppliers.data ?? []).find(
      (item) => item.name.trim().toLowerCase() === supplier.trim().toLowerCase(),
    );
    setSupplierGstin(enabled ? (matched?.gstin ?? "") : "");
    setSupplierPhone(enabled ? (matched?.phone ?? "") : "");
    setSupplierEmail(enabled ? (matched?.email ?? "") : "");
    setSupplierAddress(enabled ? (matched?.address ?? "") : "");
    if (!enabled) setInvoiceNumber("");
  };
  const setLine = (key: string, update: (line: DraftLine) => DraftLine) =>
    setLines((rows) => rows.map((row) => (row.key === key ? update(row) : row)));
  const resizeUnits = (line: DraftLine, value: string) => {
    const count = Math.max(0, Math.min(500, Number.parseInt(value, 10) || 0));
    const units = Array.from(
      { length: count },
      (_, index) =>
        line.units[index] ?? {
          key: crypto.randomUUID(),
          quantity: line.quantityEach,
          purchaseCost: line.purchaseCostEach,
        },
    );
    return { ...line, unitCount: value, units };
  };
  const setDefault = (
    line: DraftLine,
    field: "quantityEach" | "purchaseCostEach",
    value: string,
  ) => {
    const childField = field === "quantityEach" ? "quantity" : "purchaseCost";
    const previous = line[field];
    return {
      ...line,
      [field]: value,
      units: line.units.map((unit) =>
        unit[childField] === previous ? { ...unit, [childField]: value } : unit,
      ),
    };
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
            <div className="rounded-xl border p-3">
              <h3 className="mb-3 font-semibold">Batch information</h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <label className="text-sm">
                  Batch ID
                  <Input value="Auto-generated on save" readOnly className="bg-muted" />
                </label>
                <label className="text-sm">
                  Arrival date
                  <Input
                    type="date"
                    value={arrivalDate}
                    onChange={(e) => setArrivalDate(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Supplier / provider
                  <PickOrTypeInput
                    value={supplier}
                    onChange={selectSupplier}
                    options={(suppliers.data ?? []).map((item) => item.name)}
                  />
                </label>
                <label className="text-sm">
                  Transport / other charges ₹
                  <Input
                    inputMode="decimal"
                    value={transportCharges}
                    onChange={(e) => setTransportCharges(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="rounded-xl border p-3">
              <h3 className="mb-3 font-semibold">Supplier GST & purchase invoice</h3>
              <p className="mb-3 text-sm text-muted-foreground">
                Choose Yes only when the supplier provided a GST purchase invoice. Unit purchase CP
                remains GST-inclusive.
              </p>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Supplier invoice available?</span>
                <Button
                  type="button"
                  variant={hasSupplierInvoice ? "default" : "outline"}
                  disabled={!supplier.trim()}
                  onClick={() => chooseSupplierInvoice(true)}
                >
                  Yes
                </Button>
                <Button
                  type="button"
                  variant={!hasSupplierInvoice ? "default" : "outline"}
                  disabled={!supplier.trim()}
                  onClick={() => chooseSupplierInvoice(false)}
                >
                  No
                </Button>
              </div>
              {hasSupplierInvoice && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Input
                    aria-label="Supplier GSTIN"
                    placeholder="Supplier GSTIN"
                    value={supplierGstin}
                    onChange={(e) => setSupplierGstin(e.target.value.toUpperCase())}
                  />
                  <Input
                    placeholder="Supplier phone (saved for next time)"
                    value={supplierPhone}
                    onChange={(e) => setSupplierPhone(e.target.value)}
                  />
                  <Input
                    placeholder="Supplier email (saved for next time)"
                    value={supplierEmail}
                    onChange={(e) => setSupplierEmail(e.target.value)}
                  />
                  <Input
                    placeholder="Supplier address (saved for next time)"
                    value={supplierAddress}
                    onChange={(e) => setSupplierAddress(e.target.value)}
                  />
                  <Input
                    aria-label="Supplier invoice number"
                    placeholder="Invoice number"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                  />
                  <div className="flex h-11 items-center rounded border bg-muted/30 px-3 text-sm font-medium text-emerald-700">
                    ITC eligible
                  </div>
                </div>
              )}
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
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_8rem]">
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
                      onChange={(e) => {
                        const selected = categoryOptions.find(
                          (item) => item.code === e.target.value,
                        );
                        setLine(line.key, (row) => ({
                          ...row,
                          category: e.target.value,
                          unit: selected?.measurement_unit ?? row.unit,
                        }));
                      }}
                    >
                      {categoryOptions.map((category) => (
                        <option key={category.id} value={category.code}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Measurement unit
                    <Input value={line.unit} readOnly className="w-24 bg-muted" />
                  </label>
                  <label className="text-sm">
                    Physical units
                    <Input
                      inputMode="numeric"
                      value={line.unitCount}
                      onChange={(e) => setLine(line.key, (row) => resizeUnits(row, e.target.value))}
                    />
                  </label>
                </div>
                <details
                  className="mt-4 rounded-lg border bg-muted/20"
                  open={line.units.length <= 10}
                >
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                    Units ({line.units.length}) — expand to set individual quantity and CP
                  </summary>
                  <div className="border-t p-3">
                    <div className="mb-3 grid gap-3 sm:grid-cols-2">
                      <label className="text-sm">
                        Default quantity in each unit ({line.unit})
                        <Input
                          inputMode="decimal"
                          value={line.quantityEach}
                          onChange={(e) =>
                            setLine(line.key, (row) =>
                              setDefault(row, "quantityEach", e.target.value),
                            )
                          }
                        />
                      </label>
                      <label className="text-sm">
                        Default purchase CP per unit, including GST ₹
                        <Input
                          inputMode="decimal"
                          value={line.purchaseCostEach}
                          onChange={(e) =>
                            setLine(line.key, (row) =>
                              setDefault(row, "purchaseCostEach", e.target.value),
                            )
                          }
                        />
                      </label>
                    </div>
                    <div className="space-y-2 border-l-2 border-primary/30 pl-3">
                      {line.units.map((unit, unitIndex) => (
                        <div
                          key={unit.key}
                          className="grid items-end gap-3 rounded-lg border bg-background p-2 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]"
                        >
                          <p className="pb-2 text-sm font-medium">
                            └ Unit {String(unitIndex + 1).padStart(2, "0")}
                          </p>
                          <label className="text-xs text-muted-foreground">
                            Quantity ({line.unit})
                            <Input
                              inputMode="decimal"
                              value={unit.quantity}
                              onChange={(e) =>
                                setLine(line.key, (row) => ({
                                  ...row,
                                  units: row.units.map((child) =>
                                    child.key === unit.key
                                      ? { ...child, quantity: e.target.value }
                                      : child,
                                  ),
                                }))
                              }
                            />
                          </label>
                          <label className="text-xs text-muted-foreground">
                            Purchase CP incl. GST ₹
                            <Input
                              inputMode="decimal"
                              value={unit.purchaseCost}
                              onChange={(e) =>
                                setLine(line.key, (row) => ({
                                  ...row,
                                  units: row.units.map((child) =>
                                    child.key === unit.key
                                      ? { ...child, purchaseCost: e.target.value }
                                      : child,
                                  ),
                                }))
                              }
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
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
              Transport and other charges are divided equally across all physical units and added to
              each unit's landed CP.
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
