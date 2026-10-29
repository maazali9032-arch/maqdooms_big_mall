import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sqlNull } from "@/shared/utils/sql-null";

/** Public bucket for e-commerce photos (inventory photos stay private elsewhere). */
export const ECOMMERCE_BUCKET = "ecommerce-images";

export type Section = "main" | "mahib";
export const SECTION_LABEL: Record<Section, string> = { main: "Main store", mahib: "Mahib" };

export type Category = {
  id: string;
  section: Section;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  hidden: boolean;
  products: number;
  published: number;
};

export type SizeOffer = { size: string | null; price_paise: number | null; left: number };
export type Offer =
  | {
      kind: "garment";
      sizes: SizeOffer[];
      total_left: number;
      price_min: number | null;
      price_max: number | null;
      sold_out: boolean;
    }
  | { kind: "fabric"; price_from_paise_per_m: number | null; sold_out: boolean }
  | { kind: "empty"; sold_out: boolean };

export type CatalogueItem = {
  id: string;
  title: string;
  slug: string;
  published: boolean;
  category_id: string | null;
  category: string | null;
  section: Section | null;
  thumbnail: string | null;
  images: string[];
  featured_in_category: boolean;
  featured_rank: number | null;
  home_featured: boolean;
  updated_at: string;
  offer: Offer;
};

export type StockLine = {
  stock_id: string;
  barcode: string;
  kind: "piece" | "fabric";
  size?: string | null;
  colour?: string | null;
  sp_paise?: number | null;
  location?: string | null;
  available: boolean;
};

export type ProductDetail = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  tags: string[];
  seo_title: string | null;
  seo_description: string | null;
  category_id: string | null;
  images: string[];
  thumbnail: string | null;
  fabric_price_paise: number | null;
  published: boolean;
  featured_in_category: boolean;
  featured_rank: number | null;
  home_featured: boolean;
  offer: Offer;
  stock: StockLine[];
};

export type ScanResult = {
  kind: "piece" | "fabric";
  stock_id: string;
  barcode: string;
  product: string;
  design: string | null;
  size?: string | null;
  sp_paise?: number | null;
  location?: string | null;
  available: boolean;
  suggested_title: string;
  current_listing: { id: string; title: string; published: boolean } | null;
  matching_listings: { id: string; title: string; published: boolean }[];
};

export const ecomKeys = {
  categories: ["ecom", "categories"] as const,
  catalogue: ["ecom", "catalogue"] as const,
  product: (id: string) => ["ecom", "product", id] as const,
  settings: ["ecom", "settings"] as const,
};

async function unwrap<T>(
  promise: PromiseLike<{ data: unknown; error: { message: string } | null }>,
) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data as T;
}

export function publicImageUrl(path: string | null | undefined) {
  if (!path) return null;
  return supabase.storage.from(ECOMMERCE_BUCKET).getPublicUrl(path).data.publicUrl;
}

export function useCategories() {
  return useQuery({
    queryKey: ecomKeys.categories,
    queryFn: () => unwrap<Category[]>(supabase.rpc("ecom_categories_admin")),
  });
}

export function useCatalogue() {
  return useQuery({
    queryKey: ecomKeys.catalogue,
    queryFn: () => unwrap<CatalogueItem[]>(supabase.rpc("ecom_catalogue_admin")),
  });
}

export function useProduct(id: string | null) {
  return useQuery({
    queryKey: ecomKeys.product(id ?? "none"),
    enabled: Boolean(id),
    queryFn: () => unwrap<ProductDetail>(supabase.rpc("ecom_product_admin", { p_listing: id! })),
  });
}

export function useStoreSettings() {
  return useQuery({
    queryKey: ecomKeys.settings,
    queryFn: () =>
      unwrap<{ whatsapp_number: string; updated_at: string }>(supabase.rpc("ecom_settings_admin")),
  });
}

