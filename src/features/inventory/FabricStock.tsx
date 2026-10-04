import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import {
  useBatches,
  useCreateBatch,
  useEnsureFabric,
  useEnsureSupplier,
  useFabrics,
  useSuppliers,
} from "@/features/inventory";
import { quantityInput } from "./ledger-quantity";
import { fabricBarcodeBars, printFabricLabel } from "./fabric-label";
import { fabricMoneyInput } from "./fabric-entry-input";
import { formatMoney } from "@/shared/utils/units";
import { Panel, EmptyState } from "@/shared/components/page";
import { PickOrTypeInput } from "@/shared/components/pick-or-type";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type FabricRecord = {
  id: string;
  fabric_id: string;
  fabric_code: string;
  fabric_name: string;
  batch_id: string;
  batch_code: string;
  barcode: string;
  entry_state: string;
  created_by: string | null;
  original_mm: number;
  available_mm: number;
  sp_paise_per_m: number | null;
  unlocated_thans: number;
  thans: { id: string; original_mm: number | null; status: string }[];
  locations: { id: string; name: string; quantity_mm: number }[];
};
type History = {
  id: string;
  kind: string;
  thaan_id: string;
  quantity: number;
  reference: string | null;
  reason: string;
  actor_id: string;
  occurred_at: string;
  source_location_id: string | null;
  destination_location_id: string | null;
};
function metres(mm: number | null) {
  return mm === null ? "—" : `${mm / 1000} m`;
}

