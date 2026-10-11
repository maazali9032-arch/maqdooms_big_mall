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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionContext } from "../stock-registration/session";
import { AppShell } from "@/app/layouts/AppShell";
import { DirectFabricSale } from "@/features/pos/DirectFabricSale";
import { SalespersonWork } from "@/features/salesperson/SalespersonWork";
import { calls, setActor } from "./client";
import "@/styles.css";
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
export function Fixture() {
  const [role, setRole] = useState("counter");
  const [id, setId] = useState("counter-user");
  const permissions =
    role === "counter"
      ? [
          "pos.sell",
          "pos.enter_price",
          "pos.assign_salesperson",
          "pos.issue_to_tailoring",
          "pos.enter_tailoring_total",
        ]
      : ["salesperson.view_work"];
  function change(next: string, user: string) {
    setRole(next);
    setId(user);
    setActor(user, next);
    qc.clear();
  }
  return (
    <SessionContext.Provider
      value={{
        isOwner: role === "owner",
        roles: [role],
        permissions,
        userId: id,
        fullName: role,
        email: "fixture@test",
        loading: false,
        can: (key) => role === "owner" || permissions.includes(key),
      }}
    >
      <button onClick={() => change("salesperson", "sales-one")}>Salesperson fixture</button>
      <button onClick={() => change("salesperson", "sales-two")}>Other Salesperson fixture</button>
      <button onClick={() => change("owner", "owner-user")}>Owner fixture</button>
      <AppShell>
        <Outlet />
      </AppShell>
    </SessionContext.Provider>
  );
}
const root = createRootRoute({ component: Fixture });
const pos = createRoute({ getParentRoute: () => root, path: "/pos", component: DirectFabricSale });
const work = createRoute({
  getParentRoute: () => root,
  path: "/my-work",
  component: SalespersonWork,
});
const other = [
  "/settings",
  "/dashboard",
  "/inventory",
  "/access",
  "/reports",
  "/audit",
  "/tailoring",
  "/customers",
].map((path) =>
  createRoute({ getParentRoute: () => root, path, component: () => <p>Fixture page</p> }),
);
const router = createRouter({
  routeTree: root.addChildren([pos, work, ...other]),
  history: createMemoryHistory({ initialEntries: ["/pos"] }),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
Object.assign(window, { salespersonCalls: calls });
