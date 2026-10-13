import { createFileRoute } from "@tanstack/react-router";
import { FabricTransfer } from "@/features/inventory/FabricTransfer";

export const Route = createFileRoute("/_authenticated/inventory/transfers")({
  component: FabricTransfer,
});
