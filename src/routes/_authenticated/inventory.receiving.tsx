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
          "Fabric Thaans and vendor-purchased ready-made garments with individually barcoded physical stock.",
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
        description="Scan existing fabric labels, create a fabric batch, or receive vendor readymade garments with individual F barcodes."
      />
      <StockRegistration />
    </>
  );
}
