import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel } from "@/shared/components/page";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { quantityInput, quantityText } from "./ledger-quantity";
import { fabricBarcodeBars, printFabricLabel } from "./fabric-label";
import { definiteDatabaseRejection } from "./consumable-input";

type Stock = {
  id: string;
  barcode: string;
  fabric_name: string;
  batch_code: string;
  thans: { id: string; original_mm: number | null }[];
};
type Row = {
  thaan: string;
  stock: Stock;
  selected: boolean;
  quantity: string;
  destination: string;
  status: string;
};
type Plan = {
  id: string;
  source: string;
  destination: string;
  reason: string;
  items: { inventory_item_id: string; quantity: number }[];
  thaans: string[];
};

function Symbol({ code }: { code: string }) {
  const bars = fabricBarcodeBars(code);
  return (
    <svg
      viewBox={`0 0 ${bars.length + 40} 65`}
      className="h-8 w-36 max-w-full"
      role="img"
      aria-label={`Barcode ${code}`}
    >
      <rect width="100%" height="65" fill="white" />
      {[...bars].map((bit, i) =>
        bit === "1" ? <rect key={i} x={20 + i} y="4" width="1" height="55" fill="black" /> : null,
      )}
    </svg>
  );
}
export function FabricTransfer() {
  const { isOwner, roles, can } = useSession();
  const allowed = (isOwner || roles.includes("stock_entry")) && can("stock.transfer");
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [barcode, setBarcode] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Plan[]>([]);
  const stocks = useQuery({
    queryKey: ["fabric-stock"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fabric_stock_catalog", {});
      if (error) throw error;
      return data as unknown as Stock[];
    },
  });
  const catalog = useQuery({
    queryKey: ["location-ledger", "catalog"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_catalog");
      if (error) throw error;
      return data ?? [];
    },
  });
  const locations = useQuery({
    queryKey: ["location-ledger", "locations"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_locations");
      if (error) throw error;
      return data ?? [];
    },
  });
  const balances = useQuery({
    queryKey: ["location-ledger", "balances"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_location_balances");
      if (error) throw error;
      return data ?? [];
    },
  });
  const history = useQuery({
    queryKey: ["stock-transfer-history"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("stock_transfer_history", { p_limit: 50 });
      if (error) throw error;
      return data as unknown as {
        id: string;
        code: string;
        source_name: string;
        destination_name: string;
        posted_at: string;
      }[];
    },
  });
  const sourceId =
    source || locations.data?.find((l) => l.active && l.kind === "workshop")?.id || "";
  const loadError = stocks.error || catalog.error || locations.error || balances.error;
  const loading =
    stocks.isPending || catalog.isPending || locations.isPending || balances.isPending;
  const frozen = busy || pending.length > 0;
  const selected = rows.filter((r) => r.selected);
  function authority(row: Row) {
    return catalog.data?.find((i) => i.item_kind === "fabric" && i.item_id === row.thaan)
      ?.inventory_item_id;
  }
  function available(row: Row) {
    const id = authority(row);
    return id
      ? Number(
          balances.data?.find((b) => b.inventory_item_id === id && b.location_id === sourceId)
            ?.quantity ?? 0,
        )
      : null;
  }
  function update(thaan: string, changes: Partial<Row>) {
    setRows((old) => old.map((r) => (r.thaan === thaan ? { ...r, ...changes } : r)));
  }
  function scan() {
    if (frozen || loading || loadError) return;
    const stock = stocks.data?.find((s) => s.barcode === barcode.trim());
    if (!stock) {
      toast.error("Fabric barcode not found");
      return;
    }
    setRows((old) => [
      ...old,
      ...stock.thans
        .filter((t) => !old.some((r) => r.thaan === t.id))
        .map((t) => ({
          thaan: t.id,
          stock,
          selected: true,
          quantity: "",
          destination: "",
          status: "",
        })),
    ]);
    setBarcode("");
    input.current?.focus();
  }
  async function post() {
    if (busy || loadError) return;
    let work = pending;
    try {
      if (!work.length) {
        if (!sourceId || !reason.trim() || !selected.length)
          throw new Error("Select rows and enter a transfer reason/reference.");
        const groups = new Map<string, Plan>();
        for (const row of selected) {
          const item = authority(row),
            amount = available(row);
          const quantity = quantityInput(row.quantity, "mm");
          if (!item || amount === null)
            throw new Error(
              `${row.stock.barcode}: stock measurements/location must be recorded first`,
            );
          if (quantity <= 0 || quantity > amount)
            throw new Error(`${row.stock.barcode}: enter metres within available Workshop stock`);
          const destination = locations.data?.find(
            (l) =>
              l.id === row.destination &&
              l.active &&
              l.id !== sourceId &&
              (isOwner || l.kind === "showroom_sublocation"),
          );
          if (!destination) throw new Error(`${row.stock.barcode}: select a valid destination`);
          const group = groups.get(row.destination) ?? {
            id: crypto.randomUUID(),
            source: sourceId,
            destination: row.destination,
            reason: reason.trim(),
            items: [],
            thaans: [],
          };
          group.items.push({ inventory_item_id: item, quantity });
          group.thaans.push(row.thaan);
          groups.set(row.destination, group);
        }
        work = [...groups.values()];
      }
      setBusy(true);
      setPending(work);
      for (let index = 0; index < work.length; index++) {
        const plan = work[index]!;
        const { error } = await supabase.rpc("post_inventory_transfer", {
          p_request_id: plan.id,
          p_source: plan.source,
          p_destination: plan.destination,
          p_items: plan.items,
          p_reason: plan.reason,
        });
        if (error) {
          plan.thaans.forEach((id) => update(id, { status: error.message }));
          setPending(definiteDatabaseRejection(error) ? [] : work.slice(index));
          throw error;
        }
        plan.thaans.forEach((id) =>
          update(id, { selected: false, quantity: "", status: "Transferred" }),
        );
        setPending(work.slice(index + 1));
      }
      toast.success("Selected stock transferred");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      await qc.invalidateQueries();
      setBusy(false);
    }
  }
  if (!allowed) return <p>Stock transfer permission required. Contact the Owner.</p>;
  return (
    <div className="space-y-4">
      <Panel
        title="Stock Transfer"
        description="Scan multiple Thaans. Select rows, enter metres and choose where to send them. The same barcode stays on each piece."
      >
        {loadError && <p role="alert">Transfer data could not load. Refresh before posting.</p>}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            scan();
          }}
        >
          <Input
            ref={input}
            className="min-w-0 flex-1"
            aria-label="Transfer Fabric Barcode"
            list="transfer-barcodes"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="Scan or type a barcode and press Enter"
            autoComplete="off"
            disabled={frozen || loading || Boolean(loadError)}
          />
          <datalist id="transfer-barcodes">
            {stocks.data?.map((s) => (
              <option key={s.id} value={s.barcode}>
                {s.fabric_name} · {s.batch_code}
              </option>
            ))}
          </datalist>
          <Button disabled={frozen || loading || !barcode.trim()}>Scan</Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span>From: {locations.data?.find((l) => l.id === sourceId)?.name ?? "Workshop"}</span>
          {isOwner && (
            <select
              aria-label="Transfer source"
              className="rounded border bg-background p-2"
              value={sourceId}
              disabled={frozen}
              onChange={(e) => setSource(e.target.value)}
            >
              {locations.data
                ?.filter((l) => l.active)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          )}
        </div>
        {!!rows.length && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  aria-label="Select all transfer rows"
                  checked={rows.every((r) => r.selected)}
                  disabled={frozen}
                  onCheckedChange={(v) =>
                    setRows((old) => old.map((r) => ({ ...r, selected: Boolean(v) })))
                  }
                />
                Select all
              </label>
              <span className="text-xs text-muted-foreground">
                {rows.length} Thaans · {selected.length} selected
              </span>
              <Button
                variant="outline"
                disabled={!selected.length || !can("stock.print_barcode")}
                onClick={() => {
                  try {
                    if (labels.current) printFabricLabel(labels.current, "Selected Thaan barcodes");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Printing failed");
                  }
                }}
              >
                Print selected barcodes
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2">Select</th>
                    <th>Thaan / barcode</th>
                    <th>Available</th>
                    <th>Send (m)</th>
                    <th>Destination</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const amount = available(row);
                    return (
                      <tr key={row.thaan} className="border-b">
                        <td className="p-2">
                          <Checkbox
                            aria-label={`Select transfer ${row.thaan}`}
                            checked={row.selected}
                            disabled={frozen}
                            onCheckedChange={(v) => update(row.thaan, { selected: Boolean(v) })}
                          />
                        </td>
                        <td className="py-3 pr-3">
                          <Symbol code={row.stock.barcode} />
                          <p className="font-mono text-xs">{row.stock.barcode}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.stock.fabric_name} · {row.stock.batch_code}
                          </p>
                        </td>
                        <td className="pr-2">
                          {amount === null
                            ? "Not measured / unlocated"
                            : quantityText(amount, "mm")}
                        </td>
                        <td className="p-1">
                          <Input
                            className="w-28"
                            aria-label={`Send metres ${row.thaan}`}
                            inputMode="decimal"
                            value={row.quantity}
                            disabled={frozen || !row.selected || amount === null || amount <= 0}
                            onChange={(e) => update(row.thaan, { quantity: e.target.value })}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={frozen || !row.selected || !amount}
                            onClick={() => update(row.thaan, { quantity: String(amount! / 1000) })}
                          >
                            All available
                          </Button>
                        </td>
                        <td className="p-1">
                          <select
                            aria-label={`Destination ${row.thaan}`}
                            className="w-40 rounded border bg-background p-2"
                            value={row.destination}
                            disabled={frozen || !row.selected}
                            onChange={(e) => update(row.thaan, { destination: e.target.value })}
                          >
                            <option value="">Choose destination</option>
                            {locations.data
                              ?.filter(
                                (l) =>
                                  l.active &&
                                  l.id !== sourceId &&
                                  (isOwner || l.kind === "showroom_sublocation"),
                              )
                              .map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.name}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="p-2 text-xs">{row.status}</td>
                        <td>
                          <Button
                            variant="ghost"
                            disabled={frozen}
                            aria-label={`Remove transfer ${row.thaan}`}
                            onClick={() =>
                              setRows((old) => old.filter((r) => r.thaan !== row.thaan))
                            }
                          >
                            ×
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Input
              aria-label="Fabric Transfer reason or reference"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Transfer reason / reference"
              disabled={frozen}
            />
            <Button
              disabled={
                busy ||
                loading ||
                Boolean(loadError) ||
                (!pending.length && (!selected.length || !reason.trim()))
              }
              onClick={() => void post()}
            >
              {pending.length ? "Retry pending transfers" : "Transfer selected Thaans"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Each destination is a separate transfer document. Completed groups are marked
              Transferred; retries reuse the same request.
            </p>
            <div ref={labels} className="hidden">
              {selected.map((r) => (
                <article key={r.thaan}>
                  <Symbol code={r.stock.barcode} />
                  <p>{r.stock.barcode}</p>
                  <p>
                    {r.stock.fabric_name} · {r.stock.batch_code}
                  </p>
                </article>
              ))}
            </div>
          </div>
        )}
      </Panel>
      <details className="panel p-4">
        <summary className="cursor-pointer font-semibold">Stock Transfer history</summary>
        {history.error ? (
          <p role="alert">Transfer history could not load.</p>
        ) : (
          history.data?.map((t) => (
            <p key={t.id} className="border-b py-2 text-sm">
              {t.code} · {t.source_name} → {t.destination_name} ·{" "}
              {new Date(t.posted_at).toLocaleString()}
            </p>
          ))
        )}
      </details>
    </div>
  );
}
