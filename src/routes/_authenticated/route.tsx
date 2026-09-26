import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/app/layouts/AppShell";
import { canAccessPath, homePath } from "@/app/access/modules";

type AccessBootstrap = {
  active?: boolean;
  roles?: string[];
  permissions?: string[];
};

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const { data: bootstrap, error: bootstrapError } = await supabase.rpc(
      "bootstrap_current_user",
      {
        _full_name: (data.user.user_metadata?.["full_name"] as string) ?? null,
      },
    );
    if (bootstrapError) throw bootstrapError;
    const access = (bootstrap ?? {}) as AccessBootstrap;
    if (access.active === false) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }
    const roles = access.roles ?? [];
    const permissions = access.permissions ?? [];
    if (!canAccessPath(roles, permissions, location.pathname)) {
      throw redirect({ to: homePath(roles) });
    }
    return { user: data.user, roles, permissions };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
