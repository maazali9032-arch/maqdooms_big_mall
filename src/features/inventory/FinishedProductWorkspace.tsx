import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { ProductionReceipt } from "./ProductionReceipt";
import { FinishedProductInventory } from "./FinishedProductInventory";
import { CustomerTailoringReceipt } from "./CustomerTailoringReceipt";
import { Panel } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
export function FinishedProductWorkspace() {
  const { isOwner, roles, can } = useSession();
  const customerReceiptAllowed =
    isOwner ||
    (roles.includes("counter") && can("pos.issue_to_tailoring")) ||
    can("production.receive");
  const productionReceiptAllowed =
    isOwner || can("production.receive") || can("stock.price_finished");
  const transferAllowed =
    isOwner || (roles.includes("stock_entry") && can("stock.transfer_finished"));
  const [loaded, setLoaded] = useState(false),
    [expanded, setExpanded] = useState(false),
    [receiptType, setReceiptType] = useState<"customer" | "production">(
      customerReceiptAllowed ? "customer" : "production",
    );
  const existing = useQuery({
    queryKey: ["finished-product-inventory", "exists"],
    enabled: transferAllowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("finished_product_inventory", { p_limit: 1 });
      if (error) throw error;
      return data as unknown as { id: string }[];
    },
  });
  return (
    <div className="space-y-4">
      <Panel
        title="Receive finished garments"
        description="Choose whether the returned garment belongs to a customer stitching job or to shop production."
        actions={
          customerReceiptAllowed && productionReceiptAllowed ? (
            <div className="flex rounded-lg border bg-muted/40 p-1">
              <Button
                size="sm"
                variant={receiptType === "customer" ? "default" : "ghost"}
                onClick={() => setReceiptType("customer")}
              >
                Customer stitching
              </Button>
              <Button
                size="sm"
                variant={receiptType === "production" ? "default" : "ghost"}
                onClick={() => setReceiptType("production")}
              >
                Shop production
              </Button>
            </div>
          ) : undefined
        }
      >
        {customerReceiptAllowed && receiptType === "customer" ? (
          <CustomerTailoringReceipt embedded />
        ) : productionReceiptAllowed ? (
          <ProductionReceipt embedded onLoaded={() => setLoaded(true)} />
        ) : null}
      </Panel>
      {existing.error && (
        <p role="alert">
          Could not check existing pieces.{" "}
          <button className="underline" onClick={() => void existing.refetch()}>
            Retry
          </button>
        </p>
      )}
      {transferAllowed && (loaded || !!existing.data?.length) && (
        <details
          className="rounded-xl border bg-card p-4"
          onToggle={(e) => setExpanded(e.currentTarget.open)}
        >
          <summary className="cursor-pointer font-semibold">
            Existing Pieces, Transfers & History
          </summary>
          {expanded && (
            <div className="mt-4">
              <FinishedProductInventory />
            </div>
          )}
        </details>
      )}
    </div>
  );
}
