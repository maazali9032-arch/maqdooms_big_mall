import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Toaster } from "sonner";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { WorkshopFabricStock } from "@/features/inventory/WorkshopFabricStock";
import { InventoryToolbar } from "@/features/inventory/InventoryToolbar";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { SessionContext } from "./session";
import { calls } from "./client";
import "@/styles.css";
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
export function App() {
  const [search, setSearch] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  const [active, setActive] = useState("fabric-stock");
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
        <Tabs value={active} onValueChange={setActive}>
          <InventoryToolbar
            activeId={active}
            showOperationalHistory
            canReceive
            isOwner
            showIncomplete
            incompleteOnly={incomplete}
            onIncompleteChange={setIncomplete}
            search={search}
            onSearchChange={setSearch}
          />
          <TabsContent value="fabric-stock">
            <WorkshopFabricStock
              search={search}
              incompleteOnly={incomplete}
              onSearchChange={setSearch}
            />
          </TabsContent>
          {[
            "thaans",
            "locations",
            "movements",
            "batches",
            "finished-products",
            "consumables",
            "archived",
          ].map((id) => (
            <TabsContent key={id} value={id}>
              {id} panel fixture
            </TabsContent>
          ))}
        </Tabs>
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
