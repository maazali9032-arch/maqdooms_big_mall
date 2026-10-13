import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { StockRegistration } from "@/features/inventory/StockRegistration";
import { WorkshopFabricStock } from "@/features/inventory/WorkshopFabricStock";
import { ScannedThaanRows } from "@/features/inventory/ScannedThaanRows";
import { SessionContext } from "../workshop-inventory/session";
import "@/styles.css";
function App() {
  const [view, setView] = useState("entry"),
    [search, setSearch] = useState(""),
    [incomplete, setIncomplete] = useState(false);
  return (
    <SessionContext.Provider
      value={{
        userId: "staff",
        fullName: "Stock Staff",
        email: "staff@example.test",
        roles: ["stock_entry"],
        permissions: [],
        isOwner: false,
        loading: false,
        can: () => true,
      }}
    >
      <main className="mx-auto max-w-6xl space-y-4 p-4">
        <nav className="flex gap-3">
          {["entry", "inventory", "scanner"].map((v) => (
            <button key={v} onClick={() => setView(v)}>
              {v} view
            </button>
          ))}
        </nav>
        {view === "entry" ? (
          <StockRegistration />
        ) : view === "inventory" ? (
          <WorkshopFabricStock
            search={search}
            onSearchChange={setSearch}
            incompleteOnly={incomplete}
            onIncompleteChange={setIncomplete}
          />
        ) : (
          <ScannedThaanRows />
        )}
      </main>
      <Toaster />
    </SessionContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <App />
  </QueryClientProvider>,
);
