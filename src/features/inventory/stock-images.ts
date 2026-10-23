import { supabase } from "@/integrations/supabase/client";

export type StockImageKind = "thaan" | "finished_product";
export type StockImageAssignment = { kind: StockImageKind; itemId: string; file: File };

const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateStockImage(file: File) {
  if (!allowed.has(file.type)) throw new Error("Use a JPG, PNG or WebP image");
  if (file.size > 5 * 1024 * 1024) throw new Error("Each image must be 5 MB or smaller");
}

export async function saveStockImages(userId: string, assignments: StockImageAssignment[]) {
  if (!assignments.length) return;
  const uploads = new Map<File, { path: string; mime: string }>();
  const uploaded: string[] = [];
  try {
    for (const { file } of assignments) {
      if (uploads.has(file)) continue;
      validateStockImage(file);
      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${userId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from("stock-images").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      uploads.set(file, { path, mime: file.type });
      uploaded.push(path);
    }
    const links = assignments.map(({ kind, itemId, file }) => ({
      item_kind: kind,
      item_id: itemId,
      storage_path: uploads.get(file)!.path,
      mime_type: uploads.get(file)!.mime,
    }));
    const { error } = await (supabase.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: Error | null }>)("save_stock_item_images", { p_links: links });
    if (error) throw error;
  } catch (error) {
    if (uploaded.length) await supabase.storage.from("stock-images").remove(uploaded);
    throw error;
  }
}

export async function loadStockImageUrls(kind: StockImageKind, itemIds: string[]) {
  if (!itemIds.length) return new Map<string, string>();
  const { data, error } = await (supabase as any)
    .from("stock_item_images")
    .select("item_id,storage_path")
    .eq("item_kind", kind)
    .in("item_id", itemIds);
  if (error) throw error;
  const rows = (data ?? []) as { item_id: string; storage_path: string }[];
  if (!rows.length) return new Map<string, string>();
  const signed = await supabase.storage
    .from("stock-images")
    .createSignedUrls(rows.map((row) => row.storage_path), 3600);
  if (signed.error) throw signed.error;
  return new Map(
    rows.flatMap((row, index) => {
      const url = signed.data[index]?.signedUrl;
      return url ? [[row.item_id, url] as const] : [];
    }),
  );
}

