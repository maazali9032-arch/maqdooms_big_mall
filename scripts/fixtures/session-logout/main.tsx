import { createRoot } from "react-dom/client";
import {
  Outlet,
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { SessionProvider, useSession } from "@/app/providers/session";
import { AppShell } from "@/app/layouts/AppShell";
import { createWorkspaceQueryClient } from "@/app/providers/query-client";
import { AuthPage } from "@/routes/auth";
import { Route as HomeRoute } from "@/routes/index";
import { Route as ProtectedRoute } from "@/routes/_authenticated/route";
import { withLogoutTimeout } from "@/integrations/supabase/authLogoutFetch";
import { controls } from "./client";
import "@/styles.css";
const qc = createWorkspaceQueryClient();
qc.setDefaultOptions({ queries: { retry: false } });
export function Probe() {
  const state = useSession();
  return (
    <>
      <output data-testid="session-state">
        {JSON.stringify({
          userId: state.userId,
          fullName: state.fullName,
          roles: state.roles,
          permissions: state.permissions,
          loading: state.loading,
        })}
      </output>
      <button onClick={() => void state.refresh()}>Refresh access fixture</button>
    </>
  );
}
export function Root() {
  return (
    <SessionProvider>
      <Probe />
      <Outlet />
      <Toaster />
    </SessionProvider>
  );
}
const root = createRootRoute({ component: Root });
const auth = createRoute({ getParentRoute: () => root, path: "/auth", component: AuthPage });
const home = createRoute({
  getParentRoute: () => root,
  path: "/",
  beforeLoad: HomeRoute.options.beforeLoad,
  component: () => null,
});
const protectedRoute = createRoute({
  getParentRoute: () => root,
  id: "protected",
  beforeLoad: ProtectedRoute.options.beforeLoad,
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
const stock = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/inventory/receiving",
  component: () => <h1>Stock workspace fixture</h1>,
});
const pos = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/pos",
  component: () => <h1>Counter workspace fixture</h1>,
});
const owner = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/dashboard",
  component: () => <h1>Owner workspace fixture</h1>,
});
const router = createRouter({
  routeTree: root.addChildren([auth, home, protectedRoute.addChildren([stock, pos, owner])]),
  history: createMemoryHistory({ initialEntries: ["/inventory/receiving"] }),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
let release: (() => void) | null = null;
Object.assign(window, {
  logoutControls: controls,
  seedCache: () => qc.setQueryData(["private-old-user"], "old secret"),
  readCache: () => qc.getQueryData(["private-old-user"]) ?? null,
  startPrivateQuery: () => {
    void qc
      .fetchQuery({
        queryKey: ["late-private"],
        queryFn: () =>
          new Promise<string>((resolve) => {
            release = () => resolve("old secret");
          }),
      })
      .catch(() => {});
  },
  releasePrivate: () => release?.(),
  readLateCache: () => qc.getQueryData(["late-private"]) ?? null,
  timeoutCheck: async () => {
    let aborted = false;
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_, reject) => {
        const stop = () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (init?.signal?.aborted) stop();
        else init?.signal?.addEventListener("abort", stop, { once: true });
      });
    try {
      await withLogoutTimeout(hanging, 20)("https://example.test/auth/v1/logout?scope=global");
    } catch {
      /* Expected aborted fake request. */
    }
    const upstream = new AbortController();
    let sameSignal = false;
    const passthrough: typeof fetch = async (_input, init) => {
      sameSignal = init?.signal === upstream.signal;
      return new Response("{}");
    };
    await withLogoutTimeout(passthrough, 20)("https://example.test/auth/v1/token", {
      signal: upstream.signal,
    });
    const caller = new AbortController();
    caller.abort();
    let callerCancelled = false;
    try {
      await withLogoutTimeout(hanging, 20)("https://example.test/auth/v1/logout", {
        signal: caller.signal,
      });
    } catch {
      callerCancelled = true;
    }
    let bodyAborted = false;
    const streaming: typeof fetch = async (_input, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener(
              "abort",
              () => {
                bodyAborted = true;
                controller.error(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
          },
        }),
      );
    try {
      await withLogoutTimeout(streaming, 20)("https://example.test/auth/v1/logout");
    } catch {
      /* Expected streaming-body timeout. */
    }
    return { aborted, sameSignal, callerCancelled, bodyAborted };
  },
});
