import { createRoot } from "react-dom/client";
import { useState } from "react";
import {
  Outlet,
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { createWorkspaceQueryClient } from "@/app/providers/query-client";
import { StockRegistration } from "@/features/inventory/StockRegistration";
import { AppShell } from "@/app/layouts/AppShell";
import { SessionContext } from "./session";
import { calls } from "./client";
import "@/styles.css";
const qc = createWorkspaceQueryClient();
qc.setDefaultOptions({ queries: { retry: false } });
export function Fixture() {
  const [role, setRole] = useState("stock_entry");
  return (
    <SessionContext.Provider
      value={{
        isOwner: role === "owner",
        roles: [role],
        permissions: role === "stock_entry" ? ["inventory.receive"] : [],
        userId: "fixture",
        fullName: "Fixture Staff",
        email: "fixture@example.test",
        loading: false,
        can: (key) => role === "owner" || (role === "stock_entry" && key === "inventory.receive"),
      }}
    >
      <button
        onClick={() => {
          setRole("counter");
          qc.clear();
        }}
      >
        Switch to Counter fixture
      </button>
      <AppShell>
        <Outlet />
      </AppShell>
    </SessionContext.Provider>
  );
}
const root = createRootRoute({ component: Fixture });
const stock = createRoute({
  getParentRoute: () => root,
  path: "/inventory/receiving",
  component: StockRegistration,
});
const other = [
  "/pos",
  "/inventory",
  "/dashboard",
  "/settings",
  "/tailoring",
  "/customers",
  "/ecommerce",
  "/whatsapp",
  "/reports",
  "/audit",
  "/access",
].map((path) =>
  createRoute({ getParentRoute: () => root, path, component: () => <p>Fixture page</p> }),
);
const router = createRouter({
  routeTree: root.addChildren([stock, ...other]),
  history: createMemoryHistory({ initialEntries: ["/inventory/receiving"] }),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
Object.assign(window, { stockRegistrationCalls: calls });
