import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
export function LocationDefinitions() {
  const { isOwner } = useSession(),
    qc = useQueryClient();
  const query = useQuery({
    queryKey: ["location-ledger", "locations"],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_locations");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [form, setForm] = useState({ id: "", code: "", name: "", active: true });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("manage_showroom_location", {
        p_id: form.id || null,
        p_code: form.code || `FLR-${crypto.randomUUID().slice(0, 8)}`,
        p_name: form.name.trim(),
        p_active: form.active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm({ id: "", code: "", name: "", active: true });
      void qc.invalidateQueries({ queryKey: ["location-ledger"] });
      toast.success("Floor saved");
    },
    onError: (e) => toast.error(e.message),
  });
  if (!isOwner) return <p>Owner access required.</p>;
  return (
    <Panel
      title="Showroom floors"
      description="Define the floors used by Stock Transfer, Counter and Production. Historical records remain intact; move stock out before deactivating a floor."
    >
      <QueryState
        loading={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
      />
      <form
        className="mb-5 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="min-w-0 flex-1 text-sm">
          Floor name
          <Input
            aria-label="Floor name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Showroom Floor 1"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          Active
        </label>
        <Button disabled={save.isPending}>{form.id ? "Save floor" : "Add floor"}</Button>
        {form.id && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setForm({ id: "", code: "", name: "", active: true })}
          >
            Cancel
          </Button>
        )}
      </form>
      <div className="space-y-2">
        {query.data
          ?.filter((row) => row.kind === "showroom_sublocation")
          .map((row) => (
            <div key={row.id} className="flex items-center justify-between rounded-lg border p-3">
              <span>
                {row.name}
                <small className="ml-2 text-muted-foreground">
                  {row.active ? "Active" : "Inactive"}
                </small>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setForm({ id: row.id, code: row.code, name: row.name, active: row.active })
                }
              >
                Edit
              </Button>
            </div>
          ))}
      </div>
    </Panel>
  );
}