export function FabricStock({
  receiving = false,
  scanOnly = false,
}: {
  receiving?: boolean;
  scanOnly?: boolean;
}) {
  const { isOwner, roles, userId, can } = useSession();
  const mayReceive = isOwner || (roles.includes("stock_entry") && can("inventory.receive"));
  const qc = useQueryClient();
  const stock = useQuery({
    queryKey: ["fabric-stock"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fabric_stock_catalog", {});
      if (error) throw error;
      return data as unknown as FabricRecord[];
    },
  });
  const batches = useBatches(receiving && mayReceive);
  const createBatch = useCreateBatch();
  const fabrics = useFabrics();
  const suppliers = useSuppliers();
  const ensureFabric = useEnsureFabric();
  const ensureSupplier = useEnsureSupplier();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = (stock.data ?? []).find((s) => s.id === selectedId);
  const ownOpen = Boolean(
    selected &&
    (isOwner || (selected.created_by === userId && mayReceive)) &&
    ["draft", "correcting"].includes(selected.entry_state),
  );
  const cp = useQuery({
    queryKey: ["fabric-entry-cp", selectedId, selected?.entry_state],
    enabled: Boolean(selected && (isOwner || ownOpen)),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("domain_stock_entry_cp", {
        p_stock_id: selectedId!,
      });
      if (error) throw error;
      return data;
    },
  });
  const history = useQuery({
    queryKey: ["fabric-stock-history", selectedId],
    enabled: Boolean(selected),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fabric_stock_history", { p_stock: selectedId! });
      if (error) throw error;
      return data as unknown as History[];
    },
  });
  const [scan, setScan] = useState("");
  const [filter, setFilter] = useState("");
  const [batch, setBatch] = useState("");
  const [supplier, setSupplier] = useState("");
  const [bill, setBill] = useState("");
  const [fabric, setFabric] = useState("");
  const [lengths, setLengths] = useState("10");
  const [newCp, setNewCp] = useState("");
  const [editCp, setEditCp] = useState("");
  const [editLengths, setEditLengths] = useState<Record<string, string>>({});
  const [sp, setSp] = useState("");
  const [reason, setReason] = useState("");
  const request = useRef<{ payload: string; id: string } | null>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const bars = useMemo(() => (selected ? fabricBarcodeBars(selected.barcode) : ""), [selected]);
  useEffect(() => {
    setReason("");
    setSp(
      selected?.sp_paise_per_m === null || selected?.sp_paise_per_m === undefined
        ? ""
        : String(selected.sp_paise_per_m / 100),
    );
    setEditLengths(
      Object.fromEntries(
        (selected?.thans ?? []).map((t) => [
          t.id,
          t.original_mm === null ? "" : String(t.original_mm / 1000),
        ]),
      ),
    );
  }, [selected]);
  useEffect(() => {
    setEditCp(cp.data === null || cp.data === undefined ? "" : String(cp.data / 100));
  }, [cp.data, selectedId, selected?.entry_state]);
  const action = useMutation({
    mutationFn: async (work: () => Promise<void>) => work(),
    onSettled: async () => {
      await qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Operation failed"),
  });
  const run = (work: () => Promise<void>) => action.mutate(work);
  const editable = selected?.entry_state === "draft" && ownOpen;
  const draftBatches = (batches.data ?? []).filter(
    (b) => b.status === "draft" && (isOwner || b.created_by === userId),
  );
  async function check<T>(result: { data: T; error: { message: string } | null }): Promise<T> {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }
  async function saveDraft() {
    if (!selected) return;
    const rows = selected.thans.map((t) => ({
      id: t.id,
      length_mm: quantityInput(editLengths[t.id] ?? "", "mm"),
    }));
    await check(
      await supabase.rpc("update_fabric_entry", {
        p_stock: selected.id,
        p_lengths: rows,
        p_cp: fabricMoneyInput(editCp),
      }),
    );
  }
  async function createEntry() {
    if (!batch) throw new Error("Select an open batch");
    const mm = lengths
      .split(/[\n,]+/)
      .filter((s) => s.trim())
      .map((s) => quantityInput(s, "mm"));
    if (mm.length === 0) throw new Error("Enter at least one Than length");
    const price = fabricMoneyInput(newCp);
    const fabricId = await ensureFabric.mutateAsync(fabric);
    if (!fabricId) throw new Error("Fabric required");
    const payload = JSON.stringify([fabricId, batch, mm, price]);
    if (request.current?.payload !== payload)
      request.current = { payload, id: crypto.randomUUID() };
    const id = await check(
      await supabase.rpc("create_fabric_entry", {
        p_request_id: request.current.id,
        p_fabric: fabricId,
        p_batch: batch,
        p_lengths: mm,
        p_cp: price,
      }),
    );
    setSelectedId(id);
    setNewCp("");
    request.current = null;
    toast.success("Fabric Stock saved — one barcode generated");
  }
  const disabled = action.isPending || stock.isPending;
  return (
    <div className="space-y-4">
      {receiving && mayReceive ? (
        <Panel
          title="Enter Fabric Stock"
          description="One Fabric + Batch barcode. Enter each internal Than's length; stock enters Workshop when completed. SP can be added later by Owner."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <Label htmlFor="fabric-batch">Batch</Label>
              <select
                id="fabric-batch"
                className="h-11 w-full rounded border bg-background p-2"
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                disabled={disabled}
              >
                <option value="">Select an open batch</option>
                {draftBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code}
                  </option>
                ))}
              </select>
              <Label>Supplier (optional)</Label>
              <PickOrTypeInput
                value={supplier}
                onChange={setSupplier}
                options={(suppliers.data ?? []).map((s) => s.name)}
                placeholder="Select or enter supplier"
              />
              <Input
                aria-label="Bill number"
                value={bill}
                onChange={(e) => setBill(e.target.value)}
                placeholder="Bill number (optional)"
                disabled={disabled}
              />
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  run(async () => {
                    const supplierId = await ensureSupplier.mutateAsync(supplier);
                    const b = await createBatch.mutateAsync({
                      supplier_id: supplierId,
                      bill_no: bill,
                      notes: "",
                    });
                    setBatch(b.id);
                    toast.success("Batch created");
                  })
                }
              >
                Create new batch
              </Button>
            </div>
            <div className="space-y-3">
              <Label>Fabric</Label>
              <PickOrTypeInput
                value={fabric}
                onChange={setFabric}
                options={(fabrics.data ?? []).map((f) => f.name)}
                placeholder="Select or enter Fabric"
              />
              <Label htmlFor="than-lengths">
                Than lengths (m), one per line or comma separated
              </Label>
              <Textarea
                id="than-lengths"
                value={lengths}
                onChange={(e) => setLengths(e.target.value)}
                disabled={disabled}
              />
              <Label htmlFor="entry-cp">CP / Lagat (₹ per metre)</Label>
              <Input
                id="entry-cp"
                value={newCp}
                onChange={(e) => setNewCp(e.target.value)}
                inputMode="decimal"
                disabled={disabled}
              />
              <Button
                disabled={disabled || !batch || !fabric.trim()}
                onClick={() => run(createEntry)}
              >
                Save stock &amp; generate Fabric Barcode
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}
      <Panel
        title="Scan Fabric Barcode"
        description="A keyboard barcode scanner or manual entry opens the same Fabric + Batch record for every authorized role."
      >
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const found = (await check(
                await supabase.rpc("fabric_stock_catalog", { p_barcode: scan.trim() }),
              )) as unknown as FabricRecord[];
              if (found.length !== 1)
                throw new Error(
                  "Fabric Barcode not found. Historical roll labels remain in legacy inventory.",
                );
              setSelectedId(found[0]!.id);
              setScan("");
            });
          }}
        >
          <Input
            aria-label="Fabric Barcode"
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            autoComplete="off"
            placeholder="Scan Fabric Barcode and press Enter"
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
            disabled={disabled}
          />
          <Button disabled={disabled || !scan.trim()}>Scan</Button>
        </form>
      </Panel>
      {stock.error ? (
        <p role="alert" className="text-destructive">
          {stock.error.message}
        </p>
      ) : null}
      {!scanOnly ? (
        <Panel
          title="Fabric Stock"
          description="Each row has one stable Fabric Barcode. Individual Thans remain internal."
        >
          <Input
            aria-label="Search Fabric Stock"
            placeholder="Search Fabric, Batch or Fabric Barcode"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {stock.isPending ? (
            <p>Loading Fabric Stock…</p>
          ) : stock.data?.length ? (
            <div className="mt-3 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Fabric / Batch</th>
                    <th>Fabric Barcode</th>
                    <th>Thans</th>
                    <th>Available</th>
                    <th>SP / m</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.data
                    .filter((s) =>
                      [s.fabric_name, s.batch_code, s.barcode]
                        .join(" ")
                        .toLowerCase()
                        .includes(filter.toLowerCase()),
                    )
                    .map((s) => (
                      <tr key={s.id} className="border-t">
                        <td className="py-3">
                          <Button variant="link" onClick={() => setSelectedId(s.id)}>
                            {s.fabric_name} / {s.batch_code}
                          </Button>
                        </td>
                        <td className="break-all font-mono text-xs">{s.barcode}</td>
                        <td>{s.thans.length}</td>
                        <td>{metres(s.available_mm)}</td>
                        <td>{formatMoney(s.sp_paise_per_m, true)}</td>
                        <td>{s.entry_state}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No Fabric Stock"
              description="Create a stock entry or reconcile existing identities."
            />
          )}
        </Panel>
      ) : null}
      {selected ? (
        <Panel title={`${selected.fabric_name} — ${selected.batch_code}`}>
          <div className="space-y-4">
            <div ref={labelRef} className="rounded border bg-white p-4 text-black">
              <p className="font-semibold">{selected.fabric_name}</p>
              <p>
                Fabric ID: {selected.fabric_code} · Batch: {selected.batch_code}
              </p>
              <svg
                role="img"
                aria-label={`Fabric Barcode ${selected.barcode}`}
                viewBox={`0 0 ${bars.length + 40} 65`}
                preserveAspectRatio="xMidYMid meet"
                className="h-24 w-full max-w-[600px]"
              >
                <rect width={bars.length + 40} height="65" fill="white" />
                {Array.from(bars).map((bit, i) =>
                  bit === "1" ? (
                    <rect key={i} x={20 + i} y="4" width="1" height="55" fill="black" />
                  ) : null,
                )}
              </svg>
              <p className="break-all font-mono">{selected.barcode}</p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                try {
                  if (labelRef.current) printFabricLabel(labelRef.current);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Printing failed");
                }
              }}
            >
              Print Fabric Barcode label
            </Button>
            <p>
              {selected.thans.length} Thans · original {metres(selected.original_mm)} · available{" "}
              {metres(selected.available_mm)} · SP {formatMoney(selected.sp_paise_per_m, true)} / m
            </p>
            {selected.locations.map((l) => (
              <p key={l.id}>
                {l.name}: {metres(l.quantity_mm)}
              </p>
            ))}
            {selected.unlocated_thans > 0 ? (
              <p>
                {selected.unlocated_thans} historical Thans still need explicit location
                reconciliation. No Workshop location is assumed.
              </p>
            ) : null}
            {selected.entry_state === "legacy_pending" ? (
              <p>
                Historical Fabric + Batch identity. Preserve old roll labels; use Locations &amp;
                transfers for quantity reconciliation.
              </p>
            ) : null}
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Internal Than</th>
                    <th>Length</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.thans.map((t, i) => (
                    <tr key={t.id} className="border-t">
                      <td className="py-2">
                        Than {i + 1}
                        <span className="ml-2 text-xs text-muted-foreground">{t.id}</span>
                      </td>
                      <td>
                        {editable ? (
                          <Input
                            aria-label={`Than ${i + 1} length in metres`}
                            value={editLengths[t.id] ?? ""}
                            onChange={(e) =>
                              setEditLengths({ ...editLengths, [t.id]: e.target.value })
                            }
                            disabled={disabled}
                            inputMode="decimal"
                          />
                        ) : (
                          metres(t.original_mm)
                        )}
                      </td>
                      <td>{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {isOwner || ownOpen ? (
              <div className="space-y-2">
                <Label htmlFor="stock-cp">CP / Lagat (₹ per metre)</Label>
                {cp.error ? (
                  <p role="alert">{cp.error.message}</p>
                ) : (
                  <Input
                    id="stock-cp"
                    value={editCp}
                    onChange={(e) => setEditCp(e.target.value)}
                    inputMode="decimal"
                    disabled={!ownOpen || disabled || cp.isPending}
                  />
                )}
              </div>
            ) : null}
            {ownOpen ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={disabled || cp.isPending || Boolean(cp.error)}
                  onClick={() =>
                    run(async () => {
                      if (editable) await saveDraft();
                      else
                        await check(
                          await supabase.rpc("domain_stock_entry_cp", {
                            p_stock_id: selected.id,
                            p_cp: fabricMoneyInput(editCp),
                          }),
                        );
                      toast.success("Stock-entry correction saved");
                    })
                  }
                >
                  Save {editable ? "draft" : "CP correction"}
                </Button>
                <Button
                  disabled={disabled || cp.isPending || Boolean(cp.error)}
                  onClick={() =>
                    run(async () => {
                      if (editable) await saveDraft();
                      else
                        await check(
                          await supabase.rpc("domain_stock_entry_cp", {
                            p_stock_id: selected.id,
                            p_cp: fabricMoneyInput(editCp),
                          }),
                        );
                      await check(
                        await supabase.rpc("complete_fabric_entry", { p_stock: selected.id }),
                      );
                      setEditCp("");
                      setNewCp("");
                      qc.removeQueries({ queryKey: ["fabric-entry-cp", selected.id] });
                      toast.success(
                        editable
                          ? "Received into Workshop — SP may be added later"
                          : "CP correction completed",
                      );
                    })
                  }
                >
                  {editable ? "Complete Workshop receipt" : "Close CP correction"}
                </Button>
              </div>
            ) : null}
            {isOwner ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="stock-sp">SP / Selling Price (₹ per metre)</Label>
                  <Input
                    id="stock-sp"
                    value={sp}
                    onChange={(e) => setSp(e.target.value)}
                    inputMode="decimal"
                    disabled={disabled}
                  />
                  <Input
                    aria-label="Price or correction reason"
                    placeholder="Reason for price/correction"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    disabled={disabled}
                  />
                  <Button
                    disabled={disabled || !reason.trim()}
                    onClick={() =>
                      run(async () => {
                        await check(
                          await supabase.rpc("owner_set_fabric_sp", {
                            p_stock: selected.id,
                            p_sp: fabricMoneyInput(sp),
                            p_reason: reason,
                          }),
                        );
                        toast.success("SP updated — same Fabric Barcode");
                      })
                    }
                  >
                    Set / update SP
                  </Button>
                </div>
                {selected.entry_state === "complete" ? (
                  <div>
                    <p>
                      Open a scoped CP correction for this stock's original entry user. Quantity and
                      barcode stay unchanged.
                    </p>
                    <Button
                      variant="outline"
                      disabled={disabled || !reason.trim()}
                      onClick={() =>
                        run(async () => {
                          await check(
                            await supabase.rpc("open_fabric_cp_correction", {
                              p_stock: selected.id,
                              p_reason: reason,
                            }),
                          );
                          toast.success("CP correction opened");
                        })
                      }
                    >
                      Open CP correction
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div>
              <h3 className="font-semibold">Movement history (latest 200)</h3>
              {history.error ? (
                <p role="alert">{history.error.message}</p>
              ) : history.isPending ? (
                <p>Loading history…</p>
              ) : history.data?.length ? (
                history.data.map((h) => (
                  <div key={h.id} className="border-t py-2 text-sm">
                    <p>
                      {new Date(h.occurred_at).toLocaleString()} · {h.kind} · {metres(h.quantity)}
                    </p>
                    <p>
                      {h.reference} · {h.reason}
                    </p>
                    <p className="break-all text-xs">
                      Than {h.thaan_id} · User {h.actor_id} · Source {h.source_location_id ?? "—"} →
                      Destination {h.destination_location_id ?? "—"}
                    </p>
                  </div>
                ))
              ) : (
                <p>No location movements yet.</p>
              )}
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
