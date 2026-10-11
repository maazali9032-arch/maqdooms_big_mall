import { createFileRoute } from "@tanstack/react-router";
import { FabricTransfer } from "@/features/inventory/FabricTransfer";

import { FinishedProductInventory } from "@/features/inventory/FinishedProductInventory";

export const Route = createFileRoute("/_authenticated/inventory/transfers")({
  component: StockTransfers,
});

function StockTransfers() {
  return (
    <div className="space-y-6">
      <FabricTransfer />
      <FinishedProductInventory />
    </div>
  );
}
