import { createFileRoute } from "@tanstack/react-router";
import { StockRegistration } from "@/features/inventory/StockRegistration";
import { PageHeader } from "@/shared/components/page";

export const Route = createFileRoute("/_authenticated/inventory/receiving")({
  head: () => ({
    meta: [
      { title: "Fabric Stock Entry — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content:
          "Provider delivery batches, Fabric Types and individually barcoded Thans with optional CP.",
      },
    ],
  }),
  component: ReceivingPage,
});
function ReceivingPage() {
  return (
    <>
      <PageHeader
        title="Fabric Stock Entry"
        description="Scan existing fabric labels or create a batch, print labels by fabric type, then measure each Thaan."
      />
      <StockRegistration />
    </>
  );
}
