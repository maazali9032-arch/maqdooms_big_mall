import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCustomers(enabled = true) {
  return useQuery({
    queryKey: ["customers"],
    enabled,
    queryFn: async () => {
      const [list, activity] = await Promise.all([
        supabase.from("customers").select("*").order("name"),
        supabase.rpc("owner_customer_activity"),
      ]);
      if (list.error) throw list.error;
      if (activity.error) throw activity.error;
      // Bills and tailoring jobs come from the current order tables, not the retired legacy ones.
      const byCustomer = new Map((activity.data ?? []).map((row) => [row.customer_id, row]));
      return (list.data ?? []).map((customer) => {
        const row = byCustomer.get(customer.id);
        return {
          ...customer,
          bill_count: row?.bill_count ?? 0,
          spend_paise: Number(row?.spend_paise ?? 0),
          last_bill_at: row?.last_bill_at ?? null,
          tailoring_jobs: row?.tailoring_jobs ?? 0,
          open_tailoring_jobs: row?.open_tailoring_jobs ?? 0,
        };
      });
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
