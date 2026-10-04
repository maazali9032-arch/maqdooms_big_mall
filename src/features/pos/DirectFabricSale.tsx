import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { useCustomers } from "@/features/customers";
import { Panel } from "@/shared/components/page";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/shared/utils/units";
import { formatDateTime } from "@/shared/utils/format";
import { fabricSaleCut } from "./fabric-sale-input";

type Stock = {
  id: string;
  fabric_name: string;
  batch_code: string;
  barcode: string;
  sp_paise_per_m: number | null;
  sp_version_id: string | null;
  cuts: {
    inventory_item_id: string;
    thaan_id: string;
    locations: { id: string; name: string; quantity_mm: number }[];
  }[];
};
type Cut = {
  inventory_item_id: string;
  quantity: number;
  sp_version_id: string;
  label: string;
  amount: number;
  sp: number;
  thaan_id: string;
};
type Order = {
  id: string;
  code: string;
  source_name: string;
  customer_snapshot: { name: string | null; phone?: string | null };
  final_customer_price_paise: number;
  reference: string | null;
  created_by: string;
  created_at: string;
  completed_at: string;
  items: {
    id: string;
    fabric_name: string;
    batch_code: string;
    barcode: string;
    thaan_id: string;
    quantity_mm: number;
    sp_paise_per_m: number;
    final_customer_price_paise: number;
    movement_id: string;
  }[];
};

