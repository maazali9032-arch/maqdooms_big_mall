import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ThaanOverview = {
  id: string;
  barcode: string;
  status: "draft" | "active" | "depleted" | "archived";
  original_mm: number | null;
  width_mm: number | null;
  price_paise: number | null;
  rack: string | null;
  created_at: string;
  batch_id: string | null;
  batch_code: string | null;
  supplier_name: string | null;
  fabric_id: string | null;
  fabric_name: string | null;
  fabric_code: string | null;
  category: string | null;
  colour: string | null;
  design: string | null;
  available_mm: number;
  held_mm: number;
  is_incomplete: boolean;
  last_movement_at: string | null;
};

export function incompleteReasons(thaan: Pick<ThaanOverview, "original_mm" | "price_paise">) {
  const reasons: string[] = [];
  if (thaan.original_mm === null) reasons.push("Missing length");
  if (thaan.price_paise === null) reasons.push("Missing selling price");
  return reasons;
}

export type MovementRow = {
  id: string;
  created_at: string;
  kind: string;
  delta_mm: number;
  purpose: string | null;
  reference: string | null;
  reason: string | null;
  price_snapshot_paise: number | null;
  user_name: string | null;
  barcode: string;
  fabric_name: string | null;
};

export const inventoryKeys = {
  thaans: ["thaans"] as const,
  movements: ["movements"] as const,
  batches: ["receiving-batches"] as const,
  fabrics: ["fabrics"] as const,
  costs: ["thaan-costs"] as const,
};

export function useThaans(status?: ThaanOverview["status"][]) {
  return useQuery({
    queryKey: [...inventoryKeys.thaans, status ?? "all"],
    queryFn: async (): Promise<ThaanOverview[]> => {
      let q = supabase.from("v_thaan_overview").select("*").order("barcode");
      if (status?.length) q = q.in("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ThaanOverview[];
    },
  });
}

export function useMovements(limit = 200, enabled = true) {
  return useQuery({
    queryKey: [...inventoryKeys.movements, limit],
    enabled,
    queryFn: async (): Promise<MovementRow[]> => {
      const { data, error } = await supabase
        .from("v_movement_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as MovementRow[];
    },
  });
}

export function useFabrics() {
  return useQuery({
    queryKey: inventoryKeys.fabrics,
    queryFn: async () => {
      const { data, error } = await supabase.from("fabrics").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSuppliers() {
  return useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useBatches(enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.batches,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("receiving_batches")
        .select("*, suppliers(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Costs are a separate, permission-gated table: counter staff simply receive no rows. */
export function useThaanCosts(enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.costs,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("thaan_costs").select("thaan_id, cost_paise");
      if (error) return [] as { thaan_id: string; cost_paise: number }[];
      return data ?? [];
    },
  });
}

export function useCreateBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { supplier_id: string | null; bill_no: string; notes: string }) => {
      const code = `RB-${Date.now().toString().slice(-6)}`;
      const { data, error } = await supabase
        .from("receiving_batches")
        .insert({
          code,
          supplier_id: input.supplier_id,
          bill_no: input.bill_no,
          notes: input.notes,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: inventoryKeys.batches }),
  });
}

export function useScanThaan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { batch_id: string; barcode: string }) => {
      const { data: existing } = await supabase
        .from("thaans")
        .select("id, barcode, status")
        .eq("barcode", input.barcode)
        .maybeSingle();
      if (existing) throw new Error(`Duplicate scan — ${input.barcode} already exists`);
      const { data, error } = await supabase
        .from("thaans")
        .insert({ barcode: input.barcode, batch_id: input.batch_id, status: "draft" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: inventoryKeys.thaans }),
  });
}

export type ThaanPatch = {
  fabric_id?: string | null;
  original_mm?: number | null;
  width_mm?: number | null;
  price_paise?: number | null;
  rack?: string | null;
};

