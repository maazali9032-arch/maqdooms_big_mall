import { createFileRoute } from "@tanstack/react-router";
import { StockRegistration } from "@/features/inventory/StockRegistration";
import { PageHeader } from "@/shared/components/page";

export const Route = createFileRoute("/_authenticated/inventory/receiving")({
  head: () => ({
    meta: [
      { title: "Stock Entry — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content:
          "Fabric Thaans, vendor-purchased ready-made garments and unit-tracked tailoring materials.",
      },
    ],
  }),
  component: ReceivingPage,
});
function ReceivingPage() {
  return (
    <>
      <PageHeader
        title="Stock Entry"
        description="Scan existing labels or create a batch for fabric Thaans, vendor readymade garments or unit-tracked tailoring materials."
      />
      <StockRegistration />
    </>
  );
}
