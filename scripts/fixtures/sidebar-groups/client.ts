export const supabase = {
  auth: { signOut: async () => ({}) },
  rpc: async (name: string) => {
    if (name === "owner_production_catalog")
      return { data: { products: [], designs: [] }, error: null };
    if (name === "customer_tailoring_catalog") return { data: { stocks: [] }, error: null };
    if (
      [
        "owner_production_history",
        "tailoring_assignment_options",
        "inventory_locations",
        "consumable_catalog",
      ].includes(name)
    )
      return { data: [], error: null };
    return {
      data: [
        {
          id: name,
          code: name === "direct_fabric_order_history" ? "FAB-BILL" : "PRD-BILL",
          completed_at: "2026-10-11T09:00:00Z",
          customer_snapshot: { name: "Customer One" },
          final_customer_price_paise: 25000,
          items: [
            {
              id: "line",
              barcode: "TEST-12345",
              fabric_name: "Cotton",
              product: "Kurta",
              quantity_mm: 2000,
              quantity: 1,
              final_customer_price_paise: 25000,
            },
          ],
        },
      ],
      error: null,
    };
  },
};
