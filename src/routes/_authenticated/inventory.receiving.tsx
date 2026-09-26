import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useBatches,
  useCommitBatch,
  useCreateBatch,
  useEnsureFabric,
  useEnsureSupplier,
  useFabrics,
  useScanThaan,
  useSuppliers,
  useThaanCosts,
  useThaans,
  useUpdateThaans,
  type ThaanOverview,
} from "@/features/inventory";
import { useSession } from "@/app/providers/session";
import { ThaanEditor } from "@/features/inventory/ThaanEditor";
import { PickOrTypeInput } from "@/shared/components/pick-or-type";
import { PageHeader, Panel, StatusBadge, EmptyState } from "@/shared/components/page";
import { formatMetres, formatMoney, parseMetreInput, parseRupeeInput } from "@/shared/utils/units";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/inventory/receiving")({
  head: () => ({
    meta: [
      { title: "Enter New Stock — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content: "Barcode-driven stock receiving with bulk edit and batch commit.",
      },
      { property: "og:title", content: "Enter New Stock — Maqdoom's Big Mall ERP" },
      {
        property: "og:description",
        content: "Barcode-driven stock receiving with bulk edit and batch commit.",
      },
    ],
  }),
  component: ReceivingPage,
});

function ReceivingPage() {
  const batches = useBatches();
  const suppliers = useSuppliers();
  const fabrics = useFabrics();
  const thaans = useThaans();
  const createBatch = useCreateBatch();
  const scan = useScanThaan();
  const update = useUpdateThaans();
  const commit = useCommitBatch();
  const ensureSupplier = useEnsureSupplier();
  const ensureFabric = useEnsureFabric();
  const costs = useThaanCosts();
  const { can } = useSession();
  const showCost = can("inventory.view_cost");
  const costMap = new Map((costs.data ?? []).map((c) => [c.thaan_id, c.cost_paise]));
  const fabricNames = (fabrics.data ?? []).map((f) => f.name);
  const [editing, setEditing] = useState<ThaanOverview | null>(null);

  const [batchId, setBatchId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [billNo, setBillNo] = useState("");
  const [barcode, setBarcode] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState({ fabric: "", length: "", width: "", price: "", cost: "" });
  const scanRef = useRef<HTMLInputElement>(null);

  const draftBatches = (batches.data ?? []).filter((b) => b.status === "draft");
  useEffect(() => {
    if (!batchId && draftBatches.length) setBatchId(draftBatches[0]!.id);
  }, [batchId, draftBatches]);

  const rows = useMemo(
    () => (thaans.data ?? []).filter((t) => t.batch_id === batchId),
    [thaans.data, batchId],
  );

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    const code = barcode.trim();
    if (!code || !batchId) return;
    setBarcode("");
    try {
      await scan.mutateAsync({ batch_id: batchId, barcode: code });
      toast.success(`${code} added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scan failed");
    }
    scanRef.current?.focus();
  }

  async function applyBulk() {
    if (!selected.length) {
      toast.error("Select at least one scanned row");
      return;
    }
    try {
      const fabricId = bulk.fabric ? await ensureFabric.mutateAsync(bulk.fabric) : undefined;
      await update.mutateAsync({
        ids: selected,
        patch: {
          fabric_id: fabricId ?? undefined,
          original_mm: bulk.length ? parseMetreInput(bulk.length) : undefined,
          width_mm: bulk.width ? parseMetreInput(bulk.width) : undefined,
          price_paise: bulk.price ? parseRupeeInput(bulk.price) : undefined,
        },
        cost_paise: bulk.cost ? parseRupeeInput(bulk.cost) : undefined,
      });
      toast.success(`Applied to ${selected.length} thaan(s)`);
      setSelected([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk edit failed");
    }
  }

  async function handleCommit() {
    if (!batchId) return;
    try {
      const result = await commit.mutateAsync(batchId);
      toast.success(
        `${result.activated} thaan(s) activated${result.incomplete ? `, ${result.incomplete} left incomplete` : ""}`,
      );
      setBatchId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Commit failed");
    }
  }

  return (
    <>
      <PageHeader
        title="Enter New Stock"
        description="Scan continuously — rows append instantly, details can be filled in afterwards."
        actions={
          <Button
            size="sm"
            onClick={handleCommit}
            disabled={!batchId || !rows.length || commit.isPending}
          >
            Commit receiving batch
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Panel title="Step 1 — Receiving batch">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Open batch</Label>
                <Select value={batchId ?? ""} onValueChange={setBatchId}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select a draft batch" />
                  </SelectTrigger>
                  <SelectContent>
                    {draftBatches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="supplier">Supplier</Label>
                <PickOrTypeInput
                  id="supplier"
                  value={supplierName}
                  onChange={setSupplierName}
                  options={(suppliers.data ?? []).map((sp) => sp.name)}
                  placeholder="Select or type a new supplier"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bill">Bill number</Label>
                <Input
                  id="bill"
                  value={billNo}
                  onChange={(e) => setBillNo(e.target.value)}
                  className="h-11"
                />
              </div>
              <Button
                variant="outline"
                className="w-full"
                disabled={createBatch.isPending || ensureSupplier.isPending}
                onClick={async () => {
                  try {
                    const supplierId = await ensureSupplier.mutateAsync(supplierName);
                    const b = await createBatch.mutateAsync({
                      supplier_id: supplierId,
                      bill_no: billNo,
                      notes: "",
                    });
                    setBatchId(b.id);
                    toast.success(`Batch ${b.code} started`);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not start batch");
                  }
                }}
              >
                Start new batch
              </Button>
            </div>
          </Panel>

          <Panel title="Step 2 — Scan thaans">
            <form onSubmit={handleScan} className="space-y-2">
              <Label htmlFor="scan">Barcode</Label>
              <Input
                id="scan"
                ref={scanRef}
                autoFocus
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Scan or type, then Enter"
                className="numeric h-12 text-base"
                disabled={!batchId}
              />
              <p className="text-xs text-muted-foreground">
                One scan = one physical roll. Barcodes carry only an identifier; lengths and prices
                live in the database.
              </p>
            </form>
          </Panel>

          <Panel title="Step 3 — Bulk edit" description={`${selected.length} selected`}>
            <div className="space-y-3">
              <PickOrTypeInput
                value={bulk.fabric}
                onChange={(v) => setBulk({ ...bulk, fabric: v })}
                options={fabricNames}
                placeholder="Fabric — select or type new"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Length (m)"
                  inputMode="decimal"
                  value={bulk.length}
                  onChange={(e) => setBulk({ ...bulk, length: e.target.value })}
                  className="h-11"
                />
                <Input
                  placeholder="Width (m)"
                  inputMode="decimal"
                  value={bulk.width}
                  onChange={(e) => setBulk({ ...bulk, width: e.target.value })}
                  className="h-11"
                />
                <Input
                  placeholder="Sell ₹/m"
                  inputMode="decimal"
                  value={bulk.price}
                  onChange={(e) => setBulk({ ...bulk, price: e.target.value })}
                  className="h-11"
                />
                <Input
                  placeholder="Laagat ₹/m"
                  inputMode="decimal"
                  value={bulk.cost}
                  onChange={(e) => setBulk({ ...bulk, cost: e.target.value })}
                  className="h-11"
                />
              </div>
              <Button className="w-full" onClick={applyBulk} disabled={update.isPending}>
                Apply to selected
              </Button>
            </div>
          </Panel>
        </div>

        <Panel
          title="Scanned records"
          description="Drafts stay out of sellable stock until the batch is committed"
          bodyClassName="p-0"
        >
          {!rows.length ? (
            <EmptyState
              title="Nothing scanned yet"
              description="Select a batch and start scanning."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead className="border-b border-border bg-surface">
                  <tr className="label-eyebrow">
                    <th className="px-3 py-2">
                      <Checkbox
                        checked={selected.length === rows.length && rows.length > 0}
                        onCheckedChange={(v) => setSelected(v ? rows.map((r) => r.id) : [])}
                        aria-label="Select all"
                      />
                    </th>
                    <th className="px-3 py-2 font-semibold">#</th>
                    <th className="px-3 py-2 font-semibold">Barcode</th>
                    <th className="hidden px-3 py-2 font-semibold sm:table-cell">Fabric</th>
                    <th className="px-3 py-2 text-right font-semibold">Length</th>
                    <th className="hidden px-3 py-2 text-right font-semibold md:table-cell">
                      Sell / m
                    </th>
                    {showCost ? (
                      <th className="hidden px-3 py-2 text-right font-semibold md:table-cell">
                        Laagat / m
                      </th>
                    ) : null}
                    <th className="px-3 py-2 text-right font-semibold">Status</th>
                    <th className="px-3 py-2">
                      <span className="sr-only">Edit</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t, i) => (
                    <tr key={t.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={selected.includes(t.id)}
                          onCheckedChange={(v) =>
                            setSelected(
                              v ? [...selected, t.id] : selected.filter((id) => id !== t.id),
                            )
                          }
                          aria-label={`Select ${t.barcode}`}
                        />
                      </td>
                      <td className="numeric px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                      <td className="numeric px-3 py-2 text-xs font-medium">{t.barcode}</td>
                      <td className="hidden px-3 py-2 text-sm sm:table-cell">
                        {t.fabric_name ?? "—"}
                      </td>
                      <td className="numeric px-3 py-2 text-right text-sm">
                        {formatMetres(t.original_mm)}
                      </td>
                      <td className="numeric hidden px-3 py-2 text-right text-sm md:table-cell">
                        {formatMoney(t.price_paise)}
                      </td>
                      {showCost ? (
                        <td className="numeric hidden px-3 py-2 text-right text-sm md:table-cell">
                          {costMap.has(t.id) ? formatMoney(costMap.get(t.id)!) : "—"}
                        </td>
                      ) : null}
                      <td className="px-3 py-2 text-right">
                        <StatusBadge status={t.is_incomplete ? "incomplete" : t.status} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(t)}
                          aria-label={`Edit ${t.barcode}`}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {editing ? (
        <ThaanEditor
          thaan={editing}
          costPaise={costMap.get(editing.id) ?? null}
          showCost={showCost}
          fabricNames={fabricNames}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
