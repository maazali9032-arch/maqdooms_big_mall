import { ScannedThaanRows } from "./ScannedThaanRows";
import { VendorReadymadeRegistration } from "./VendorReadymadeRegistration";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  Barcode,
  FileText,
  Layers,
  PackagePlus,
  Plus,
  Shirt,
  Trash2,
} from "lucide-react";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { useSuppliers } from "@/features/inventory";
import { PickOrTypeInput } from "@/shared/components/pick-or-type";
import { Panel } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { fabricMoneyInput } from "./fabric-entry-input";
import { quantityInput } from "./ledger-quantity";
import { reportQuantity } from "@/features/reports/report-value";
import { fabricBarcodeBars, printFabricLabel } from "./fabric-label";
import { definiteDatabaseRejection } from "./consumable-input";
import { createStockBatch } from "./stock-batch-request";
import { StockImageInput } from "./StockImageInput";
import { saveStockImages } from "./stock-images";
import { MaterialUnits } from "./MaterialUnits";
import { BarcodeSticker } from "./BarcodeSticker";
import { inclusivePurchaseAmounts } from "./purchase-invoice";
import type { SupabaseClient } from "@supabase/supabase-js";
type Variant = {
  id: string;
  code: string;
  original_mm: number | null;
  saved_length_mm?: number | null;
  colour?: string | null;
};
type FabricType = { id: string; code: string; name: string; variants: Variant[] };
type Batch = {
  id: string;
  code: string;
  provider_name: string;
  arrival_date: string;
  remarks: string | null;
  fabric_types: FabricType[];
};
type MaterialUnit = {
  id: string;
  batch_id: string;
  barcode: string;
  ordinal: number;
  initial_quantity: number;
  unit: string;
  batch_code: string;
  supplier_name: string;
  material_name: string;
  category: string;
  received_at?: string | null;
};
type VendorPiece = {
  id: string;
  barcode: string;
  product: string;
  style: string | null;
  size: string | null;
  batch_code: string;
  supplier: string;
  arrival_date: string;
};
type ResumeLabel = {
  id: string;
  barcode: string;
  name: string;
  description: string;
  detail: string;
};
type ResumeBatch = {
  key: string;
  kind: "fabric" | "materials" | "vendor_finished";
  id: string;
  code: string;
  provider: string;
  arrivalDate: string;
  labels: ResumeLabel[];
};
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: Error | null }>;
const inventoryRpc = supabase.rpc.bind(supabase) as unknown as Rpc;
type Work =
  | { kind: "append"; group: string; quantity: number }
  | { kind: "fabric"; batch: string; name: string; quantity: number }
  | {
      kind: "batch";
      provider: string;
      date: string;
      remarks: string | null;
      fabrics: {
        name: string;
        quantity: number;
        rows: { colour: string | null; length_mm: number | null; cp_paise_per_m: number | null }[];
      }[];
      purchase?: {
        supplier_gstin: string;
        supplier_phone?: string;
        supplier_email?: string;
        supplier_address?: string;
        invoice_number: string;
        invoice_date: string;
        itc_status: "eligible" | "ineligible" | "reversed" | "pending";
        actual_taxable_paise: number | null;
        actual_gst_paise: number | null;
        actual_supplier_paise: number | null;
        transport_paise: number;
      };
      imagePlan?: {
        types: { image: File | null; pieces: (File | null)[] }[];
      };
    }
  | {
      kind: "details";
      barcode: string;
      colour: string | null;
      length: number | null;
      cp: number | null;
    }
  | { kind: "cp"; barcode: string; cp: number };
type Pending = { request: string; work: Work };
type EntryRow = {
  id: string;
  name: string;
  quantity: string;
  sharedLength: string;
  sharedCp: string;
  image: File | null;
  details: { colour: string; length: string; cp: string; image?: File | null }[];
};
const emptyRow = (): EntryRow => ({
  id: crypto.randomUUID(),
  name: "",
  quantity: "",
  sharedLength: "",
  sharedCp: "",
  image: null,
  details: [],
});
const thaanDetail = (row: EntryRow, index: number) => ({
  colour: "",
  length: row.sharedLength,
  cp: row.sharedCp,
  ...row.details[index],
});
const rowCount = (value: string) =>
  /^[1-9]\d*$/.test(value) && Number(value) <= 500 ? Number(value) : 0;
const metres = (v: number | null) =>
  v === null ? "Not measured" : reportQuantity(String(v), "mm");
