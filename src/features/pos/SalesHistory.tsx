import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/app/providers/session";
import { Panel } from "@/shared/components/page";
import { formatMoney } from "@/shared/utils/units";
import { formatDateTime } from "@/shared/utils/format";

type Bill = {
  id: string;
  code: string;
  customer_snapshot: { name?: string | null };
  final_customer_price_paise: number;
  completed_at: string;
  items: {
    id: string;
    barcode: string;
    fabric_name?: string;
    product?: string;
    quantity_mm?: number;
    quantity?: number;
    final_customer_price_paise: number;
  }[];
};

export function SalesHistory() {
  const { isOwner, roles } = useSession();
  const allowed = isOwner || roles.includes("counter");
  const fabric = useQuery({
    queryKey: ["direct-fabric-sale", "history"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("direct_fabric_order_history", {});
      if (error) throw error;
      return data as unknown as Bill[];
    },
  });
  const products = useQuery({
    queryKey: ["finished-product-sale", "history"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("finished_product_order_history", {});
      if (error) throw error;
      return data as unknown as Bill[];
    },
  });
  if (!allowed) return null;
  return (
    <div className="space-y-4">
      {[
        { title: "Fabric Sales History", query: fabric, unit: "m" },
        { title: "Finished Product Sales History", query: products, unit: "pc" },
      ].map(({ title, query, unit }) => (
        <Panel
          key={title}
          title={title}
          description="Latest 50 completed bills. Customer Tailoring bookings and progress are available in Customer Tailoring."
        >
          {query.isPending ? (
            <p>Loading bills…</p>
          ) : query.error ? (
            <p role="alert">{query.error.message}</p>
          ) : !query.data?.length ? (
            <p>No completed bills.</p>
          ) : (
            query.data.map((bill) => (
              <article key={bill.id} className="mb-3 rounded border p-3">
                <p className="font-medium">
                  {bill.code} · {bill.customer_snapshot?.name || "Walk-in customer"}
                </p>
                <p>
                  {formatDateTime(bill.completed_at)} · Total{" "}
                  {formatMoney(Number(bill.final_customer_price_paise))}
                </p>
                {bill.items.map((item) => (
                  <p key={item.id} className="break-words">
                    {item.fabric_name || item.product} · {item.barcode} ·{" "}
                    {unit === "m" ? Number(item.quantity_mm) / 1000 : item.quantity} {unit} ·{" "}
                    {formatMoney(Number(item.final_customer_price_paise))}
                  </p>
                ))}
              </article>
            ))
          )}
        </Panel>
      ))}
    </div>
  );
}
