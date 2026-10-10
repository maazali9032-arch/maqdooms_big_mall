import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRoles, useStaff } from "@/features/access";
import { Panel } from "@/shared/components/page";
import { toast } from "sonner";

export function UserPermissions() {
  const staff = useStaff();
  const roles = useRoles();
  const qc = useQueryClient();
  const [user, setUser] = useState("");
  const overrides = useQuery({
    queryKey: ["user-permission-overrides"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_permission_overrides").select("*");
      if (error) throw error;
      return data;
    },
  });
  const save = useMutation({
    mutationFn: async ({ permission, value }: { permission: string; value: string }) => {
      const { error } = await supabase.rpc("owner_set_user_permission", {
        p_user: user,
        p_permission: permission,
        p_granted: value === "inherit" ? null : value === "allow",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      toast.success("User permission saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const person = staff.data?.find((p) => p.id === user);
  return (
    <Panel
      title="Individual user permissions"
      description="Choose a user and allow, deny or inherit each action. Roles determine eligible workflows; internal costs and administration remain Owner-only. Owner accounts retain full control. Staff should refresh access after a change."
    >
      {(staff.error || roles.error || overrides.error) && (
        <p role="alert">Permissions could not load. Refresh before changing access.</p>
      )}
      <select
        aria-label="Permission user"
        className="w-full rounded border bg-background p-2"
        value={user}
        disabled={save.isPending}
        onChange={(e) => setUser(e.target.value)}
      >
        <option value="">Select staff member</option>
        {staff.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name} · {p.email}
          </option>
        ))}
      </select>
      {person && (
        <div className="mt-3 space-y-2">
          {roles.data?.permissions.map((p) => {
            const override = overrides.data?.find(
              (o) => o.user_id === user && o.permission_key === p.key,
            );
            const inherited = roles.data?.rolePermissions.some(
              (r) => person.roles.includes(r.role_key) && r.permission_key === p.key,
            );
            return (
              <label
                key={p.key}
                className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm"
              >
                <span>
                  {p.label}
                  <span className="block text-xs text-muted-foreground">
                    {p.key} · Role default: {inherited ? "allowed" : "denied"}
                  </span>
                </span>
                <select
                  aria-label={`${p.label} permission`}
                  className="rounded border bg-background p-2"
                  value={override ? (override.granted ? "allow" : "deny") : "inherit"}
                  disabled={
                    person.roles.includes("owner") ||
                    save.isPending ||
                    overrides.isPending ||
                    Boolean(overrides.error)
                  }
                  onChange={(e) => save.mutate({ permission: p.key, value: e.target.value })}
                >
                  <option value="inherit">Inherit role default</option>
                  <option value="allow">Allow</option>
                  <option value="deny">Deny</option>
                </select>
              </label>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