function BarcodeLabel({
  variant,
  batch,
  fabric,
}: {
  variant: Variant;
  batch: Batch;
  fabric: FabricType;
}) {
  const bars = fabricBarcodeBars(variant.code);
  return (
    <article
      data-barcode-label=""
      data-code={variant.code}
      data-name={fabric.name}
      data-description={`${batch.code} / ${batch.provider_name}`}
      data-detail={[
        variant.colour,
        (variant.saved_length_mm ?? variant.original_mm) != null
          ? metres(variant.saved_length_mm ?? variant.original_mm)
          : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      className="break-inside-avoid rounded border bg-white p-3 text-black"
    >
      <p>
        {batch.code} / {batch.provider_name}
      </p>
      <p>{fabric.name}</p>
      <svg
        viewBox={`0 0 ${bars.length + 40} 65`}
        role="img"
        aria-label={`Barcode ${variant.code}`}
        className="h-16 w-full"
        shapeRendering="crispEdges"
      >
        <rect width={bars.length + 40} height="65" fill="white" />
        {[...bars].map((b, i) =>
          b === "1" ? <rect key={i} x={20 + i} y="4" width="1" height="55" fill="black" /> : null,
        )}
      </svg>
      <p className="break-all font-mono">{variant.code}</p>
      {variant.colour && <p>{variant.colour}</p>}
      {(variant.saved_length_mm ?? variant.original_mm) !== null && (
        <p>{metres(variant.saved_length_mm ?? variant.original_mm)}</p>
      )}
    </article>
  );
}
export function StockRegistration() {
  const { isOwner, roles, userId, can } = useSession();
  const allowed = isOwner || (roles.includes("stock_entry") && can("inventory.receive"));
  const qc = useQueryClient();
  const suppliers = useSuppliers();
  const [stage, setStage] = useState<"home" | "create" | "labels" | "resume">("home");
  const [batchType, setBatchType] = useState<"fabric" | "vendor_finished" | "materials">("fabric");
  const [provider, setProvider] = useState("");
  const [date, setDate] = useState(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  const [supplierGstin, setSupplierGstin] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [supplierInvoice, setSupplierInvoice] = useState("");
  const [hasSupplierInvoice, setHasSupplierInvoice] = useState(false);
  const [transportCharges, setTransportCharges] = useState("0");
  const [rows, setRows] = useState<EntryRow[]>([emptyRow()]);
  const [batchId, setBatchId] = useState("");
  const [previousBatchKey, setPreviousBatchKey] = useState("");
  const [resumeBatch, setResumeBatch] = useState<ResumeBatch | null>(null);
  const [groupIndex, setGroupIndex] = useState(0);
  const [extraCount, setExtraCount] = useState("");
  const [extraName, setExtraName] = useState("");
  const [printed, setPrinted] = useState<string[]>([]);
  const labels = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const selectProvider = (value: string) => {
    setProvider(value);
    setHasSupplierInvoice(false);
    setSupplierGstin("");
    setSupplierPhone("");
    setSupplierEmail("");
    setSupplierAddress("");
    setSupplierInvoice("");
  };
  const chooseSupplierInvoice = (enabled: boolean) => {
    setHasSupplierInvoice(enabled);
    const matched = (suppliers.data ?? []).find(
      (supplier) => supplier.name.trim().toLowerCase() === provider.trim().toLowerCase(),
    );
    setSupplierGstin(enabled ? (matched?.gstin ?? "") : "");
    setSupplierPhone(enabled ? (matched?.phone ?? "") : "");
    setSupplierEmail(enabled ? (matched?.email ?? "") : "");
    setSupplierAddress(enabled ? (matched?.address ?? "") : "");
    if (!enabled) setSupplierInvoice("");
  };
  const catalog = useQuery({
    queryKey: ["stock-registration", userId],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("stock_registration_catalog", {});
      if (error) throw error;
      return data as unknown as Batch[];
    },
  });
  const materialCatalog = useQuery({
    queryKey: ["stock-registration-material-batches", userId],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await inventoryRpc("material_unit_catalog", { p_search: null });
      if (error) throw error;
      return data as MaterialUnit[];
    },
  });
  const vendorCatalog = useQuery({
    queryKey: ["stock-registration-vendor-batches", userId],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await inventoryRpc("vendor_readymade_stock", {
        p_search: "",
        p_limit: 500,
      });
      if (error) throw error;
      return data as VendorPiece[];
    },
  });
  const previousBatches = useMemo<ResumeBatch[]>(() => {
    const result: ResumeBatch[] = (catalog.data ?? []).map((item) => ({
      key: `fabric:${item.id}`,
      kind: "fabric",
      id: item.id,
      code: item.code,
      provider: item.provider_name,
      arrivalDate: item.arrival_date,
      labels: [],
    }));
    const materialBatches = new Map<string, MaterialUnit[]>();
    for (const unit of materialCatalog.data ?? []) {
      materialBatches.set(unit.batch_id, [...(materialBatches.get(unit.batch_id) ?? []), unit]);
    }
    for (const [id, units] of materialBatches) {
      const first = units[0];
      result.push({
        key: `materials:${id}`,
        kind: "materials",
        id,
        code: first.batch_code,
        provider: first.supplier_name,
        arrivalDate: first.received_at ?? "",
        labels: units
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((unit) => ({
            id: unit.id,
            barcode: unit.barcode,
            name: unit.material_name || unit.category,
            description: `${unit.batch_code} / ${unit.supplier_name || "No supplier"}`,
            detail: `Unit ${unit.ordinal} · ${unit.initial_quantity} ${unit.unit}`,
          })),
      });
    }
    const vendorBatches = new Map<string, VendorPiece[]>();
    for (const piece of vendorCatalog.data ?? []) {
      vendorBatches.set(piece.batch_code, [...(vendorBatches.get(piece.batch_code) ?? []), piece]);
    }
    for (const [code, pieces] of vendorBatches) {
      const first = pieces[0];
      result.push({
        key: `vendor_finished:${code}`,
        kind: "vendor_finished",
        id: code,
        code,
        provider: first.supplier,
        arrivalDate: first.arrival_date,
        labels: pieces.map((piece) => ({
          id: piece.id,
          barcode: piece.barcode,
          name: piece.product,
          description: `${piece.batch_code} / ${piece.supplier || "No supplier"}`,
          detail: [piece.style, piece.size && `Size ${piece.size}`].filter(Boolean).join(" · "),
        })),
      });
    }
    return result.sort(
      (a, b) =>
        b.arrivalDate.localeCompare(a.arrivalDate) ||
        b.code.localeCompare(a.code, undefined, { numeric: true }),
    );
  }, [catalog.data, materialCatalog.data, vendorCatalog.data]);
  const selectedPreviousBatch = previousBatches.find((item) => item.key === previousBatchKey);
  const names = [
    ...new Set([
      ...(suppliers.data ?? []).map((s) => s.name),
      ...(catalog.data ?? []).map((b) => b.provider_name),
    ]),
  ];
  const fabricNames = [
    ...new Set([
      "Cotton",
      "Velvet",
      "Khadi",
      "Linen",
      "Silk",
      "Net",
      "Organza",
      "Others",
      ...(catalog.data ?? []).flatMap((b) => b.fabric_types.map((g) => g.name)),
    ]),
  ];
  const batch = catalog.data?.find((b) => b.id === batchId);
  const group = batch?.fabric_types[groupIndex];
  const total = rows.reduce(
    (sum, r) => sum + (/^\d+$/.test(r.quantity) ? Number(r.quantity) : 0),
    0,
  );
  const action = useMutation({
    mutationFn: async (args: Pending) => {
      setPending(args);
      const w = args.work;
      const result =
        w.kind === "append"
          ? await supabase.rpc("append_registered_thans", {
              p_request: args.request,
              p_fabric_type: w.group,
              p_rows: Array.from({ length: w.quantity }, () => ({
                length_mm: null,
                cp_paise_per_m: null,
              })),
            })
          : w.kind === "fabric"
            ? await supabase.rpc("register_fabric_type", {
                p_request: args.request,
                p_batch: w.batch,
                p_name: w.name,
                p_rows: Array.from({ length: w.quantity }, () => ({
                  length_mm: null,
                  cp_paise_per_m: null,
                })),
              })
            : w.kind === "batch"
              ? await createStockBatch(supabase as unknown as SupabaseClient, args.request, w)
              : w.kind === "details"
                ? await supabase.rpc("save_registered_thaan_details", {
                    p_request: args.request,
                    p_barcode: w.barcode,
                    p_colour: w.colour,
                    p_length_mm: w.length,
                    p_cp: w.cp,
                  })
                : await supabase.rpc("fill_registered_thaan_cp", {
                    p_request: args.request,
                    p_barcode: w.barcode,
                    p_cp: w.cp,
                  });
      if (result.error) throw result.error;
      if (w.kind === "batch" && w.imagePlan) {
        if (!userId) throw new Error("Sign in again before saving stock images");
        const { data: created, error: catalogError } = await supabase.rpc(
          "stock_registration_catalog",
          { p_batch: String(result.data) },
        );
        if (catalogError) throw catalogError;
        const createdBatch = (created as unknown as Batch[])[0];
        if (!createdBatch) throw new Error("Created batch could not be loaded for its images");
        await saveStockImages(
          userId,
          createdBatch.fabric_types.flatMap((fabric, typeIndex) =>
            fabric.variants.flatMap((variant, pieceIndex) => {
              const plan = w.imagePlan!.types[typeIndex];
              const file = plan?.pieces[pieceIndex] ?? plan?.image;
              return file && (variant as Variant & { thaan_id?: string }).thaan_id
                ? [
                    {
                      kind: "thaan" as const,
                      itemId: (variant as Variant & { thaan_id: string }).thaan_id,
                      file,
                    },
                  ]
                : [];
            }),
          ),
        );
      }
      return result.data;
    },
    onSuccess: async (id, args) => {
      setPending(null);
      if (args.work.kind === "batch") {
        setBatchId(String(id));
        setGroupIndex(0);
        setPrinted([]);
        setStage("labels");
        setRows([emptyRow()]);
        setHasSupplierInvoice(false);
        setSupplierGstin("");
        setSupplierPhone("");
        setSupplierEmail("");
        setSupplierAddress("");
      } else if (args.work.kind === "append" || args.work.kind === "fabric") {
        setExtraCount("");
        setExtraName("");
        if (args.work.kind === "append") setPrinted([]);
      }
      await qc.invalidateQueries();
      toast.success(
        ["batch", "append", "fabric"].includes(args.work.kind)
          ? "Labels generated; scan each Thaan to measure actual stock"
          : args.work.kind === "cp"
            ? "Missing CP saved"
            : "Actual Thaan details saved",
      );
    },
    onError: (error) => {
      if (definiteDatabaseRejection(error)) setPending(null);
      toast.error(error.message || "Result uncertain; retry the same request");
    },
  });
  const frozen = action.isPending || pending !== null;
  const run = (work: Work) => action.mutate({ request: crypto.randomUUID(), work });
  if (!allowed) return <p>Authorized Stock Entry access is required.</p>;
  return (
    <div className="space-y-4">
      {pending && !action.isPending && (
        <Panel title="Confirm previous request">
          <p>Result uncertain. Retry before changing values.</p>
          <Button onClick={() => action.mutate(pending)}>Retry same request</Button>
        </Panel>
      )}
      {stage === "home" && (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <ScannedThaanRows />
            <Panel
              title="Create Batch"
              description="Choose fabrics, vendor garments or tailoring materials, then enter the batch details for that stock type."
            >
              <Button
                disabled={frozen || !can("stock.generate_labels")}
                onClick={() => {
                  setBatchType("fabric");
                  setStage("create");
                }}
              >
                Create Batch
              </Button>
              <p className="mt-3 text-sm text-muted-foreground">
                Each physical Thaan, garment or material unit receives its own barcode.
              </p>
            </Panel>
          </div>
          <Panel title="Previous batches">
            <QueryState
              loading={catalog.isPending || materialCatalog.isPending || vendorCatalog.isPending}
              error={catalog.error ?? materialCatalog.error ?? vendorCatalog.error}
              retry={() => {
                void Promise.all([
                  catalog.refetch(),
                  materialCatalog.refetch(),
                  vendorCatalog.refetch(),
                ]);
              }}
            />
            <select
              aria-label="Previous batch"
              className="h-11 w-full rounded border bg-background p-2"
              value={previousBatchKey}
              disabled={frozen}
              onChange={(e) => setPreviousBatchKey(e.target.value)}
            >
              <option value="">Select a batch to resume printing</option>
              {previousBatches.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.code} / {item.provider || "No supplier"} ·{" "}
                  {item.kind === "fabric"
                    ? "Fabric"
                    : item.kind === "materials"
                      ? "Materials"
                      : "Ready-made"}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              className="mt-2"
              disabled={
                frozen ||
                !selectedPreviousBatch ||
                (selectedPreviousBatch.kind === "fabric"
                  ? !(
                      catalog.data?.find((item) => item.id === selectedPreviousBatch.id)
                        ?.fabric_types.length ?? 0
                    )
                  : !selectedPreviousBatch.labels.length)
              }
              onClick={() => {
                if (!selectedPreviousBatch) return;
                if (selectedPreviousBatch.kind === "fabric") {
                  setBatchId(selectedPreviousBatch.id);
                  setGroupIndex(0);
                  setStage("labels");
                } else {
                  setResumeBatch(selectedPreviousBatch);
                  setStage("resume");
                }
              }}
            >
              Open batch labels
            </Button>
          </Panel>
        </>
      )}
      {stage === "create" && (
        <>
          <Panel
            title="1. Choose Stock Item Type"
            description="Choose the stock being received. The batch form below changes for fabrics, vendor garments or tailoring materials."
          >
            <div className="grid gap-3 md:grid-cols-3">
              <Button
                type="button"
                variant="outline"
                aria-pressed={batchType === "fabric"}
                disabled={frozen}
                onClick={() => setBatchType("fabric")}
                className={`h-auto min-h-20 justify-start whitespace-normal px-4 py-3 text-left ${
                  batchType === "fabric"
                    ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/40"
                    : "border-border bg-background text-foreground hover:bg-muted/40"
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Layers className="size-6" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-base font-semibold">Fabric / Thaan</span>
                    <span className="mt-1 block text-sm font-normal text-muted-foreground">
                      Raw fabrics purchased by metre and tracked as individual Thaans.
                    </span>
                  </span>
                  <span
                    className={`ml-auto size-5 shrink-0 rounded-full border-2 ${batchType === "fabric" ? "border-primary bg-primary shadow-[inset_0_0_0_4px_hsl(var(--background))]" : "border-muted-foreground/40"}`}
                    aria-hidden="true"
                  />
                </span>
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-pressed={batchType === "vendor_finished"}
                disabled={frozen || !can("stock.price_finished")}
                onClick={() => setBatchType("vendor_finished")}
                className={`h-auto min-h-20 justify-start whitespace-normal px-4 py-3 text-left ${
                  batchType === "vendor_finished"
                    ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/40"
                    : "border-border bg-background text-foreground hover:bg-muted/40"
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Shirt className="size-6" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-base font-semibold">Ready-made Garments</span>
                    <span className="mt-1 block text-sm font-normal text-muted-foreground">
                      Garments purchased from a vendor, barcoded individually and resold.
                    </span>
                  </span>
                  <span
                    className={`ml-auto size-5 shrink-0 rounded-full border-2 ${batchType === "vendor_finished" ? "border-primary bg-primary shadow-[inset_0_0_0_4px_hsl(var(--background))]" : "border-muted-foreground/40"}`}
                    aria-hidden="true"
                  />
                </span>
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-pressed={batchType === "materials"}
                disabled={frozen || (!isOwner && !can("materials.receive_units"))}
                onClick={() => setBatchType("materials")}
                className={`h-auto min-h-20 justify-start whitespace-normal px-4 py-3 text-left ${
                  batchType === "materials"
                    ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/40"
                    : "border-border bg-background text-foreground hover:bg-muted/40"
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <PackagePlus className="size-6" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-base font-semibold">Materials & Consumables</span>
                    <span className="mt-1 block text-sm font-normal text-muted-foreground">
                      Buttons, fusing, padding and other tailoring supplies tracked by physical
                      unit.
                    </span>
                  </span>
                  <span
                    className={`ml-auto size-5 shrink-0 rounded-full border-2 ${batchType === "materials" ? "border-primary bg-primary shadow-[inset_0_0_0_4px_hsl(var(--background))]" : "border-muted-foreground/40"}`}
                    aria-hidden="true"
                  />
                </span>
              </Button>
            </div>
          </Panel>
          {batchType === "vendor_finished" && (
            <VendorReadymadeRegistration onCancel={() => setStage("home")} />
          )}
          {batchType === "materials" && (
            <MaterialUnits showInventory={false} onCancel={() => setStage("home")} />
          )}
          {batchType === "fabric" && (
            <>
              <Panel
                title="2. Batch Information"
                actions={<FileText className="size-5 text-primary" aria-hidden="true" />}
              >
                <fieldset disabled={frozen} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <Label>Batch ID</Label>
                    <Input className="h-11 bg-muted/30" value="Auto-generated on save" readOnly />
                  </div>
                  <div>
                    <Label htmlFor="arrival-date">Arrival date</Label>
                    <Input
                      id="arrival-date"
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="provider-name">Supplier / provider</Label>
                    <PickOrTypeInput
                      id="provider-name"
                      value={provider}
                      onChange={selectProvider}
                      options={names}
                    />
                  </div>
                  <div>
                    <Label htmlFor="transport-charges">Transport / other charges (₹)</Label>
                    <Input
                      id="transport-charges"
                      inputMode="decimal"
                      value={transportCharges}
                      onChange={(e) => setTransportCharges(e.target.value)}
                    />
                  </div>
                </fieldset>
              </Panel>
              <Panel
                title="3. Supplier GST & purchase invoice"
                description="Choose Yes only when the supplier provided a GST purchase invoice. Purchase CP below remains GST-inclusive."
              >
                <fieldset disabled={frozen} className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">Supplier invoice available?</span>
                    <Button
                      type="button"
                      variant={hasSupplierInvoice ? "default" : "outline"}
                      disabled={!provider.trim()}
                      onClick={() => chooseSupplierInvoice(true)}
                    >
                      Yes
                    </Button>
                    <Button
                      type="button"
                      variant={!hasSupplierInvoice ? "default" : "outline"}
                      disabled={!provider.trim()}
                      onClick={() => chooseSupplierInvoice(false)}
                    >
                      No
                    </Button>
                  </div>
                  {hasSupplierInvoice && (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Input
                        aria-label="Supplier GSTIN"
                        placeholder="Supplier GSTIN"
                        value={supplierGstin}
                        onChange={(e) => setSupplierGstin(e.target.value.toUpperCase())}
                      />
                      <Input
                        aria-label="Supplier phone"
                        placeholder="Supplier phone (saved for next time)"
                        value={supplierPhone}
                        onChange={(e) => setSupplierPhone(e.target.value)}
                      />
                      <Input
                        aria-label="Supplier email"
                        placeholder="Supplier email (saved for next time)"
                        value={supplierEmail}
                        onChange={(e) => setSupplierEmail(e.target.value)}
                      />
                      <Input
                        aria-label="Supplier address"
                        placeholder="Supplier address (saved for next time)"
                        value={supplierAddress}
                        onChange={(e) => setSupplierAddress(e.target.value)}
                      />
                      <Input
                        aria-label="Supplier invoice number"
                        placeholder="Supplier invoice number"
                        value={supplierInvoice}
                        onChange={(e) => setSupplierInvoice(e.target.value)}
                      />
                      <div className="flex h-11 items-center rounded border bg-muted/30 px-3 text-sm font-medium text-emerald-700">
                        ITC eligible
                      </div>
                    </div>
                  )}
                </fieldset>
              </Panel>
              <Panel
                title="Fabric Types & Quantities"
                description="Choose your fabrics and the number of physical Thaans for each."
              >
                <fieldset disabled={frozen} className="space-y-3">
                  <div className="rounded-lg bg-primary/5 p-3" aria-label="Batch hierarchy">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <FileText className="size-5 text-primary" />
                      <span>New Batch — {provider.trim() || "Select a provider"}</span>
                    </div>
                    <p className="ml-7 mt-1 text-xs text-muted-foreground">
                      Batch ID and individual barcode identities are generated on save.
                    </p>
                  </div>
                  <div className="ml-2 space-y-5 border-l-2 border-primary/25 pl-3 sm:ml-4 sm:pl-5">
                    {rows.map((r, i) => (
                      <section
                        key={r.id}
                        aria-label={"Fabric group " + (i + 1)}
                        className="relative min-w-0 before:absolute before:-left-3 before:top-6 before:w-3 before:border-t-2 before:border-primary/25 sm:before:-left-5 sm:before:w-5"
                      >
                        <div className="rounded-lg border bg-muted/20 p-3">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <h3 className="flex items-center gap-2 text-sm font-semibold">
                              <Layers className="size-4 text-primary" />
                              Fabric Type {i + 1}
                              {r.name.trim() ? " — " + r.name : ""}
                            </h3>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              aria-label={"Remove Fabric Type " + (i + 1)}
                              disabled={rows.length === 1}
                              onClick={() => setRows((old) => old.filter((row) => row.id !== r.id))}
                            >
                              <Trash2 className="size-3.5" />
                              <span className="sr-only sm:not-sr-only">Remove</span>
                            </Button>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_7rem_1fr_1fr]">
                            <div className="min-w-0">
                              <Label htmlFor={"type-" + r.id}>Fabric Type {i + 1}</Label>
                              <PickOrTypeInput
                                id={"type-" + r.id}
                                value={r.name}
                                options={fabricNames}
                                placeholder="Choose or type a fabric"
                                onChange={(name) =>
                                  setRows((old) =>
                                    old.map((row) => (row.id === r.id ? { ...row, name } : row)),
                                  )
                                }
                              />
                            </div>
                            <div>
                              <Label htmlFor={"count-" + r.id}>Thaan count {i + 1}</Label>
                              <Input
                                id={"count-" + r.id}
                                value={r.quantity}
                                placeholder="e.g. 10"
                                inputMode="numeric"
                                onChange={(e) =>
                                  setRows((old) =>
                                    old.map((row) =>
                                      row.id === r.id ? { ...row, quantity: e.target.value } : row,
                                    ),
                                  )
                                }
                              />
                            </div>
                            <div>
                              <Label htmlFor={"bulk-length-" + r.id}>Length for all (m)</Label>
                              <Input
                                id={"bulk-length-" + r.id}
                                aria-label={"Length for all fabric " + (i + 1)}
                                inputMode="decimal"
                                placeholder="Optional metres"
                                value={r.sharedLength}
                                disabled={!can("stock.measure_thaan")}
                                onChange={(e) =>
                                  setRows((old) =>
                                    old.map((row) =>
                                      row.id === r.id
                                        ? { ...row, sharedLength: e.target.value }
                                        : row,
                                    ),
                                  )
                                }
                              />
                            </div>
                            <div>
                              <Label htmlFor={"bulk-cp-" + r.id}>
                                Purchase CP for all / metre, including GST (₹)
                              </Label>
                              <Input
                                id={"bulk-cp-" + r.id}
                                aria-label={"CP for all fabric " + (i + 1)}
                                inputMode="decimal"
                                placeholder="Optional CP"
                                value={r.sharedCp}
                                disabled={
                                  !can("stock.measure_thaan") ||
                                  !can("inventory.view_registered_cp")
                                }
                                onChange={(e) =>
                                  setRows((old) =>
                                    old.map((row) =>
                                      row.id === r.id ? { ...row, sharedCp: e.target.value } : row,
                                    ),
                                  )
                                }
                              />
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground">
                              Defaults apply to new rows. Individual rows can have different values.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={
                                !rowCount(r.quantity) ||
                                !can("stock.measure_thaan") ||
                                (!r.sharedLength.trim() && !r.sharedCp.trim())
                              }
                              onClick={() => {
                                try {
                                  if (r.sharedLength.trim()) quantityInput(r.sharedLength, "mm");
                                  if (r.sharedCp.trim()) fabricMoneyInput(r.sharedCp);
                                  setRows((old) =>
                                    old.map((row) =>
                                      row.id !== r.id
                                        ? row
                                        : {
                                            ...row,
                                            details: Array.from(
                                              {
                                                length: Math.max(
                                                  rowCount(row.quantity),
                                                  row.details.length,
                                                ),
                                              },
                                              (_, n) =>
                                                n >= rowCount(row.quantity)
                                                  ? row.details[n]!
                                                  : {
                                                      ...thaanDetail(row, n),
                                                      ...(row.sharedLength.trim()
                                                        ? { length: row.sharedLength }
                                                        : {}),
                                                      ...(row.sharedCp.trim()
                                                        ? { cp: row.sharedCp }
                                                        : {}),
                                                    },
                                            ),
                                          },
                                    ),
                                  );
                                } catch (e) {
                                  toast.error(
                                    e instanceof Error ? e.message : "Check default values",
                                  );
                                }
                              }}
                            >
                              Apply to all {rowCount(r.quantity) || ""} Thaans
                            </Button>
                          </div>
                          <div className="mt-3 border-t pt-3">
                            <StockImageInput
                              label="Add image for this fabric type"
                              file={r.image}
                              onChange={(image) =>
                                setRows((old) =>
                                  old.map((row) => (row.id === r.id ? { ...row, image } : row)),
                                )
                              }
                              disabled={frozen}
                            />
                            <p className="mt-1 text-xs text-muted-foreground">
                              Used by every Thaan in this fabric type unless that row has its own
                              image.
                            </p>
                          </div>
                        </div>
                        <div
                          className="ml-2 mt-3 space-y-2 border-l border-primary/25 pl-3 sm:ml-4 sm:pl-4"
                          aria-label={"Thaan rows for fabric " + (i + 1)}
                        >
                          {!rowCount(r.quantity) && (
                            <p className="py-2 text-xs text-muted-foreground">
                              Enter 1–500 Thaans to show their rows.
                            </p>
                          )}
                          {Array.from({ length: rowCount(r.quantity) }, (_, n) => (
                            <div
                              key={n}
                              className="relative grid min-w-0 gap-2 rounded-md border bg-card p-3 before:absolute before:-left-3 before:top-5 before:w-3 before:border-t before:border-primary/25 sm:grid-cols-3 lg:grid-cols-[minmax(6rem,.8fr)_repeat(3,minmax(0,1fr))_auto_2rem] sm:before:-left-4 sm:before:w-4"
                            >
                              <div className="flex items-center gap-2 sm:col-span-3 lg:col-span-1">
                                <Barcode className="size-4 shrink-0 text-primary" />
                                <div>
                                  <p className="text-xs font-semibold">
                                    Thaan {String(n + 1).padStart(2, "0")}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    Barcode generated on save
                                  </p>
                                </div>
                              </div>
                              {(
                                [
                                  ["colour", "Colour (optional)"],
                                  ["length", "Length (metres)"],
                                  ["cp", "Purchase CP per metre, including GST"],
                                ] as const
                              ).map(([field, label]) => (
                                <div key={field} className="min-w-0">
                                  <Label
                                    htmlFor={r.id + "-" + n + "-" + field}
                                    className="mb-1 block text-[11px] text-muted-foreground"
                                  >
                                    {label}
                                    <span className="sr-only">
                                      {" "}
                                      - fabric {i + 1}, Thaan {n + 1}
                                    </span>
                                  </Label>
                                  <Input
                                    id={r.id + "-" + n + "-" + field}
                                    className="h-9"
                                    value={thaanDetail(r, n)[field]}
                                    inputMode={field === "colour" ? "text" : "decimal"}
                                    disabled={
                                      !can("stock.measure_thaan") ||
                                      (field === "cp" && !can("inventory.view_registered_cp"))
                                    }
                                    placeholder={
                                      field === "colour"
                                        ? "Optional colour"
                                        : field === "length"
                                          ? "Metres"
                                          : "Optional CP"
                                    }
                                    onChange={(e) =>
                                      setRows((old) =>
                                        old.map((row) => {
                                          if (row.id !== r.id) return row;
                                          const details = [...row.details];
                                          details[n] = {
                                            ...thaanDetail(row, n),
                                            [field]: e.target.value,
                                          };
                                          return { ...row, details };
                                        }),
                                      )
                                    }
                                  />
                                </div>
                              ))}
                              <StockImageInput
                                compact
                                label="Image"
                                file={thaanDetail(r, n).image ?? null}
                                inheritedFile={r.image}
                                inheritedText={r.image ? "From fabric type" : undefined}
                                onChange={(image) =>
                                  setRows((old) =>
                                    old.map((row) => {
                                      if (row.id !== r.id) return row;
                                      const details = [...row.details];
                                      details[n] = { ...thaanDetail(row, n), image };
                                      return { ...row, details };
                                    }),
                                  )
                                }
                                disabled={frozen}
                              />
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="size-8 justify-self-end text-destructive sm:col-span-3 lg:col-span-1"
                                aria-label={
                                  "Remove Thaan " + (n + 1) + " from Fabric Type " + (i + 1)
                                }
                                disabled={rowCount(r.quantity) <= 1}
                                onClick={() =>
                                  setRows((old) =>
                                    old.map((row) =>
                                      row.id !== r.id
                                        ? row
                                        : {
                                            ...row,
                                            quantity: String(rowCount(row.quantity) - 1),
                                            details: Array.from(
                                              {
                                                length: Math.max(
                                                  rowCount(row.quantity),
                                                  row.details.length,
                                                ),
                                              },
                                              (_, index) => thaanDetail(row, index),
                                            ).filter((_, index) => index !== n),
                                          },
                                    ),
                                  )
                                }
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full justify-start gap-2 border-primary/10 bg-primary/5 text-primary hover:bg-primary/10"
                    disabled={rows.length >= 100}
                    onClick={() => setRows((old) => [...old, emptyRow()])}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Add Another Fabric Type
                  </Button>
                </fieldset>
              </Panel>
              <Panel
                bodyClassName="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
                className="border-primary/15"
              >
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                  <p>Total Thaans: {total}</p>
                  <p>Fabric Types: {rows.length}</p>
                  <p>Estimated Barcodes: {total}</p>
                  <p>Transport is divided by total metres and added equally to every metre.</p>
                </div>
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <Button
                    className="min-w-24"
                    variant="outline"
                    disabled={frozen}
                    onClick={() => setStage("home")}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={
                      frozen || !can("stock.generate_labels") || !provider.trim() || !date || !total
                    }
                    onClick={() => {
                      try {
                        if (
                          rows.some(
                            (r) =>
                              !r.name.trim() ||
                              !/^[1-9]\d*$/.test(r.quantity) ||
                              Number(r.quantity) > 500,
                          ) ||
                          total > 5000
                        ) {
                          toast.error(
                            "Enter a fabric name and 1-500 Thaans for every row; up to 5000 labels per batch submission",
                          );
                          return;
                        }
                        if (
                          hasSupplierInvoice &&
                          !/^[0-9]{2}[A-Z0-9]{13}$/.test(supplierGstin.trim())
                        )
                          throw new Error("Enter the supplier's valid 15-character GSTIN");
                        if (hasSupplierInvoice && !supplierInvoice.trim())
                          throw new Error("Supplier invoice number is required");
                        fabricMoneyInput(transportCharges);
                        for (const row of rows)
                          for (let index = 0; index < Number(row.quantity); index++) {
                            const detail = thaanDetail(row, index);
                            if (!detail.length.trim() || !detail.cp.trim())
                              throw new Error(
                                "Length and GST-inclusive purchase CP are required for every Thaan",
                              );
                            quantityInput(detail.length, "mm");
                            fabricMoneyInput(detail.cp);
                          }
                        if (
                          rows.some((r) =>
                            r.details
                              .slice(Number(r.quantity))
                              .some(
                                (d) => d && (d.colour.trim() || d.length.trim() || d.cp.trim()),
                              ),
                          )
                        )
                          throw new Error(
                            "Thaan count would discard entered details; restore the count or clear those rows first",
                          );
                        const purchaseTotalPaise = rows.reduce(
                          (sum, row) =>
                            sum +
                            Array.from({ length: Number(row.quantity) }, (_, index) => {
                              const detail = thaanDetail(row, index);
                              return Math.round(
                                (fabricMoneyInput(detail.cp) * quantityInput(detail.length, "mm")) /
                                  1000,
                              );
                            }).reduce((a, b) => a + b, 0),
                          0,
                        );
                        run({
                          kind: "batch",
                          provider: provider.trim(),
                          date,
                          remarks: null,
                          fabrics: rows.map((r) => ({
                            name: r.name.trim(),
                            quantity: Number(r.quantity),
                            rows: Array.from({ length: Number(r.quantity) }, (_, n) => ({
                              colour: thaanDetail(r, n).colour.trim() || null,
                              length_mm: thaanDetail(r, n).length.trim()
                                ? quantityInput(thaanDetail(r, n).length, "mm")
                                : null,
                              cp_paise_per_m:
                                fabricMoneyInput(thaanDetail(r, n).cp) +
                                Math.round(
                                  (fabricMoneyInput(transportCharges) * 1000) /
                                    rows.reduce(
                                      (sum, entry) =>
                                        sum +
                                        Array.from({ length: Number(entry.quantity) }, (_, index) =>
                                          quantityInput(thaanDetail(entry, index).length, "mm"),
                                        ).reduce((a, b) => a + b, 0),
                                      0,
                                    ),
                                ),
                            })),
                          })),
                          imagePlan: {
                            types: rows.map((r) => ({
                              image: r.image,
                              pieces: Array.from(
                                { length: Number(r.quantity) },
                                (_, n) => thaanDetail(r, n).image ?? null,
                              ),
                            })),
                          },
                          purchase: hasSupplierInvoice
                            ? {
                                supplier_gstin: supplierGstin.trim(),
                                supplier_phone: supplierPhone.trim(),
                                supplier_email: supplierEmail.trim(),
                                supplier_address: supplierAddress.trim(),
                                invoice_number: supplierInvoice.trim(),
                                invoice_date: date,
                                itc_status: "eligible",
                                ...inclusivePurchaseAmounts(purchaseTotalPaise),
                                transport_paise: fabricMoneyInput(transportCharges),
                              }
                            : undefined,
                        });
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "Check actual Thaan details",
                        );
                      }
                    }}
                  >
                    Generate All Barcodes <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </Panel>
            </>
          )}
        </>
      )}
      {stage === "labels" && (
        <Panel
          title="Print Fabric Type Labels"
          description="Print all labels for one fabric type, then move to the next. Reprinting keeps the same barcodes."
        >
          <QueryState
            loading={catalog.isFetching && !batch}
            error={catalog.error}
            retry={() => void catalog.refetch()}
          />
          {batch && group && (
            <>
              <p className="font-semibold">
                {batch.code} / {batch.provider_name}
              </p>
              <p>
                {group.name} / {group.code} / Total: {group.variants.length}
              </p>
              <p>
                Fabric Type {groupIndex + 1} of {batch.fabric_types.length}
              </p>
              <div ref={labels} className="my-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.variants.map((v) => (
                  <BarcodeLabel key={v.id} variant={v} batch={batch} fabric={group} />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={frozen || groupIndex === 0}
                  onClick={() => setGroupIndex((i) => i - 1)}
                >
                  Previous Fabric Type
                </Button>
                <Button
                  disabled={frozen || !can("stock.print_barcode")}
                  onClick={() => {
                    try {
                      if (labels.current) {
                        printFabricLabel(labels.current, `${group.name} / ${batch.code}`);
                        setPrinted((old) => (old.includes(group.id) ? old : [...old, group.id]));
                      }
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Printing failed");
                    }
                  }}
                >
                  {printed.includes(group.id) ? "Print Again" : "Print All Labels for This Fabric"}
                </Button>
                {groupIndex < batch.fabric_types.length - 1 ? (
                  <Button disabled={frozen} onClick={() => setGroupIndex((i) => i + 1)}>
                    Next Fabric Type
                  </Button>
                ) : (
                  <Button
                    disabled={frozen}
                    onClick={() => {
                      setStage("home");
                    }}
                  >
                    Finish - Scan Thaans
                  </Button>
                )}
              </div>
            </>
          )}
          {batch && group && (
            <details className="mt-4 rounded border p-3">
              <summary>Add more labels to this batch</summary>
              <fieldset
                disabled={frozen || !can("stock.generate_labels")}
                className="mt-3 space-y-2"
              >
                <Label htmlFor="extra-count">Additional Thaan count</Label>
                <Input
                  id="extra-count"
                  inputMode="numeric"
                  value={extraCount}
                  onChange={(e) => setExtraCount(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!/^[1-9]\d*$/.test(extraCount) || Number(extraCount) > 500) {
                      toast.error("Enter 1-500 Thaans");
                      return;
                    }
                    run({ kind: "append", group: group.id, quantity: Number(extraCount) });
                  }}
                >
                  Add Thaans to this Fabric Type
                </Button>
                <Label htmlFor="extra-name">New Fabric Type name</Label>
                <PickOrTypeInput
                  id="extra-name"
                  value={extraName}
                  onChange={setExtraName}
                  options={fabricNames}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    if (
                      !extraName.trim() ||
                      !/^[1-9]\d*$/.test(extraCount) ||
                      Number(extraCount) > 500
                    ) {
                      toast.error("Enter a new fabric name and 1-500 Thaans");
                      return;
                    }
                    run({
                      kind: "fabric",
                      batch: batch.id,
                      name: extraName.trim(),
                      quantity: Number(extraCount),
                    });
                  }}
                >
                  Add New Fabric Type to Batch
                </Button>
              </fieldset>
            </details>
          )}
          <Button
            variant="ghost"
            className="mt-3"
            disabled={frozen}
            onClick={() => setStage("home")}
          >
            Back to Stock Entry
          </Button>
        </Panel>
      )}
      {stage === "resume" && resumeBatch && (
        <Panel
          title={`${resumeBatch.code} labels`}
          description={`${resumeBatch.kind === "materials" ? "Material units" : "Vendor ready-made garments"} · ${resumeBatch.labels.length} labels · ${resumeBatch.provider || "No supplier"}`}
        >
          <div ref={labels} className="my-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {resumeBatch.labels.map((label) => (
              <BarcodeSticker
                key={label.id}
                barcode={label.barcode}
                name={label.name}
                description={label.description}
                detail={label.detail}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={frozen}
              onClick={() => {
                setResumeBatch(null);
                setStage("home");
              }}
            >
              Back
            </Button>
            <Button
              disabled={frozen || !can("stock.print_barcode")}
              onClick={() => {
                try {
                  if (labels.current) {
                    printFabricLabel(labels.current, `${resumeBatch.code} labels`);
                  }
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Printing failed");
                }
              }}
            >
              Print all {resumeBatch.labels.length} labels
            </Button>
          </div>
        </Panel>
      )}
      <p className="text-sm text-muted-foreground">
        Unmeasured labels are not available stock. Length is received into Workshop only when actual
        details are saved.
      </p>
    </div>
  );
}
