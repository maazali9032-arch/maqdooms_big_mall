import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { Button } from "@/components/ui/button";

type Destination = {
  tailor_id: string;
  tailor_name: string;
  factory_id: string;
  factory_name: string;
};
type Queue = { barcode: string; tailor: string };
const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: Error | null }>;
export function MaterialUnitTransfer() {
  const { isOwner, can } = useSession();
  const allowed = isOwner || can("materials.transfer_units");
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [tailor, setTailor] = useState("");
  const [queue, setQueue] = useState<Queue[]>([]);
  const destinations = useQuery({
    queryKey: ["material-transfer-destinations"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await rpc("material_transfer_destinations", {});
      if (error) throw error;
      return data as Destination[];
    },
  });
  const transfer = useMutation({
    mutationFn: async (items: Queue[]) => {
      for (const item of items) {
        const { error } = await rpc("transfer_material_unit", {
          p_request: crypto.randomUUID(),
          p_barcode: item.barcode,
          p_tailor: item.tailor,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setQueue([]);
      void qc.invalidateQueries({ queryKey: ["material-units"] });
      toast.success("Complete material units assigned to the Master Tailor");
    },
    onError: (error) => toast.error(error.message),
  });
  if (!allowed) return null;
  const add = (value: string): void => {
    const barcode = value.trim().toUpperCase();
    if (!/^M[0-9A-Z]{5}$/.test(barcode)) {
      toast.error("Scan a six-character M material-unit barcode");
      return;
    }
    if (!tailor) {
      toast.error("Choose the destination Master Tailor first");
      return;
    }
    if (queue.some((item) => item.barcode === barcode)) {
      toast.error("This unit is already in the transfer list");
      return;
    }
    setQueue((items) => [...items, { barcode, tailor }]);
    setCode("");
  };
  return (
    <div className="mb-5 rounded-xl border p-4">
      <h3 className="font-semibold">Transfer material units to a Master Tailor</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Choose the factory Tailor once, then scan multiple M barcodes. Every scan adds one complete
        physical unit.
      </p>
      <select
        className="mb-3 min-h-11 w-full rounded-md border bg-background px-3"
        value={tailor}
        onChange={(e) => setTailor(e.target.value)}
      >
        <option value="">Choose factory and Master Tailor</option>
        {destinations.data?.map((row) => (
          <option key={row.tailor_id} value={row.tailor_id}>
            {row.factory_name} · {row.tailor_name}
          </option>
        ))}
      </select>
      <BarcodeEntry
        value={code}
        onChange={setCode}
        onScan={add}
        label="Material unit barcode"
        placeholder="Scan M material-unit barcode"
        disabled={transfer.isPending}
        action="Add unit"
      />
      {!!queue.length && (
        <div className="mt-3 space-y-2">
          {queue.map((item) => (
            <div
              key={item.barcode}
              className="flex items-center justify-between rounded border p-2"
            >
              <span className="font-mono">{item.barcode}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setQueue((rows) => rows.filter((row) => row.barcode !== item.barcode))
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button disabled={transfer.isPending} onClick={() => transfer.mutate(queue)}>
            {transfer.isPending
              ? "Transferring…"
              : `Transfer ${queue.length} complete unit${queue.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      )}
    </div>
  );
}
