import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useTailoringJobs(enabled = true) {
  return useQuery({
    queryKey: ["tailoring-jobs"],
    enabled,
    queryFn: async () => {
      const [{ data, error }, { data: costs }, { data: prices }] = await Promise.all([
        supabase
          .from("tailoring_jobs")
          .select(
            "*, customers(name, phone), tailor:profiles!tailoring_jobs_tailor_id_fkey(full_name, email), tailoring_job_lines(id, category, length_mm, qty, thaans(barcode, fabric_id), materials(name, unit))",
          )
          .order("created_at", { ascending: false }),
        // Cost snapshots are column-restricted; this function returns rows only for cost-permitted users.
        supabase.rpc("tailoring_line_costs"),
        supabase.rpc("owner_tailoring_line_prices"),
      ]);
      if (error) throw error;
      const costMap = new Map((costs ?? []).map((c) => [c.line_id, c.cost_snapshot_paise]));
      const priceMap = new Map((prices ?? []).map((p) => [p.line_id, p.price_snapshot_paise]));
      return (data ?? []).map((job) => ({
        ...job,
        tailoring_job_lines: (job.tailoring_job_lines ?? []).map((l) => ({
          ...l,
          cost_snapshot_paise: costMap.get(l.id) ?? null,
          price_snapshot_paise: priceMap.get(l.id) ?? null,
        })),
      }));
    },
  });
}

/** Jobs that the counter can currently receive fabric against. */
export function useEligibleTailoringJobs(enabled = true) {
  return useQuery({
    queryKey: ["tailoring-jobs", "eligible-for-issue"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("eligible_tailoring_jobs");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useActiveTailors(enabled = true) {
  return useQuery({
    queryKey: ["tailors", "active"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("active_tailors");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useMaterials() {
  return useQuery({
    queryKey: ["materials"],
    queryFn: async () => {
      const [{ data, error }, { data: costs }] = await Promise.all([
        supabase.from("materials").select("id, name, unit, qty_on_hand, price_paise").order("name"),
        supabase.rpc("material_costs"),
      ]);
      if (error) throw error;
      const costMap = new Map((costs ?? []).map((row) => [row.material_id, row.cost_paise]));
      return Promise.all(
        (data ?? []).map(async (material) => {
          const { data: quantity, error: quantityError } = await supabase.rpc(
            "material_available_qty",
            { p_material: material.id },
          );
          if (quantityError) throw quantityError;
          return {
            ...material,
            qty_on_hand: quantity ?? 0,
            cost_paise: costMap.get(material.id) ?? null,
          };
        }),
      );
    },
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      garment: string;
      tailor_id: string;
      customer_id?: string | null;
      notes?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("create_tailoring_job", {
        p_garment: input.garment,
        p_tailor_id: input.tailor_id,
        p_customer_id: input.customer_id || undefined,
        p_notes: input.notes?.trim() || undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tailoring-jobs"] }),
  });
}

export function useAssignTailor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { jobId: string; tailorId: string }) => {
      const { error } = await supabase.rpc("assign_tailoring_job", {
        p_job_id: input.jobId,
        p_tailor_id: input.tailorId,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tailoring-jobs"] }),
  });
}

export function useUpdateJobStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: string }) => {
      const { error } = await supabase.rpc("update_tailoring_job_status", {
        p_job_id: input.id,
        p_status: input.status,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tailoring-jobs"] }),
  });
}

/** Line totals derived from snapshots — mm x per-metre price. */
export function lineValue(line: {
  length_mm: number | null;
  qty: number | null;
  price_snapshot_paise: number | null;
  cost_snapshot_paise: number | null;
}) {
  const units = line.length_mm !== null ? line.length_mm / 1000 : (line.qty ?? 0);
  return {
    cost: Math.round(units * (line.cost_snapshot_paise ?? 0)),
    selling: Math.round(units * (line.price_snapshot_paise ?? 0)),
  };
}
