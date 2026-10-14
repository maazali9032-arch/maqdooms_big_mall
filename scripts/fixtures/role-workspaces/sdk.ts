import { calls } from "./client";
export function createClient(_url: string, _key: string, options: unknown) {
  calls.push({ name: "isolatedClient", args: options });
  return {
    auth: {
      signUp: async () => {
        calls.push({ name: "signUp", args: "synthetic account" });
        return {
          data: { user: { id: "new-staff", identities: [{ id: "identity" }] }, session: null },
          error: null,
        };
      },
      signOut: async () => ({ error: null }),
    },
  };
}
