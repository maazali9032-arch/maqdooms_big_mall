import { useEffect, useRef, useState } from "react";
import { Star, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BarcodeEntry } from "@/shared/components/barcode-entry";
import { StatusBadge } from "@/shared/components/page";
import { QueryState } from "@/shared/components/query-state";
import { formatMoney, parseRupeeInput, paiseToRupees } from "@/shared/utils/units";
import {
  SECTION_LABEL,
  deleteProductPhotos,
  priceLabel,
  publicImageUrl,
  stockLabel,
  uploadProductPhoto,
  useCategories,
  useEcomAction,
  useProduct,
  type ProductDetail,
} from "./admin-api";
import { AiSuggestButton } from "./AiSuggestButton";
import { ImageCropDialog } from "@/shared/components/image-crop-dialog";
import { IMAGE_SPECS } from "@/shared/utils/image-pipeline";

const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm";

type Form = {
  title: string;
  category_id: string;
  description: string;
  tags: string;
  seo_title: string;
  seo_description: string;
  fabric_price: string;
  images: string[];
  thumbnail: string | null;
};

function toForm(p: ProductDetail): Form {
  return {
    title: p.title,
    category_id: p.category_id ?? "",
    description: p.description ?? "",
    tags: (p.tags ?? []).join(", "),
    seo_title: p.seo_title ?? "",
    seo_description: p.seo_description ?? "",
    fabric_price:
      p.fabric_price_paise != null ? String(paiseToRupees(p.fabric_price_paise) ?? "") : "",
    images: p.images ?? [],
    thumbnail: p.thumbnail,
  };
}

