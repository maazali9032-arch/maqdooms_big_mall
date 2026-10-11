import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionContext } from "../stock-registration/session";
import { OwnerProduction } from "@/features/tailoring/OwnerProduction";
import { FinishedProductInventory } from "@/features/inventory/FinishedProductInventory";
import { FinishedProducts } from "@/features/tailoring/FinishedProducts";
import { calls } from "./client";
import "@/styles.css";
const qc = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
function Fixture() {
  const [role, setRole] = useState("owner"),
    [screen, setScreen] = useState("production"),
    [deny, setDeny] = useState(false);
  return (
    <SessionContext.Provider
      value={{
        isOwner: role === "owner",
        roles: [role],
        permissions: [],
        userId: role,
        fullName: role,
        email: "fixture@test",
        loading: false,
        can: (key) =>
          role === "owner" ||
          (!deny && ["stock.transfer_finished", "stock.print_barcode"].includes(key)),
      }}
    >
      <button
        onClick={() => {
          setRole("stock_entry");
          setScreen("transfer");
          qc.clear();
        }}
      >
        Stock staff fixture
      </button>
      <button
        onClick={() => {
          setDeny(!deny);
          qc.clear();
        }}
      >
        Toggle transfer permission
      </button>
      <button
        onClick={() => {
          setRole("owner");
          setScreen("inspect");
          qc.clear();
        }}
      >
        Owner scan fixture
      </button>
      {screen === "production" ? (
        <OwnerProduction />
      ) : screen === "transfer" ? (
        <FinishedProductInventory />
      ) : (
        <FinishedProducts />
      )}
    </SessionContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}>
    <Fixture />
  </QueryClientProvider>,
);
Object.assign(window, { productionCalls: calls });