export function useUpdateThaans() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ids: string[]; patch: ThaanPatch; cost_paise?: number | null }) => {
      const patch = Object.fromEntries(
        Object.entries(input.patch).filter(([, v]) => v !== undefined && v !== null),
      );
      if (Object.keys(patch).length) {
        const { error } = await supabase
          .from("thaans")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .in("id", input.ids);
        if (error) throw error;
      }
      if (input.cost_paise !== undefined && input.cost_paise !== null) {
        const { error } = await supabase
          .from("thaan_costs")
          .upsert(
            input.ids.map((id) => ({ thaan_id: id, cost_paise: input.cost_paise as number })),
          );
        if (error) throw error;
      }
      return input.ids.length;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.thaans });
      void qc.invalidateQueries({ queryKey: inventoryKeys.costs });
    },
  });
}

export type CorrectThaanResult = {
  activated: boolean;
  complete: boolean;
  inward_created: boolean;
  status: ThaanOverview["status"];
};

/**
 * Corrects an existing draft/incomplete thaan and atomically revalidates it.
 * The database activates committed complete stock and guarantees at most one
 * INWARD ledger entry for the thaan.
 */
export function useCorrectIncompleteThaan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      thaan_id: string;
      fabric_id: string | null;
      original_mm: number | null;
      width_mm: number | null;
      price_paise: number | null;
      cost_paise: number | null;
    }) => {
      const { data, error } = await supabase.rpc("correct_incomplete_thaan", {
        p_thaan_id: input.thaan_id,
        p_fabric_id: input.fabric_id ?? undefined,
        p_original_mm: input.original_mm ?? undefined,
        p_width_mm: input.width_mm ?? undefined,
        p_price_paise: input.price_paise ?? undefined,
        p_cost_paise: input.cost_paise ?? undefined,
      });
      if (error) throw error;
      return data as unknown as CorrectThaanResult;
    },
    onSuccess: () => void qc.invalidateQueries(),
  });
}

export function useCommitBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) => {
      const { data, error } = await supabase.rpc("commit_receiving_batch", { p_batch_id: batchId });
      if (error) throw error;
      return data as { activated: number; incomplete: number; code: string };
    },
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });
}

export function useAdjustThaan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      thaan_id: string;
      delta_mm: number;
      kind: "ADJUSTMENT" | "RETURN" | "WASTAGE";
      reason: string;
    }) => {
      const { error } = await supabase.rpc("adjust_thaan", {
        p_thaan_id: input.thaan_id,
        p_delta_mm: input.delta_mm,
        p_kind: input.kind,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries(),
  });
}

export function useDashboardMetrics() {
  return useQuery({
    queryKey: ["dashboard-metrics"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_metrics");
      if (error) throw error;
      return data as Record<string, number>;
    },
  });
}

/** Pick-or-type: returns the id of an existing supplier by name, creating it when new. */
export function useEnsureSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<string | null> => {
      const clean = name.trim();
      if (!clean) return null;
      const pattern = clean.replace(/[\\%_]/g, "\\$&");
      const { data: found } = await supabase
        .from("suppliers")
        .select("id")
        .ilike("name", pattern)
        .limit(1);
      if (found?.[0]) return found[0].id;
      const { data, error } = await supabase
        .from("suppliers")
        .insert({ name: clean })
        .select("id")
        .single();
      if (error) throw error;
      await supabase.rpc("log_audit", {
        _action: "create_supplier",
        _entity: "supplier",
        _ref: clean,
        _detail: {},
      });
      return data.id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}

/** Pick-or-type: returns the id of an existing fabric by name, creating it when new. */
export function useEnsureFabric() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<string | null> => {
      const clean = name.trim();
      if (!clean) return null;
      const pattern = clean.replace(/[\\%_]/g, "\\$&");
      const { data: found } = await supabase
        .from("fabrics")
        .select("id")
        .ilike("name", pattern)
        .limit(1);
      if (found?.[0]) return found[0].id;
      const slug = clean
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 16);
      const code = `FB-${slug}-${Date.now().toString().slice(-4)}`;
      const { data, error } = await supabase
        .from("fabrics")
        .insert({ name: clean, code, category: "Fabric" })
        .select("id")
        .single();
      if (error) throw error;
      await supabase.rpc("log_audit", {
        _action: "create_fabric",
        _entity: "fabric",
        _ref: code,
        _detail: { name: clean },
      });
      return data.id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: inventoryKeys.fabrics }),
  });
}