/** Edit one online product: details, photos (star = thumbnail), linked stock and visibility. */
export function ProductEditor({ productId, onClose }: { productId: string; onClose: () => void }) {
  const product = useProduct(productId);
  const categories = useCategories();
  const actions = useEcomAction();
  const [form, setForm] = useState<Form | null>(null);
  const [scan, setScan] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Photos uploaded in this session but not yet saved, so they can be cleaned up on cancel.
  const unsaved = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (product.data && !form) setForm(toForm(product.data));
  }, [product.data, form]);

  const p = product.data;
  const isFabric = p?.offer.kind === "fabric";
  const dirty =
    Boolean(p && form) && JSON.stringify(toForm(p as ProductDetail)) !== JSON.stringify(form);

  const close = () => {
    if (unsaved.current.size) void deleteProductPhotos([...unsaved.current]);
    onClose();
  };

  // Picked photos wait here and are cropped to 4:5 one at a time.
  const [cropQueue, setCropQueue] = useState<File[]>([]);

  const addPhotos = (files: FileList | null) => {
    if (!files || !form) return;
    const room = 6 - form.images.length;
    if (fileInput.current) fileInput.current.value = "";
    if (room <= 0) {
      toast.error("Up to 6 photos per product");
      return;
    }
    if (files.length > room) toast.message(`Only ${room} more photo(s) fit; the rest were skipped`);
    setCropQueue([...files].slice(0, room));
  };

  const uploadCropped = async (cropped: File[]) => {
    setCropQueue((q) => q.slice(1));
    setUploading(true);
    try {
      const path = await uploadProductPhoto(productId, cropped);
      unsaved.current.add(path);
      setForm((f) =>
        f ? { ...f, images: [...f.images, path], thumbnail: f.thumbnail ?? path } : f,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (path: string) =>
    setForm((f) => {
      if (!f) return f;
      const images = f.images.filter((x) => x !== path);
      return { ...f, images, thumbnail: f.thumbnail === path ? (images[0] ?? null) : f.thumbnail };
    });

  const save = async () => {
    if (!form || !p) return;
    const fabricPaise =
      isFabric && form.fabric_price.trim() ? parseRupeeInput(form.fabric_price) : null;
    if (isFabric && form.fabric_price.trim() && !fabricPaise) {
      toast.error("Enter a valid price per metre");
      return;
    }
    const removed = p.images.filter((x) => !form.images.includes(x));
    await actions.saveProduct.mutateAsync({
      listingId: productId,
      details: {
        title: form.title,
        category_id: form.category_id || null,
        description: form.description,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        seo_title: form.seo_title,
        seo_description: form.seo_description,
        images: form.images,
        thumbnail: form.thumbnail,
        fabric_price_paise: fabricPaise,
      },
    });
    unsaved.current = new Set();
    await deleteProductPhotos(removed);
    setForm(null); // reload from the saved record
  };

  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const grouped = (categories.data ?? []).reduce<Record<string, typeof categories.data>>(
    (acc, c) => {
      (acc[c.section] ??= []).push(c);
      return acc;
    },
    {},
  );

  return (
    <Dialog open onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{p ? p.title : "Product"}</DialogTitle>
          <DialogDescription>
            {p ? `${priceLabel(p.offer, formatMoney)} · ${stockLabel(p.offer)}` : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        <QueryState
          loading={product.isPending}
          error={product.error}
          retry={() => void product.refetch()}
        />
        {p && form ? (
          <div className="space-y-6">
            <section className="flex flex-wrap items-center gap-2">
              <StatusBadge status={p.published ? "published" : "draft"} />
              {p.home_featured ? <StatusBadge status="active" label="Home featured" /> : null}
              {p.featured_in_category ? (
                <StatusBadge status="active" label="Featured in category" />
              ) : null}
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="title">Product name</Label>
                <Input
                  id="title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="category">Category</Label>
                <select
                  id="category"
                  className={selectClass}
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                >
                  <option value="">Choose a category</option>
                  {(["main", "mahib"] as const).map((section) =>
                    grouped[section]?.length ? (
                      <optgroup key={section} label={SECTION_LABEL[section]}>
                        {grouped[section]!.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.hidden ? " (hidden)" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ) : null,
                  )}
                </select>
              </div>
              {isFabric ? (
                <div className="space-y-1">
                  <Label htmlFor="fabric-price">Display price from (₹ per metre)</Label>
                  <Input
                    id="fabric-price"
                    inputMode="decimal"
                    value={form.fabric_price}
                    onChange={(e) => setForm({ ...form, fabric_price: e.target.value })}
                    placeholder="Leave empty for 'Price on enquiry'"
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label>Price</Label>
                  <p className="flex h-11 items-center text-sm text-muted-foreground">
                    Showroom SP: {priceLabel(p.offer, formatMoney)}
                  </p>
                </div>
              )}
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  rows={4}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="tags">Tags (comma separated)</Label>
                <Input
                  id="tags"
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="seo-title">Search title (up to 70 characters)</Label>
                <Input
                  id="seo-title"
                  maxLength={70}
                  value={form.seo_title}
                  onChange={(e) => setForm({ ...form, seo_title: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="seo-description">Search description (up to 170)</Label>
                <Textarea
                  id="seo-description"
                  rows={2}
                  maxLength={170}
                  value={form.seo_description}
                  onChange={(e) => setForm({ ...form, seo_description: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <AiSuggestButton
                  productId={productId}
                  thumbnail={form.thumbnail}
                  onApply={(s) =>
                    setForm((f) =>
                      f
                        ? {
                            ...f,
                            title: s.title ?? f.title,
                            description: s.description ?? f.description,
                            tags: s.tags?.length ? s.tags.join(", ") : f.tags,
                            seo_title: s.seo_title ?? f.seo_title,
                            seo_description: s.seo_description ?? f.seo_description,
                          }
                        : f,
                    )
                  }
                />
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  Photos ({form.images.length}/6) — star one as the thumbnail
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading || form.images.length >= 6}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload className="size-4" />
                  {uploading ? "Uploading…" : "Add photos"}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => addPhotos(e.target.files)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {form.images.map((path) => (
                  <figure key={path} className="relative overflow-hidden rounded-lg border">
                    <img
                      src={publicImageUrl(path) ?? ""}
                      alt=""
                      className="aspect-square w-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 flex justify-between bg-background/85 p-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={form.thumbnail === path ? "default" : "ghost"}
                        aria-label="Use as thumbnail"
                        aria-pressed={form.thumbnail === path}
                        onClick={() => setForm({ ...form, thumbnail: path })}
                      >
                        <Star className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="Remove photo"
                        onClick={() => removePhoto(path)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </figure>
                ))}
                {!form.images.length ? (
                  <p className="col-span-full text-sm text-muted-foreground">
                    No photos yet. These are separate from inventory photos and are shown on the
                    website.
                  </p>
                ) : null}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">
                {isFabric ? "Linked rolls" : "Linked pieces"} ({p.stock.length})
              </h3>
              <BarcodeEntry
                label="Scan another identical piece"
                value={scan}
                onChange={setScan}
                action="Add"
                onScan={(code) =>
                  void run(async () => {
                    await actions.addStock.mutateAsync({ listingId: productId, barcode: code });
                    setScan("");
                  }, "Added")
                }
              />
              {p.offer.kind === "garment" ? (
                <p className="text-sm text-muted-foreground">
                  Sizes:{" "}
                  {p.offer.sizes
                    .map(
                      (s) =>
                        `${s.size ?? "—"}: ${s.left} left${s.price_paise ? ` at ${formatMoney(s.price_paise)}` : ""}`,
                    )
                    .join(" · ") || "none"}
                </p>
              ) : null}
              <div className="divide-y rounded-lg border">
                {p.stock.map((s) => (
                  <div
                    key={s.stock_id}
                    className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-xs">{s.barcode}</span>
                    <span>{s.kind === "piece" ? `Size ${s.size ?? "—"}` : (s.colour ?? "")}</span>
                    {s.sp_paise ? <span>{formatMoney(s.sp_paise)}</span> : null}
                    <span className="text-muted-foreground">{s.location ?? ""}</span>
                    <StatusBadge
                      status={s.available ? "active" : "depleted"}
                      label={s.available ? "Available" : "Not on floor"}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() =>
                        void run(
                          () =>
                            actions.removeStock.mutateAsync({
                              listingId: productId,
                              stockId: s.stock_id,
                            }),
                          "Removed",
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            <section className="flex flex-wrap gap-2 border-t pt-4">
              <Button
                variant="outline"
                onClick={() =>
                  void run(
                    () =>
                      actions.setPublished.mutateAsync({
                        listingId: productId,
                        published: !p.published,
                      }),
                    p.published ? "Unpublished" : "Published",
                  )
                }
                disabled={dirty}
                title={dirty ? "Save your changes first" : undefined}
              >
                {p.published ? "Unpublish" : "Publish"}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void run(
                    () =>
                      actions.setFeatured.mutateAsync({
                        listingId: productId,
                        featured: !p.featured_in_category,
                        rank: null,
                      }),
                    p.featured_in_category ? "No longer featured" : "Featured in its category",
                  )
                }
              >
                {p.featured_in_category ? "Unfeature in category" : "Feature in category"}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void run(
                    () =>
                      actions.setHomeFeatured.mutateAsync({
                        listingId: productId,
                        on: !p.home_featured,
                      }),
                    p.home_featured
                      ? "Removed from home page"
                      : "Now on the home page for its category",
                  )
                }
              >
                {p.home_featured ? "Remove from home page" : "Show on home page"}
              </Button>
              <Button
                variant="ghost"
                className="ml-auto text-destructive"
                onClick={() => {
                  if (
                    window.confirm(
                      "Archive this product? It leaves the website; stock is not affected.",
                    )
                  )
                    void run(async () => {
                      await actions.archive.mutateAsync(productId);
                      onClose();
                    }, "Archived");
                }}
              >
                Archive
              </Button>
            </section>
          </div>
        ) : null}
        {cropQueue[0] ? (
          <ImageCropDialog
            key={cropQueue[0].name + cropQueue[0].lastModified}
            file={cropQueue[0]}
            aspect={IMAGE_SPECS.ecommerce.aspect}
            outputs={IMAGE_SPECS.ecommerce.outputs}
            title={`Crop website photo (4:5) — ${cropQueue.length} left`}
            onCancel={() => setCropQueue((q) => q.slice(1))}
            onDone={(files) => void uploadCropped(files)}
          />
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Close
          </Button>
          <Button
            disabled={!dirty || actions.saveProduct.isPending || uploading}
            onClick={() => void run(save, "Saved")}
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
