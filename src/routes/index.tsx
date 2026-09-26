import { createFileRoute, redirect } from "@tanstack/react-router";
import { homePath } from "@/app/access/modules";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: bootstrap } = await supabase.rpc("bootstrap_current_user", {
      _full_name: (data.user.user_metadata?.["full_name"] as string) ?? null,
    });
    const access = bootstrap as { active?: boolean; roles?: string[] } | null;
    if (access?.active === false) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }
    throw redirect({ to: homePath(access?.roles ?? []) });
  },
  component: () => null,
});
