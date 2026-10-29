import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/shared/components/page";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMetres, metresToMm, mmToMetres } from "@/shared/utils/units";

type LocationBalance = { id: string; name: string; kind: string; quantity: number };
type LookupResult = {
  inventory_item_id: string;
  kind: "fabric" | "piece";
  unit: string;
  label: string;
  barcode: string;
  total: number;
  locations: LocationBalance[];
};

function showQuantity(kind: LookupResult["kind"], quantity: number) {
  return kind === "fabric" ? formatMetres(quantity) : `${quantity} pc`;
}

/**
 * Owner-only stock correction: scan a barcode, enter the quantity actually on
 * the shelf at one location and a reason. The difference is posted as an
 * audited ADJUSTMENT movement through record_inventory_correction().
 */
export function OwnerStockCorrection() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [item, setItem] = useState<LookupResult | null>(null);
  const [locationId, setLocationId] = useState("");
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");

  const lookup = useMutation({
    mutationFn: async (barcode: string) => {
      const { data, error } = await supabase.rpc("owner_stock_correction_lookup", {
        p_barcode: barcode,
      });
      if (error) throw new Error(error.message);
      return data as unknown as LookupResult;
    },
    onSuccess: (data) => {
      setItem(data);
      const withStock = data.locations.find((l) => Number(l.quantity) > 0);
      setLocationId(withStock?.id ?? data.locations[0]?.id ?? "");
      setCounted("");
      setReason("");
    },
    onError: (e) => {
      setItem(null);
      toast.error(e.message);
    },
  });

  const location = item?.locations.find((l) => l.id === locationId);
  const current = location ? Number(location.quantity) : 0;
  const countedValue =
    counted.trim() === ""
      ? null
      : item?.kind === "fabric"
        ? Number.isFinite(Number(counted)) && Number(counted) >= 0
          ? metresToMm(Number(counted))
          : null
        : Number.isInteger(Number(counted)) && Number(counted) >= 0
          ? Number(counted)
          : null;
  const difference = countedValue === null ? null : countedValue - current;

  const save = useMutation({
    mutationFn: async () => {
      if (!item || !location || difference === null || difference === 0) return;
      const { error } = await supabase.rpc("record_inventory_correction", {
        p_item: item.inventory_item_id,
        p_location: location.id,
        p_kind: "ADJUSTMENT",
        p_quantity: Math.abs(difference),
        p_incoming: difference > 0,
        p_reason: reason.trim(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Stock corrected and recorded in the audit trail");
      void qc.invalidateQueries();
      if (item) lookup.mutate(item.barcode);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Panel
      title="Stock corrections"
      description="Owner only. Scan an item, enter what is actually on the shelf at one location, and give a reason. The difference is recorded as an audited correction; earlier history is never changed."
    >
      <div className="space-y-4">
        <BarcodeEntry
          label="Stock barcode"
          value={code}
          onChange={setCode}
          onScan={(value) => lookup.mutate(value)}
          disabled={lookup.isPending}
        />
        {item ? (
          <section className="space-y-4 rounded-lg border p-4">
            <div>
              <p className="font-semibold">{item.label}</p>
              <p className="text-sm text-muted-foreground">
                {item.barcode} · total {showQuantity(item.kind, Number(item.total))}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {item.locations.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLocationId(l.id)}
                  aria-pressed={l.id === locationId}
                  className={`min-h-11 rounded-md border px-3 py-2 text-left text-sm ${
                    l.id === locationId ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <span className="block font-medium">{l.name}</span>
                  <span className="text-muted-foreground">
                    {showQuantity(item.kind, Number(l.quantity))}
                  </span>
                </button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="counted">
                  Actual quantity at {location?.name ?? "location"} (
                  {item.kind === "fabric" ? "metres" : "pieces"})
                </Label>
                <Input
                  id="counted"
                  inputMode="decimal"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                  placeholder={
                    item.kind === "fabric" ? String(mmToMetres(current)) : String(current)
                  }
                />
                <p className="text-sm text-muted-foreground">
                  {difference === null
                    ? `Recorded now: ${showQuantity(item.kind, current)}`
                    : difference === 0
                      ? "Matches the record; nothing to correct."
                      : `${difference > 0 ? "Adds" : "Removes"} ${showQuantity(
                          item.kind,
                          Math.abs(difference),
                        )}`}
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="reason">Reason (required)</Label>
                <Textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Physical count on 30 Oct; 0.5 m damaged end cut off"
                />
              </div>
            </div>
            <Button
              disabled={
                save.isPending ||
                !location ||
                difference === null ||
                difference === 0 ||
                reason.trim().length < 3
              }
              onClick={() => save.mutate()}
            >
              Record correction
            </Button>
          </section>
        ) : null}
      </div>
    </Panel>
  );
}
