import { createFileRoute } from "@tanstack/react-router";
import { useWorkflowRoute } from "@/shared/components/use-workflow-route";
import { useSession } from "@/app/providers/session";
import { PageHeader } from "@/shared/components/page";
import { CustomerTailoringWork } from "@/features/tailoring/CustomerTailoringWork";
import { MixedProduction } from "@/features/tailoring/MixedProduction";
import { ProductionOngoing } from "@/features/tailoring/ProductionOngoing";
import { OwnerFactoryDefinitions } from "@/features/tailoring/OwnerFactoryDefinitions";
import { ProductDesignDefinitions } from "@/features/tailoring/ProductDesignDefinitions";
import { ProductionReceipt } from "@/features/inventory/ProductionReceipt";
import { TailorMaterialWork } from "@/features/tailoring/TailorMaterialWork";
export const Route = createFileRoute("/_authenticated/tailoring")({
  head: () => ({ meta: [{ title: "Tailoring & Production — Maqdoom's Big Mall ERP" }] }),
  component: TailoringPage,
});
function TailoringPage() {
  const { activeId } = useWorkflowRoute();
  const { isOwner, can, roles } = useSession();
  const id =
    activeId ||
    (roles.includes("tailor_staff")
      ? "work"
      : roles.includes("production") && !isOwner
        ? "fabric"
        : "customer");
  const view =
    id === "hierarchy"
      ? {
          title: "Factories & Tailors",
          content: isOwner ? <OwnerFactoryDefinitions /> : <p>Owner access required.</p>,
        }
      : id === "catalog"
        ? {
            title: "Products & Designs",
            content: isOwner ? <ProductDesignDefinitions /> : <p>Owner access required.</p>,
          }
        : id === "work"
          ? {
              title:
                roles.includes("tailor_staff") && !roles.includes("tailor")
                  ? "My Work"
                  : "Record Completed Work",
              content: <TailorMaterialWork />,
            }
          : id === "fabric"
            ? { title: "New Production", content: <MixedProduction /> }
            : id === "receipt"
              ? {
                  title: "Workshop Receipt",
                  content:
                    isOwner || can("production.receive") ? (
                      <ProductionReceipt />
                    ) : (
                      <p>Workshop receipt access required.</p>
                    ),
                }
              : id === "customer"
                ? { title: "Customer Tailoring", content: <CustomerTailoringWork /> }
                : { title: "Ongoing Production", content: <ProductionOngoing /> };
  return (
    <>
      <PageHeader
        title={view.title}
        description={
          id === "hierarchy" || id === "catalog"
            ? "Owner administration · shared work definitions"
            : "Recorded work and its linked fabric."
        }
      />
      {view.content}
    </>
  );
}
