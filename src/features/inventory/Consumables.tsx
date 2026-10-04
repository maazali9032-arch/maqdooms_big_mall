import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel } from "@/shared/components/page";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/shared/utils/format";
import { quantityText } from "./ledger-quantity";
import { consumableQuantity, receiptCost, definiteDatabaseRejection } from "./consumable-input";
import type { Database } from "@/integrations/supabase/types";

export type Consumable = {
  id: string;
  name: string;
  unit: string;
  category: string;
  active: boolean;
  inventory_item_id: string | null;
  quantity: number | null;
  locations: { id: string; name: string; quantity: number }[];
};
const categories = ["buttons", "thread", "padding", "other"];
type ReceiptArgs = Database["public"]["Functions"]["receive_consumable"]["Args"];
type Receipt = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  destination_name: string;
  reason: string;
  received_at: string;
  received_by: string;
};
export function Consumables() {
  const { isOwner, roles, can } = useSession();
  const mayReceive = isOwner || (roles.includes("stock_entry") && can("inventory.receive"));
  const mayRead =
    isOwner || roles.some((r) => ["stock_entry", "counter", "ecommerce_manager"].includes(r));
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: ["consumables", "catalog"],
    enabled: mayRead,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("consumable_catalog");
      if (error) throw error;
      return data as unknown as Consumable[];
    },
  });
  const locations = useQuery({
    queryKey: ["location-ledger", "locations"],
    enabled: mayReceive,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_locations");
      if (error) throw error;
      return data ?? [];
    },
  });
  const history = useQuery({
    queryKey: ["consumables", "receipts"],
    enabled: mayReceive,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("consumable_receipt_history", { p_limit: 100 });
      if (error) throw error;
      return data as unknown as Receipt[];
    },
  });
  const [form, setForm] = useState({
    material: "",
    name: "",
    unit: "pc",
    category: "other",
    location: "",
    quantity: "",
    cp: "",
    reason: "",
  });
  const [pending, setPending] = useState<ReceiptArgs | null>(null);
  const refresh = () => {
    for (const key of ["consumables", "location-ledger", "material-issues", "inventory"])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const receive = useMutation({
    mutationFn: async (args: ReceiptArgs) => {
      setPending(args);
      const { data, error } = await supabase.rpc("receive_consumable", args);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setPending(null);
      setForm((f) => ({ ...f, quantity: "", cp: "", reason: "" }));
      refresh();
      toast.success("Consumable receipt posted");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPending(null);
      toast.error(e.message);
    },
  });
  const manage = useMutation({
    mutationFn: async (m: Consumable) => {
      const { error } = await supabase.rpc("manage_consumable", {
        p_material: m.id,
        p_name: m.name,
        p_category: m.category,
        p_active: m.active,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });
  if (!mayRead) return null;
  const selected = catalog.data?.find((m) => m.id === form.material);
  const submit = () => {
    if (pending) {
      receive.mutate(pending);
      return;
    }
    try {
      if (!form.location || !form.reason.trim() || (!selected && !form.name.trim()))
        throw new Error("Choose a destination and enter the material and receipt reason");
      receive.mutate({
        p_request_id: crypto.randomUUID(),
        p_material: selected?.id ?? null,
        p_name: selected ? null : form.name.trim(),
        p_unit: selected ? null : form.unit.trim(),
        p_category: selected ? null : form.category,
        p_location: form.location,
        p_quantity: consumableQuantity(form.quantity, selected?.unit ?? form.unit),
        p_cp: receiptCost(form.cp),
        p_reason: form.reason.trim(),
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Panel
      title="Consumables"
      description="Buttons, thread, padding and other materials. Quantities come from the location ledger."
    >
      {catalog.isPending && <p>Loading consumables…</p>}
      {catalog.error && <p role="alert">{catalog.error.message}</p>}
      {!catalog.isPending && !catalog.error && !catalog.data?.length && (
        <p>No consumables received yet.</p>
      )}
      <div className="space-y-3">
        {catalog.data?.map((m) => (
          <div key={m.id} className="rounded border p-3">
            <p>
              {m.name} · {m.category} ·{" "}
              {m.quantity === null
                ? "Opening locations require explicit reconciliation"
                : quantityText(Number(m.quantity), m.unit, false)}
              {!m.active && " · Inactive"}
            </p>
            <p className="text-sm text-muted-foreground">
              {m.locations
                .map((l) => `${l.name}: ${quantityText(Number(l.quantity), m.unit, false)}`)
                .join(" · ")}
            </p>
            {isOwner && (
              <div className="flex gap-2">
                <select
                  aria-label={`Category for ${m.name}`}
                  value={m.category}
                  disabled={manage.isPending}
                  onChange={(e) => manage.mutate({ ...m, category: e.target.value })}
                >
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={manage.isPending}
                  onClick={() => manage.mutate({ ...m, active: !m.active })}
                >
                  {m.active ? "Deactivate" : "Activate"}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      {mayReceive && (
        <div className="mt-5 space-y-3">
          <h3 className="font-semibold">Receive consumables</h3>
          <fieldset disabled={receive.isPending || !!pending} className="grid gap-3 md:grid-cols-2">
            <label>
              Material
              <select
                className="block w-full border p-2"
                value={form.material}
                onChange={(e) => setForm({ ...form, material: e.target.value })}
              >
                <option value="">New consumable</option>
                {catalog.data
                  ?.filter((m) => m.active && m.inventory_item_id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.unit})
                    </option>
                  ))}
              </select>
            </label>
            {!selected && (
              <>
                <label>
                  Name
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
                <label>
                  Unit (pc, set, pair, m, etc.)
                  <Input
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  />
                </label>
                <label>
                  Category
                  <select
                    className="block w-full border p-2"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  >
                    {categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label>
              Destination
              <select
                className="block w-full border p-2"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              >
                <option value="">Choose destination</option>
                {locations.data
                  ?.filter((l) => l.active)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Quantity ({selected?.unit ?? form.unit})
              <Input
                inputMode="decimal"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />
            </label>
            <label>
              Receipt CP per unit (₹)
              <Input
                inputMode="decimal"
                value={form.cp}
                onChange={(e) => setForm({ ...form, cp: e.target.value })}
              />
            </label>
            <label>
              Receipt reference / reason
              <Input
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </label>
          </fieldset>
          <p className="text-sm text-muted-foreground">
            CP is entered for this receipt. Receiving does not change SP or reprice previous
            receipts and jobs.
          </p>
          {locations.error && <p role="alert">{locations.error.message}</p>}
          {pending && !receive.isPending && (
            <p role="alert">
              Receipt result is uncertain. Retry the same receipt to confirm its result.
            </p>
          )}
          <Button onClick={submit} disabled={receive.isPending}>
            {receive.isPending ? "Posting…" : pending ? "Retry same receipt" : "Post receipt"}
          </Button>
          <h3 className="font-semibold">Receipt history</h3>
          {history.error && <p role="alert">{history.error.message}</p>}
          {!history.isPending && !history.error && !history.data?.length && (
            <p>No receipts recorded.</p>
          )}
          {history.data?.map((r) => (
            <p key={r.id} className="text-sm">
              {formatDateTime(r.received_at)} · {r.name} ·{" "}
              {quantityText(Number(r.quantity), r.unit, false)} → {r.destination_name} · {r.reason}{" "}
              · Received by {r.received_by}
            </p>
          ))}
        </div>
      )}
    </Panel>
  );
}
