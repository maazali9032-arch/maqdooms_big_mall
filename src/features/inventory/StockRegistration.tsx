import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { reportMoney, reportQuantity } from "@/features/reports/report-value";
import { fabricBarcodeBars, printFabricLabel } from "./fabric-label";
import { definiteDatabaseRejection } from "./consumable-input";
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
type Details = {
  code: string;
  batch_code: string;
  supplier: string;
  fabric_type: string;
  original_mm: number | null;
  saved_length_mm: number | null;
  colour: string | null;
  measured: boolean;
  can_complete: boolean;
  cp_visible: boolean;
  cp_missing: boolean;
  cp_paise_per_m: number | null;
  available_mm: number | null;
  status: string;
  locations: { id: string; name: string; quantity_mm: number }[];
};
type Legacy = {
  barcode: string;
  fabric_name: string;
  batch_code: string;
  available_mm: number;
  thans: { id: string; original_mm: number | null; status: string }[];
  locations: { id: string; name: string; quantity_mm: number }[];
};
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
  expanded: boolean;
  details: { colour: string; length: string; cp: string }[];
};
const emptyRow = (): EntryRow => ({
  id: crypto.randomUUID(),
  name: "",
  quantity: "",
  expanded: false,
  details: [],
});
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
    <article className="break-inside-avoid rounded border bg-white p-3 text-black">
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
  const [stage, setStage] = useState<"home" | "create" | "labels">("home");
  const [provider, setProvider] = useState("");
  const [date, setDate] = useState(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  const [remarks, setRemarks] = useState("");
  const [rows, setRows] = useState<EntryRow[]>([emptyRow()]);
  const [batchId, setBatchId] = useState("");
  const [groupIndex, setGroupIndex] = useState(0);
  const [extraCount, setExtraCount] = useState("");
  const [extraName, setExtraName] = useState("");
  const [printed, setPrinted] = useState<string[]>([]);
  const labels = useRef<HTMLDivElement>(null);
  const [barcode, setBarcode] = useState("");
  const [scanned, setScanned] = useState("");
  const [colour, setColour] = useState("");
  const [length, setLength] = useState("");
  const [cp, setCp] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const catalog = useQuery({
    queryKey: ["stock-registration", userId],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("stock_registration_catalog", {});
      if (error) throw error;
      return data as unknown as Batch[];
    },
  });
  const lookup = useQuery({
    queryKey: ["stock-registration-scan", userId, scanned],
    enabled: allowed && !!scanned,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("registered_thaan_details", {
        p_barcode: scanned,
      });
      if (error) throw error;
      if (data) return { registered: data as unknown as Details, legacy: null };
      const fallback = await supabase.rpc("fabric_stock_catalog", { p_barcode: scanned });
      if (fallback.error) throw fallback.error;
      return { registered: null, legacy: (fallback.data as unknown as Legacy[])[0] ?? null };
    },
  });
  const details = lookup.data?.registered;
  const legacy = lookup.data?.legacy;
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
              ? await supabase.rpc("create_barcode_batch_with_details", {
                  p_request: args.request,
                  p_provider: w.provider,
                  p_arrival_date: w.date,
                  p_remarks: w.remarks,
                  p_fabrics: w.fabrics,
                })
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
      return result.data;
    },
    onSuccess: async (id, args) => {
      setPending(null);
      if (args.work.kind === "batch") {
        setBatchId(id);
        setGroupIndex(0);
        setPrinted([]);
        setStage("labels");
        setRows([emptyRow()]);
      } else if (args.work.kind === "append" || args.work.kind === "fabric") {
        setExtraCount("");
        setExtraName("");
        if (args.work.kind === "append") setPrinted([]);
      } else {
        setColour("");
        setLength("");
        setCp("");
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
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Panel
              title="Scan Existing Barcode"
              description="Scan a fabric Thaan to view its details and complete missing information."
            >
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!frozen && barcode.trim()) {
                    setScanned(barcode.trim());
                    setColour("");
                    setLength("");
                    setCp("");
                    void qc.invalidateQueries({
                      queryKey: ["stock-registration-scan", userId, barcode.trim()],
                    });
                  }
                }}
              >
                <Input
                  aria-label="Thaan barcode"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="Scan barcode and press Enter"
                  disabled={frozen}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button disabled={frozen || !barcode.trim()}>Scan Thaan</Button>
              </form>
              {!!scanned && (
                <QueryState
                  loading={lookup.isPending}
                  error={lookup.error}
                  retry={() => void lookup.refetch()}
                />
              )}
              {details && !lookup.error && (
                <div className="mt-4 space-y-3 rounded border p-3">
                  <p className="break-all font-semibold">{details.code}</p>
                  <p>
                    {details.batch_code} / {details.supplier} / {details.fabric_type}
                  </p>
                  <p>Colour: {details.colour || "Not recorded"}</p>
                  <p>Saved length: {metres(details.saved_length_mm)}</p>
                  <p>Available stock: {metres(details.available_mm)}</p>
                  <p>
                    CP / metre:{" "}
                    {details.cp_visible
                      ? details.cp_paise_per_m === null
                        ? "Not recorded"
                        : reportMoney(String(details.cp_paise_per_m))
                      : "Restricted"}
                  </p>
                  <p>
                    Status:{" "}
                    {details.measured
                      ? details.status
                      : "Awaiting actual measurement - unavailable for transfer or sale"}
                  </p>
                  {details.locations.map((l) => (
                    <p key={l.id}>
                      {l.name}: {metres(Number(l.quantity_mm))}
                    </p>
                  ))}
                  {details.can_complete && (!details.measured || !details.colour) && (
                    <fieldset disabled={frozen} className="space-y-2">
                      {!details.colour && (
                        <>
                          <Label htmlFor="measured-colour">Actual colour</Label>
                          <Input
                            id="measured-colour"
                            value={colour}
                            onChange={(e) => setColour(e.target.value)}
                          />
                        </>
                      )}
                      {details.saved_length_mm === null && (
                        <>
                          <Label htmlFor="measured-length">Actual length (metres)</Label>
                          <Input
                            id="measured-length"
                            inputMode="decimal"
                            value={length}
                            onChange={(e) => setLength(e.target.value)}
                          />
                        </>
                      )}
                      {details.cp_missing &&
                        (!details.measured || can("inventory.fill_missing_cp")) && (
                          <>
                            <Label htmlFor="measured-cp">CP per metre (optional)</Label>
                            <Input
                              id="measured-cp"
                              inputMode="decimal"
                              value={cp}
                              onChange={(e) => setCp(e.target.value)}
                            />
                          </>
                        )}
                      <Button
                        type="button"
                        disabled={!colour.trim() && !length.trim() && !cp.trim()}
                        onClick={() => {
                          try {
                            run({
                              kind: "details",
                              barcode: details.code,
                              colour: colour.trim() || null,
                              length: length.trim() ? quantityInput(length, "mm") : null,
                              cp: cp.trim() ? fabricMoneyInput(cp) : null,
                            });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Invalid details");
                          }
                        }}
                      >
                        Save actual Thaan details
                      </Button>
                    </fieldset>
                  )}
                  {details.can_complete &&
                    details.measured &&
                    details.colour &&
                    details.cp_missing &&
                    can("inventory.fill_missing_cp") && (
                      <fieldset disabled={frozen} className="space-y-2">
                        <Label htmlFor="delayed-cp">Missing CP per metre</Label>
                        <Input
                          id="delayed-cp"
                          value={cp}
                          onChange={(e) => setCp(e.target.value)}
                          inputMode="decimal"
                        />
                        <Button
                          type="button"
                          disabled={!cp.trim()}
                          onClick={() => {
                            try {
                              run({ kind: "cp", barcode: details.code, cp: fabricMoneyInput(cp) });
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Invalid CP");
                            }
                          }}
                        >
                          Save missing CP
                        </Button>
                      </fieldset>
                    )}
                </div>
              )}
              {legacy && !lookup.error && (
                <div className="mt-4 rounded border p-3">
                  <p>
                    {legacy.barcode} / {legacy.fabric_name} / {legacy.batch_code}
                  </p>
                  <p>Available: {metres(Number(legacy.available_mm))}</p>
                  {legacy.thans.map((t) => (
                    <p key={t.id}>
                      Thaan {t.id.slice(0, 8)} / {metres(t.original_mm)} / {t.status}
                    </p>
                  ))}
                  {legacy.locations.map((l) => (
                    <p key={l.id}>
                      {l.name}: {metres(Number(l.quantity_mm))}
                    </p>
                  ))}
                  <p>Existing stock record; corrections use the established inventory workflow.</p>
                </div>
              )}
              {scanned && !lookup.isPending && !lookup.error && !details && !legacy && (
                <p>No fabric barcode found.</p>
              )}
            </Panel>
            <Panel
              title="Create Batch"
              description="Register arrival details and Thaan counts, then print labels by fabric type."
            >
              <Button
                disabled={frozen || !can("stock.generate_labels")}
                onClick={() => setStage("create")}
              >
                Create Batch
              </Button>
              <p className="mt-3 text-sm text-muted-foreground">
                Colour, actual length and CP can be entered during creation or after attaching
                labels.
              </p>
            </Panel>
          </div>
          <Panel title="Previous batches">
            <QueryState
              loading={catalog.isPending}
              error={catalog.error}
              retry={() => void catalog.refetch()}
            />
            <select
              aria-label="Previous batch"
              className="h-11 w-full rounded border bg-background p-2"
              value={batchId}
              disabled={frozen}
              onChange={(e) => setBatchId(e.target.value)}
            >
              <option value="">Select a batch to resume printing</option>
              {catalog.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} / {b.provider_name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              className="mt-2"
              disabled={frozen || !batch?.fabric_types.length}
              onClick={() => {
                setGroupIndex(0);
                setStage("labels");
              }}
            >
              Open batch labels
            </Button>
          </Panel>
        </>
      )}
      {stage === "create" && (
        <>
          <Panel title="Batch Information">
            <fieldset disabled={frozen} className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Batch ID</Label>
                <Input value="Auto-generated when labels are created" readOnly />
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
                  onChange={setProvider}
                  options={names}
                />
              </div>
              <div>
                <Label htmlFor="batch-remarks">Remarks (optional)</Label>
                <Input
                  id="batch-remarks"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              </div>
            </fieldset>
          </Panel>
          <Panel
            title="Fabric Types & Quantities"
            description="Enter physical Thaan counts, not metres."
          >
            <fieldset disabled={frozen} className="space-y-3">
              {rows.map((r, i) => (
                <div
                  key={r.id}
                  className="grid gap-2 rounded border p-3 sm:grid-cols-[1fr_120px_auto]"
                >
                  <div>
                    <Label htmlFor={`type-${r.id}`}>Fabric Type {i + 1}</Label>
                    <PickOrTypeInput
                      id={`type-${r.id}`}
                      value={r.name}
                      options={fabricNames}
                      onChange={(name) =>
                        setRows((old) =>
                          old.map((row) => (row.id === r.id ? { ...row, name } : row)),
                        )
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor={`count-${r.id}`}>Thaan count {i + 1}</Label>
                    <Input
                      id={`count-${r.id}`}
                      inputMode="numeric"
                      value={r.quantity}
                      onChange={(e) =>
                        setRows((old) =>
                          old.map((row) =>
                            row.id === r.id ? { ...row, quantity: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="min-w-0 sm:col-span-full">
                    <Button
                      type="button"
                      variant="outline"
                      aria-expanded={r.expanded}
                      aria-controls={`details-${r.id}`}
                      disabled={!/^[1-9]\d*$/.test(r.quantity) || Number(r.quantity) > 500}
                      onClick={() =>
                        setRows((old) =>
                          old.map((row) =>
                            row.id === r.id ? { ...row, expanded: !row.expanded } : row,
                          ),
                        )
                      }
                    >
                      {r.expanded ? "Hide" : "Enter"} optional Thaan details {i + 1}
                    </Button>
                    {r.expanded && (
                      <div id={`details-${r.id}`} className="mt-3 space-y-3">
                        <p>
                          Optional: enter actual details now or leave blank and complete by
                          scanning. Stock becomes available only when colour and length are
                          recorded.
                        </p>
                        {Array.from(
                          { length: Math.min(500, Math.max(0, Number(r.quantity) || 0)) },
                          (_, n) => (
                            <div key={n} className="grid gap-2 rounded border p-3 sm:grid-cols-3">
                              <p className="font-semibold sm:col-span-full">
                                Thaan {n + 1} � barcode generated on save
                              </p>
                              {(
                                [
                                  ["colour", "Colour"],
                                  ["length", "Length (metres)"],
                                  ["cp", "CP per metre (optional)"],
                                ] as const
                              ).map(([field, label]) => (
                                <div key={field}>
                                  <Label htmlFor={`${r.id}-${n}-${field}`}>
                                    {label} � fabric {i + 1}, Thaan {n + 1}
                                  </Label>
                                  <Input
                                    id={`${r.id}-${n}-${field}`}
                                    value={r.details[n]?.[field] ?? ""}
                                    disabled={!can("stock.measure_thaan")}
                                    inputMode={field === "colour" ? "text" : "decimal"}
                                    onChange={(e) =>
                                      setRows((old) =>
                                        old.map((row) => {
                                          if (row.id !== r.id) return row;
                                          const details = [...row.details];
                                          details[n] = {
                                            colour: "",
                                            length: "",
                                            cp: "",
                                            ...details[n],
                                            [field]: e.target.value,
                                          };
                                          return { ...row, details };
                                        }),
                                      )
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={rows.length === 1}
                    onClick={() => setRows((old) => old.filter((row) => row.id !== r.id))}
                  >
                    Remove Fabric Type {i + 1}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={rows.length >= 100}
                onClick={() => setRows((old) => [...old, emptyRow()])}
              >
                Add Another Fabric Type
              </Button>
            </fieldset>
          </Panel>
          <Panel title="Batch Summary">
            <p>Total Thaans: {total}</p>
            <p>Fabric Types: {rows.length}</p>
            <p>Estimated Barcodes: {total}</p>
            <p className="my-3">
              Print one fabric type at a time, attach its labels, then scan each Thaan to record
              actual details.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={frozen} onClick={() => setStage("home")}>
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
                      rows.some((r) =>
                        r.details
                          .slice(Number(r.quantity))
                          .some((d) => d && (d.colour.trim() || d.length.trim() || d.cp.trim())),
                      )
                    )
                      throw new Error(
                        "Thaan count would discard entered details; restore the count or clear those rows first",
                      );
                    run({
                      kind: "batch",
                      provider: provider.trim(),
                      date,
                      remarks: remarks.trim() || null,
                      fabrics: rows.map((r) => ({
                        name: r.name.trim(),
                        quantity: Number(r.quantity),
                        rows: Array.from({ length: Number(r.quantity) }, (_, n) => ({
                          colour: r.details[n]?.colour.trim() || null,
                          length_mm: r.details[n]?.length.trim()
                            ? quantityInput(r.details[n].length, "mm")
                            : null,
                          cp_paise_per_m: r.details[n]?.cp.trim()
                            ? fabricMoneyInput(r.details[n].cp)
                            : null,
                        })),
                      })),
                    });
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : "Check actual Thaan details",
                    );
                  }
                }}
              >
                Generate All Barcodes
              </Button>
            </div>
          </Panel>
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
                      setScanned("");
                      setBarcode("");
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
      <p className="text-sm text-muted-foreground">
        Unmeasured labels are not available stock. Length is received into Workshop only when actual
        details are saved.
      </p>
    </div>
  );
}
