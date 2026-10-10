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
import { FabricTransfer } from "@/features/inventory/FabricTransfer";
import { DirectFabricSale } from "@/features/pos/DirectFabricSale";
import { UserPermissions } from "@/features/access/UserPermissions";
import { calls } from "./client";
import "@/styles.css";
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
export function Fixture() {
  const [role, setRole] = useState("stock_entry");
  const [deny, setDeny] = useState(false);
  const permissions =
    role === "stock_entry"
      ? deny
        ? []
        : ["stock.transfer", "stock.print_barcode"]
      : ["pos.sell", "pos.enter_price"];
  return (
    <SessionContext.Provider
      value={{
        isOwner: role === "owner",
        roles: [role],
        permissions,
        userId: "fixture",
        fullName: "Fixture Staff",
        email: "fixture@test",
        loading: false,
        can: (key) => role === "owner" || permissions.includes(key),
      }}
    >
      <button
        onClick={() => {
          setRole("counter");
          qc.clear();
        }}
      >
        Counter fixture
      </button>
      <button
        onClick={() => {
          setRole("owner");
          qc.clear();
        }}
      >
        Owner fixture
      </button>
      <button onClick={() => setDeny(true)}>Revoke transfer fixture</button>
      <AppShell>
        <Outlet />
      </AppShell>
    </SessionContext.Provider>
  );
}
const root = createRootRoute({ component: Fixture });
const transfer = createRoute({
  getParentRoute: () => root,
  path: "/inventory/transfers",
  component: FabricTransfer,
});
const pos = createRoute({ getParentRoute: () => root, path: "/pos", component: DirectFabricSale });
const access = createRoute({
  getParentRoute: () => root,
  path: "/access",
  component: UserPermissions,
});
const other = ["/inventory", "/settings", "/dashboard", "/inventory/receiving"].map((path) =>
  createRoute({ getParentRoute: () => root, path, component: () => <p>Fixture page</p> }),
);
const router = createRouter({
  routeTree: root.addChildren([transfer, pos, access, ...other]),
  history: createMemoryHistory({ initialEntries: ["/inventory/transfers"] }),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
Object.assign(window, { revisionCalls: calls });
