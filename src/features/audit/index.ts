import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AuditEntry = {
  id: string;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_ref: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

export function useAuditLog(limit = 300) {
  return useQuery({
    queryKey: ["audit-log", limit],
    queryFn: async (): Promise<AuditEntry[]> => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as AuditEntry[];
    },
  });
}
