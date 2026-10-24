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
import type { Session } from "@supabase/supabase-js";
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
  signOut: () => Promise<void>;
  signingOut: boolean;
  logoutError: string | null;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const generation = useRef(0);
  const accessKey = useRef("");
  const blocked = useRef(false);
  const rejectedTokens = useRef(new Set<string>());
  const deferredLoads = useRef(new Set<number>());
  const currentSession = useRef<Session | null>(null);
  const logoutOperation = useRef<Promise<void> | null>(null);
  const logoutBusy = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [fullName, setFullName] = useState("Staff");
  const [roles, setRoles] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);

  const clearAccess = useCallback(() => {
    ++generation.current;
    deferredLoads.current.forEach((timer) => window.clearTimeout(timer));
    deferredLoads.current.clear();
    accessKey.current = "";
    void queryClient.cancelQueries();
    queryClient.clear();
    setUserId(null);
    setEmail(null);
    setFullName("Staff");
    setRoles([]);
    setPermissions([]);
    setLoading(false);
  }, [queryClient]);
  const signOut = useCallback((): Promise<void> => {
    if (logoutOperation.current) return logoutOperation.current;
    if (currentSession.current) rejectedTokens.current.add(currentSession.current.access_token);
    blocked.current = true;
    logoutBusy.current = true;
    clearAccess();
    setSigningOut(true);
    setLogoutError(null);
    const operation = (async () => {
      try {
        const { error } = await supabase.auth.signOut();
        const verification = await supabase.auth.getSession();
        if (verification.error || verification.data.session) {
          setLogoutError("Sign-out could not finish. Retry before signing into another account.");
          return;
        }
        currentSession.current = null;
        if (error)
          toast.warning(
            "Signed out on this browser. Sign-out on other devices could not be confirmed.",
          );
      } catch {
        setLogoutError("Sign-out could not finish. Retry before signing into another account.");
      } finally {
        logoutBusy.current = false;
        logoutOperation.current = null;
        setSigningOut(false);
      }
    })();
    logoutOperation.current = operation;
    return operation;
  }, [clearAccess]);
  const load = useCallback(
    async (knownSession?: Session | null) => {
      if (blocked.current || logoutBusy.current) return;
      const ticket = ++generation.current;
      const reset = clearAccess;
      try {
        const { data, error: sessionError } =
          knownSession === undefined
            ? await supabase.auth.getSession()
            : { data: { session: knownSession }, error: null };
        if (ticket !== generation.current) return;
        if (sessionError) throw sessionError;
        const session = data.session;
        currentSession.current = session;
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
          await signOut();
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
        setLoading(false);

        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", session.user.id)
            .maybeSingle();
          if (ticket !== generation.current) return;
          setFullName(profile?.full_name ?? "Staff");
          setLoading(false);
        } catch {
          // A display-name lookup must not discard already verified access.
        }
      } catch {
        if (ticket === generation.current) reset();
      }
    },
    [queryClient, clearAccess, signOut],
  );

  useEffect(() => {
    void load();
    const deferred = deferredLoads.current;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        if (currentSession.current) rejectedTokens.current.add(currentSession.current.access_token);
        blocked.current = true;
        clearAccess();
        return;
      }
      if (logoutBusy.current) {
        if (session) rejectedTokens.current.add(session.access_token);
        return;
      }
      if (event === "TOKEN_REFRESHED") {
        if (blocked.current) {
          if (session) rejectedTokens.current.add(session.access_token);
          return;
        }
        if (session?.user.id === currentSession.current?.user.id) currentSession.current = session;
        return;
      }
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        // Focus can re-emit SIGNED_IN for the old token. Only a genuinely new
        // sign-in may release a logout barrier; old periodic/async work cannot.
        if (
          (blocked.current && !session) ||
          (session && rejectedTokens.current.has(session.access_token))
        )
          return;
        blocked.current = false;
        setLogoutError(null);
        if (session?.user.id !== currentSession.current?.user.id) {
          clearAccess();
          setLoading(true);
        }
        const timer = window.setTimeout(() => {
          deferred.delete(timer);
          // A delayed cross-tab event may carry an older session. Read the
          // canonical SDK session outside the callback before verifying access.
          void load();
        }, 0);
        deferred.add(timer);
      }
    });
    // Re-check access periodically and on focus so role changes and deactivation apply without re-login.
    const recheck = () => void load();
    const timer = window.setInterval(recheck, 60_000);
    window.addEventListener("focus", recheck);
    return () => {
      sub.subscription.unsubscribe();
      deferred.forEach((timer) => window.clearTimeout(timer));
      ++generation.current;
      window.clearInterval(timer);
      window.removeEventListener("focus", recheck);
    };
  }, [load, clearAccess]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`profile-access-${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
        (payload) => {
          if (blocked.current || currentSession.current?.user.id !== userId) return;
          const profile = payload.new as { active?: boolean; full_name?: string };
          if (profile.active === false) void signOut();
          // Bootstrap itself updates last_login. Do not bootstrap again on
          // that event, which would create a realtime feedback loop.
          else if (profile.full_name) setFullName(profile.full_name);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, signOut]);

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
      refresh: () => load(),
      signOut,
      signingOut,
      logoutError,
    };
  }, [
    loading,
    userId,
    email,
    fullName,
    roles,
    permissions,
    load,
    signOut,
    signingOut,
    logoutError,
  ]);

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
  salesperson: "Salesperson",
  tailor: "Tailor",
  tailor_staff: "Tailor Staff",
  production: "Production",
  ecommerce_manager: "E-commerce Manager",
};
