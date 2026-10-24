import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/shared/components/page";
import { gstLocalDateTime } from "./configuration-time";
import { percentToBps } from "./tax";
const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: Error | null }>;
type Slab = {
  threshold_paise: string | number;
  lower_rate_bps: number;
  higher_rate_bps: number;
  effective_from: string;
};
export function GarmentGstSlabs() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["gst-garment-slabs"],
    queryFn: async () => {
      const { data, error } = await rpc("gst_garment_slab_settings", {});
      if (error) throw error;
      return data as Slab;
    },
  });
  const [threshold, setThreshold] = useState("2500"),
    [lower, setLower] = useState("5"),
    [higher, setHigher] = useState("18"),
    [effective, setEffective] = useState(gstLocalDateTime(new Date()));
  useEffect(() => {
    if (!query.data) return;
    setThreshold((Number(query.data.threshold_paise) / 100).toString());
    setLower((query.data.lower_rate_bps / 100).toString());
    setHigher((query.data.higher_rate_bps / 100).toString());
    setEffective(
      gstLocalDateTime(new Date(Math.max(Date.now(), Date.parse(query.data.effective_from)))),
    );
  }, [query.data]);
  const save = useMutation({
    mutationFn: async () => {
      const amount = Number(threshold);
      if (!Number.isFinite(amount) || amount < 0)
        throw new Error("Enter a valid garment threshold");
      const { error } = await rpc("owner_save_gst_garment_slabs", {
        p_effective_from: new Date(effective).toISOString(),
        p_threshold_paise: Math.round(amount * 100),
        p_lower_rate_bps: percentToBps(lower),
        p_higher_rate_bps: percentToBps(higher),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["gst-garment-slabs"] });
      toast.success("Garment GST slab version saved");
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Panel
      title="GST-inclusive garment price slabs"
      description="Applied to owner-produced, customer-stitched and vendor ready-made garments using the discounted unit SP. A unit exactly at the threshold uses the lower rate."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm">
          Effective from
          <Input
            type="datetime-local"
            value={effective}
            onChange={(e) => setEffective(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Threshold SP ₹
          <Input
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </label>
        <label className="text-sm">
          At or below threshold %
          <Input inputMode="decimal" value={lower} onChange={(e) => setLower(e.target.value)} />
        </label>
        <label className="text-sm">
          Above threshold %
          <Input inputMode="decimal" value={higher} onChange={(e) => setHigher(e.target.value)} />
        </label>
      </div>
      <p className="my-3 text-sm text-muted-foreground">
        Current rule: discounted unit SP up to and including ₹{threshold || "0"} uses {lower || "0"}
        %; above it uses {higher || "0"}%. Saved invoices keep their snapshot.
      </p>
      <Button disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : "Save garment GST slab version"}
      </Button>
    </Panel>
  );
}
