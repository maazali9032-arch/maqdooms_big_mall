import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { ProductionReceipt } from "./ProductionReceipt";
import { FinishedProductInventory } from "./FinishedProductInventory";
export function FinishedProductWorkspace() {
  const { isOwner, roles, can } = useSession();
  const transferAllowed =
    isOwner || (roles.includes("stock_entry") && can("stock.transfer_finished"));
  const [loaded, setLoaded] = useState(false),
    [expanded, setExpanded] = useState(false);
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
      <ProductionReceipt onLoaded={() => setLoaded(true)} />
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