export function DirectFabricSale() {
  const { isOwner, can } = useSession();
  const qc = useQueryClient();
  const customers = useCustomers();
  const stocks = useQuery({
    queryKey: ["direct-fabric-sale", "catalog"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("direct_fabric_sale_catalog", {});
      if (error) throw error;
      return data as unknown as Stock[];
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
  const history = useQuery({
    queryKey: ["direct-fabric-sale", "history"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("direct_fabric_order_history", {});
      if (error) throw error;
      return data as unknown as Order[];
    },
  });
  const [barcode, setBarcode] = useState("");
  const [stockId, setStockId] = useState("");
  const [source, setSource] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [cart, setCart] = useState<Cut[]>([]);
  const [customer, setCustomer] = useState("");
  const [reference, setReference] = useState("");
  const [paid, setPaid] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState("");
  // An uncertain response must retry the exact original request before edits.
  const request = useRef<{ id: string; signature: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const stock = stocks.data?.find((s) => s.id === stockId);
  const total = cart.reduce((sum, cut) => sum + cut.amount, 0);
  const costs = useQuery({
    queryKey: ["direct-fabric-sale", "costs", selectedOrder],
    enabled: isOwner && !!selectedOrder,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_direct_fabric_order_costs", {
        p_order: selectedOrder,
      });
      if (error) throw error;
      return data as unknown as { order_item_id: string; cp_paise_per_m: number | null }[];
    },
  });
  const checkout = useMutation({
    mutationFn: async () => {
      if (!cart.length || !source || !paid || !Number.isSafeInteger(total))
        throw new Error("Select cuts, source and confirm received payment");
      const items = cart
        .map((c) => ({
          inventory_item_id: c.inventory_item_id,
          quantity: c.quantity,
          sp_version_id: c.sp_version_id,
        }))
        .sort((a, b) => a.inventory_item_id.localeCompare(b.inventory_item_id));
      const signature = JSON.stringify({ source, items, customer, reference: reference.trim() });
      if (request.current && request.current.signature !== signature)
        throw new Error("Retry or resolve the pending sale before changing it");
      request.current ??= { id: crypto.randomUUID(), signature };
      const { data, error } = await supabase.rpc("complete_direct_fabric_sale", {
        p_request_id: request.current.id,
        p_source: source,
        p_items: items,
        p_customer: customer || null,
        p_payment_confirmed: true,
        p_reference: reference.trim() || undefined,
      });
      if (error) {
        // PostgreSQL exceptions prove the transaction rolled back. Transport
        // failures do not: keep the UUID and frozen cart for an exact retry.
        if (error.code?.startsWith("P") || /^[234]/.test(error.code ?? "")) {
          request.current = null;
          setUncertain(false);
        } else setUncertain(true);
        throw error;
      }
      return data;
    },
    onSuccess: (id) => {
      request.current = null;
      setUncertain(false);
      setCart([]);
      setPaid(false);
      setChoices({});
      setSelectedOrder(id);
      toast.success("Direct Fabric Sale completed");
    },
    onError: (e) => {
      if (request.current) setUncertain(true);
      toast.error(e.message);
    },
    onSettled: async () => {
      await Promise.all(
        [
          "direct-fabric-sale",
          "fabric-stock",
          "fabric-stock-history",
          "location-ledger",
          "thaans",
          "movements",
          "dashboard-metrics",
          "customers",
        ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
  const frozen = checkout.isPending || uncertain;
  function scan() {
    const found = stocks.data?.find((s) => s.barcode === barcode.trim());
    if (!found) {
      toast.error("Fabric Barcode not found in sale stock");
      return;
    }
    setStockId(found.id);
    setChoices({});
  }
  function addCuts() {
    try {
      if (!stock || !source || stock.sp_paise_per_m === null || !stock.sp_version_id)
        throw new Error("Select location and stock with Owner SP");
      const additions: Cut[] = [];
      for (const cut of stock.cuts) {
        const value = choices[cut.inventory_item_id]?.trim();
        if (!value || /^0(?:\.0+)?$/.test(value)) continue;
        if (cart.some((c) => c.inventory_item_id === cut.inventory_item_id))
          throw new Error("Remove the existing cut before changing this Than");
        const plan = fabricSaleCut(
          value,
          cut.locations.find((l) => l.id === source)?.quantity_mm ?? 0,
          stock.sp_paise_per_m,
        );
        additions.push({
          ...plan,
          inventory_item_id: cut.inventory_item_id,
          sp_version_id: stock.sp_version_id,
          label: `${stock.fabric_name} / ${stock.batch_code}`,
          sp: stock.sp_paise_per_m,
          thaan_id: cut.thaan_id,
        });
      }
      if (!additions.length || cart.length + additions.length > 50)
        throw new Error("Enter cuts; maximum 50 Thans per sale");
      if (!Number.isSafeInteger(total + additions.reduce((sum, c) => sum + c.amount, 0)))
        throw new Error("Sale amount exceeds supported range");
      setCart([...cart, ...additions]);
      setChoices({});
      setPaid(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const order = history.data?.find((o) => o.id === selectedOrder);
  return (
    <Panel
      title="Direct Fabric Sale"
      description="Scan a Fabric Barcode, choose the location and internal Than cuts, then confirm payment."
    >
      {(stocks.error || locations.error || history.error) && (
        <p role="alert" className="text-destructive">
          {(stocks.error || locations.error || history.error)?.message}
        </p>
      )}
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Fabric Barcode"
            autoComplete="off"
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
            autoFocus
            placeholder="Scan Fabric Barcode"
            value={barcode}
            disabled={frozen}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                scan();
              }
            }}
          />
          <Button disabled={frozen || stocks.isPending} onClick={scan}>
            Scan
          </Button>
          <Button variant="outline" disabled={frozen} onClick={() => void stocks.refetch()}>
            Refresh SP / stock
          </Button>
        </div>
        <Label htmlFor="direct-sale-source">Stock location</Label>
        <select
          id="direct-sale-source"
          className="w-full rounded border bg-background p-2"
          value={source}
          disabled={frozen || cart.length > 0}
          onChange={(e) => {
            setSource(e.target.value);
            setChoices({});
            setPaid(false);
          }}
        >
          <option value="">Choose Workshop / Showroom</option>
          {locations.data
            ?.filter(
              (l) => l.active && ["workshop", "showroom", "showroom_sublocation"].includes(l.kind),
            )
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
        {stock && (
          <div className="space-y-2">
            <p>
              {stock.fabric_name} / {stock.batch_code} — {stock.barcode}
            </p>
            <p>
              Current SP:{" "}
              {stock.sp_paise_per_m === null
                ? "Owner must set SP before sale"
                : `${formatMoney(stock.sp_paise_per_m)} / m`}
            </p>
            {stock.cuts.map((cut, index) => (
              <div key={cut.inventory_item_id} className="flex items-center gap-3">
                <Label htmlFor={`cut-${cut.inventory_item_id}`} className="flex-1">
                  Than {index + 1} ({cut.thaan_id.slice(0, 8)}) ·{" "}
                  {(cut.locations.find((l) => l.id === source)?.quantity_mm ?? 0) / 1000} m
                  available
                </Label>
                <Input
                  id={`cut-${cut.inventory_item_id}`}
                  className="w-32"
                  placeholder="Cut metres"
                  inputMode="decimal"
                  disabled={frozen || !source}
                  value={choices[cut.inventory_item_id] ?? ""}
                  onChange={(e) =>
                    setChoices({ ...choices, [cut.inventory_item_id]: e.target.value })
                  }
                />
              </div>
            ))}
            <Button disabled={frozen || stock.sp_paise_per_m === null} onClick={addCuts}>
              Add cuts to sale
            </Button>
          </div>
        )}
        {cart.map((c) => (
          <div key={c.inventory_item_id} className="flex flex-wrap items-center gap-2">
            <span className="flex-1">
              {c.label} · Than {c.thaan_id.slice(0, 8)} · {c.quantity / 1000} m ×{" "}
              {formatMoney(c.sp)} / m = {formatMoney(c.amount)}
            </span>
            <Button
              variant="outline"
              disabled={frozen}
              onClick={() => {
                setCart(cart.filter((x) => x !== c));
                setPaid(false);
              }}
            >
              Remove
            </Button>
          </div>
        ))}
        <Label htmlFor="direct-sale-customer">Customer</Label>
        <select
          id="direct-sale-customer"
          className="w-full rounded border bg-background p-2"
          value={customer}
          disabled={frozen}
          onChange={(e) => setCustomer(e.target.value)}
        >
          <option value="">Walk-in customer</option>
          {customers.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || c.phone || c.id}
            </option>
          ))}
        </select>
        {customers.error && (
          <p role="alert" className="text-destructive">
            Customer list unavailable: {customers.error.message}
          </p>
        )}
        <Input
          aria-label="Sale reference"
          placeholder="Sale reference (optional)"
          value={reference}
          disabled={frozen}
          onChange={(e) => setReference(e.target.value)}
        />
        <p className="font-semibold">Customer total: {formatMoney(total)}</p>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={paid}
            disabled={frozen}
            onChange={(e) => setPaid(e.target.checked)}
          />{" "}
          Customer payment received
        </label>
        {uncertain && (
          <p role="alert">
            The response was interrupted. Retry this unchanged sale to retrieve its result without
            deducting stock twice. Keep this page open until resolved.
          </p>
        )}
        <Button
          disabled={checkout.isPending || !cart.length || !paid || !can("pos.sell")}
          onClick={() => checkout.mutate()}
        >
          {checkout.isPending
            ? "Completing…"
            : uncertain
              ? "Retry pending sale"
              : "Complete Direct Fabric Sale"}
        </Button>
        <h3 className="font-semibold">Order History</h3>
        <select
          aria-label="Direct Fabric Order"
          className="w-full rounded border bg-background p-2"
          value={selectedOrder}
          onChange={(e) => setSelectedOrder(e.target.value)}
        >
          <option value="">Select completed order (latest 50)</option>
          {history.data?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.code} · {formatMoney(o.final_customer_price_paise)}
            </option>
          ))}
        </select>
        {order && (
          <div className="space-y-2 rounded border p-3">
            <p>
              {order.code} · {order.customer_snapshot?.name || "Customer"}{" "}
              {order.customer_snapshot?.phone} · {order.source_name}
            </p>
            <p>
              {formatDateTime(order.completed_at)} · User {order.created_by} · Reference{" "}
              {order.reference || "—"}
            </p>
            {order.items.map((it) => (
              <div key={it.id}>
                <p>
                  {it.fabric_name} / {it.batch_code} · {it.barcode} · Than {it.thaan_id.slice(0, 8)}
                </p>
                <p>
                  {it.quantity_mm / 1000} m · SP {formatMoney(it.sp_paise_per_m)} / m ·{" "}
                  {formatMoney(it.final_customer_price_paise)}
                </p>
                {isOwner && (
                  <p>
                    CP at sale:{" "}
                    {costs.isPending
                      ? "Loading…"
                      : costs.data?.find((c) => c.order_item_id === it.id)?.cp_paise_per_m == null
                        ? "Unknown"
                        : `${formatMoney(costs.data.find((c) => c.order_item_id === it.id)!.cp_paise_per_m!)} / m`}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Movement {it.movement_id}</p>
              </div>
            ))}
            {isOwner && costs.error && (
              <p role="alert" className="text-destructive">
                {costs.error.message}
              </p>
            )}
            <p className="font-semibold">Paid: {formatMoney(order.final_customer_price_paise)}</p>
          </div>
        )}
      </div>
    </Panel>
  );
}
