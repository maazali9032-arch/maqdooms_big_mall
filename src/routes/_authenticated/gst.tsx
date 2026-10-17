import { createFileRoute } from "@tanstack/react-router";
import { GstConfigurationPage } from "@/features/gst/GstConfigurationPage";
import { GstReport } from "@/features/gst/GstReport";
import { PageHeader } from "@/shared/components/page";

export const Route = createFileRoute("/_authenticated/gst")({
  head: () => ({
    meta: [
      { title: "GST Configuration — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content: "Owner-controlled effective-dated GST configuration and classifications.",
      },
    ],
  }),
  component: GstPage,
});

function GstPage() {
  return (
    <>
      <PageHeader
        title="GST Configuration"
        description="Configure effective-dated tax rules, invoice presentation and business GST details. Have your CA verify rates and classifications before activation."
      />
      <GstConfigurationPage />
      <div className="mt-6">
        <GstReport />
      </div>
    </>
  );
}
