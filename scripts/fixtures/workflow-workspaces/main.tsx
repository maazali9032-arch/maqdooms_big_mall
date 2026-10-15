import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { SessionContext } from "../workshop-inventory/session";
import { CounterWorkspace } from "@/features/pos/CounterWorkspace";
import { MixedProduction } from "@/features/tailoring/MixedProduction";
import { ProductionOngoing } from "@/features/tailoring/ProductionOngoing";
import { CustomerTailoringWork } from "@/features/tailoring/CustomerTailoringWork";
import { OwnerFactoryDefinitions } from "@/features/tailoring/OwnerFactoryDefinitions";
import { ProductDesignDefinitions } from "@/features/tailoring/ProductDesignDefinitions";
import { sidebarSections } from "@/app/access/sidebar";
import { FinishedProductWorkspace } from "@/features/inventory/FinishedProductWorkspace";
import { FabricStockSummary } from "@/routes/_authenticated/inventory.index";
import "@/styles.css";
const params = new URLSearchParams(location.search),
  role = params.get("role") ?? "owner",
  view = params.get("view") ?? "pos";
const permissions = [
  "pos.sell",
  "pos.issue_to_tailoring",
  "pos.enter_tailoring_total",
  "pos.assign_salesperson",
  "pos.enter_price",
  "production.create",
  "production.view",
  "production.progress",
  "tailoring.manage_jobs",
  "stock.transfer",
  "stock.transfer_finished",
  "production.receive",
  "stock.price_finished",
];
permissions.push("stock.print_barcode");
const session = {
  userId: "fixture",
  fullName: "Fixture",
  email: "fixture@example.test",
  loading: false,
  isOwner: role === "owner",
  roles: [role],
  permissions,
  can: (p: string) =>
    (![
      "production.receive",
      "stock.price_finished",
      "stock.transfer_finished",
      "stock.print_barcode",
    ].includes(p) ||
      ["owner", "stock_entry"].includes(role)) &&
    permissions.includes(p),
};
const sections = sidebarSections([role], permissions);
const component =
  view === "finished" ? (
    <FinishedProductWorkspace />
  ) : view === "stock-cards" ? (
    <FabricStockSummary />
  ) : view === "production" ? (
    <MixedProduction />
  ) : view === "ongoing" ? (
    <ProductionOngoing />
  ) : view === "customer" ? (
    <CustomerTailoringWork />
  ) : view === "factory" ? (
    <OwnerFactoryDefinitions />
  ) : view === "definitions" ? (
    <ProductDesignDefinitions />
  ) : (
    <CounterWorkspace />
  );
createRoot(document.getElementById("root")!).render(
  <SessionContext.Provider value={session}>
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <main className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-6">
        <h1 className="font-semibold">Disposable browser fixture</h1>
        <nav aria-label="Role navigation" className="flex flex-wrap gap-2 text-xs">
          {sections.map((s) => (
            <div key={s.label}>
              <strong>{s.label}</strong>
              {s.items.map((i) => (
                <span className="ml-2" key={i.to + (i.hash ?? "")}>
                  {i.label}
                </span>
              ))}
            </div>
          ))}
        </nav>
        {component}
      </main>
      <Toaster />
    </QueryClientProvider>
  </SessionContext.Provider>,
);
