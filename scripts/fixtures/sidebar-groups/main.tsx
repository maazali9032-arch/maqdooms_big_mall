import { OwnerProduction } from "@/features/tailoring/OwnerProduction";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { AppShell } from "@/app/layouts/AppShell";
import { WorkflowTabs } from "@/shared/components/workflow-tabs";
import { useWorkflowRoute } from "@/shared/components/use-workflow-route";
import { SalesHistory } from "@/features/pos/SalesHistory";
import { SessionContext } from "../stock-registration/session";
import "@/styles.css";
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Draft({ name }: { name: string }) {
  const [value, setValue] = useState("");
  return (
    <label>
      {name}
      <input aria-label={name} value={value} onChange={(e) => setValue(e.target.value)} />
    </label>
  );
}
function Workflows() {
  const navigation = useWorkflowRoute();
  return (
    <WorkflowTabs
      {...navigation}
      items={[
        ...[
          "customer",
          "production",
          "cost",
          "products",
          "issues",
          "hierarchy",
          "catalog",
          "fabric-stock",
          "consumables",
          "finished-products",
          "locations",
        ].map((id) => ({
          id,
          label: `Fixture ${id}`,
          content:
            id === "catalog" ? <OwnerProduction catalogOnly /> : <Draft name={`${id} draft`} />,
        })),
        { id: "history", label: "Fixture history", content: <SalesHistory /> },
      ]}
    />
  );
}
function Fixture() {
  const [role, setRole] = useState("owner"),
    [deny, setDeny] = useState(false);
  const permissions = deny
    ? []
    : role === "stock_entry"
      ? ["stock.transfer_finished"]
      : role === "salesperson"
        ? ["salesperson.view_work"]
        : [];
  return (
    <SessionContext.Provider
      value={{
        isOwner: role === "owner",
        roles: [role],
        permissions,
        userId: "fixture",
        fullName: "Fixture User",
        email: "test@fixture",
        loading: false,
        can: (key) => role === "owner" || permissions.includes(key),
      }}
    >
      <AppShell>
        <div className="flex flex-wrap gap-2">
          {["owner", "counter", "tailor", "stock_entry", "salesperson"].map((value) => (
            <button
              key={value}
              onClick={() => {
                setRole(value);
                setDeny(false);
                qc.clear();
              }}
            >
              Use {value}
            </button>
          ))}
          <button onClick={() => setDeny(!deny)}>Toggle permissions</button>
        </div>
        <Outlet />
      </AppShell>
    </SessionContext.Provider>
  );
}
const root = createRootRoute({ component: Fixture });
const children = [
  "/dashboard",
  "/inventory",
  "/inventory/receiving",
  "/inventory/transfers",
  "/pos",
  "/tailoring",
  "/reports",
  "/audit",
  "/settings",
  "/access",
  "/customers",
  "/my-work",
  "/ecommerce",
  "/whatsapp",
].map((path) => createRoute({ getParentRoute: () => root, path, component: Workflows }));
const router = createRouter({
  routeTree: root.addChildren(children),
  history: createMemoryHistory({ initialEntries: ["/dashboard"] }),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
