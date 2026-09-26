import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCustomers(enabled = true) {
  return useQuery({
    queryKey: ["customers"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select(
          "*, sales(id, bill_no, total_paise, created_at), tailoring_jobs(id, code, garment, status)",
        )
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name?: string | null;
      phone?: string | null;
      whatsapp_phone?: string | null;
      notes?: string | null;
    }) => {
      const { data: customerId, error } = await supabase.rpc("find_or_create_customer", {
        p_name: input.name?.trim() || undefined,
        p_phone: input.phone?.trim() || undefined,
        p_whatsapp_phone: input.whatsapp_phone?.trim() || undefined,
        p_notes: input.notes?.trim() || undefined,
      });
      if (error) throw error;
      if (!customerId) return null;

      const { data, error: readError } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .single();
      if (readError) throw readError;
      return data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}
