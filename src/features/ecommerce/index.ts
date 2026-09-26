import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useListings() {
  return useQuery({
    queryKey: ["listings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select(
          "*, listing_variants(id, label, qty), listing_thaan_links(thaan_id, thaans(barcode))",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Online availability for a linked listing is the LARGEST single remaining
 * thaan minus active holds — never the sum of linked thaans.
 */
export function useListingAvailability() {
  return useQuery({
    queryKey: ["listing-availability"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_listing_availability").select("*");
      if (error) throw error;
      return (data ?? []) as {
        listing_id: string;
        linked_thaans: number;
        largest_piece_mm: number;
        total_linked_mm: number;
      }[];
    },
  });
}

export function useOnlineOrders() {
  return useQuery({
    queryKey: ["online-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("online_orders")
        .select("*, listings(title, slug)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useHolds() {
  return useQuery({
    queryKey: ["holds"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("holds")
        .select("*, thaans(barcode)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTogglePublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; published: boolean }) => {
      const { error } = await supabase
        .from("listings")
        .update({ published: input.published })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["listings"] }),
  });
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: string }) => {
      const { error } = await supabase
        .from("online_orders")
        .update({ status: input.status })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["online-orders"] }),
  });
}

export const MAX_LISTING_IMAGES = 6;
export const MAX_LISTING_IMAGE_BYTES = 10 * 1024 * 1024;
export const LISTING_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const IMAGE_BUCKET = "listing-images";

/** Resolves stored image references (storage paths or absolute URLs) to viewable URLs. */
export function useListingImageUrls(images: string[]) {
  return useQuery({
    queryKey: ["listing-image-urls", images],
    enabled: images.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const paths = images.filter((i) => !/^https?:\/\//.test(i));
      const signed = new Map<string, string>();
      if (paths.length) {
        const { data } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls(paths, 3600);
        for (const d of data ?? []) if (d.path && d.signedUrl) signed.set(d.path, d.signedUrl);
      }
      return images.map((i) => (/^https?:\/\//.test(i) ? i : (signed.get(i) ?? "")));
    },
  });
}

export type ListingInput = {
  id?: string;
  title: string;
  description: string;
  category: string;
  collection: string;
  tags: string[];
  seo_title: string;
  seo_description: string;
  price_paise: number | null;
  sale_price_paise: number | null;
  stock_mode: "linked" | "manual" | "untracked";
  keptImages: string[];
  removedImages: string[];
  newImages: File[];
  variants: { id?: string; label: string; qty: number }[];
  removedVariantIds: string[];
};

/**
 * Creates or edits an online listing. Only listing tables are touched —
 * physical inventory, POS prices and laagat are never modified here.
 */
export function useSaveListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ListingInput) => {
      if (input.keptImages.length + input.newImages.length > MAX_LISTING_IMAGES) {
        throw new Error(`A listing can have at most ${MAX_LISTING_IMAGES} images`);
      }
      const fields = {
        title: input.title.trim(),
        description: input.description.trim() || null,
        category: input.category.trim() || null,
        collection: input.collection.trim() || null,
        tags: input.tags,
        seo_title: input.seo_title.trim() || null,
        seo_description: input.seo_description.trim() || null,
        price_paise: input.price_paise,
        sale_price_paise: input.sale_price_paise,
      };
      for (const file of input.newImages) {
        if (!LISTING_IMAGE_TYPES.includes(file.type)) {
          throw new Error(`${file.name} must be a JPG, PNG, WebP or GIF image`);
        }
        if (file.size > MAX_LISTING_IMAGE_BYTES) {
          throw new Error(`${file.name} exceeds the 10 MB image limit`);
        }
      }
      let id = input.id;
      let created = false;
      if (!id) {
        const slug = `${fields.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}-${Date.now().toString().slice(-4)}`;
        const { data, error } = await supabase
          .from("listings")
          .insert({ ...fields, slug, stock_mode: input.stock_mode, published: false })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id;
        created = true;
      }
      const uploaded: string[] = [];
      try {
        for (const file of input.newImages) {
          const rawExt = file.name.split(".").pop()?.toLowerCase() || "jpg";
          const ext = rawExt.replace(/[^a-z0-9]/g, "") || "jpg";
          const path = `${id}/${crypto.randomUUID()}.${ext}`;
          const { error } = await supabase.storage
            .from(IMAGE_BUCKET)
            .upload(path, file, { contentType: file.type });
          if (error) throw error;
          uploaded.push(path);
        }
        const { error: updError } = await supabase
          .from("listings")
          .update({ ...fields, images: [...input.keptImages, ...uploaded] })
          .eq("id", id);
        if (updError) throw updError;
      } catch (error) {
        if (uploaded.length) await supabase.storage.from(IMAGE_BUCKET).remove(uploaded);
        if (created) await supabase.from("listings").delete().eq("id", id);
        throw error;
      }

      const storedRemovals = input.removedImages.filter((path) => !/^https?:\/\//.test(path));
      if (storedRemovals.length) {
        const { error } = await supabase.storage.from(IMAGE_BUCKET).remove(storedRemovals);
        if (error)
          throw new Error(
            `Listing saved, but removed image files could not be cleaned up: ${error.message}`,
          );
      }

      if (input.stock_mode === "manual") {
        if (input.removedVariantIds.length) {
          const { error } = await supabase
            .from("listing_variants")
            .delete()
            .in("id", input.removedVariantIds);
          if (error) throw error;
        }
        for (const v of input.variants.filter((x) => x.label.trim())) {
          const row = {
            listing_id: id,
            label: v.label.trim(),
            qty: Math.max(0, Math.floor(v.qty)),
          };
          const { error } = v.id
            ? await supabase.from("listing_variants").update(row).eq("id", v.id)
            : await supabase.from("listing_variants").insert(row);
          if (error) throw error;
        }
      }
      return id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["listings"] });
      void qc.invalidateQueries({ queryKey: ["listing-availability"] });
    },
  });
}
