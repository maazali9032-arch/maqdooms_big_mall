import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
export function useSalespeople() {
  const { userId, isOwner, roles, can } = useSession();
  return useQuery({
    queryKey: ["salespeople", userId],
    enabled:
      ((isOwner || roles.includes("counter")) && can("pos.assign_salesperson")) ||
      (roles.includes("salesperson") && can("salesperson.view_work")),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("salesperson_options");
      if (error) throw error;
      return data as unknown as { id: string; name: string; code: string | null }[];
    },
  });
}
