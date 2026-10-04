import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/app/providers/session";
import { PageHeader } from "@/shared/components/page";
import { OwnerDashboard } from "@/features/reports/OwnerDashboard";
export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Owner Dashboard — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content: "Live stock, sales, tailoring and audit overview for Maqdoom's Big Mall.",
      },
      { property: "og:title", content: "Owner Dashboard — Maqdoom's Big Mall ERP" },
      { property: "og:description", content: "Live stock, sales, tailoring and audit overview." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { fullName } = useSession();
  return (
    <>
      <PageHeader
        title={"Good day, " + (fullName.split(" ")[0] || "Owner")}
        description="Current canonical stock, payment-confirmed sales today and recorded Owner review checks."
      />
      <OwnerDashboard />
    </>
  );
}
