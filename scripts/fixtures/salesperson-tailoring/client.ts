type Args = {
  p_salesperson?: string;
  p_final_price?: number;
  p_request?: string;
  p_items?: { quantity: number; sp_paise_per_m?: number }[];
  p_destination?: string;
  p_user?: string;
  p_permission?: string;
  p_granted?: boolean | null;
};
export const calls: { name: string; args: Args }[] = [];
let actor = "counter-user",
  role = "counter";
export function setActor(id: string, next: string) {
  actor = id;
  role = next;
}
const assignment = {
  id: "assignment",
  factory_id: "factory",
  factory_name: "Factory A",
  section_id: "section",
  section_name: "Section A",
  tailor_name: "Tailor A",
  tailor_code: "T-A",
};
const work: Record<string, unknown>[] = [];
let pendingBooking: string | undefined;
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
    if (name === "salesperson_options")
      data = [
        { id: "sales-one", name: "Sales One" },
        { id: "sales-two", name: "Sales Two" },
      ];
    if (name === "tailoring_assignment_options") data = [assignment];
    if (name === "customer_tailoring_catalog")
      data = {
        stocks: [
          {
            ...stock,
            cuts: [{ inventory_item_id: "item", thaan_id: "than", locations: stockLocations }],
          },
        ],
        charges: [],
      };
    if (name === "book_counter_tailoring") {
      if (!pendingBooking) {
        pendingBooking = args.p_request;
        work.push({
          id: "bill",
          code: "CT-BILL",
          kind: "customer_tailoring",
          created_at: "2026-10-11T00:00:00Z",
          created_by: actor,
          salesperson_user_id: args.p_salesperson,
          salesperson_name: "Sales One",
          source_name: "Floor 2",
          customer_snapshot: { name: "Customer One" },
          final_customer_price_paise: String(args.p_final_price),
          fabric_mm: "3000",
          job_id: "job",
          job_code: "CT-JOB",
          job_status: "open",
          garment: "Suit",
          factory_name: "Factory A",
          section_name: "Section A",
          tailor_name: "Tailor A",
          fabrics: [
            {
              barcode: stock.barcode,
              fabric: stock.fabric_name,
              batch: stock.batch_code,
              quantity_mm: "3000",
            },
          ],
        });
        return {
          data: null,
          error: { code: "FETCH_ERROR", message: "Simulated interrupted response" },
        };
      }
      data = "job";
    }
    if (name === "salesperson_work")
      data = work.filter(
        (w) =>
          (role === "owner" || w.salesperson_user_id === actor) &&
          (!args.p_salesperson || w.salesperson_user_id === args.p_salesperson),
      );
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
