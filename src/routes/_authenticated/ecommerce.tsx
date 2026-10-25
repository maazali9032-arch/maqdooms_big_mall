import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CircleDollarSign,
  CloudCog,
  Eye,
  Image,
  PackageCheck,
  ShoppingCart,
  Truck,
  Users,
} from "lucide-react";
import { ListingEditor, type EditableListing } from "@/features/ecommerce/ListingEditor";
import {
  useHolds,
  useListingAvailability,
  useListings,
  useOnlineOrders,
  useTogglePublish,
  useUpdateOrderStatus,
  useLinkedShowroomStock,
} from "@/features/ecommerce";
import { ShowroomStock } from "@/features/ecommerce/ShowroomStock";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DemoNotice,
  EmptyState,
  PageHeader,
  Panel,
  StatCard,
  StatusBadge,
} from "@/shared/components/page";
import { useWorkflowRoute } from "@/shared/components/use-workflow-route";
import { useSession } from "@/app/providers/session";
import { formatDateTime } from "@/shared/utils/format";
import { formatMetres, formatMoney } from "@/shared/utils/units";

export const Route = createFileRoute("/_authenticated/ecommerce")({
  head: () => ({ meta: [{ title: "E-commerce Management — Maqdoom's Big Mall ERP" }] }),
  component: EcommercePage,
});

type Listing = EditableListing & {
  id: string;
  title: string;
  category: string | null;
  collection: string | null;
  description: string | null;
  images: string[];
  price_paise: number | null;
  sale_price_paise: number | null;
  stock_mode: string;
  published: boolean;
};