/** One mutation hook for every e-commerce action; each refreshes the lists it touches. */
export function useEcomAction() {
  const qc = useQueryClient();
  const refresh = (productId?: string) => {
    void qc.invalidateQueries({ queryKey: ecomKeys.catalogue });
    void qc.invalidateQueries({ queryKey: ecomKeys.categories });
    if (productId) void qc.invalidateQueries({ queryKey: ecomKeys.product(productId) });
  };
  return {
    saveCategory: useMutation({
      mutationFn: (c: {
        id: string | null;
        section: Section;
        name: string;
        description: string;
        sort_order: number;
        hidden: boolean;
      }) =>
        unwrap<string>(
          supabase.rpc("ecom_save_category", {
            p_id: c.id ?? sqlNull,
            p_section: c.section,
            p_name: c.name,
            p_slug: sqlNull,
            p_description: c.description || sqlNull,
            p_sort_order: c.sort_order,
            p_hidden: c.hidden,
          }),
        ),
      onSuccess: () => refresh(),
    }),
    deleteCategory: useMutation({
      mutationFn: (id: string) => unwrap(supabase.rpc("ecom_delete_category", { p_id: id })),
      onSuccess: () => refresh(),
    }),
    scan: useMutation({
      mutationFn: (barcode: string) =>
        unwrap<ScanResult>(supabase.rpc("ecom_scan", { p_barcode: barcode })),
    }),
    createProduct: useMutation({
      mutationFn: (p: { barcode: string; title: string; categoryId: string | null }) =>
        unwrap<string>(
          supabase.rpc("ecom_create_product", {
            p_barcode: p.barcode,
            p_title: p.title,
            p_category: p.categoryId ?? sqlNull,
          }),
        ),
      onSuccess: () => refresh(),
    }),
    addStock: useMutation({
      mutationFn: (p: { listingId: string; barcode: string }) =>
        unwrap<Offer>(
          supabase.rpc("ecom_add_stock", { p_listing: p.listingId, p_barcode: p.barcode }),
        ),
      onSuccess: (_d, p) => refresh(p.listingId),
    }),
    removeStock: useMutation({
      mutationFn: (p: { listingId: string; stockId: string }) =>
        unwrap<Offer>(
          supabase.rpc("ecom_remove_stock", { p_listing: p.listingId, p_stock_id: p.stockId }),
        ),
      onSuccess: (_d, p) => refresh(p.listingId),
    }),
    saveProduct: useMutation({
      mutationFn: (p: { listingId: string; details: Record<string, unknown> }) =>
        unwrap(
          supabase.rpc("ecom_save_product", {
            p_listing: p.listingId,
            p_details: p.details as never,
          }),
        ),
      onSuccess: (_d, p) => refresh(p.listingId),
    }),
    setPublished: useMutation({
      mutationFn: (p: { listingId: string; published: boolean }) =>
        unwrap(
          supabase.rpc("ecom_set_published", {
            p_listing: p.listingId,
            p_published: p.published,
          }),
        ),
      onSuccess: (_d, p) => refresh(p.listingId),
    }),
    setFeatured: useMutation({
      mutationFn: (p: { listingId: string; featured: boolean; rank: number | null }) =>
        unwrap(
          supabase.rpc("ecom_set_featured", {
            p_listing: p.listingId,
            p_featured: p.featured,
            p_rank: p.rank ?? sqlNull,
          }),
        ),
      onSuccess: (_d, p) => refresh(p.listingId),
    }),
    setHomeFeatured: useMutation({
      mutationFn: (p: { listingId: string; on: boolean }) =>
        unwrap(supabase.rpc("ecom_set_home_featured", { p_listing: p.listingId, p_on: p.on })),
      onSuccess: (_d, p) => refresh(p.listingId),
    }),
    archive: useMutation({
      mutationFn: (listingId: string) =>
        unwrap(supabase.rpc("ecom_archive_product", { p_listing: listingId })),
      onSuccess: () => refresh(),
    }),
    saveSettings: useMutation({
      mutationFn: (whatsapp: string) =>
        unwrap(supabase.rpc("ecom_save_settings", { p_whatsapp_number: whatsapp })),
      onSuccess: () => void qc.invalidateQueries({ queryKey: ecomKeys.settings }),
    }),
  };
}

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

/** Uploads one photo into the product's own folder and returns its storage path. */
export async function uploadProductPhoto(listingId: string, file: File): Promise<string> {
  if (!ALLOWED.includes(file.type)) throw new Error("Use a JPEG, PNG or WebP photo");
  if (file.size > 10 * 1024 * 1024) throw new Error("Each photo must be under 10 MB");
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${listingId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(ECOMMERCE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function deleteProductPhotos(paths: string[]) {
  if (!paths.length) return;
  await supabase.storage.from(ECOMMERCE_BUCKET).remove(paths);
}

export function priceLabel(offer: Offer, format: (paise: number) => string) {
  if (offer.kind === "garment") {
    if (offer.price_min == null) return "—";
    return offer.price_min === offer.price_max
      ? format(offer.price_min)
      : `${format(offer.price_min)} – ${format(offer.price_max ?? offer.price_min)}`;
  }
  if (offer.kind === "fabric")
    return offer.price_from_paise_per_m
      ? `from ${format(offer.price_from_paise_per_m)} / m`
      : "Price on enquiry";
  return "—";
}

export function stockLabel(offer: Offer) {
  if (offer.kind === "garment") return offer.sold_out ? "Sold out" : `${offer.total_left} left`;
  if (offer.kind === "fabric") return offer.sold_out ? "Sold out" : "In stock";
  return "No stock linked";
}
