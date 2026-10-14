import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
import {
  PageHeader,
  Panel,
  StatusBadge,
  EmptyState,
  DemoNotice,
  StatCard,
} from "@/shared/components/page";
import { formatMetres, formatMoney } from "@/shared/utils/units";
import { formatDateTime } from "@/shared/utils/format";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkflowRoute } from "@/shared/components/use-workflow-route";
import { ShowroomStock } from "@/features/ecommerce/ShowroomStock";
import { useSession } from "@/app/providers/session";

export const Route = createFileRoute("/_authenticated/ecommerce")({
  head: () => ({
    meta: [
      { title: "E-commerce — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content: "Internal listing management, inventory links, online orders and pick tasks.",
      },
      { property: "og:title", content: "E-commerce — Maqdoom's Big Mall ERP" },
      {
        property: "og:description",
        content: "Internal listing management, inventory links and pick tasks.",
      },
    ],
  }),
  component: EcommercePage,
});

function EcommercePage() {
  const navigation = useWorkflowRoute();
  const { isOwner } = useSession();
  const listings = useListings();
  const availability = useListingAvailability();
  const linkedStock = useLinkedShowroomStock();
  const orders = useOnlineOrders();
  const holds = useHolds();
  const togglePublish = useTogglePublish();
  const updateOrder = useUpdateOrderStatus();
  const [editing, setEditing] = useState<EditableListing | null | undefined>(undefined);

  const availabilityMap = new Map((availability.data ?? []).map((a) => [a.listing_id, a]));
  const linkedMap = new Map((linkedStock.data ?? []).map((a) => [a.listing_id, a]));
  if (
    navigation.activeId === "fabric" ||
    navigation.activeId === "products" ||
    (!isOwner && !navigation.activeId)
  ) {
    return (
      <>
        <PageHeader title="E-commerce" description="Showroom stock for your online catalog." />
        <ShowroomStock
          key={navigation.activeId}
          kind={navigation.activeId === "products" ? "product" : "fabric"}
          onManageListings={() => navigation.onChange("listings")}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="E-commerce"
        description="Nothing becomes public automatically — only listings published here are exposed to the storefront."
        actions={
          <Button size="sm" onClick={() => setEditing(null)}>
            New online listing
          </Button>
        }
      />
      {editing !== undefined ? (
        <ListingEditor listing={editing} onClose={() => setEditing(undefined)} />
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Listings" value={(listings.data ?? []).length} />
        <StatCard
          label="Published"
          value={(listings.data ?? []).filter((l) => l.published).length}
        />
        <StatCard
          label="Open orders"
          value={
            (orders.data ?? []).filter((o) => o.status === "new" || o.status === "picking").length
          }
        />
        <StatCard
          label="Active holds"
          value={(holds.data ?? []).filter((h) => h.status === "active").length}
        />
      </div>

      <Tabs defaultValue="listings">
        <TabsList className="w-full overflow-x-auto sm:w-auto">
          <TabsTrigger value="listings">Listings</TabsTrigger>
          <TabsTrigger value="orders">Online orders</TabsTrigger>
          <TabsTrigger value="picks">Pick tasks</TabsTrigger>
          <TabsTrigger value="holds">Holds</TabsTrigger>
        </TabsList>

        <TabsContent value="listings" className="mt-4 space-y-4">
          <DemoNotice>
            Online availability for a fabric listing is the largest single remaining thaan minus
            active holds — never the sum of linked thaans.
          </DemoNotice>
          {(listings.data ?? []).map((l) => {
            const a = availabilityMap.get(l.id);
            const linked = linkedMap.get(l.id);
            const variants = (l.listing_variants ?? []) as {
              id: string;
              label: string;
              qty: number;
            }[];
            return (
              <Panel
                key={l.id}
                title={l.title}
                description={`${l.stock_mode} stock · ${l.category ?? "Uncategorised"}`}
                actions={
                  <div className="flex items-center gap-2">
                    <StatusBadge status={l.published ? "published" : "unpublished"} />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(l as EditableListing)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => togglePublish.mutate({ id: l.id, published: !l.published })}
                    >
                      {l.published ? "Unpublish" : "Publish"}
                    </Button>
                  </div>
                }
              >
                <p className="text-sm text-muted-foreground">{l.description}</p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <p className="label-eyebrow">Online price</p>
                    <p className="numeric text-sm">
                      {formatMoney(l.price_paise)}
                      {l.sale_price_paise ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · sale {formatMoney(l.sale_price_paise)}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {(l.images ?? []).length} image(s)
                    </p>
                  </div>
                  {l.stock_mode === "linked" ? (
                    <>
                      <div>
                        <p className="label-eyebrow">
                          {linked?.kind === "product"
                            ? "Available Showroom pieces"
                            : "Largest available Showroom Thaan"}
                        </p>
                        <p className="numeric text-sm font-semibold">
                          {linked?.kind === "product"
                            ? linked.stock.length || "Sold out"
                            : formatMetres(a?.largest_piece_mm ?? 0)}
                        </p>
                      </div>
                      <div>
                        <p className="label-eyebrow">Available Showroom barcodes</p>
                        <p className="numeric text-sm">
                          {(linked?.stock ?? []).map((k) => k.barcode).join(", ") || "—"}
                        </p>
                      </div>
                      {linked?.kind !== "product" && (
                        <div>
                          <p className="label-eyebrow">Total linked (not orderable)</p>
                          <p className="numeric text-sm text-muted-foreground">
                            {formatMetres(a?.total_linked_mm ?? 0)}
                          </p>
                        </div>
                      )}
                    </>
                  ) : null}
                  {l.stock_mode === "manual" ? (
                    <div className="col-span-2">
                      <p className="label-eyebrow">Sizes</p>
                      <p className="numeric text-sm">
                        {variants.map((v) => `${v.label}=${v.qty}`).join("  ") || "—"}
                      </p>
                    </div>
                  ) : null}
                </div>
              </Panel>
            );
          })}
        </TabsContent>

        <TabsContent value="orders" className="mt-4">
          <Panel bodyClassName="p-0">
            <div className="divide-y divide-border">
              {(orders.data ?? []).map((o) => (
                <div key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <span className="numeric text-xs font-medium">{o.order_no}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {o.customer_name} · {(o.listings as { title?: string } | null)?.title}
                  </span>
                  <span className="numeric">{o.length_mm ? formatMetres(o.length_mm) : "—"}</span>
                  <span className="numeric">{formatMoney(o.amount_paise)}</span>
                  <StatusBadge status={o.status} />
                  <span className="hidden text-xs text-muted-foreground lg:block">
                    {formatDateTime(o.created_at)}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="picks" className="mt-4">
          <Panel
            title="Pick tasks"
            description="Counter staff scan the thaan and cut through the normal cutting flow — there is no second deduction path."
            bodyClassName="p-0"
          >
            <div className="divide-y divide-border">
              {(orders.data ?? []).filter((o) => o.status === "new" || o.status === "picking")
                .length === 0 ? (
                <EmptyState title="No open pick tasks" />
              ) : (
                (orders.data ?? [])
                  .filter((o) => o.status === "new" || o.status === "picking")
                  .map((o) => (
                    <div key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                      <span className="numeric text-xs font-medium">{o.order_no}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {(o.listings as { title?: string } | null)?.title} — requested{" "}
                        <span className="numeric">
                          {o.length_mm ? formatMetres(o.length_mm) : "1 pc"}
                        </span>
                      </span>
                      <StatusBadge status={o.status} />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateOrder.mutate({
                            id: o.id,
                            status: o.status === "new" ? "picking" : "picked",
                          })
                        }
                      >
                        {o.status === "new" ? "Start picking" : "Mark picked"}
                      </Button>
                    </div>
                  ))
              )}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="holds" className="mt-4">
          <Panel
            title="Holds"
            description="Temporary reservations for online checkout. Duration is configurable — no final value is hardcoded."
            bodyClassName="p-0"
          >
            <div className="divide-y divide-border">
              {(holds.data ?? []).length === 0 ? (
                <EmptyState title="No holds" />
              ) : (
                (holds.data ?? []).map((h) => (
                  <div key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <span className="numeric text-xs">
                      {(h.thaans as { barcode?: string } | null)?.barcode}
                    </span>
                    <span className="numeric">{formatMetres(h.length_mm)}</span>
                    <span className="text-muted-foreground">{h.reference ?? "—"}</span>
                    <StatusBadge status={h.status === "active" ? "open" : "archived"} />
                    <span className="ml-auto text-xs text-muted-foreground">
                      expires {formatDateTime(h.expires_at)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
    </>
  );
}
