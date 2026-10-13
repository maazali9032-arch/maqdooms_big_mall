import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { StockRegistration } from "@/features/inventory/StockRegistration";
import { Route } from "@/routes/_authenticated/inventory.transfers";
import { SessionContext } from "../workshop-inventory/session";
import "@/styles.css";
const Transfer = Route.options.component!;
function App() {
  const [transfer, setTransfer] = useState(false);
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
        <button onClick={() => setTransfer(false)}>Entry view</button>
        <button onClick={() => setTransfer(true)}>Transfer view</button>
        {transfer ? <Transfer /> : <StockRegistration />}
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
