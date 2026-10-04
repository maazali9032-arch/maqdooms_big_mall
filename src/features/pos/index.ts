import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ThaanOverview } from "@/features/inventory";

export type CutResult = {
  thaan_id: string;
  barcode: string;
  length_mm: number;
  remaining_mm: number;
  amount_paise: number;
  bill_no: string | null;
  sale_id: string | null;
};

export type TailoringIssueResult = {
  job_id: string;
  cut_count: number;
  total_length_mm: number;
  cuts: CutResult[];
};

export type FabricSaleResult = {
  sale_id: string;
  bill_no: string;
  item_count: number;
  total_length_mm: number;
  total_paise: number;
  cuts: CutResult[];
};

export async function lookupThaan(barcode: string): Promise<ThaanOverview | null> {
  const { data, error } = await supabase
    .from("v_thaan_overview")
    .select("*")
    .eq("barcode", barcode.trim())
    .maybeSingle();
  if (error) throw error;
  return (data as ThaanOverview | null) ?? null;
}

/**
 * The single authoritative deduction path. React never computes the new balance —
 * cut_thaan() locks the row, revalidates availability against the ledger and holds,
 * writes the movement plus the sale or tailoring line, and snapshots prices.
 */
export function useCutThaan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      barcode: string;
      length_mm: number;
      purpose: "sale" | "tailoring";
      customer_id?: string | null;
      job_id?: string | null;
      category?: string;
      reason?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("cut_thaan", {
        p_barcode: input.barcode,
        p_length_mm: input.length_mm,
        p_purpose: input.purpose,
        p_customer_id: input.customer_id ?? undefined,
        p_job_id: input.job_id ?? undefined,
        p_category: input.category ?? "outer fabric",
        p_reason: input.reason ?? undefined,
      });
      if (error) throw error;
      return data as unknown as CutResult;
    },
    onSuccess: () => void qc.invalidateQueries(),
  });
}

/**
 * Atomically commits a staged group of fabric cuts to one tailoring job. The
 * database delegates each item to cut_thaan(), so holds, row locks, ledger
 * entries, cost snapshots and depletion rules stay authoritative.
 */
export function useIssueTailoringFabrics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      jobId: string;
      items: Array<{ barcode: string; lengthMm: number; category?: string }>;
      reason?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("issue_tailoring_fabrics", {
        p_job_id: input.jobId,
        p_items: input.items.map((item) => ({
          barcode: item.barcode,
          length_mm: item.lengthMm,
          category: item.category ?? "outer fabric",
        })),
        p_reason: input.reason ?? undefined,
      });
      if (error) throw error;
      return data as unknown as TailoringIssueResult;
    },
    onSuccess: () => void qc.invalidateQueries(),
  });
}

/**
 * Atomically completes one customer bill containing one or more fabric cuts.
 * Stock is only deducted after every staged thaan passes the database's stock,
 * hold and completeness checks.
 */
export function useCompleteFabricSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      customerId?: string | null;
      items: Array<{ barcode: string; lengthMm: number }>;
      reason?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("complete_fabric_sale", {
        p_customer_id: input.customerId ?? undefined,
        p_items: input.items.map((item) => ({
          barcode: item.barcode,
          length_mm: item.lengthMm,
        })),
        p_reason: input.reason ?? undefined,
      });
      if (error) throw error;
      return data as unknown as FabricSaleResult;
    },
    onSuccess: () => void qc.invalidateQueries(),
  });
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
