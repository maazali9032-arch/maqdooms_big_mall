import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import { createWorkspaceQueryClient } from "@/app/providers/query-client";
import {
  createRouter,
  createRootRoute,
  RouterProvider,
  createMemoryHistory,
} from "@tanstack/react-router";
import { WorkflowTabs } from "@/shared/components/workflow-tabs";
import { OwnerDashboard } from "@/features/reports/OwnerDashboard";
import { OwnerReports } from "@/features/reports/OwnerReports";
import { printFabricLabel } from "@/features/inventory/fabric-label";
import { customerTailoringBillHtml } from "@/features/tailoring/customer-tailoring-bill";
import { calls, setFailure } from "./client";
import { TestSession } from "./session";
import "@/styles.css";

const queryClient = createWorkspaceQueryClient();
queryClient.setDefaultOptions({ queries: { retry: false } });
export function Draft({ name }: { name: string }) {
  const [value, setValue] = useState("");
  useEffect(() => {
    calls.push("mounted:" + name);
  }, [name]);
  return (
    <label>
      {name}
      <input aria-label={name} value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
  );
}
export function Fixture() {
  const [owner, setOwner] = useState(true);
  const mutation = useMutation({ mutationFn: async () => "local-fixture-only" });
  return (
    <TestSession.Provider value={{ isOwner: owner }}>
      <main>
        <button onClick={() => mutation.mutate()}>Successful fixture write</button>
        <button
          onClick={() => {
            setOwner((value) => !value);
            queryClient.clear();
          }}
        >
          Toggle Owner
        </button>
        <button
          onClick={() => {
            setFailure(true);
            void queryClient.invalidateQueries();
          }}
        >
          Fail reads
        </button>
        <button onClick={() => setFailure(false)}>Recover reads</button>
        <WorkflowTabs
          items={[
            { id: "sale", label: "Sale draft", content: <Draft name="Sale cart" /> },
            { id: "job", label: "Job draft", content: <Draft name="Job notes" /> },
          ]}
        />
        <OwnerDashboard />
        <OwnerReports />
        <div id="fixture-label">
          <p>FAB-FIXTURE</p>
          <svg width="150" height="50">
            <rect width="150" height="50" />
          </svg>
        </div>
        <button onClick={() => printFabricLabel(document.getElementById("fixture-label")!)}>
          Print fixture label
        </button>
        <div
          dangerouslySetInnerHTML={{
            __html: customerTailoringBillHtml({
              order_code: "CT-FIXTURE",
              garment: "Kurta",
              source_name: "Workshop",
              created_at: "2026-10-04",
              customer_snapshot: { name: "Test Customer" },
              final_customer_price_paise: 85000,
              issues: [{ fabric_name: "Cotton", batch_code: "B1", quantity_mm: 3000 }],
              cp_paise: 12345,
            } as never),
          }}
        />
      </main>
    </TestSession.Provider>
  );
}
const route = createRootRoute({ component: Fixture });
const router = createRouter({
  routeTree: route,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
Object.assign(window, { phase16Calls: calls });
