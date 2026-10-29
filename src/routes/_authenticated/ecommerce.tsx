import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, Panel } from "@/shared/components/page";
import { useWorkflowRoute } from "@/shared/components/use-workflow-route";
import { useSession } from "@/app/providers/session";
import { ProductCatalogue } from "@/features/ecommerce/ProductCatalogue";
import { PublishByScan } from "@/features/ecommerce/PublishByScan";
import { CategoriesManager } from "@/features/ecommerce/CategoriesManager";
import { StoreSettings } from "@/features/ecommerce/StoreSettings";

export const Route = createFileRoute("/_authenticated/ecommerce")({
  head: () => ({ meta: [{ title: "E-commerce — Maqdoom's Big Mall ERP" }] }),
  component: EcommercePage,
});

const TABS = [
  ["catalogue", "Product Catalogue"],
  ["publish", "Publish by scan"],
  ["categories", "Categories"],
  ["orders", "Orders & Fulfilment"],
  ["shipping", "Shipping & Logistics"],
  ["returns", "Returns, Exchanges & Refunds"],
  ["customers", "Customers & Loyalty"],
  ["settings", "Store settings"],
  ["reports", "Reports"],
] as const;
type TabId = (typeof TABS)[number][0];

/** Older sidebar links ("#fabric", "#products") now open Publish by scan. */
function normalise(hash: string): TabId {
  if (hash === "fabric" || hash === "products") return "publish";
  return (TABS.find(([id]) => id === hash)?.[0] ?? "catalogue") as TabId;
}

function ComingWithOnlineOrders({ title, what }: { title: string; what: string }) {
  return (
    <Panel title={title}>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Coming with online orders. The first release takes orders on WhatsApp, so there is nothing
        to manage here yet. {what}
      </p>
    </Panel>
  );
}

function EcommercePage() {
  const nav = useWorkflowRoute();
  const { isOwner } = useSession();
  const active = normalise(nav.activeId);
  const visible = TABS.filter(([id]) => isOwner || id !== "reports");
  return (
    <>
      <PageHeader
        title="E-commerce"
        description="Decide what appears on the website. Products are built from showroom stock by scanning; stock and prices stay in the ERP."
      />
      <Tabs value={active} onValueChange={nav.onChange} className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
          {visible.map(([id, label]) => (
            <TabsTrigger key={id} value={id} className="min-h-10 whitespace-normal px-2">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="catalogue">
          <ProductCatalogue onPublishNew={() => nav.onChange("publish")} />
        </TabsContent>
        <TabsContent value="publish">
          <PublishByScan />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesManager />
        </TabsContent>
        <TabsContent value="orders">
          <ComingWithOnlineOrders
            title="Orders & Fulfilment"
            what="When online payment is added, paid orders will appear here and use the same stock ledger as the showroom."
          />
        </TabsContent>
        <TabsContent value="shipping">
          <ComingWithOnlineOrders
            title="Shipping & Logistics"
            what="Courier, packing and tracking will be managed here."
          />
        </TabsContent>
        <TabsContent value="returns">
          <ComingWithOnlineOrders
            title="Returns, Exchanges & Refunds"
            what="Online returns will reuse the existing defective-return and exchange records."
          />
        </TabsContent>
        <TabsContent value="customers">
          <ComingWithOnlineOrders
            title="Customers & Loyalty"
            what="Online customer accounts will link to the existing customer records."
          />
        </TabsContent>
        <TabsContent value="settings">
          <StoreSettings />
        </TabsContent>
        {isOwner ? (
          <TabsContent value="reports">
            <Panel title="Reports">
              <p className="text-sm text-muted-foreground">
                Online sales reports appear here once online orders exist. Showroom revenue stays on
                the Owner dashboard.
              </p>
            </Panel>
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}
