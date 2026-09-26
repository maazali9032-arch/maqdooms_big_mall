import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseRupeeInput } from "@/shared/utils/units";
import {
  MAX_LISTING_IMAGES,
  MAX_LISTING_IMAGE_BYTES,
  LISTING_IMAGE_TYPES,
  useListingImageUrls,
  useSaveListing,
  type ListingInput,
} from "./index";

export type EditableListing = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  collection: string | null;
  tags: string[];
  seo_title: string | null;
  seo_description: string | null;
  price_paise: number | null;
  sale_price_paise: number | null;
  stock_mode: string;
  images: string[];
  listing_variants?: { id: string; label: string; qty: number }[];
};

const rupees = (p: number | null) => (p === null ? "" : String(p / 100));

/** Create an online-only product (listing === null) or edit an existing listing. */
export function ListingEditor({
  listing,
  onClose,
}: {
  listing: EditableListing | null;
  onClose: () => void;
}) {
  const save = useSaveListing();
  const isNew = listing === null;
  const [form, setForm] = useState({
    title: listing?.title ?? "",
    description: listing?.description ?? "",
    category: listing?.category ?? "",
    collection: listing?.collection ?? "",
    tags: (listing?.tags ?? []).join(", "),
    seo_title: listing?.seo_title ?? "",
    seo_description: listing?.seo_description ?? "",
    price: rupees(listing?.price_paise ?? null),
    sale: rupees(listing?.sale_price_paise ?? null),
    stock_mode: (listing?.stock_mode ?? "manual") as ListingInput["stock_mode"],
  });
  const [kept, setKept] = useState<string[]>(listing?.images ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [variants, setVariants] = useState<{ id?: string; label: string; qty: number }[]>(
    (listing?.listing_variants ?? []).map((v) => ({ id: v.id, label: v.label, qty: v.qty })),
  );
  const [removedVariantIds, setRemovedVariantIds] = useState<string[]>([]);

  const keptUrls = useListingImageUrls(kept);
  const filePreviews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => filePreviews.forEach((u) => URL.revokeObjectURL(u)), [filePreviews]);
  const total = kept.length + files.length;

  function addFiles(list: FileList | null) {
    if (!list) return;
    const selected = Array.from(list);
    const incoming = selected.filter(
      (file) => LISTING_IMAGE_TYPES.includes(file.type) && file.size <= MAX_LISTING_IMAGE_BYTES,
    );
    if (incoming.length !== selected.length) {
      toast.error("Use JPG, PNG, WebP or GIF images up to 10 MB each");
    }
    const room = MAX_LISTING_IMAGES - total;
    if (incoming.length > room) toast.error(`Maximum ${MAX_LISTING_IMAGES} images per listing`);
    setFiles([...files, ...incoming.slice(0, Math.max(0, room))]);
  }

  async function submit() {
    if (!form.title.trim()) {
      toast.error("Product name is required");
      return;
    }
    try {
      await save.mutateAsync({
        id: listing?.id,
        title: form.title,
        description: form.description,
        category: form.category,
        collection: form.collection,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        seo_title: form.seo_title,
        seo_description: form.seo_description,
        price_paise: form.price ? parseRupeeInput(form.price) : null,
        sale_price_paise: form.sale ? parseRupeeInput(form.sale) : null,
        stock_mode: form.stock_mode,
        keptImages: kept,
        removedImages: (listing?.images ?? []).filter((image) => !kept.includes(image)),
        newImages: files,
        variants,
        removedVariantIds,
      });
      toast.success(isNew ? "Online product created (unpublished)" : "Listing saved");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "New online-only product" : `Edit listing — ${listing.title}`}
          </DialogTitle>
          <DialogDescription>
            Online details only. Counter prices, laagat and physical stock are never changed here.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="l-title">Product name</Label>
            <Input id="l-title" value={form.title} onChange={set("title")} className="h-11" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="l-desc">Description</Label>
            <Textarea id="l-desc" rows={3} value={form.description} onChange={set("description")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="l-price">
              Online price (₹{form.stock_mode === "linked" ? "/m" : ""})
            </Label>
            <Input
              id="l-price"
              inputMode="decimal"
              value={form.price}
              onChange={set("price")}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="l-sale">Sale price (optional)</Label>
            <Input
              id="l-sale"
              inputMode="decimal"
              value={form.sale}
              onChange={set("sale")}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="l-cat">Category</Label>
            <Input id="l-cat" value={form.category} onChange={set("category")} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="l-col">Collection</Label>
            <Input
              id="l-col"
              value={form.collection}
              onChange={set("collection")}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="l-tags">Tags (comma separated)</Label>
            <Input id="l-tags" value={form.tags} onChange={set("tags")} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="l-seo">SEO title</Label>
            <Input id="l-seo" value={form.seo_title} onChange={set("seo_title")} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="l-seod">SEO description</Label>
            <Input
              id="l-seod"
              value={form.seo_description}
              onChange={set("seo_description")}
              className="h-11"
            />
          </div>

          {isNew ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Product type</Label>
              <Select
                value={form.stock_mode}
                onValueChange={(v) =>
                  setForm({ ...form, stock_mode: v as ListingInput["stock_mode"] })
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual quantity (sizes)</SelectItem>
                  <SelectItem value="untracked">Untracked (showcase / enquiry)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Online-only — no physical inventory is created.
              </p>
            </div>
          ) : null}
        </div>

        {form.stock_mode === "manual" ? (
          <div className="space-y-2">
            <Label>Sizes and quantity</Label>
            {variants.map((v, i) => (
              <div key={v.id ?? `new-${i}`} className="flex gap-2">
                <Input
                  placeholder="Size (e.g. M)"
                  value={v.label}
                  onChange={(e) =>
                    setVariants(
                      variants.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    )
                  }
                  className="h-10"
                />
                <Input
                  type="number"
                  min={0}
                  value={v.qty}
                  onChange={(e) =>
                    setVariants(
                      variants.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)),
                    )
                  }
                  className="numeric h-10 w-24"
                  aria-label="Quantity"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove size"
                  onClick={() => {
                    if (v.id) setRemovedVariantIds([...removedVariantIds, v.id]);
                    setVariants(variants.filter((_, j) => j !== i));
                  }}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVariants([...variants, { label: "", qty: 0 }])}
            >
              Add size
            </Button>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label>
            Images{" "}
            <span className="numeric text-muted-foreground">
              ({total}/{MAX_LISTING_IMAGES})
            </span>
          </Label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {kept.map((img, i) => (
              <Thumb
                key={img}
                src={keptUrls.data?.[i]}
                onRemove={() => setKept(kept.filter((k) => k !== img))}
              />
            ))}
            {filePreviews.map((src, i) => (
              <Thumb
                key={src}
                src={src}
                isNew
                onRemove={() => setFiles(files.filter((_, j) => j !== i))}
              />
            ))}
          </div>
          {total < MAX_LISTING_IMAGES ? (
            <Input
              type="file"
              accept={LISTING_IMAGE_TYPES.join(",")}
              multiple
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Maximum reached — remove an image to replace it.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Thumb({ src, onRemove, isNew }: { src?: string; onRemove: () => void; isNew?: boolean }) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-sm border border-border bg-muted">
      {src ? <img src={src} alt="" className="size-full object-cover" /> : null}
      {isNew ? (
        <span className="absolute bottom-0 left-0 bg-primary px-1 text-[10px] text-primary-foreground">
          new
        </span>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove image"
        className="absolute right-0.5 top-0.5 rounded-sm bg-background/90 p-0.5 text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