function EcommercePage() {
  const navigation = useWorkflowRoute();
  const { isOwner } = useSession();
  const listings = useListings(),
    availability = useListingAvailability(),
    linkedStock = useLinkedShowroomStock(),
    orders = useOnlineOrders(),
    holds = useHolds();
  const togglePublish = useTogglePublish(),
    updateOrder = useUpdateOrderStatus();
  const [editing, setEditing] = useState<EditableListing | null | undefined>(undefined);
  const listingRows = (listings.data ?? []) as Listing[];
  const orderRows = useMemo(() => orders.data ?? [], [orders.data]);
  const holdRows = holds.data ?? [];
  const availabilityMap = new Map((availability.data ?? []).map((row) => [row.listing_id, row]));
  const linkedMap = new Map((linkedStock.data ?? []).map((row) => [row.listing_id, row]));
  const customers = useMemo(() => {
    const map = new Map<
      string,
      { name: string; phone: string | null; orders: number; spent: number }
    >();
    for (const order of orderRows) {
      const key = `${order.customer_name}|${order.phone ?? ""}`;
      const row = map.get(key) ?? {
        name: order.customer_name,
        phone: order.phone,
        orders: 0,
        spent: 0,
      };
      row.orders += 1;
      row.spent += order.amount_paise ?? 0;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.spent - a.spent);
  }, [orderRows]);
  const fulfilledRevenue = orderRows
    .filter((row) => row.status === "fulfilled")
    .reduce((sum, row) => sum + (row.amount_paise ?? 0), 0);
  const incompleteListings = listingRows.filter(
    (row) => !row.images?.length || !row.price_paise || !row.description,
  );

  if (
    navigation.activeId === "fabric" ||
    navigation.activeId === "products" ||
    (!isOwner && !navigation.activeId)
  )
    return (
      <>
        <PageHeader
          title="E-commerce"
          description="Choose eligible Showroom stock for the online catalogue."
        />
        <ShowroomStock
          key={navigation.activeId}
          kind={navigation.activeId === "products" ? "product" : "fabric"}
          onManageListings={() => navigation.onChange("listings")}
        />
      </>
    );

  const listingCards = (
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      {listingRows.map((listing) => {
        const available = availabilityMap.get(listing.id),
          linked = linkedMap.get(listing.id);
        return (
          <article key={listing.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="aspect-[16/7] bg-muted">
              {listing.images?.[0] ? (
                <img src={listing.images[0]} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <Image className="mr-2 size-5" />
                  No catalogue image
                </div>
              )}
            </div>
            <div className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold">{listing.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    {listing.category ?? "Uncategorised"} · {listing.collection ?? "No collection"}
                  </p>
                </div>
                <StatusBadge status={listing.published ? "published" : "draft"} />
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {listing.description || "Online description is still missing."}
              </p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="label-eyebrow">Online price</p>
                  <strong>
                    {listing.price_paise ? formatMoney(listing.price_paise) : "Not set"}
                  </strong>
                </div>
                <div>
                  <p className="label-eyebrow">Available</p>
                  <strong>
                    {linked?.kind === "product"
                      ? `${linked.stock.length} pc`
                      : listing.stock_mode === "linked"
                        ? formatMetres(available?.largest_piece_mm ?? 0)
                        : "Manual"}
                  </strong>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(listing)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    togglePublish.mutate({ id: listing.id, published: !listing.published })
                  }
                >
                  {listing.published ? "Unpublish" : "Publish"}
                </Button>
              </div>
            </div>
          </article>
        );
      })}
      {!listingRows.length ? (
        <EmptyState
          title="No online products"
          description="Create a listing from eligible ERP stock."
        />
      ) : null}
    </div>
  );

  return (
    <>
      <PageHeader
        title="E-commerce Management"
        description="Manage the online catalogue, orders, fulfilment, customers and stock integration from one workspace."
        actions={<Button onClick={() => setEditing(null)}>Add product</Button>}
      />
      {editing !== undefined ? (
        <ListingEditor listing={editing} onClose={() => setEditing(undefined)} />
      ) : null}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10">
          {[
            ["overview", "Overview"],
            ["catalogue", "Catalogue"],
            ["publish", "Publish"],
            ["pricing", "Pricing"],
            ["orders", "Orders"],
            ["shipping", "Shipping"],
            ["customers", "Customers"],
            ["content", "Content"],
            ["reports", "Reports"],
            ["health", "Health"],
          ].map(([id, label]) => (
            <TabsTrigger key={id} value={id} className="min-h-10 whitespace-normal px-2">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Online orders" value={orderRows.length} icon={ShoppingCart} />
            <StatCard
              label="Online revenue"
              value={formatMoney(fulfilledRevenue)}
              icon={CircleDollarSign}
            />
            <StatCard
              label="Products published"
              value={listingRows.filter((row) => row.published).length}
              icon={Boxes}
            />
            <StatCard
              label="Open fulfilment"
              value={
                orderRows.filter((row) => ["new", "picking", "picked"].includes(row.status)).length
              }
              icon={PackageCheck}
            />
            <StatCard
              label="Catalogue issues"
              value={incompleteListings.length}
              icon={AlertTriangle}
              tone={incompleteListings.length ? "warning" : "success"}
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <Panel
              title="Product catalogue"
              description="Online products and their live stock state."
              actions={
                <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                  Add product
                </Button>
              }
            >
              {listingCards}
            </Panel>
            <div className="space-y-4">
              <Panel title="Recent online orders" bodyClassName="p-0">
                <div className="divide-y">
                  {orderRows.slice(0, 6).map((order) => (
                    <div key={order.id} className="flex items-center gap-3 p-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <strong className="font-mono text-xs">{order.order_no}</strong>
                        <p className="truncate text-muted-foreground">{order.customer_name}</p>
                      </div>
                      <span>{formatMoney(order.amount_paise)}</span>
                      <StatusBadge status={order.status} />
                    </div>
                  ))}
                  {!orderRows.length ? <EmptyState title="No online orders" /> : null}
                </div>
              </Panel>
              <Panel title="Integration health">
                <div className="space-y-2 text-sm">
                  <p className="flex justify-between">
                    <span>Linked listings</span>
                    <strong>{linkedMap.size}</strong>
                  </p>
                  <p className="flex justify-between">
                    <span>Active checkout holds</span>
                    <strong>{holdRows.filter((row) => row.status === "active").length}</strong>
                  </p>
                  <p className="flex justify-between">
                    <span>Missing content or price</span>
                    <strong>{incompleteListings.length}</strong>
                  </p>
                </div>
              </Panel>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="catalogue" className="space-y-4">
          <DemoNotice>
            Catalogue products remain linked to ERP stock; publishing never creates duplicate
            inventory.
          </DemoNotice>
          {listingCards}
        </TabsContent>
        <TabsContent value="publish">
          <Panel
            title="Publish & visibility"
            description="Publish only catalogue-ready products. Changes preserve ERP stock links."
            bodyClassName="p-0"
          >
            <div className="divide-y">
              {listingRows.map((listing) => (
                <div key={listing.id} className="flex flex-wrap items-center gap-3 p-4">
                  <Eye className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <strong>{listing.title}</strong>
                    <p className="text-xs text-muted-foreground">
                      {listing.collection ?? "No collection"} · {listing.images?.length ?? 0} images
                    </p>
                  </div>
                  <StatusBadge status={listing.published ? "published" : "unpublished"} />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      togglePublish.mutate({ id: listing.id, published: !listing.published })
                    }
                  >
                    {listing.published ? "Unpublish" : "Publish"}
                  </Button>
                </div>
              ))}
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="pricing">
          <Panel
            title="Online pricing"
            description="Edit online and approved promotion prices on each product."
            bodyClassName="p-0"
          >
            <div className="divide-y">
              {listingRows.map((listing) => (
                <div
                  key={listing.id}
                  className="grid items-center gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
                >
                  <strong>{listing.title}</strong>
                  <span>{listing.price_paise ? formatMoney(listing.price_paise) : "Not set"}</span>
                  <span className="text-success">
                    {listing.sale_price_paise
                      ? `Sale ${formatMoney(listing.sale_price_paise)}`
                      : "No promotion"}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setEditing(listing)}>
                    Edit price
                  </Button>
                </div>
              ))}
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="orders">
          <OrderTable
            orders={orderRows}
            onAdvance={(id, status) => updateOrder.mutate({ id, status })}
          />
        </TabsContent>
        <TabsContent value="shipping">
          <Panel
            title="Shipping & fulfilment"
            description="Packing and dispatch use the same online-order history. Courier labels and tracking appear after a courier integration is connected."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard
                label="To pick"
                value={orderRows.filter((row) => row.status === "new").length}
                icon={ShoppingCart}
              />
              <StatCard
                label="Packing"
                value={orderRows.filter((row) => ["picking", "picked"].includes(row.status)).length}
                icon={PackageCheck}
              />
              <StatCard
                label="Fulfilled"
                value={orderRows.filter((row) => row.status === "fulfilled").length}
                icon={Truck}
              />
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="customers">
          <Panel
            title="Customers & loyalty"
            description="Shared online customer activity. Loyalty earning and redemption require an owner-approved policy."
            bodyClassName="p-0"
          >
            <div className="divide-y">
              {customers.map((customer) => (
                <div
                  key={`${customer.name}-${customer.phone}`}
                  className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                >
                  <div>
                    <strong>{customer.name}</strong>
                    <p className="text-xs text-muted-foreground">
                      {customer.phone ?? "No contact"}
                    </p>
                  </div>
                  <span>{customer.orders} order(s)</span>
                  <strong>{formatMoney(customer.spent)}</strong>
                </div>
              ))}
              {!customers.length ? <EmptyState title="No online customers yet" /> : null}
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="content">
          <Panel
            title="Website content"
            description="Catalogue images, collections and descriptions currently available to the storefront."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard
                label="Collections"
                value={new Set(listingRows.map((row) => row.collection).filter(Boolean)).size}
                icon={Image}
              />
              <StatCard
                label="Products with images"
                value={listingRows.filter((row) => row.images?.length).length}
                icon={Eye}
              />
              <StatCard
                label="Needs content"
                value={incompleteListings.length}
                icon={AlertTriangle}
                tone={incompleteListings.length ? "warning" : "success"}
              />
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Homepage banners, lookbooks and scheduled promotions need a dedicated content schema
              before staff can safely publish them.
            </p>
          </Panel>
        </TabsContent>
        <TabsContent value="reports">
          <Panel
            title="E-commerce reports"
            description="Operational totals from recorded online orders."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Fulfilled revenue"
                value={formatMoney(fulfilledRevenue)}
                icon={BarChart3}
              />
              <StatCard
                label="Average order"
                value={formatMoney(
                  orderRows.length
                    ? Math.round(
                        orderRows.reduce((sum, row) => sum + (row.amount_paise ?? 0), 0) /
                          orderRows.length,
                      )
                    : 0,
                )}
              />
              <StatCard
                label="Cancelled"
                value={orderRows.filter((row) => row.status === "cancelled").length}
              />
              <StatCard label="Customers" value={customers.length} icon={Users} />
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="health" className="space-y-4">
          <Panel
            title="Integration health"
            description="Stock links, checkout holds and events requiring staff attention."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Linked stock products" value={linkedMap.size} icon={CloudCog} />
              <StatCard
                label="Active holds"
                value={holdRows.filter((row) => row.status === "active").length}
              />
              <StatCard
                label="Failed content checks"
                value={incompleteListings.length}
                tone={incompleteListings.length ? "warning" : "success"}
              />
            </div>
          </Panel>
          <Panel title="Checkout holds" bodyClassName="p-0">
            <div className="divide-y">
              {holdRows.map((hold) => (
                <div key={hold.id} className="flex flex-wrap gap-3 p-3 text-sm">
                  <span className="font-mono">
                    {(hold.thaans as { barcode?: string } | null)?.barcode}
                  </span>
                  <span>{formatMetres(hold.length_mm)}</span>
                  <StatusBadge status={hold.status} />
                  <span className="ml-auto text-muted-foreground">
                    expires {formatDateTime(hold.expires_at)}
                  </span>
                </div>
              ))}
              {!holdRows.length ? <EmptyState title="No checkout holds" /> : null}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
    </>
  );
}

function OrderTable({
  orders,
  onAdvance,
}: {
  orders: NonNullable<ReturnType<typeof useOnlineOrders>["data"]>;
  onAdvance: (id: string, status: string) => void;
}) {
  return (
    <Panel
      title="Orders & fulfilment"
      description="Process picking, packing, fulfilment and cancellations without a second inventory deduction path."
      bodyClassName="p-0"
    >
      <div className="divide-y">
        {orders.map((order) => (
          <div key={order.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <span className="font-mono text-xs font-semibold">{order.order_no}</span>
            <div className="min-w-0 flex-1">
              <strong>{order.customer_name}</strong>
              <p className="truncate text-xs text-muted-foreground">
                {(order.listings as { title?: string } | null)?.title} ·{" "}
                {formatDateTime(order.created_at)}
              </p>
            </div>
            <span>{order.length_mm ? formatMetres(order.length_mm) : `${order.qty ?? 1} pc`}</span>
            <strong>{formatMoney(order.amount_paise)}</strong>
            <StatusBadge status={order.status} />
            {["new", "picking", "picked"].includes(order.status) ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onAdvance(
                    order.id,
                    order.status === "new"
                      ? "picking"
                      : order.status === "picking"
                        ? "picked"
                        : "fulfilled",
                  )
                }
              >
                {order.status === "new"
                  ? "Start picking"
                  : order.status === "picking"
                    ? "Mark packed"
                    : "Mark fulfilled"}
              </Button>
            ) : null}
          </div>
        ))}
        {!orders.length ? <EmptyState title="No online orders" /> : null}
      </div>
    </Panel>
  );
}
