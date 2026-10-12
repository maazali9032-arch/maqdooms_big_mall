type Session = {
  access_token: string;
  user: { id: string; email: string; user_metadata: Record<string, string> };
};
const sessionFor = (role: string, nonce = Date.now()) => ({
  access_token: `token-${role}-${nonce}`,
  user: { id: role, email: `${role}@example.test`, user_metadata: { full_name: role } },
});
let session: Session | null = sessionFor("stock_entry", 1);
let oldSession: Session | null = null;
const listeners = new Set<(event: string, session: Session | null) => void>();
let notify = false;
let finish: ((mode: string) => void) | null = null;
let hold = false;
let bootstrapRelease: (() => void) | null = null;
let profileHold = false;
let profileRelease: (() => void) | null = null;
export const calls: string[] = [];
function emit(event: string, value: Session | null) {
  notify = true;
  for (const listener of listeners) listener(event, value);
  notify = false;
}
export const controls = {
  finishLogout: (mode = "success") => finish?.(mode),
  holdBootstrap: () => {
    hold = true;
  },
  releaseBootstrap: () => bootstrapRelease?.(),
  staleSignIn: () => emit("SIGNED_IN", oldSession),
  foreignEvent: () => emit("SIGNED_IN", sessionFor("owner", 123)),
  externalSignOut: () => {
    oldSession = session;
    session = null;
    emit("SIGNED_OUT", null);
  },
  refreshToken: () => {
    if (session) {
      session = { ...session, access_token: session.access_token + "-refreshed" };
      emit("TOKEN_REFRESHED", session);
    }
  },
  cacheCalls: () => calls,
  holdProfile: () => {
    profileHold = true;
  },
  releaseProfile: () => profileRelease?.(),
};
export const supabase = {
  auth: {
    getSession: async () => {
      if (notify) throw new Error("Auth method called inside auth callback");
      calls.push("getSession");
      return { data: { session }, error: null };
    },
    getUser: async () => ({ data: { user: session?.user ?? null }, error: null }),
    onAuthStateChange: (cb: (event: string, session: Session | null) => void) => {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },
    signOut: () => {
      calls.push("signOut");
      oldSession = session;
      return new Promise<{ error: Error | null }>((resolve) => {
        finish = (mode) => {
          finish = null;
          if (mode === "retain") {
            resolve({ error: new Error("Storage removal failed") });
            return;
          }
          session = null;
          emit("SIGNED_OUT", null);
          resolve({
            error: mode === "remote_error" ? new Error("Remote revoke unavailable") : null,
          });
        };
      });
    },
    signInWithPassword: async ({ email }: { email: string; password: string }) => {
      calls.push("signIn");
      session = sessionFor(email.split("@")[0]);
      emit("SIGNED_IN", session);
      return { data: { session }, error: null };
    },
    signUp: async () => ({ error: null }),
  },
  rpc: async (name: string) => {
    if (notify) throw new Error("RPC inside auth callback");
    calls.push(name);
    const role = session?.user.id ?? "counter";
    const result = {
      data: {
        active: true,
        roles: [role],
        permissions:
          role === "stock_entry"
            ? ["inventory.receive", "inventory.edit_thaan", "stock.print_barcode", "stock.transfer"]
            : [],
      },
      error: null,
    };
    if (hold) {
      hold = false;
      return new Promise<typeof result>((resolve) => {
        bootstrapRelease = () => {
          bootstrapRelease = null;
          resolve(result);
        };
      });
    }
    return result;
  },
  from: () => ({
    select: () => ({
      eq: (_: string, id: string) => ({
        maybeSingle: async () => {
          const result = { data: { full_name: id }, error: null };
          if (profileHold) {
            profileHold = false;
            return new Promise<typeof result>((resolve) => {
              profileRelease = () => {
                profileRelease = null;
                resolve(result);
              };
            });
          }
          return result;
        },
      }),
    }),
  }),
  channel: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    return channel;
  },
  removeChannel: async () => {},
};
