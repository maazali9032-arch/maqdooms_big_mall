import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/shared/components/page";
import { formatDateTime } from "@/shared/utils/format";

import { quantityInput, quantityText } from "./ledger-quantity";
import { FabricTransfer } from "./FabricTransfer";

export function LocationLedger() {
  const { isOwner } = useSession();
  const queryClient = useQueryClient();
  const catalog = useQuery({
    queryKey: ["location-ledger", "catalog"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_catalog");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const locations = useQuery({
    queryKey: ["location-ledger", "locations"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_locations");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const balances = useQuery({
    queryKey: ["location-ledger", "balances"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_location_balances");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const history = useQuery({
    queryKey: ["location-ledger", "history"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_movement_history", { p_limit: 200 });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const [locationForm, setLocationForm] = useState({ id: "", code: "", name: "", active: true });
  const [selected, setSelected] = useState("");
  const item = catalog.data?.find((row) => row.item_id === selected);
  const [allocations, setAllocations] = useState([{ location: "", quantity: "" }]);
  const [reconcileReason, setReconcileReason] = useState("");
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [transferLines, setTransferLines] = useState([{ item: "", quantity: "" }]);
  const [transferReason, setTransferReason] = useState("");
  const request = useRef<{ signature: string; id: string } | null>(null);
  const [correction, setCorrection] = useState({
    item: "",
    location: "",
    kind: "ADJUSTMENT",
    quantity: "",
    incoming: false,
    reason: "",
  });
  const active = (locations.data ?? []).filter((row) => row.active);
  const tracked = (catalog.data ?? []).filter((row) => row.inventory_item_id);
  const locationName = (id: string | null) =>
    locations.data?.find((row) => row.id === id)?.name ?? (id ? id : "Outside stock");
  const itemName = (id: string | null) =>
    catalog.data?.find((row) => row.inventory_item_id === id)?.label ?? id ?? "Unlinked history";
  const save = useMutation({
    mutationFn: async (operation: () => Promise<void>) => operation(),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["location-ledger"] }),
        queryClient.invalidateQueries({ queryKey: ["thaans"] }),
        queryClient.invalidateQueries({ queryKey: ["materials"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
        queryClient.invalidateQueries({ queryKey: ["fabric-stock"] }),
        queryClient.invalidateQueries({ queryKey: ["fabric-stock-history"] }),
        queryClient.invalidateQueries({ queryKey: ["stock-transfer-history"] }),
        queryClient.invalidateQueries({ queryKey: ["finished-products"] }),
        queryClient.invalidateQueries({ queryKey: ["finished-product-sale"] }),
        queryClient.invalidateQueries({ queryKey: ["finished-product-inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["finished-product-movements"] }),
      ]);
    },
    onSuccess: () => toast.success("Stock record saved"),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Stock operation failed"),
  });
  const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm";
  const locationSelect = (value: string, onChange: (value: string) => void, label: string) => (
    <select
      aria-label={label}
      className={selectClass}
      value={value}
      required
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Select location</option>
      {active.map((row) => (
        <option key={row.id} value={row.id}>
          {row.name}
        </option>
      ))}
    </select>
  );
  if (catalog.isLoading || locations.isLoading || balances.isLoading)
    return <p>Loading stock locations…</p>;
  if (catalog.error || locations.error || balances.error || history.error)
    return <p role="alert">Stock location data could not be loaded. Refresh to try again.</p>;
  return (
    <div className="space-y-5">
      {isOwner ? <FabricTransfer /> : null}
      <Panel
        title="Stock by location"
        description="Unreconciled stock remains unlocated until the Owner records a verified physical count."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Item</th>
                <th>Location</th>
                <th className="text-right">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {(catalog.data ?? []).map((row) =>
                row.inventory_item_id && row.quantity !== 0 ? (
                  (balances.data ?? [])
                    .filter(
                      (balance) =>
                        balance.inventory_item_id === row.inventory_item_id &&
                        balance.quantity !== 0,
                    )
                    .map((balance) => (
                      <tr key={`${row.item_id}-${balance.location_id}`} className="border-b">
                        <td className="py-3">{row.label}</td>
                        <td>{locationName(balance.location_id)}</td>
                        <td className="text-right">
                          {quantityText(balance.quantity, row.unit, row.item_kind === "fabric")}
                        </td>
                      </tr>
                    ))
                ) : (
                  <tr key={row.item_id} className="border-b">
                    <td className="py-3">{row.label}</td>
                    <td>
                      {row.inventory_item_id
                        ? "Reconciled — no stock"
                        : row.unlinked_movements
                          ? "Unlinked history — review required"
                          : "Unlocated — reconciliation required"}
                    </td>
                    <td className="text-right">
                      {quantityText(row.quantity, row.unit, row.item_kind === "fabric")}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Showroom Locations">
        <div className="space-y-3">
          {(locations.data ?? []).map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3">
              <span>
                {row.name} · {row.code}
                {!row.active ? " · Inactive" : ""}
              </span>
              {isOwner && row.kind === "showroom_sublocation" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setLocationForm({
                      id: row.id,
                      code: row.code,
                      name: row.name,
                      active: row.active,
                    })
                  }
                >
                  Edit
                </Button>
              ) : null}
            </div>
          ))}
          {isOwner ? (
            <form
              className="grid gap-2 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(async () => {
                  const { error } = await supabase.rpc("manage_showroom_location", {
                    p_id: locationForm.id || null,
                    p_code: locationForm.code,
                    p_name: locationForm.name,
                    p_active: locationForm.active,
                  });
                  if (error) throw new Error(error.message);
                  setLocationForm({ id: "", code: "", name: "", active: true });
                });
              }}
            >
              <Input
                aria-label="Location code"
                placeholder="Location code"
                required
                disabled={!!locationForm.id}
                value={locationForm.code}
                onChange={(e) => setLocationForm({ ...locationForm, code: e.target.value })}
              />
              <Input
                aria-label="Location name"
                placeholder="Location name"
                required
                value={locationForm.name}
                onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={locationForm.active}
                  onChange={(e) => setLocationForm({ ...locationForm, active: e.target.checked })}
                />
                Active
              </label>
              <Button disabled={save.isPending}>
                {locationForm.id ? "Save location" : "Add sublocation"}
              </Button>
            </form>
          ) : null}
        </div>
      </Panel>
      {isOwner ? (
        <>
          <Panel
            title="Reconcile stock locations"
            description="Allocate the complete existing quantity. After confirmation, use location controls for movements. Existing Counter sales and unlocated reservations cannot use this stock yet."
          >
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(async () => {
                  if (!item) throw new Error("Select an item");
                  const values =
                    item.quantity === 0
                      ? []
                      : allocations.map((row) => ({
                          location_id: row.location,
                          quantity: quantityInput(
                            row.quantity,
                            item.unit,
                            item.item_kind === "fabric",
                          ),
                        }));
                  const { error } = await supabase.rpc("reconcile_inventory_item", {
                    p_kind: item.item_kind,
                    p_item_id: item.item_id,
                    p_allocations: values,
                    p_reason: reconcileReason,
                  });
                  if (error) throw new Error(error.message);
                  setSelected("");
                  setAllocations([{ location: "", quantity: "" }]);
                  setReconcileReason("");
                });
              }}
            >
              <select
                aria-label="Item to reconcile"
                className={selectClass}
                required
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Select unlocated stock</option>
                {(catalog.data ?? [])
                  .filter((row) => !row.inventory_item_id)
                  .map((row) => (
                    <option key={row.item_id} value={row.item_id}>
                      {row.label} ·{" "}
                      {quantityText(row.quantity, row.unit, row.item_kind === "fabric")}
                    </option>
                  ))}
              </select>
              {item?.quantity !== 0 &&
                allocations.map((row, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-3">
                    {locationSelect(
                      row.location,
                      (location) =>
                        setAllocations((values) =>
                          values.map((value, n) => (n === index ? { ...value, location } : value)),
                        ),
                      "Opening location",
                    )}
                    <Input
                      aria-label="Opening quantity"
                      placeholder={`Quantity (${item?.item_kind === "fabric" ? "m" : (item?.unit ?? "unit")})`}
                      inputMode="decimal"
                      required
                      value={row.quantity}
                      onChange={(e) =>
                        setAllocations((values) =>
                          values.map((value, n) =>
                            n === index ? { ...value, quantity: e.target.value } : value,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={allocations.length === 1}
                      onClick={() =>
                        setAllocations((values) => values.filter((_, n) => n !== index))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              <Button
                type="button"
                variant="outline"
                disabled={item?.quantity === 0}
                onClick={() =>
                  setAllocations((values) => [...values, { location: "", quantity: "" }])
                }
              >
                Add allocation
              </Button>
              {item?.quantity === 0 ? (
                <p>
                  No stock remains. Confirming will record a zero opening quantity without creating
                  an inventory movement.
                </p>
              ) : null}
              <Input
                aria-label="Reconciliation reason"
                placeholder="Verified count / reference"
                required
                value={reconcileReason}
                onChange={(e) => setReconcileReason(e.target.value)}
              />
              <Button disabled={save.isPending || !item || !!item.unlinked_movements}>
                Confirm locations
              </Button>
            </form>
          </Panel>
          <Panel
            title="Transfer stock"
            description="Move verified stock between Workshop, Showroom and its sublocations. A transfer preserves the total quantity."
          >
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(async () => {
                  const values = transferLines.map((row) => {
                    const selectedItem = tracked.find(
                      (value) => value.inventory_item_id === row.item,
                    );
                    if (!selectedItem) throw new Error("Select each transfer item");
                    return {
                      inventory_item_id: row.item,
                      quantity: quantityInput(
                        row.quantity,
                        selectedItem.unit,
                        selectedItem.item_kind === "fabric",
                      ),
                    };
                  });
                  const signature = JSON.stringify([source, destination, values, transferReason]);
                  if (request.current?.signature !== signature)
                    request.current = { signature, id: crypto.randomUUID() };
                  const { error } = await supabase.rpc("post_inventory_transfer", {
                    p_request_id: request.current.id,
                    p_source: source,
                    p_destination: destination,
                    p_items: values,
                    p_reason: transferReason,
                  });
                  if (error) throw new Error(error.message);
                  request.current = null;
                  setTransferLines([{ item: "", quantity: "" }]);
                  setTransferReason("");
                });
              }}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                {locationSelect(source, setSource, "Transfer source")}
                {locationSelect(destination, setDestination, "Transfer destination")}
              </div>
              {transferLines.map((row, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-3">
                  <select
                    aria-label="Transfer item"
                    className={selectClass}
                    required
                    value={row.item}
                    onChange={(e) =>
                      setTransferLines((values) =>
                        values.map((value, n) =>
                          n === index ? { ...value, item: e.target.value } : value,
                        ),
                      )
                    }
                  >
                    <option value="">Select stock</option>
                    {tracked.map((value) => (
                      <option key={value.item_id} value={value.inventory_item_id!}>
                        {value.label} ·{" "}
                        {quantityText(
                          (balances.data ?? []).find(
                            (balance) =>
                              balance.inventory_item_id === value.inventory_item_id &&
                              balance.location_id === source,
                          )?.quantity ?? 0,
                          value.unit,
                          value.item_kind === "fabric",
                        )}{" "}
                        at source
                      </option>
                    ))}
                  </select>
                  <Input
                    aria-label="Transfer quantity"
                    inputMode="decimal"
                    required
                    placeholder="Quantity (fabric in m)"
                    value={row.quantity}
                    onChange={(e) =>
                      setTransferLines((values) =>
                        values.map((value, n) =>
                          n === index ? { ...value, quantity: e.target.value } : value,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={transferLines.length === 1}
                    onClick={() =>
                      setTransferLines((values) => values.filter((_, n) => n !== index))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setTransferLines((values) => [...values, { item: "", quantity: "" }])
                }
              >
                Add item
              </Button>
              <Input
                aria-label="Transfer reason"
                placeholder="Transfer reason / reference"
                required
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
              />
              <Button disabled={save.isPending}>Post transfer</Button>
            </form>
          </Panel>
          <Panel
            title="Record stock correction"
            description="Adjustments, returns and wastage require an explicit quantity and reason."
          >
            <form
              className="grid gap-2 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(async () => {
                  const chosen = tracked.find(
                    (value) => value.inventory_item_id === correction.item,
                  );
                  if (!chosen) throw new Error("Select an item");
                  const { error } = await supabase.rpc("record_inventory_correction", {
                    p_item: correction.item,
                    p_location: correction.location,
                    p_kind: correction.kind,
                    p_quantity: quantityInput(
                      correction.quantity,
                      chosen.unit,
                      chosen.item_kind === "fabric",
                    ),
                    p_incoming: correction.incoming,
                    p_reason: correction.reason,
                  });
                  if (error) throw new Error(error.message);
                  setCorrection({ ...correction, quantity: "", reason: "" });
                });
              }}
            >
              <select
                aria-label="Correction item"
                className={selectClass}
                required
                value={correction.item}
                onChange={(e) => setCorrection({ ...correction, item: e.target.value })}
              >
                <option value="">Select stock</option>
                {tracked.map((row) => (
                  <option key={row.item_id} value={row.inventory_item_id!}>
                    {row.label}
                  </option>
                ))}
              </select>
              {locationSelect(
                correction.location,
                (location) => setCorrection({ ...correction, location }),
                "Correction location",
              )}
              <select
                aria-label="Correction type"
                className={selectClass}
                value={correction.kind}
                onChange={(e) =>
                  setCorrection({
                    ...correction,
                    kind: e.target.value,
                    incoming: e.target.value === "RETURN",
                  })
                }
              >
                <option value="ADJUSTMENT">Adjustment</option>
                <option value="RETURN">Return</option>
                <option value="WASTAGE">Wastage</option>
              </select>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={correction.incoming}
                  disabled={correction.kind !== "ADJUSTMENT"}
                  onChange={(e) => setCorrection({ ...correction, incoming: e.target.checked })}
                />
                Add stock
              </label>
              <Input
                aria-label="Correction quantity"
                inputMode="decimal"
                required
                placeholder="Quantity (fabric in m)"
                value={correction.quantity}
                onChange={(e) => setCorrection({ ...correction, quantity: e.target.value })}
              />
              <Input
                aria-label="Correction reason"
                required
                placeholder="Reason / reference"
                value={correction.reason}
                onChange={(e) => setCorrection({ ...correction, reason: e.target.value })}
              />
              <Button disabled={save.isPending}>Record movement</Button>
            </form>
          </Panel>
        </>
      ) : null}
      <Panel
        title="Location movement history"
        description="Latest 200 movements. Opening counts, transfers and explicit corrections remain traceable."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Time / actor</th>
                <th>Item / type</th>
                <th>Movement</th>
                <th>Reason / reference</th>
              </tr>
            </thead>
            <tbody>
              {(history.data ?? []).map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="py-3">
                    {formatDateTime(row.occurred_at)}
                    <div className="text-xs text-muted-foreground">{row.actor_id}</div>
                  </td>
                  <td>
                    {itemName(row.inventory_item_id)}
                    <div>{row.kind}</div>
                  </td>
                  <td>
                    {quantityText(
                      row.quantity,
                      row.unit,
                      catalog.data?.find((item) => item.inventory_item_id === row.inventory_item_id)
                        ?.item_kind === "fabric",
                    )}
                    <div>
                      {locationName(row.source_location_id)} →{" "}
                      {locationName(row.destination_location_id)}
                    </div>
                  </td>
                  <td>
                    {row.reason}
                    <div className="text-xs">{row.reference}</div>
                    {row.order_item_id ? (
                      <div className="text-xs">Order item: {row.order_item_id}</div>
                    ) : null}
                    {row.customer_tailoring_job_id || row.production_job_id ? (
                      <div className="text-xs">
                        Job: {row.customer_tailoring_job_id ?? row.production_job_id}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
