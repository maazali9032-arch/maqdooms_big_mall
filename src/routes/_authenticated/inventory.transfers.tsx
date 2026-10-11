import { WorkflowTabs } from "@/shared/components/workflow-tabs";
import { useWorkflowRoute } from "@/shared/components/use-workflow-route";
import { useSession } from "@/app/providers/session";
import { createFileRoute } from "@tanstack/react-router";
import { FabricTransfer } from "@/features/inventory/FabricTransfer";

import { FinishedProductInventory } from "@/features/inventory/FinishedProductInventory";

export const Route = createFileRoute("/_authenticated/inventory/transfers")({
  component: StockTransfers,
});

function StockTransfers() {
  const navigation = useWorkflowRoute();
  const { isOwner, can } = useSession();
  return (
    <WorkflowTabs
      {...navigation}
      items={[
        ...(isOwner || can("stock.transfer")
          ? [{ id: "fabric", label: "Fabric Transfers", content: <FabricTransfer /> }]
          : []),
        ...(isOwner || can("stock.transfer_finished")
          ? [
              {
                id: "products",
                label: "Finished Product Transfers",
                content: <FinishedProductInventory />,
              },
            ]
          : []),
      ]}
    />
  );
}
