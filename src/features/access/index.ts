import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useStaff() {
  return useQuery({
    queryKey: ["staff"],
    queryFn: async () => {
      const [{ data: profiles, error }, { data: userRoles }] = await Promise.all([
        supabase.from("profiles").select("*").order("full_name"),
        supabase.from("user_roles").select("user_id, role_key"),
      ]);
      if (error) throw error;
      return (profiles ?? []).map((p) => ({
        ...p,
        roles: (userRoles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role_key),
      }));
    },
  });
}

export function useRoles() {
  return useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const [{ data: roles }, { data: permissions }, { data: rolePerms }] = await Promise.all([
        supabase.from("roles").select("*"),
        supabase.from("permissions").select("*").order("domain"),
        supabase.from("role_permissions").select("*"),
      ]);
      return {
        roles: roles ?? [],
        permissions: permissions ?? [],
        rolePermissions: rolePerms ?? [],
      };
    },
  });
}

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; roleKey: string; grant: boolean }) => {
      if (input.grant) {
        const { error } = await supabase
          .from("user_roles")
          .insert({ user_id: input.userId, role_key: input.roleKey });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", input.userId)
          .eq("role_key", input.roleKey);
        if (error) throw error;
      }
      await supabase.rpc("log_audit", {
        _action: "access_change",
        _entity: "user",
        _ref: input.userId,
        _detail: { role: input.roleKey, action: input.grant ? "granted" : "revoked" },
      });
    },
    onSuccess: () => void qc.invalidateQueries(),
  });
}

export function useSetActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; active: boolean }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ active: input.active })
        .eq("id", input.userId);
      if (error) throw error;
      await supabase.rpc("log_audit", {
        _action: input.active ? "access_restored" : "access_revoked",
        _entity: "user",
        _ref: input.userId,
        _detail: {},
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["staff"] }),
  });
}
