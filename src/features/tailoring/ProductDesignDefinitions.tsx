import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { definiteDatabaseRejection } from "@/features/inventory/consumable-input";
import type { Database } from "@/integrations/supabase/types";
import { DeleteDefinition } from "@/shared/components/delete-definition";
type Definition = { id: string; code: string; name: string; active: boolean };
type Args = Database["public"]["Functions"]["manage_production_catalog"]["Args"];
const empty = { id: "", code: "", name: "", active: true };
export function ProductDesignDefinitions() {
  const { isOwner } = useSession();
  const qc = useQueryClient();
  const [kind, setKind] = useState<"product" | "design">("product"),
    [form, setForm] = useState(empty),
    [pending, setPending] = useState<Args | null>(null);
  const query = useQuery({
    queryKey: ["owner-production", "catalog"],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_production_catalog");
      if (error) throw error;
      return data as unknown as { products: Definition[]; designs: Definition[] };
    },
  });
  const save = useMutation({
    mutationFn: async (args: Args) => {
      setPending(args);
      const { error } = await supabase.rpc("manage_production_catalog", args);
      if (error) throw error;
    },
    onSuccess: () => {
      setPending(null);
      setForm(empty);
      void qc.invalidateQueries();
      toast.success("Definition saved");
    },
    onError: (e) => {
      if (definiteDatabaseRejection(e)) setPending(null);
      toast.error(e.message);
    },
  });
  if (!isOwner) return <p>Owner access required.</p>;
  const list = kind === "product" ? query.data?.products : query.data?.designs;
  return (
    <Panel
      title="Products & Designs"
      description="Shared definitions for customer tailoring and production. Existing jobs retain their saved details."
    >
      <QueryState
        loading={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
      />
      <fieldset disabled={!!pending || save.isPending} className="space-y-4">
        <div className="flex gap-2">
          {(["product", "design"] as const).map((k) => (
            <Button
              key={k}
              variant={k === kind ? "default" : "outline"}
              onClick={() => {
                setKind(k);
                setForm(empty);
              }}
            >
              {k === "product" ? "Product types" : "Designs"}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            aria-label="Definition code"
            placeholder={kind === "product" ? "Product code" : "Design number"}
            disabled={!!form.id}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
          <Input
            aria-label="Definition name"
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          Active
        </label>
        <div className="flex gap-2">
          <Button
            disabled={!form.code.trim() || !form.name.trim()}
            onClick={() =>
              save.mutate({
                p_request: crypto.randomUUID(),
                p_kind: kind,
                p_id: form.id || null,
                p_code: form.code.trim(),
                p_name: form.name.trim(),
                p_active: form.active,
                p_charge_paise: null,
                p_reason: "Owner saved " + kind + " definition",
              })
            }
          >
            Save {kind}
          </Button>
          {form.id && (
            <Button variant="outline" onClick={() => setForm(empty)}>
              Cancel edit
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {list?.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
            >
              <div>
                <strong>{d.name}</strong>
                <p className="text-xs">
                  {d.code} · {d.active ? "Active" : "Inactive"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setForm(d)}>
                  Edit
                </Button>
                <DeleteDefinition
                  kind={kind}
                  item={d}
                  onDeleted={() => {
                    if (form.id === d.id) setForm(empty);
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      {pending && !save.isPending && (
        <Button onClick={() => save.mutate(pending)}>Retry unchanged definition</Button>
      )}
    </Panel>
  );
}
