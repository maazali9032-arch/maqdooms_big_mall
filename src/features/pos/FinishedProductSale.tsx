import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { useCustomers } from "@/features/customers";
import { definiteDatabaseRejection } from "@/features/inventory/consumable-input";
import { Panel } from "@/shared/components/page";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/shared/utils/units";
import { formatDateTime } from "@/shared/utils/format";

type Cost = {
  versions: {
    total_paise: number;
    quantity_snapshot: number;
    lines: { id: string; category: string; amount_paise: number }[];
  }[];
};
type Piece = {
  id: string;
  barcode: string;
  product: string;
  design: string;
  production_job: string;
  piece_number: number;
  location_id: string;
  location: string;
  location_active: boolean;
  status: string;
  available: boolean;
  sp_paise: number | null;
  sp_version_id: string | null;
  identical_available: number;
  locations: {
    location_id: string;
    name: string;
    quantity: number;
    subtree_quantity: number;
    kind: string;
    active: boolean;
  }[];
  production_cost_paise?: number | null;
  production_cost?: Cost;
};
type Order = {
  id: string;
  code: string;
  customer_snapshot: { name: string | null; phone?: string | null };
  source: string;
  final_customer_price_paise: number;
  reference: string | null;
  actor: string | null;
  created_by: string;
  completed_at: string;
  items: {
    id: string;
    barcode: string;
    product: string;
    design: string;
    job_code: string;
    quantity: number;
    sp_paise: number;
    final_customer_price_paise: number;
    movement_id: string;
    production_cost_paise?: number | null;
    cost_evidence?: {
      total_paise: number;
      quantity_snapshot: number;
      lines: { id: string; category: string; amount_paise: number }[];
    };
  }[];
};
type Request = {
  p_request: string;
  p_source: string;
  p_items: { piece_id: string; sp_version_id: string }[];
  p_customer: string | null;
  p_payment_confirmed: boolean;
  p_reference: string;
};

