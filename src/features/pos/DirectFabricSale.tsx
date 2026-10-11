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
import { formatMoney as displayMoney } from "@/shared/utils/units";
import { formatDateTime } from "@/shared/utils/format";
import { fabricSaleCut } from "./fabric-sale-input";
import { fabricMoneyInput } from "@/features/inventory/fabric-entry-input";
import { SalespersonPicker } from "@/features/salesperson/SalespersonPicker";
import { CustomerTailoring, type TailoringSelection } from "@/features/tailoring/CustomerTailoring";
import { customerTailoringCut } from "@/features/tailoring/customer-tailoring-input";

const formatMoney = (paise: number | null | undefined) => displayMoney(paise, true);

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
  const [price, setPrice] = useState("");
  const [cart, setCart] = useState<Cut[]>([]);
  const [customer, setCustomer] = useState("");
  const [salesperson, setSalesperson] = useState("");
  const [stitching, setStitching] = useState(false);
  const [stitchingSelection, setStitchingSelection] = useState<TailoringSelection | null>(null);
  const [bookedTailoring, setBookedTailoring] = useState("");
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
      if (!cart.length || !source || !paid || !salesperson || !Number.isSafeInteger(total))
        throw new Error("Select cuts, source and confirm received payment");
      const items = cart
        .map((c) => ({
          inventory_item_id: c.inventory_item_id,
          quantity: c.quantity,
          sp_paise_per_m: c.sp,
        }))
        .sort((a, b) => a.inventory_item_id.localeCompare(b.inventory_item_id));
      const signature = JSON.stringify({
        source,
        items,
        customer,
        salesperson,
        reference: reference.trim(),
      });
      if (request.current && request.current.signature !== signature)
        throw new Error("Retry or resolve the pending sale before changing it");
      request.current ??= { id: crypto.randomUUID(), signature };
      const { data, error } = await supabase.rpc("complete_counter_fabric_sale", {
        p_request_id: request.current.id,
        p_source: source,
        p_items: items,
        p_customer: customer || null,
        p_payment_confirmed: true,
        p_reference: reference.trim(),
        p_salesperson: salesperson,
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
      setSalesperson("");
      setPrice("");
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
          "salesperson-work",
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
    setPrice("");
  }
  function addCuts() {
    try {
      if (!can("pos.enter_price")) throw new Error("Per-metre price entry permission required");
      const enteredPrice = fabricMoneyInput(price);
      if (!stock || !source || enteredPrice === null)
        throw new Error("Select location and enter the sale price per metre");
      const additions: Cut[] = [];
      for (const cut of stock.cuts) {
        const value = choices[cut.inventory_item_id]?.trim();
        if (!value || /^0(?:\.0+)?$/.test(value)) continue;
        if (cart.some((c) => c.inventory_item_id === cut.inventory_item_id))
          throw new Error("Remove the existing cut before changing this Than");
        const plan = fabricSaleCut(
          value,
          cut.locations.find((l) => l.id === source)?.quantity_mm ?? 0,
          enteredPrice,
        );
        additions.push({
          ...plan,
          inventory_item_id: cut.inventory_item_id,
          label: `${stock.fabric_name} / ${stock.batch_code}`,
          sp: enteredPrice,
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
  function stitchSelectedMetres() {
    try {
      if (!stock || !source || !salesperson)
        throw new Error("Select fabric, source and Salesperson first");
      if (cart.length)
        throw new Error("Use the stitching option below to carry your existing cart");
      const cuts = stock.cuts
        .filter((c) => Boolean(choices[c.inventory_item_id]?.trim()))
        .map((c) => ({
          inventory_item_id: c.inventory_item_id,
          thaan_id: c.thaan_id,
          quantity: customerTailoringCut(
            choices[c.inventory_item_id] ?? "",
            c.locations.find((l) => l.id === source)?.quantity_mm ?? 0,
          ),
          label: `${stock.fabric_name} / ${stock.batch_code}`,
        }));
      if (!cuts.length) throw new Error("Enter metres for stitching");
      setStitchingSelection({ source, cuts, customer, salesperson });
      setStitching(true);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  if (stitching)
    return (
      <CustomerTailoring
        initialSelection={
          stitchingSelection ?? {
            source,
            cuts: cart.map((c) => ({
              inventory_item_id: c.inventory_item_id,
              thaan_id: c.thaan_id,
              quantity: c.quantity,
              label: c.label,
            })),
            customer,
            salesperson,
          }
        }
        onCancel={() => {
          setStitching(false);
          setStitchingSelection(null);
        }}
        onBooked={(id) => {
          setBookedTailoring(id);
          setCart([]);
          setSalesperson("");
          setChoices({});
          setPrice("");
          setPaid(false);
          setStitching(false);
          setStitchingSelection(null);
        }}
      />
    );
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
            Refresh stock
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
        <SalespersonPicker
          id="fabric-salesperson"
          value={salesperson}
          onChange={(value) => {
            setSalesperson(value);
            setPaid(false);
          }}
          disabled={frozen}
        />
        {stock && (
          <div className="space-y-2">
            <p>
              {stock.fabric_name} / {stock.batch_code} — {stock.barcode}
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              {stock.cuts.flatMap((cut) =>
                cut.locations.map((l) => (
                  <span key={`${cut.inventory_item_id}-${l.id}`}>
                    {l.name}: {l.quantity_mm / 1000} m
                  </span>
                )),
              )}
            </div>
            <Label htmlFor="counter-price-per-metre">Selling price per metre (₹)</Label>
            <Input
              id="counter-price-per-metre"
              inputMode="decimal"
              value={price}
              disabled={frozen || !can("pos.enter_price")}
              onChange={(e) => {
                setPrice(e.target.value);
                setPaid(false);
              }}
              placeholder="Enter price for this sale"
            />
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
                <span aria-live="polite">
                  {(() => {
                    try {
                      const sp = fabricMoneyInput(price);
                      return sp === null || !choices[cut.inventory_item_id]?.trim()
                        ? ""
                        : formatMoney(
                            fabricSaleCut(
                              choices[cut.inventory_item_id] ?? "",
                              cut.locations.find((l) => l.id === source)?.quantity_mm ?? 0,
                              sp,
                            ).amount,
                          );
                    } catch {
                      return "Check metres / price";
                    }
                  })()}
                </span>
              </div>
            ))}
            <Button disabled={frozen || !price.trim() || !can("pos.enter_price")} onClick={addCuts}>
              Add cuts to sale
            </Button>
            <Button
              variant="outline"
              disabled={
                frozen ||
                !source ||
                !salesperson ||
                !can("pos.issue_to_tailoring") ||
                !can("pos.enter_tailoring_total")
              }
              onClick={stitchSelectedMetres}
            >
              Use selected metres for stitching
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
        <p>Customer wants stitching?</p>
        <Button
          variant="outline"
          disabled={
            frozen ||
            !cart.length ||
            !salesperson ||
            !can("pos.issue_to_tailoring") ||
            !can("pos.enter_tailoring_total")
          }
          onClick={() => setStitching(true)}
        >
          Yes — select Factory and Tailor
        </Button>
        <p className="text-xs text-muted-foreground">
          For fabric only, complete the sale below. For stitching, selected fabric is carried into
          one linked order and deducted once.
        </p>
        {bookedTailoring && (
          <p role="status" className="break-all">
            Customer Tailoring booked: {bookedTailoring}. See Customer Tailoring history for the
            bill and progress.
          </p>
        )}
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
          disabled={
            checkout.isPending ||
            !cart.length ||
            !paid ||
            !can("pos.sell") ||
            !can("pos.enter_price") ||
            !salesperson ||
            !can("pos.assign_salesperson")
          }
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
