import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/shared/components/page";
import { OwnerReports } from "@/features/reports/OwnerReports";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({
    meta: [
      { title: "Audit Trail — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content: "Searchable record of every attributable action in the platform.",
      },
      { property: "og:title", content: "Audit Trail — Maqdoom's Big Mall ERP" },
      { property: "og:description", content: "Searchable record of every attributable action." },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Canonical and legacy evidence, with actual previous/new values for recorded changes."
      />
      <OwnerReports auditOnly />
    </>
  );
}
