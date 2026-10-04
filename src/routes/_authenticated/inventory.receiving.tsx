import { createFileRoute } from "@tanstack/react-router";
import { FabricStock } from "@/features/inventory/FabricStock";
import { PageHeader } from "@/shared/components/page";

export const Route = createFileRoute("/_authenticated/inventory/receiving")({
  head: () => ({
    meta: [
      { title: "Fabric Stock Entry — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content:
          "Receive internal Thans into Workshop with one Fabric + Batch barcode. SP can be added later.",
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
        description="Enter Fabric, Batch, Than lengths and CP / Lagat. Generate and print one Fabric Barcode."
      />
      <FabricStock receiving />
    </>
  );
}
