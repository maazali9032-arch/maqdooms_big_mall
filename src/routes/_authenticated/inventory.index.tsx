import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/app/providers/session";
import { useWorkflowRoute } from "@/shared/components/use-workflow-route";
import { PageHeader, StatCard } from "@/shared/components/page";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FabricStock } from "@/features/inventory/FabricStock";
import { FinishedProductInventory } from "@/features/inventory/FinishedProductInventory";
import { Consumables } from "@/features/inventory/Consumables";
import { LocationDefinitions } from "@/features/inventory/LocationDefinitions";
import { StockActivity } from "@/features/inventory/StockActivity";
import { FabricArchive } from "@/features/inventory/FabricArchive";
import { useWorkshopInventory } from "@/features/inventory/WorkshopFabricStock";
import { useState } from "react";
import { formatMetres } from "@/shared/utils/units";
export const Route = createFileRoute("/_authenticated/inventory/")({
  head: () => ({ meta: [{ title: "Inventory — Maqdoom's Big Mall ERP" }] }),
  component: InventoryPage,
});
function InventoryPage() {
  const nav = useWorkflowRoute(),
    { isOwner } = useSession();
  if (nav.activeId === "finished-products")
    return (
      <>
        <PageHeader
          title="Finished products"
          description="Receive completed production at Workshop, set SP, print labels and transfer pieces to Showroom."
        />
        <FinishedProductInventory />
      </>
    );
  if (nav.activeId === "consumables")
    return (
      <>
        <PageHeader
          title="Materials & Consumables"
          description="Materials used for tailoring and production."
        />
        <Consumables />
      </>
    );
  if (nav.activeId === "locations")
    return isOwner ? (
      <>
        <PageHeader title="Locations & Floors" description="Owner-defined Showroom floors." />
        <LocationDefinitions />
      </>
    ) : (
      <p>Owner access required.</p>
    );
  return <StockInventory active={nav.activeId} onChange={nav.onChange} />;
}
function StockInventory({ active, onChange }: { active: string; onChange: (id: string) => void }) {
  const query = useWorkshopInventory();
  const [search, setSearch] = useState(""),
    [incomplete, setIncomplete] = useState(false);
  const chosen = ["fabric-stock", "movements", "archived"].includes(active)
    ? active
    : "fabric-stock";
  return (
    <>
      <PageHeader
        title="Fabric Stock"
        description="Workshop stock grouped by batch, fabric type and individual Thaan."
      />
      {chosen === "fabric-stock" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Active Thaans"
            value={query.data ? query.data.filter((r) => r.status === "active").length : "—"}
          />
          <StatCard
            label="Workshop available"
            value={
              query.data
                ? formatMetres(query.data.reduce((s, r) => s + (r.workshop_mm ?? 0), 0))
                : "—"
            }
          />
          <StatCard
            label="Incomplete"
            value={query.data ? query.data.filter((r) => r.incomplete).length : "—"}
          />
        </div>
      )}
      <Tabs value={chosen} onValueChange={onChange}>
        <TabsList
          className="mt-4 grid h-auto w-full grid-cols-3 gap-1 p-1.5"
          aria-label="Fabric inventory views"
        >
          {[
            ["fabric-stock", "Fabric stock & scan"],
            ["movements", "Stock movements"],
            ["archived", "Depleted / archived"],
          ].map(([id, label]) => (
            <TabsTrigger key={id} value={id!} className="min-h-11 whitespace-normal px-2">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="fabric-stock">
          <FabricStock
            search={search}
            onSearchChange={setSearch}
            incompleteOnly={incomplete}
            onIncompleteChange={setIncomplete}
          />
        </TabsContent>
        <TabsContent value="movements">
          <StockActivity />
        </TabsContent>
        <TabsContent value="archived">
          <FabricArchive />
        </TabsContent>
      </Tabs>
    </>
  );
}
