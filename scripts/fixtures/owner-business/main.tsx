import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OwnerReports } from "@/features/reports/OwnerReports";
import { OwnerAudit } from "@/features/reports/OwnerAudit";
import { OwnerDashboard } from "@/features/reports/OwnerDashboard";
import { SessionContext } from "../workshop-inventory/session";
import "@/styles.css";
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <SessionContext.Provider
      value={{
        userId: "owner",
        fullName: "Owner",
        email: "owner@example.test",
        roles: ["owner"],
        permissions: [],
        isOwner: !location.search.includes("staff=1"),
        loading: false,
        can: () => true,
      }}
    >
      <main className="mx-auto max-w-7xl space-y-4 p-4">
        {location.search.includes("audit=1") ? (
          <OwnerAudit />
        ) : location.search.includes("reports=1") ? (
          <OwnerReports initialDataset={location.hash.slice(1)} />
        ) : (
          <OwnerDashboard />
        )}
      </main>
    </SessionContext.Provider>
  </QueryClientProvider>,
);
