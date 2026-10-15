import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "./page";
import { QueryState } from "./query-state";
import { Button } from "@/components/ui/button";
export type SourceLocation = {
  id: string;
  name: string;
  kind: string;
  active: boolean;
  parent_id: string | null;
};
export function SourcePicker({
  onChoose,
  showWorkshop = false,
}: {
  onChoose: (source: SourceLocation) => void;
  showWorkshop?: boolean;
}) {
  const [id, setId] = useState("");
  const query = useQuery({
    queryKey: ["location-ledger", "locations"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_locations");
      if (error) throw error;
      return data ?? [];
    },
  });
  const locations = (query.data ?? []).filter(
    (l) =>
      l.active &&
      ["workshop", "showroom", "showroom_sublocation"].includes(l.kind) &&
      (showWorkshop || l.kind !== "workshop") &&
      (!l.parent_id || (query.data ?? []).some((p) => p.id === l.parent_id && p.active)),
  );
  return (
    <Panel
      title={showWorkshop ? "Choose fabric source" : "Choose your Showroom floor"}
      description="Select the location before scanning barcodes."
    >
      <QueryState
        loading={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
      />
      <form
        className="flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const chosen = locations.find((l) => l.id === id);
          if (chosen) onChoose(chosen);
        }}
      >
        <select
          aria-label="Work source location"
          value={id}
          onChange={(e) => setId(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background px-3"
        >
          <option value="">Select location</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <Button disabled={!id || query.isPending || !!query.error}>Proceed</Button>
      </form>
    </Panel>
  );
}
