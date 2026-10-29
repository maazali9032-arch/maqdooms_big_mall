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
import { sqlNull } from "@/shared/utils/sql-null";
type Definition = { id: string; code: string; name: string; active: boolean };
type MaterialCategory = Definition & { measurement_unit: string };
type Args = Database["public"]["Functions"]["manage_production_catalog"]["Args"];
const empty = { id: "", code: "", name: "", active: true };
const emptyCategory = { id: "", code: "", name: "", measurement_unit: "pc", active: true };
const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: Error | null }>;
export function ProductDesignDefinitions() {
  const { isOwner } = useSession();
  const qc = useQueryClient();
  const [kind, setKind] = useState<"product" | "design" | "material">("product"),
    [form, setForm] = useState(empty),
    [categoryForm, setCategoryForm] = useState(emptyCategory),
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
  const categories = useQuery({
    queryKey: ["owner-material-categories"],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await rpc("owner_material_category_catalog", {});
      if (error) throw error;
      return data as MaterialCategory[];
    },
  });
  const saveCategory = useMutation({
    mutationFn: async () => {
      const { error } = await rpc("owner_save_material_category", {
        p_id: categoryForm.id || null,
        p_name: categoryForm.name.trim(),
        p_measurement_unit: categoryForm.measurement_unit.trim(),
        p_active: categoryForm.active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setCategoryForm(emptyCategory);
      void qc.invalidateQueries({ queryKey: ["owner-material-categories"] });
      void qc.invalidateQueries({ queryKey: ["material-categories"] });
      toast.success("Material category saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await rpc("owner_delete_material_category", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      if (categoryForm.id) setCategoryForm(emptyCategory);
      void qc.invalidateQueries({ queryKey: ["owner-material-categories"] });
      void qc.invalidateQueries({ queryKey: ["material-categories"] });
      toast.success("Material category deleted");
    },
    onError: (error) => toast.error(error.message),
  });
  if (!isOwner) return <p>Owner access required.</p>;
  const list = kind === "product" ? query.data?.products : query.data?.designs;
  return (
    <Panel
      title="Products & Designs"
      description="Shared definitions for customer tailoring and production. Existing jobs retain their saved details."
    >
      <QueryState
        loading={kind === "material" ? categories.isPending : query.isPending}
        error={kind === "material" ? categories.error : query.error}
        retry={() => void query.refetch()}
      />
      <fieldset
        disabled={
          kind === "material"
            ? saveCategory.isPending || deleteCategory.isPending
            : !!pending || save.isPending
        }
        className="space-y-4"
      >
        <div className="flex gap-2">
          {(["product", "design", "material"] as const).map((k) => (
            <Button
              key={k}
              variant={k === kind ? "default" : "outline"}
              onClick={() => {
                setKind(k);
                setForm(empty);
                setCategoryForm(emptyCategory);
              }}
            >
              {k === "product"
                ? "Product types"
                : k === "design"
                  ? "Designs"
                  : "Material categories"}
            </Button>
          ))}
        </div>
        {kind === "material" ? (
          <>
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3 className="font-semibold">Material categories</h3>
                  <p className="text-sm text-muted-foreground">
                    The chosen category automatically sets the compact measurement unit in material
                    stock entry.
                  </p>
                </div>
                {categoryForm.id && (
                  <span className="text-sm text-muted-foreground">Editing {categoryForm.code}</span>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
                <Input
                  aria-label="Material category name"
                  placeholder="Category name, e.g. Buttons"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                />
                <Input
                  aria-label="Default measurement unit"
                  placeholder="Unit, e.g. pc"
                  value={categoryForm.measurement_unit}
                  onChange={(e) =>
                    setCategoryForm({ ...categoryForm, measurement_unit: e.target.value })
                  }
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={categoryForm.active}
                    onChange={(e) => setCategoryForm({ ...categoryForm, active: e.target.checked })}
                  />
                  Active
                </label>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  disabled={!categoryForm.name.trim() || !categoryForm.measurement_unit.trim()}
                  onClick={() => saveCategory.mutate()}
                >
                  Save category
                </Button>
                {categoryForm.id && (
                  <Button variant="outline" onClick={() => setCategoryForm(emptyCategory)}>
                    Cancel edit
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              {categories.data?.map((category) => (
                <div
                  key={category.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div>
                    <strong>{category.name}</strong>
                    <p className="text-xs text-muted-foreground">
                      {category.code} · default unit: {category.measurement_unit} ·{" "}
                      {category.active ? "Active" : "Inactive"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setCategoryForm(category)}>
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete ${category.name}? Categories already used by stock cannot be deleted.`,
                          )
                        )
                          deleteCategory.mutate(category.id);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
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
                    p_id: form.id || sqlNull,
                    p_code: form.code.trim(),
                    p_name: form.name.trim(),
                    p_active: form.active,
                    p_charge_paise: sqlNull,
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
          </>
        )}
      </fieldset>
      {kind !== "material" && pending && !save.isPending && (
        <Button onClick={() => save.mutate(pending)}>Retry unchanged definition</Button>
      )}
    </Panel>
  );
}
