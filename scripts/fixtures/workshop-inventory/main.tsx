import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Toaster } from "sonner";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { WorkshopFabricStock } from "@/features/inventory/WorkshopFabricStock";
import { SessionContext } from "./session";
import { calls } from "./client";
import "@/styles.css";
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
export function App() {
  const [search, setSearch] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  return (
    <SessionContext.Provider
      value={{
        isOwner: false,
        roles: ["stock_entry"],
        permissions: ["inventory.receive", "inventory.edit_thaan", "stock.print_barcode"],
        userId: "fixture",
        fullName: "Staff",
        email: "staff@example.test",
        loading: false,
        can: () => true,
      }}
    >
      <main className="mx-auto max-w-6xl space-y-4 p-4">
        <h1>Inventory</h1>
        <div className="flex flex-wrap gap-3">
          <label>
            <input
              type="checkbox"
              checked={incomplete}
              onChange={(e) => setIncomplete(e.target.checked)}
            />
            Incomplete only
          </label>
          <input
            aria-label="Upper inventory search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <WorkshopFabricStock
          search={search}
          incompleteOnly={incomplete}
          onSearchChange={setSearch}
        />
      </main>
      <Toaster />
    </SessionContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}>
    <App />
  </QueryClientProvider>,
);
Object.assign(window, { inventoryCalls: calls });
