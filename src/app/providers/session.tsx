import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type SessionState = {
  loading: boolean;
  userId: string | null;
  email: string | null;
  fullName: string;
  roles: string[];
  permissions: string[];
  can: (permission: string) => boolean;
  isOwner: boolean;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [fullName, setFullName] = useState("Staff");
  const [roles, setRoles] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);

  async function load() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) {
      setUserId(null);
      setRoles([]);
      setPermissions([]);
      setLoading(false);
      return;
    }
    setUserId(session.user.id);
    setEmail(session.user.email ?? null);

    const { data: bootstrap } = await supabase.rpc("bootstrap_current_user", {
      _full_name: (session.user.user_metadata?.["full_name"] as string) ?? null,
    });
    const payload = bootstrap as {
      roles?: string[];
      permissions?: string[];
      active?: boolean;
    } | null;
    if (payload && payload.active === false) {
      // Deactivated accounts are signed out immediately; the database already denies them all data.
      await supabase.auth.signOut();
      toast.error("Your account has been deactivated. Contact the owner.");
      return;
    }
    setRoles(payload?.roles ?? []);
    setPermissions(payload?.permissions ?? []);

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", session.user.id)
      .maybeSingle();
    if (profile?.full_name) setFullName(profile.full_name);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void load();
      }
    });
    // Re-check access periodically and on focus so role changes and deactivation apply without re-login.
    const recheck = () => void load();
    const timer = window.setInterval(recheck, 60_000);
    window.addEventListener("focus", recheck);
    return () => {
      sub.subscription.unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener("focus", recheck);
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`profile-access-${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
        (payload) => {
          const profile = payload.new as { active?: boolean };
          if (profile.active === false) void supabase.auth.signOut();
          else void load();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const value = useMemo<SessionState>(() => {
    const isOwner = roles.includes("owner");
    return {
      loading,
      userId,
      email,
      fullName,
      roles,
      permissions,
      isOwner,
      can: (permission: string) => isOwner || permissions.includes(permission),
      refresh: load,
    };
  }, [loading, userId, email, fullName, roles, permissions]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  stock_entry: "Stock Entry",
  counter: "Counter",
  tailor: "Tailor",
  ecommerce_manager: "E-commerce Manager",
};
