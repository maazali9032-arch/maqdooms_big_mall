import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { SessionContext, ROLE_LABELS } from "./session";
import { calls, setRoles } from "./client";
import { sidebarSections } from "@/app/access/sidebar";
import { OwnerProduction } from "@/features/tailoring/OwnerProduction";
import { ProductionReceipt } from "@/features/inventory/ProductionReceipt";
import { ProductionFabricIssue } from "@/features/pos/ProductionFabricIssue";
import { AccountSettings } from "@/features/access/AccountSettings";
import { CreateStaff } from "@/features/access/CreateStaff";
import { ShowroomStock } from "@/features/ecommerce/ShowroomStock";
import "@/styles.css";
const qc = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const defaults: Record<string, string[]> = {
  stock_entry: [
    "inventory.receive",
    "stock.transfer",
    "stock.transfer_finished",
    "stock.print_barcode",
    "production.receive",
    "stock.price_finished",
  ],
  counter: ["production.view", "production.create", "pos.issue_to_tailoring"],
  production: ["production.view", "production.create", "production.progress"],
  salesperson: ["salesperson.view_work"],
};
function Fixture() {
  const [roles, updateRoles] = useState(["production"]);
  const [screen, setScreen] = useState("production");
  const [addStaff, setAddStaff] = useState(false);
  const permissions = [...new Set(roles.flatMap((r) => defaults[r] ?? []))];
  const owner = roles.includes("owner");
  return (
    <SessionContext.Provider
      value={{
        isOwner: owner,
        roles,
        permissions,
        userId: roles[0]!,
        fullName: "Fixture Name",
        email: "fixture@fixture.test",
        loading: false,
        status: "authenticated",
        can: (key) => owner || permissions.includes(key),
        refresh: async () => {
          calls.push({ name: "refresh", args: {} });
        },
        signOut: async () => {},
      }}
    >
      <main className="mx-auto max-w-7xl space-y-4 p-3">
        <div className="flex flex-wrap gap-2">
          {Object.keys(ROLE_LABELS).map((role) => (
            <button
              key={role}
              onClick={() => {
                updateRoles([role]);
                setRoles([role]);
                qc.clear();
              }}
            >
              Use {role}
            </button>
          ))}
          <button
            onClick={() => {
              updateRoles(["stock_entry", "counter"]);
              setRoles(["stock_entry", "counter"]);
              qc.clear();
            }}
          >
            Use combined
          </button>
        </div>
        <nav aria-label="Role sidebar" className="flex flex-wrap gap-3">
          {sidebarSections(roles, permissions)
            .flatMap((s) => s.items)
            .map((i) => (
              <a key={i.to + (i.hash ?? "")} href={i.to + (i.hash ? `#${i.hash}` : "")}>
                {i.label}
              </a>
            ))}
        </nav>
        <div className="flex flex-wrap gap-2">
          {["production", "receipt", "extra", "account", "ecom"].map((value) => (
            <button
              key={value}
              onClick={() => {
                setScreen(value);
                qc.clear();
              }}
            >
              Screen {value}
            </button>
          ))}
          {owner && <button onClick={() => setAddStaff(true)}>Add staff fixture</button>}
        </div>
        {screen === "production" && <OwnerProduction mode="create" />}
        {screen === "receipt" && <ProductionReceipt />}
        {screen === "extra" && <ProductionFabricIssue />}
        {screen === "account" && <AccountSettings />}
        {screen === "ecom" && <ShowroomStock kind="fabric" onManageListings={() => {}} />}
        {addStaff && <CreateStaff onClose={() => setAddStaff(false)} />}
      </main>
      <Toaster />
    </SessionContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}>
    <Fixture />
  </QueryClientProvider>,
);
Object.assign(window, { roleCalls: calls });
