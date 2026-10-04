import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();
  const generation = useRef(0);
  const accessKey = useRef("");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [fullName, setFullName] = useState("Staff");
  const [roles, setRoles] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);

  const load = useCallback(async () => {
    const ticket = ++generation.current;
    const reset = () => {
      accessKey.current = "";
      void queryClient.cancelQueries();
      queryClient.clear();
      setUserId(null);
      setEmail(null);
      setFullName("Staff");
      setRoles([]);
      setPermissions([]);
      setLoading(false);
    };
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (ticket !== generation.current) return;
      if (sessionError) throw sessionError;
      const session = data.session;
      if (!session) {
        reset();
        return;
      }
      if (!accessKey.current.startsWith(`${session.user.id}:`)) {
        setLoading(true);
        void queryClient.cancelQueries();
        queryClient.clear();
        setRoles([]);
        setPermissions([]);
      }

      const { data: bootstrap, error: bootstrapError } = await supabase.rpc(
        "bootstrap_current_user",
        {
          _full_name: (session.user.user_metadata?.["full_name"] as string) ?? null,
        },
      );
      if (ticket !== generation.current) return;
      if (bootstrapError || !bootstrap)
        throw bootstrapError ?? new Error("Access verification failed");
      const payload = bootstrap as {
        roles?: string[];
        permissions?: string[];
        active?: boolean;
      } | null;
      if (payload?.active !== true) {
        // Deactivated accounts are signed out immediately; the database already denies them all data.
        reset();
        await supabase.auth.signOut();
        toast.error("Your account has been deactivated. Contact the owner.");
        return;
      }
      const nextKey = `${session.user.id}:${JSON.stringify([payload.roles, payload.permissions])}`;
      if (accessKey.current !== nextKey) {
        void queryClient.cancelQueries();
        queryClient.clear();
        accessKey.current = nextKey;
      }
      setUserId(session.user.id);
      setEmail(session.user.email ?? null);
      setRoles(payload?.roles ?? []);
      setPermissions(payload?.permissions ?? []);

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", session.user.id)
        .maybeSingle();
      if (ticket !== generation.current) return;
      setFullName(profile?.full_name ?? "Staff");
      setLoading(false);
    } catch {
      if (ticket === generation.current) reset();
    }
  }, [queryClient]);

  useEffect(() => {
    void load();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        queueMicrotask(() => void load());
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
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`profile-access-${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
        (payload) => {
          const profile = payload.new as { active?: boolean; full_name?: string };
          if (profile.active === false) void supabase.auth.signOut();
          // Bootstrap itself updates last_login. Do not bootstrap again on
          // that event, which would create a realtime feedback loop.
          else if (profile.full_name) setFullName(profile.full_name);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, load]);

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
  }, [loading, userId, email, fullName, roles, permissions, load]);

  return (
    <SessionContext.Provider key={accessKey.current} value={value}>
      {children}
    </SessionContext.Provider>
  );
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
