import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/shared/components/page";
import { OwnerReports } from "@/features/reports/OwnerReports";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content: "Inventory, sales and tailoring reporting for Maqdoom's Big Mall.",
      },
      { property: "og:title", content: "Reports — Maqdoom's Big Mall ERP" },
      { property: "og:description", content: "Inventory, sales and tailoring reporting." },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Owner reports"
        description="Canonical stock, transactions, production, financial history and Owner review controls."
      />
      <OwnerReports />
    </>
  );
}
