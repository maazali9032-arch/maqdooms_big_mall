import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  incompleteReasons,
  useAdjustThaan,
  useDashboardMetrics,
  useFabrics,
  useMovements,
  useThaanCosts,
  useThaans,
  useBatches,
  type ThaanOverview,
} from "@/features/inventory";
import { ThaanEditor } from "@/features/inventory/ThaanEditor";
import { useSession } from "@/app/providers/session";
import {
  PageHeader,
  Panel,
  StatCard,
  StatusBadge,
  EmptyState,
  DemoNotice,
} from "@/shared/components/page";
import { formatMetres, formatMoney, parseMetreInput } from "@/shared/utils/units";
import { formatDate, formatDateTime } from "@/shared/utils/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/inventory/")({
  head: () => ({
    meta: [
      { title: "Inventory — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content: "Thaan-level fabric inventory, stock ledger and adjustments.",
      },
      { property: "og:title", content: "Inventory — Maqdoom's Big Mall ERP" },
      {
        property: "og:description",
        content: "Thaan-level fabric inventory, stock ledger and adjustments.",
      },
    ],
  }),
  component: InventoryPage,
});

function ThaanRow({
  thaan,
  cost,
  onAdjust,
  onEdit,
}: {
  thaan: ThaanOverview;
  cost?: number;
  onAdjust?: () => void;
  onEdit?: () => void;
}) {
  const reasons = incompleteReasons(thaan);
  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface/70">
      <td className="px-3 py-2">
        <span className="numeric text-xs font-medium">{thaan.barcode}</span>
        <span className="block text-[11px] text-muted-foreground sm:hidden">
          {thaan.fabric_name}
        </span>
      </td>
      <td className="hidden px-3 py-2 sm:table-cell">
        <span className="text-sm">{thaan.fabric_name ?? "—"}</span>
        <span className="block text-[11px] text-muted-foreground">
          {[thaan.colour, thaan.design, thaan.rack].filter(Boolean).join(" · ")}
        </span>
      </td>
      <td className="numeric px-3 py-2 text-right text-xs text-muted-foreground">
        {formatMetres(thaan.original_mm)}
      </td>
      <td className="numeric px-3 py-2 text-right text-sm font-medium">
        {formatMetres(thaan.available_mm)}
        {thaan.held_mm > 0 ? (
          <span className="block text-[11px] font-normal text-warning-foreground">
            {formatMetres(thaan.held_mm)} held
          </span>
        ) : null}
      </td>
      <td className="numeric hidden px-3 py-2 text-right text-sm md:table-cell">
        {formatMoney(thaan.price_paise)}
      </td>
      {cost !== undefined ? (
        <td className="numeric hidden px-3 py-2 text-right text-sm text-muted-foreground lg:table-cell">
          {formatMoney(cost)}
        </td>
      ) : null}
      <td className="px-3 py-2 text-right">
        <StatusBadge
          status={thaan.is_incomplete && thaan.status !== "depleted" ? "incomplete" : thaan.status}
        />
        {reasons.length ? (
          <span className="mt-1 block text-[11px] text-warning-foreground">
            {reasons.join(" · ")}
          </span>
        ) : null}
      </td>
      {onAdjust || onEdit ? (
        <td className="px-3 py-2 text-right">
          <div className="flex justify-end gap-1">
            {onEdit ? (
              <Button variant="ghost" size="sm" onClick={onEdit}>
                Edit
              </Button>
            ) : null}
            {onAdjust ? (
              <Button variant="ghost" size="sm" onClick={onAdjust}>
                Adjust
              </Button>
            ) : null}
          </div>
        </td>
      ) : null}
    </tr>
  );
}