export function FinishedProductSale() {
  const { isOwner, roles, can } = useSession();
  const allowed = isOwner || roles.includes("counter");
  const qc = useQueryClient();
  const customers = useCustomers(allowed);
  const [barcode, setBarcode] = useState("");
  const [scan, setScan] = useState("");
  const [cart, setCart] = useState<Piece[]>([]);
  const [customer, setCustomer] = useState("");
  const [reference, setReference] = useState("");
  const [paid, setPaid] = useState(false);
  const [pending, setPending] = useState<Request | null>(null);
  const [posted, setPosted] = useState<string | null>(null);
  const lookup = useQuery({
    queryKey: ["finished-product-sale", "scan", scan],
    enabled: allowed && Boolean(scan),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("finished_product_sale_scan", { p_barcode: scan });
      if (error) throw error;
      return data as unknown as Piece | null;
    },
  });
  const history = useQuery({
    queryKey: ["finished-product-sale", "history"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("finished_product_order_history", { p_limit: 50 });
      if (error) throw error;
      return data as unknown as Order[];
    },
  });
  const sale = useMutation({
    mutationFn: async () => {
      if (!can("pos.sell") || !allowed) throw new Error("Sale permission required");
      if (!pending && (!cart.length || !paid || !Number.isSafeInteger(total)))
        throw new Error("Select pieces and confirm payment for the exact total");
      const request = pending ?? {
        p_request: crypto.randomUUID(),
        p_source: cart[0]!.location_id,
        p_items: cart
          .map((p) => ({ piece_id: p.id, sp_version_id: p.sp_version_id! }))
          .sort((a, b) => a.piece_id.localeCompare(b.piece_id)),
        p_customer: customer || null,
        p_payment_confirmed: true,
        p_reference: reference.trim(),
      };
      setPending(request);
      const { data, error } = await supabase.rpc("complete_finished_product_sale", request);
      if (error) {
        if (definiteDatabaseRejection(error)) setPending(null);
        throw error;
      }
      setPending(null);
      setPosted(data);
      setCart([]);
      setPaid(false);
      setReference("");
    },
    onSuccess: () => toast.success("Finished Product sale completed"),
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : ((e as { message?: string }).message ?? "Sale failed"),
      ),
    onSettled: async () => {
      await Promise.all(
        [
          ["finished-product-sale"],
          ["finished-products"],
          ["finished-product-inventory"],
          ["finished-product-movements"],
          ["location-ledger"],
          ["customers"],
          ["dashboard-metrics"],
        ].map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
    },
  });
  if (!allowed) return null;
  const piece = lookup.data;
  const frozen = sale.isPending || Boolean(pending);
  const total = cart.reduce((sum, p) => sum + Number(p.sp_paise), 0);
  const add = () => {
    if (
      !piece?.available ||
      !piece.location_active ||
      piece.sp_paise === null ||
      !piece.sp_version_id
    ) {
      toast.error("Available piece with Owner SP at an active location required");
      return;
    }
    if (cart.some((p) => p.id === piece.id)) {
      toast.error("This physical piece is already selected");
      return;
    }
    if (cart.length >= 50 || (cart.length && cart[0]!.location_id !== piece.location_id)) {
      toast.error("Choose at most 50 pieces from the same location per sale");
      return;
    }
    setCart([...cart, piece]);
    setPaid(false);
    setPosted(null);
  };
  return (
    <div className="space-y-4">
      <Panel
        title="Finished Product Counter & sales"
        description="Scan every physical Product Barcode to sell it. Identical-piece counts refer to the same Production Job."
      >
        <div className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const code = barcode.trim();
              if (!code) return;
              setScan(code);
              void qc.invalidateQueries({ queryKey: ["finished-product-sale", "scan", code] });
            }}
          >
            <Input
              aria-label="Sale Product Barcode"
              placeholder="Scan Product Barcode"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              disabled={frozen}
              autoComplete="off"
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button disabled={frozen || !barcode.trim()}>Scan</Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Keyboard scanner: focus the barcode field and scan; Enter opens the product. Scan each
            physical piece.
          </p>
          {lookup.error ? (
            <p role="alert">Product could not load. Refresh and review before selling.</p>
          ) : scan && lookup.isPending ? (
            <p>Loading Product…</p>
          ) : scan && !piece ? (
            <p>Product Barcode not found.</p>
          ) : null}
          {piece ? (
            <div className="space-y-2 rounded border p-3">
              <p>
                {piece.product} / {piece.design} · {piece.production_job} · Piece{" "}
                {piece.piece_number}
              </p>
              <p className="break-all font-mono">{piece.barcode}</p>
              <p>
                SP:{" "}
                {piece.sp_paise === null ? "Owner SP not set" : formatMoney(Number(piece.sp_paise))}{" "}
                · {piece.available ? "Available" : piece.status} · {piece.location}
                {!piece.location_active ? " (inactive)" : ""}
              </p>
              <p>Identical pieces available: {piece.identical_available}</p>
              <div className="flex flex-wrap gap-3">
                {piece.locations.map((l) => (
                  <p key={l.location_id}>
                    {l.name}: {l.subtree_quantity}
                    {l.kind === "showroom" ? ` (${l.quantity} outside sublocations)` : ""}
                    {!l.active ? " (inactive)" : ""}
                  </p>
                ))}
              </div>
              {isOwner ? (
                <details>
                  <summary>Owner production cost</summary>
                  <p>
                    Per piece:{" "}
                    {piece.production_cost_paise == null
                      ? "Not finalized"
                      : formatMoney(Number(piece.production_cost_paise))}
                  </p>
                  {piece.production_cost?.versions[0]?.lines.map((l) => (
                    <p key={l.id}>
                      {l.category}: {formatMoney(Number(l.amount_paise))} (job total)
                    </p>
                  ))}
                </details>
              ) : null}
              <Button
                variant="outline"
                disabled={
                  frozen ||
                  lookup.isFetching ||
                  !can("pos.sell") ||
                  !piece.available ||
                  !piece.location_active ||
                  piece.sp_paise === null ||
                  !piece.sp_version_id
                }
                onClick={add}
              >
                Add this piece
              </Button>
            </div>
          ) : null}
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>Selected piece</th>
                  <th>Location</th>
                  <th>SP / final price</th>
                  <th>Remove</th>
                </tr>
              </thead>
              <tbody>
                {cart.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="break-all py-2">
                      {p.product} / {p.design}
                      <p>{p.barcode}</p>
                    </td>
                    <td>{p.location}</td>
                    <td>{formatMoney(Number(p.sp_paise))}</td>
                    <td>
                      <Button
                        variant="ghost"
                        disabled={frozen}
                        onClick={() => {
                          setCart(cart.filter((x) => x.id !== p.id));
                          setPaid(false);
                        }}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            {cart.length} whole pieces · Total{" "}
            {Number.isSafeInteger(total) ? formatMoney(total) : "Exceeds supported money range"}.
            Final customer price equals Owner SP; no additional sales charges.
          </p>
          <Label htmlFor="product-sale-customer">Customer</Label>
          <select
            id="product-sale-customer"
            className="h-11 w-full rounded border bg-background p-2"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            disabled={frozen || customers.isPending || Boolean(customers.error)}
          >
            <option value="">Walk-in customer</option>
            {customers.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? "Customer"} {c.phone ?? ""}
              </option>
            ))}
          </select>
          {customers.error ? (
            <p role="alert">
              Customers could not load. Refresh to select a customer; a walk-in sale remains
              available.
            </p>
          ) : null}
          <Input
            aria-label="Finished Product sale reference"
            placeholder="Optional customer reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={frozen}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={paid}
              disabled={frozen || !cart.length}
              onChange={(e) => setPaid(e.target.checked)}
            />
            Payment received for the exact total shown
          </label>
          {pending && !sale.isPending ? (
            <p role="alert">
              The last result is uncertain. Retry this same request to confirm the sale without
              deducting stock twice.
            </p>
          ) : null}
          <Button
            disabled={
              sale.isPending ||
              !can("pos.sell") ||
              (!pending && (!cart.length || !paid || !Number.isSafeInteger(total)))
            }
            onClick={() => sale.mutate()}
          >
            {pending ? "Retry same sale" : "Complete paid Finished Product sale"}
          </Button>
          {posted ? (
            <p role="status" className="break-all">
              Completed order {posted}. Stock and order history refreshed.
            </p>
          ) : null}
        </div>
      </Panel>
      <Panel
        title="Finished Product order history"
        description="Latest 50 completed sales retain customer, physical pieces, location, SP, final price, user, time and stock movements."
      >
        {history.error ? (
          <p role="alert">Order history could not load.</p>
        ) : history.isPending ? (
          <p>Loading orders…</p>
        ) : !history.data?.length ? (
          <p>No completed Finished Product sales.</p>
        ) : (
          history.data.map((o) => (
            <div key={o.id} className="space-y-1 border-b py-3 text-sm">
              <p className="break-all">
                {o.code} · {o.customer_snapshot?.name ?? "Customer"}{" "}
                {o.customer_snapshot?.phone ?? ""}
              </p>
              <p>
                {o.source} · {formatDateTime(o.completed_at)} · {o.actor ?? o.created_by}
              </p>
              <p>
                Total {formatMoney(Number(o.final_customer_price_paise))} ·{" "}
                {o.reference ?? "No customer reference"}
              </p>
              {o.items.map((it) => (
                <div key={it.id} className="ml-2">
                  <p className="break-all">
                    {it.product} / {it.design} · {it.barcode} · {it.job_code}
                  </p>
                  <p>
                    {it.quantity} pc · SP {formatMoney(Number(it.sp_paise))} · Final{" "}
                    {formatMoney(Number(it.final_customer_price_paise))}
                  </p>
                  <p className="break-all text-xs">Movement {it.movement_id}</p>
                  {isOwner ? (
                    <details>
                      <summary>
                        Owner sale-time production cost:{" "}
                        {it.production_cost_paise == null
                          ? "Not recorded"
                          : formatMoney(Number(it.production_cost_paise))}
                      </summary>
                      {it.cost_evidence?.lines.map((l) => (
                        <p key={l.id}>
                          {l.category}: {formatMoney(Number(l.amount_paise))} (job total at sale)
                        </p>
                      ))}
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          ))
        )}
      </Panel>
    </div>
  );
}
