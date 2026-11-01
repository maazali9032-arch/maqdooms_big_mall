import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, Panel, StatusBadge } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { ImageCropDialog } from "@/shared/components/image-crop-dialog";
import { IMAGE_SPECS } from "@/shared/utils/image-pipeline";
import {
  SECTION_LABEL,
  deleteProductPhotos,
  publicImageUrl,
  uploadCategoryPhoto,
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
  banner_path: null as string | null,
};

/** Add, edit, reorder, hide and delete website categories (Main store or Mahib). */
export function CategoriesManager() {
  const categories = useCategories();
  const { saveCategory, deleteCategory, setCategoryPhoto } = useEcomAction();
  const [form, setForm] = useState(empty);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // The category's website photo: crop to 4:5, upload both sizes, then point the category at it.
  const savePhoto = async (cropped: File[]) => {
    setCropFile(null);
    const id = form.id;
    if (!id) return;
    const old = form.banner_path;
    setPhotoBusy(true);
    try {
      const path = await uploadCategoryPhoto(id, cropped);
      try {
        await setCategoryPhoto.mutateAsync({ id, path });
      } catch (e) {
        await deleteProductPhotos([path]);
        throw e;
      }
      if (old) void deleteProductPhotos([old]);
      setForm((f) => (f.id === id ? { ...f, banner_path: path } : f));
      toast.success("Category photo saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = () => {
    const id = form.id;
    const old = form.banner_path;
    if (!id || !old || !window.confirm("Remove this category's photo?")) return;
    setCategoryPhoto.mutate(
      { id, path: null },
      {
        onSuccess: () => {
          void deleteProductPhotos([old]);
          setForm((f) => (f.id === id ? { ...f, banner_path: null } : f));
          toast.success("Photo removed; the website shows its standard picture");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const edit = (c: Category) =>
    setForm({
      id: c.id,
      section: c.section,
      name: c.name,
      description: c.description ?? "",
      sort_order: c.sort_order,
      hidden: c.hidden,
      banner_path: c.banner_path,
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
                    {c.banner_path ? (
                      <img
                        src={publicImageUrl(c.banner_path, "card") ?? undefined}
                        alt=""
                        className="h-12 w-10 shrink-0 rounded object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="flex h-12 w-10 shrink-0 items-center justify-center rounded border border-dashed text-center text-[10px] leading-tight text-muted-foreground"
                        title="No photo yet"
                      >
                        No photo
                      </div>
                    )}
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
          <div className="space-y-1">
            <Label>Website photo</Label>
            {form.id ? (
              <div className="flex items-start gap-3">
                {form.banner_path ? (
                  <img
                    src={publicImageUrl(form.banner_path, "card") ?? undefined}
                    alt={`${form.name} category`}
                    className="h-32 w-[6.4rem] shrink-0 rounded-md border object-cover"
                  />
                ) : (
                  <div className="flex h-32 w-[6.4rem] shrink-0 items-center justify-center rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground">
                    No photo yet
                  </div>
                )}
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Shown for this category on the website, whatever products it has. Upright photo,
                    cropped to 4:5.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={photoBusy || setCategoryPhoto.isPending}
                      onClick={() => fileInput.current?.click()}
                    >
                      {photoBusy ? "Uploading…" : form.banner_path ? "Replace photo" : "Add photo"}
                    </Button>
                    {form.banner_path ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={photoBusy || setCategoryPhoto.isPending}
                        onClick={removePhoto}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    if (file) setCropFile(file);
                  }}
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Add the category first, then click Edit to add its photo.
              </p>
            )}
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
      {cropFile ? (
        <ImageCropDialog
          key={cropFile.name + cropFile.lastModified}
          file={cropFile}
          aspect={IMAGE_SPECS.ecommerce.aspect}
          outputs={IMAGE_SPECS.ecommerce.outputs}
          title="Crop category photo (4:5)"
          onCancel={() => setCropFile(null)}
          onDone={(files) => void savePhoto(files)}
        />
      ) : null}
    </div>
  );
}
