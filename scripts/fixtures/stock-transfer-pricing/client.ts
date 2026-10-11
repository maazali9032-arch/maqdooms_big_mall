type Args = {
  p_items?: { quantity: number; sp_paise_per_m?: number }[];
  p_destination?: string;
  p_user?: string;
  p_permission?: string;
  p_granted?: boolean | null;
};
export const calls: { name: string; args: Args }[] = [];
const stockLocations = [
  { id: "workshop", name: "Workshop", quantity_mm: 50000 },
  { id: "floor1", name: "Floor 1", quantity_mm: 0 },
  { id: "floor2", name: "Floor 2", quantity_mm: 10000 },
];
const stock = {
  id: "stock",
  fabric_name: "Cotton",
  batch_code: "B0001",
  barcode: "RDS-12345678c",
  available_mm: 60000,
  thans: [{ id: "than", original_mm: 60000 }],
};
let overrides: { user_id: string; permission_key: string; granted: boolean }[] = [];
export const supabase = {
  auth: { signOut: async () => ({}) },
  from: () => ({ select: async () => ({ data: structuredClone(overrides), error: null }) }),
  rpc: async (name: string, args: Args = {}) => {
    calls.push({ name, args });
    let data: unknown = [];
    if (name === "salesperson_options") data = [{ id: "sales-one", name: "Sales One" }];
    if (name === "fabric_stock_catalog") data = [{ ...stock, locations: stockLocations }];
    if (name === "inventory_catalog")
      data = [{ item_kind: "fabric", item_id: "than", inventory_item_id: "item" }];
    if (name === "inventory_locations")
      data = stockLocations.map((l) => ({
        id: l.id,
        name: l.name,
        active: true,
        kind: l.id === "workshop" ? "workshop" : "showroom_sublocation",
      }));
    if (name === "inventory_location_balances")
      data = stockLocations.map((l) => ({
        inventory_item_id: "item",
        location_id: l.id,
        quantity: l.quantity_mm,
      }));
    if (name === "post_inventory_transfer") {
      stockLocations[0].quantity_mm -= args.p_items![0].quantity;
      stockLocations.find((l) => l.id === args.p_destination)!.quantity_mm +=
        args.p_items![0].quantity;
      data = "transfer";
    }
    if (name === "direct_fabric_sale_catalog")
      data = [
        {
          ...stock,
          sp_paise_per_m: null,
          sp_version_id: null,
          cuts: [{ inventory_item_id: "item", thaan_id: "than", locations: stockLocations }],
        },
      ];
    if (name === "complete_counter_fabric_sale") data = "sale";
    if (name === "owner_set_user_permission") {
      overrides = overrides.filter(
        (o) => o.user_id !== args.p_user || o.permission_key !== args.p_permission,
      );
      if (args.p_granted !== null)
        overrides.push({
          user_id: args.p_user!,
          permission_key: args.p_permission!,
          granted: Boolean(args.p_granted),
        });
    }
    return { data: structuredClone(data), error: null };
  },
};
