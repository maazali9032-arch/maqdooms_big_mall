import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, Panel, StatusBadge } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import {
  SECTION_LABEL,
  useCategories,
  useEcomAction,
  type Category,
  type Section,
} from "./admin-api";

const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm";
const empty = {
  id: null as string | null,
  section: "main" as Section,
  name: "",
  description: "",
  sort_order: 0,
  hidden: false,
};

/** Add, edit, reorder, hide and delete website categories (Main store or Mahib). */
export function CategoriesManager() {
  const categories = useCategories();
  const { saveCategory, deleteCategory } = useEcomAction();
  const [form, setForm] = useState(empty);

  const edit = (c: Category) =>
    setForm({
      id: c.id,
      section: c.section,
      name: c.name,
      description: c.description ?? "",
      sort_order: c.sort_order,
      hidden: c.hidden,
    });

  const save = () =>
    saveCategory.mutate(form, {
      onSuccess: () => {
        toast.success(form.id ? "Category updated" : "Category added");
        setForm(empty);
      },
      onError: (e) => toast.error(e.message),
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
      <Panel
        title="Categories"
        description="Each category belongs to the main store (Home and All Products) or the Mahib section. Hidden categories and their products are not shown on the website."
        bodyClassName="p-0"
      >
        <QueryState
          loading={categories.isPending}
          error={categories.error}
          retry={() => void categories.refetch()}
        />
        {categories.data && !categories.data.length ? (
          <EmptyState title="No categories yet" description="Add the first one on the right." />
        ) : null}
        {(["main", "mahib"] as const).map((section) => {
          const rows = (categories.data ?? []).filter((c) => c.section === section);
          return rows.length ? (
            <section key={section}>
              <h3 className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide">
                {SECTION_LABEL[section]}
              </h3>
              <div className="divide-y">
                {rows.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        /{c.slug} · {c.published} published of {c.products} · order {c.sort_order}
                      </p>
                    </div>
                    {c.hidden ? <StatusBadge status="inactive" label="Hidden" /> : null}
                    <Button size="sm" variant="outline" onClick={() => edit(c)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => {
                        if (window.confirm(`Delete "${c.name}"?`))
                          deleteCategory.mutate(c.id, {
                            onSuccess: () => toast.success("Category deleted"),
                            onError: (e) => toast.error(e.message),
                          });
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ) : null;
        })}
      </Panel>
      <Panel title={form.id ? "Edit category" : "Add category"}>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cat-section">Section</Label>
            <select
              id="cat-section"
              className={selectClass}
              value={form.section}
              onChange={(e) => setForm({ ...form, section: e.target.value as Section })}
            >
              <option value="main">{SECTION_LABEL.main}</option>
              <option value="mahib">{SECTION_LABEL.mahib}</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cat-name">Name</Label>
            <Input
              id="cat-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Sherwanis"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cat-description">Short description (optional)</Label>
            <Input
              id="cat-description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="e.g. A timeless statement"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cat-order">Display order (lower comes first)</Label>
            <Input
              id="cat-order"
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.hidden}
              onChange={(e) => setForm({ ...form, hidden: e.target.checked })}
            />
            Hide from the website
          </label>
          <div className="flex gap-2">
            <Button disabled={!form.name.trim() || saveCategory.isPending} onClick={save}>
              {form.id ? "Save" : "Add category"}
            </Button>
            {form.id ? (
              <Button variant="outline" onClick={() => setForm(empty)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      </Panel>
    </div>
  );
}
