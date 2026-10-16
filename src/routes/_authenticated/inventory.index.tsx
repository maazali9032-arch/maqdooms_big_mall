import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/app/providers/session";
import { useWorkflowRoute } from "@/shared/components/use-workflow-route";
import { PageHeader, StatCard } from "@/shared/components/page";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FabricStock } from "@/features/inventory/FabricStock";
import { FinishedProductWorkspace } from "@/features/inventory/FinishedProductWorkspace";
import { Consumables } from "@/features/inventory/Consumables";
import { LocationDefinitions } from "@/features/inventory/LocationDefinitions";
import { StockActivity } from "@/features/inventory/StockActivity";
import { FabricArchive } from "@/features/inventory/FabricArchive";
import { ShowroomFloorStock } from "@/features/inventory/ShowroomFloorStock";
import { useWorkshopInventory } from "@/features/inventory/WorkshopFabricStock";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
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
          title="Finished Products"
          description="Receive completed production at Workshop, set SP, print labels and transfer pieces to Showroom."
        />
        <FinishedProductWorkspace />
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
  const [search, setSearch] = useState(""),
    [incomplete, setIncomplete] = useState(false);
  const chosen = ["fabric-stock", "showroom-stock", "movements", "archived"].includes(active)
    ? active
    : "fabric-stock";
  return (
    <>
      <PageHeader
        title="Fabric Stock"
        description="Fabric stock grouped by batch, fabric type and individual Thaan."
      />
      {chosen === "fabric-stock" && <FabricStockSummary />}
      <Tabs value={chosen} onValueChange={onChange}>
        <TabsList
          className="mt-4 grid h-auto w-full grid-cols-2 gap-1 p-1.5 md:grid-cols-4"
          aria-label="Fabric inventory views"
        >
          {[
            ["fabric-stock", "Fabric stock & scan"],
            ["showroom-stock", "Showroom floors"],
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
        <TabsContent value="showroom-stock">
          <ShowroomFloorStock />
        </TabsContent>
        <TabsContent value="archived">
          <FabricArchive />
        </TabsContent>
      </Tabs>
    </>
  );
}
export function FabricStockSummary() {
  const query = useWorkshopInventory();
  const showroom = useQuery({
    queryKey: ["showroom-fabric-available-total"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("showroom_fabric_available_total", {});
      if (error) throw error;
      return Number(data ?? 0);
    },
  });
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Active Thaans"
        value={query.data ? query.data.filter((r) => r.status === "active").length : "—"}
      />
      <StatCard
        label="Workshop available"
        value={
          query.data
            ? formatMetres(query.data.reduce((sum, row) => sum + (row.workshop_mm ?? 0), 0))
            : "—"
        }
      />
      <StatCard
        label="Showroom available"
        value={showroom.data === undefined ? "—" : formatMetres(showroom.data)}
      />
      <StatCard
        label="Incomplete"
        value={query.data ? query.data.filter((r) => r.incomplete).length : "—"}
      />
    </div>
  );
}