function ThaanTable({
  rows,
  costs,
  showCost,
  onAdjust,
  onEdit,
  emptyDescription,
}: {
  rows: ThaanOverview[];
  costs: Map<string, number>;
  showCost: boolean;
  onAdjust?: (t: ThaanOverview) => void;
  onEdit?: (t: ThaanOverview) => void;
  emptyDescription?: string;
}) {
  if (!rows.length) {
    return (
      <EmptyState
        title="No thaans in this view"
        description={emptyDescription ?? "Adjust the filters or receive new stock."}
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left">
        <thead className="border-b border-border bg-surface">
          <tr className="label-eyebrow">
            <th className="px-3 py-2 font-semibold">Thaan</th>
            <th className="hidden px-3 py-2 font-semibold sm:table-cell">Fabric</th>
            <th className="px-3 py-2 text-right font-semibold">Original</th>
            <th className="px-3 py-2 text-right font-semibold">Available</th>
            <th className="hidden px-3 py-2 text-right font-semibold md:table-cell">Sell / m</th>
            {showCost ? (
              <th className="hidden px-3 py-2 text-right font-semibold lg:table-cell">
                Laagat / m
              </th>
            ) : null}
            <th className="px-3 py-2 text-right font-semibold">Status</th>
            {onAdjust || onEdit ? <th className="px-3 py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <ThaanRow
              key={t.id}
              thaan={t}
              cost={showCost ? costs.get(t.id) : undefined}
              onAdjust={onAdjust ? () => onAdjust(t) : undefined}
              onEdit={onEdit && t.is_incomplete ? () => onEdit(t) : undefined}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InventoryPage() {
  const { can } = useSession();
  const showCost = can("inventory.view_cost");
  const canCorrectIncomplete = can("inventory.receive") && can("inventory.edit_thaan");
  const showOperationalHistory = can("inventory.receive") || can("reports.view");
  const thaans = useThaans();
  const fabrics = useFabrics();
  const costs = useThaanCosts(showCost);
  const movements = useMovements(150, showOperationalHistory);
  const batches = useBatches(can("inventory.receive"));
  const metrics = useDashboardMetrics();
  const adjust = useAdjustThaan();

  const [search, setSearch] = useState("");
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [editing, setEditing] = useState<ThaanOverview | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<ThaanOverview | null>(null);
  const [adjustLength, setAdjustLength] = useState("");
  const [adjustKind, setAdjustKind] = useState<"ADJUSTMENT" | "RETURN" | "WASTAGE">("ADJUSTMENT");
  const [adjustReason, setAdjustReason] = useState("");

  const costMap = useMemo(
    () => new Map((costs.data ?? []).map((c) => [c.thaan_id, c.cost_paise])),
    [costs.data],
  );

  const filtered = useMemo(() => {
    const all = thaans.data ?? [];
    const q = search.trim().toLowerCase();
    const searched = !q
      ? all
      : all.filter((t) =>
          [t.barcode, t.fabric_name, t.colour, t.rack, t.batch_code]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        );
    return incompleteOnly ? searched.filter((thaan) => thaan.is_incomplete) : searched;
  }, [thaans.data, search, incompleteOnly]);

  const m = metrics.data ?? {};

  async function submitAdjust() {
    if (!adjustTarget) return;
    const mm = parseMetreInput(adjustLength);
    if (!mm) {
      toast.error("Enter a length in metres");
      return;
    }
    const signed = adjustKind === "RETURN" ? mm : -mm;
    try {
      await adjust.mutateAsync({
        thaan_id: adjustTarget.id,
        delta_mm: adjustKind === "ADJUSTMENT" ? mm : signed,
        kind: adjustKind,
        reason: adjustReason,
      });
      toast.success("Movement recorded in the ledger");
      setAdjustTarget(null);
      setAdjustLength("");
      setAdjustReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Adjustment rejected");
    }
  }

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Each physical roll is one thaan with its own barcode and ledger."
        actions={
          can("inventory.receive") ? (
            <Button asChild size="sm">
              <Link to="/inventory/receiving">Enter new stock</Link>
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Active thaans" value={m["active_thaans"] ?? "—"} />
        <StatCard label="Total available" value={formatMetres(m["available_mm"] ?? 0)} />
        <StatCard label="Incomplete" value={m["incomplete_thaans"] ?? 0} tone="warning" />
        <StatCard label="Depleted" value={m["depleted_thaans"] ?? 0} />
      </div>

      <Tabs defaultValue="thaans">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="w-full overflow-x-auto sm:w-auto">
            <TabsTrigger value="thaans">Thaans</TabsTrigger>
            {showOperationalHistory ? (
              <TabsTrigger value="movements">Stock movements</TabsTrigger>
            ) : null}
            {can("inventory.receive") ? <TabsTrigger value="batches">Receiving</TabsTrigger> : null}
            <TabsTrigger value="archived">Depleted / archived</TabsTrigger>
          </TabsList>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {canCorrectIncomplete ? (
              <label className="flex h-10 items-center gap-2 whitespace-nowrap rounded-sm border border-input px-3 text-sm">
                <Checkbox
                  checked={incompleteOnly}
                  onCheckedChange={(checked) => setIncompleteOnly(Boolean(checked))}
                />
                Incomplete only
              </label>
            ) : null}
            <Input
              placeholder="Search barcode, fabric, rack…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 sm:w-72"
            />
          </div>
        </div>

        <TabsContent value="thaans" className="mt-4">
          <Panel bodyClassName="p-0">
            <ThaanTable
              rows={filtered.filter((t) => t.status === "active" || t.status === "draft")}
              costs={costMap}
              showCost={showCost}
              onAdjust={can("stock.adjust") ? (t) => setAdjustTarget(t) : undefined}
              onEdit={canCorrectIncomplete ? (t) => setEditing(t) : undefined}
              emptyDescription={
                incompleteOnly ? "No incomplete thaans match the current search." : undefined
              }
            />
          </Panel>
          {!showCost ? (
            <DemoNotice>
              Laagat (cost) is stored in a permission-gated table — your account is not granted
              <span className="numeric"> inventory.view_cost</span>, so the database returns no cost
              rows at all.
            </DemoNotice>
          ) : null}
        </TabsContent>

        {showOperationalHistory ? (
          <TabsContent value="movements" className="mt-4">
            <Panel bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left">
                  <thead className="border-b border-border bg-surface">
                    <tr className="label-eyebrow">
                      <th className="px-3 py-2 font-semibold">Date / time</th>
                      <th className="px-3 py-2 font-semibold">Thaan</th>
                      <th className="px-3 py-2 font-semibold">Type</th>
                      <th className="px-3 py-2 text-right font-semibold">Quantity</th>
                      <th className="hidden px-3 py-2 font-semibold md:table-cell">Reference</th>
                      <th className="hidden px-3 py-2 text-right font-semibold lg:table-cell">
                        Price snapshot
                      </th>
                      <th className="hidden px-3 py-2 font-semibold lg:table-cell">User</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(movements.data ?? []).map((mv) => (
                      <tr key={mv.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {formatDateTime(mv.created_at)}
                        </td>
                        <td className="numeric px-3 py-2 text-xs">{mv.barcode}</td>
                        <td className="px-3 py-2">
                          <StatusBadge
                            status={
                              mv.kind === "INWARD"
                                ? "active"
                                : mv.kind === "SALE"
                                  ? "open"
                                  : "draft"
                            }
                            label={mv.kind}
                          />
                        </td>
                        <td
                          className={`numeric px-3 py-2 text-right text-sm ${mv.delta_mm < 0 ? "text-destructive" : "text-success"}`}
                        >
                          {mv.delta_mm > 0 ? "+" : ""}
                          {formatMetres(mv.delta_mm)}
                        </td>
                        <td className="hidden px-3 py-2 text-xs md:table-cell">
                          <span className="numeric">{mv.reference ?? "—"}</span>
                          {mv.reason ? (
                            <span className="block text-[11px] text-muted-foreground">
                              {mv.reason}
                            </span>
                          ) : null}
                        </td>
                        <td className="numeric hidden px-3 py-2 text-right text-xs lg:table-cell">
                          {formatMoney(mv.price_snapshot_paise)}
                        </td>
                        <td className="hidden px-3 py-2 text-xs text-muted-foreground lg:table-cell">
                          {mv.user_name ?? "Demo data"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </TabsContent>
        ) : null}

        {can("inventory.receive") ? (
          <TabsContent value="batches" className="mt-4">
            <Panel bodyClassName="p-0">
              <div className="divide-y divide-border">
                {(batches.data ?? []).map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <span className="numeric text-xs font-medium">{b.code}</span>
                    <StatusBadge status={b.status} />
                    <span className="text-muted-foreground">
                      {(b.suppliers as { name?: string } | null)?.name ?? "No supplier"} · Bill{" "}
                      {b.bill_no ?? "—"}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatDate(b.received_on)}
                    </span>
                    {b.status === "draft" && can("inventory.receive") ? (
                      <Button asChild size="sm" variant="outline">
                        <Link to="/inventory/receiving">Continue</Link>
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </Panel>
          </TabsContent>
        ) : null}

        <TabsContent value="archived" className="mt-4">
          <Panel
            description="Depleted thaans are never deleted — their full history stays available for audit."
            title="Depleted & archived"
            bodyClassName="p-0"
          >
            <ThaanTable
              rows={filtered.filter((t) => t.status === "depleted" || t.status === "archived")}
              costs={costMap}
              showCost={showCost}
            />
          </Panel>
        </TabsContent>
      </Tabs>

      <Dialog open={!!adjustTarget} onOpenChange={(open) => !open && setAdjustTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust {adjustTarget?.barcode}</DialogTitle>
            <DialogDescription>
              Corrections never overwrite history — they append a new movement with your name, the
              timestamp and a reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Movement type</Label>
              <Select
                value={adjustKind}
                onValueChange={(v) => setAdjustKind(v as typeof adjustKind)}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADJUSTMENT">Adjustment (add to stock)</SelectItem>
                  <SelectItem value="RETURN">Return from tailor (add)</SelectItem>
                  <SelectItem value="WASTAGE">Wastage (deduct)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj-len">Length (metres)</Label>
              <Input
                id="adj-len"
                inputMode="decimal"
                value={adjustLength}
                onChange={(e) => setAdjustLength(e.target.value)}
                className="h-11"
                placeholder="0.50"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj-reason">Reason</Label>
              <Input
                id="adj-reason"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                className="h-11"
                placeholder="Physical count correction"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitAdjust} disabled={adjust.isPending}>
              Record movement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editing ? (
        <ThaanEditor
          thaan={editing}
          costPaise={costMap.get(editing.id) ?? null}
          showCost={showCost}
          fabricNames={(fabrics.data ?? []).map((fabric) => fabric.name)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
