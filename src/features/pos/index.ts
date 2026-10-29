import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ThaanOverview } from "@/features/inventory";

export async function lookupThaan(barcode: string): Promise<ThaanOverview | null> {
  const { data, error } = await supabase
    .from("v_thaan_overview")
    .select("*")
    .eq("barcode", barcode.trim())
    .maybeSingle();
  if (error) throw error;
  return (data as ThaanOverview | null) ?? null;
}

export function useRecentSales(limit = 25, enabled = true) {
  return useQuery({
    queryKey: ["sales", limit],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select(
          "*, customers(name, phone), sale_items(length_mm, price_paise_per_m, amount_paise, thaans(barcode))",
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}
