import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel } from "@/shared/components/page";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/shared/utils/format";
import { quantityText } from "./ledger-quantity";
import { prepareFabricTransfer } from "./fabric-transfer";

type Stock = {
  id: string;
  fabric_name: string;
  batch_code: string;
  barcode: string;
  available_mm: number;
  thans: { id: string; original_mm: number | null }[];
  locations: { id: string; name: string; quantity_mm: number }[];
};
type Transfer = {
  id: string;
  code: string;
  source_name: string;
  destination_name: string;
  reason: string;
  created_by: string;
  posted_at: string;
  request_id: string;
  lines: {
    id: string;
    thaan_id: string | null;
    quantity: number;
    unit: string;
    fabric_name: string | null;
    batch_code: string | null;
    barcode: string | null;
    movement_id: string | null;
    actor_id: string | null;
    occurred_at: string | null;
  }[];
};

export function FabricTransfer() {
  const { isOwner } = useSession();
  const qc = useQueryClient();
  const stocks = useQuery({
    queryKey: ["fabric-stock"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fabric_stock_catalog", {});
      if (error) throw error;
      return data as unknown as Stock[];
    },
  });
  const catalog = useQuery({
    queryKey: ["location-ledger", "catalog"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_catalog");
      if (error) throw error;
      return data ?? [];
    },
  });
  const locations = useQuery({
    queryKey: ["location-ledger", "locations"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_locations");
      if (error) throw error;
      return data ?? [];
    },
  });
  const balances = useQuery({
    queryKey: ["location-ledger", "balances"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_location_balances");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [stockId, setStockId] = useState("");
  const [barcode, setBarcode] = useState("");
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [posted, setPosted] = useState<{
    id: string;
    quantity: number;
    source: string;
    destination: string;
  } | null>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const stock = stocks.data?.find((s) => s.id === stockId);
  const history = useQuery({
    queryKey: ["stock-transfer-history", stockId],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("stock_transfer_history", {
        ...(stockId ? { p_stock: stockId } : {}),
        p_limit: 50,
      });
      if (error) throw error;
      return data as unknown as Transfer[];
    },
  });
  const thans = (stock?.thans ?? []).map((t) => {
    const authority =
      catalog.data?.find((i) => i.item_kind === "fabric" && i.item_id === t.id)
        ?.inventory_item_id ?? null;
    return {
      thaan_id: t.id,
      inventory_item_id: authority,
      source_mm:
        balances.data?.find((b) => b.inventory_item_id === authority && b.location_id === source)
          ?.quantity ?? 0,
    };
  });
  const sourceQty = stock?.locations.find((l) => l.id === source)?.quantity_mm ?? 0;
  const destinationQty = stock?.locations.find((l) => l.id === destination)?.quantity_mm ?? 0;
  const locName = (id: string) => locations.data?.find((l) => l.id === id)?.name ?? id;
  let preview: ReturnType<typeof prepareFabricTransfer> | null = null;
  let retry = false;
  let validation = "";
  if (Object.values(choices).some((q) => q.trim()))
    try {
      const planned = prepareFabricTransfer(thans, choices, false);
      retry =
        request.current?.signature ===
        JSON.stringify([source, destination, planned.lines, reason.trim()]);
      preview = retry ? planned : prepareFabricTransfer(thans, choices);
    } catch (e) {
      validation = e instanceof Error ? e.message : "Invalid transfer";
    }
  const transfer = useMutation({
    mutationFn: async () => {
      if (!isOwner) throw new Error("Owner required");
      if (!stock || !source || !destination || source === destination || !reason.trim())
        throw new Error("Select Fabric Stock, distinct locations and a reason");
      const planned = prepareFabricTransfer(thans, choices, false);
      const signature = JSON.stringify([source, destination, planned.lines, reason.trim()]);
      if (request.current?.signature !== signature) {
        prepareFabricTransfer(thans, choices);
        request.current = { signature, id: crypto.randomUUID() };
      }
      const { data, error } = await supabase.rpc("post_inventory_transfer", {
        p_request_id: request.current.id,
        p_source: source,
        p_destination: destination,
        p_items: planned.lines,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      setPosted({ id: data, quantity: planned.total_mm, source, destination });
      setChoices({});
      setReason("");
      request.current = null;
    },
    onSuccess: () => toast.success("Stock Transfer posted; refreshing current balances"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Transfer failed"),
    onSettled: async () => {
      await Promise.all(
        [
          ["location-ledger"],
          ["fabric-stock"],
          ["fabric-stock-history"],
          ["stock-transfer-history"],
          ["thaans"],
          ["dashboard-metrics"],
        ].map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
    },
  });
  const pending =
    transfer.isPending ||
    stocks.isPending ||
    catalog.isPending ||
    locations.isPending ||
    balances.isPending;
  const chooseStock = (id: string) => {
    setStockId(id);
    setChoices({});
    setPosted(null);
  };
  const selectClass = "h-11 w-full rounded border bg-background p-2";
  if (!isOwner) return null;
  return (
    <div className="space-y-4">
      <Panel
        title="Workshop ↔ Showroom Fabric Stock Transfer"
        description="Select or scan one Fabric Barcode, then choose the internal Thans and quantities to move."
      >
        <div className="space-y-3">
          {stocks.error || catalog.error || locations.error || balances.error ? (
            <p role="alert">Transfer data could not load. Refresh before posting.</p>
          ) : null}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const found = stocks.data?.find((s) => s.barcode === barcode.trim());
              if (!found) {
                toast.error("Fabric Barcode not found");
                return;
              }
              chooseStock(found.id);
              setBarcode("");
            }}
          >
            <Input
              aria-label="Transfer Fabric Barcode"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              autoComplete="off"
              disabled={pending}
            />
            <Button disabled={pending || !barcode.trim()}>Scan</Button>
          </form>
          <Label htmlFor="transfer-fabric-stock">Fabric + Batch</Label>
          <select
            id="transfer-fabric-stock"
            className={selectClass}
            value={stockId}
            disabled={pending}
            onChange={(e) => chooseStock(e.target.value)}
          >
            <option value="">Select Fabric Stock</option>
            {stocks.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fabric_name} / {s.batch_code}
              </option>
            ))}
          </select>
          {stock ? (
            <>
              <p className="break-all font-mono text-xs">{stock.barcode}</p>
              <p>Total available: {quantityText(stock.available_mm, "mm")}</p>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  transfer.mutate();
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["Source", source, setSource],
                      ["Destination", destination, setDestination],
                    ] as const
                  ).map(([label, value, setValue]) => (
                    <div key={label}>
                      <Label htmlFor={`fabric-transfer-${label}`}>{label}</Label>
                      <select
                        id={`fabric-transfer-${label}`}
                        className={selectClass}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        required
                        disabled={pending}
                      >
                        <option value="">Select {label.toLowerCase()}</option>
                        {locations.data
                          ?.filter((l) => l.active)
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <p>
                    Current {locName(source) || "source"}: {quantityText(sourceQty, "mm")}
                  </p>
                  <p>
                    Current {locName(destination) || "destination"}:{" "}
                    {quantityText(destinationQty, "mm")}
                  </p>
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th>Internal Than</th>
                        <th>Available at source</th>
                        <th>Transfer (m)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {thans.map((t, i) => (
                        <tr key={t.thaan_id} className="border-t">
                          <td className="py-2">
                            Than {i + 1}
                            <p className="break-all text-xs">{t.thaan_id}</p>
                          </td>
                          <td>
                            {t.inventory_item_id
                              ? quantityText(t.source_mm, "mm")
                              : "Location reconciliation required"}
                          </td>
                          <td>
                            <Input
                              aria-label={`Transfer from Than ${i + 1} in metres`}
                              value={choices[t.thaan_id] ?? ""}
                              onChange={(e) =>
                                setChoices({ ...choices, [t.thaan_id]: e.target.value })
                              }
                              inputMode="decimal"
                              placeholder="Leave blank to skip"
                              disabled={
                                pending ||
                                !t.inventory_item_id ||
                                !source ||
                                (t.source_mm <= 0 && !choices[t.thaan_id])
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {validation ? (
                  <p role="alert" className="text-destructive">
                    {validation}
                  </p>
                ) : null}
                {retry ? (
                  <p>
                    Retry checks the previous transfer request. It will not deduct stock again if
                    that request already posted. Review the transfer history before changing
                    quantities.
                  </p>
                ) : null}
                {preview && !retry && source && destination && source !== destination ? (
                  <p>
                    Planned transfer {quantityText(preview.total_mm, "mm")}: {locName(source)}{" "}
                    {quantityText(sourceQty - preview.total_mm, "mm")} → {locName(destination)}{" "}
                    {quantityText(destinationQty + preview.total_mm, "mm")}. Total remains{" "}
                    {quantityText(stock.available_mm, "mm")}.
                  </p>
                ) : null}
                <Input
                  aria-label="Fabric Transfer reason or reference"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason / reference"
                  required
                  disabled={pending}
                />
                <Button
                  disabled={
                    pending ||
                    !preview ||
                    !source ||
                    !destination ||
                    source === destination ||
                    !reason.trim() ||
                    Boolean(stocks.error || catalog.error || balances.error || locations.error)
                  }
                >
                  Post Stock Transfer
                </Button>
              </form>
            </>
          ) : null}
          {posted ? (
            <div role="status" className="rounded border p-3">
              <p>
                Posted {quantityText(posted.quantity, "mm")} from {locName(posted.source)} to{" "}
                {locName(posted.destination)}.
              </p>
              <p className="break-all text-xs">Transfer {posted.id}</p>
              <p>
                {transfer.isPending
                  ? "Refreshing balances…"
                  : "Current location balances are shown above."}
              </p>
            </div>
          ) : null}
        </div>
      </Panel>
      <Panel
        title="Stock Transfer history"
        description="Latest 50 posted documents, filtered to the selected Fabric Stock. Each line retains its movement, quantity, user and timestamp."
      >
        {history.error ? (
          <p role="alert">Transfer history could not load.</p>
        ) : history.isPending ? (
          <p>Loading transfer history…</p>
        ) : history.data?.length ? (
          history.data.map((t) => (
            <div key={t.id} className="space-y-1 border-b py-3 text-sm">
              <p className="break-all font-mono">{t.code}</p>
              <p>
                {t.source_name} → {t.destination_name} · {formatDateTime(t.posted_at)}
              </p>
              <p>{t.reason}</p>
              <p className="break-all text-xs">
                User {t.created_by} · Request {t.request_id}
              </p>
              {t.lines.map((l) => (
                <p key={l.id} className="break-all text-xs">
                  {l.fabric_name ?? "Item"} / {l.batch_code ?? "—"} ·{" "}
                  {quantityText(l.quantity, l.unit, Boolean(l.thaan_id))} · Than {l.thaan_id ?? "—"}{" "}
                  · {l.barcode ?? "—"} · Movement {l.movement_id ?? "—"}
                </p>
              ))}
            </div>
          ))
        ) : (
          <p>No posted transfers for this selection.</p>
        )}
      </Panel>
    </div>
  );
}
