import type { WorkshopRow } from "@/features/inventory/WorkshopFabricStock";
const base = {
  stock_id: "stock",
  batch_id: "batch",
  batch_code: "B0001",
  batch_created_at: "2026-10-13",
  arrival_date: "2026-10-13",
  supplier: "Raymonds",
  group_id: "cotton",
  type_name: "Cotton",
  ordinal: 1,
  registered: true,
  name: "Cotton",
  colour: null,
  original_mm: null,
  saved_length_mm: null,
  workshop_mm: null,
  status: "draft",
  unlocated: false,
  cp_visible: true,
  cp_paise_per_m: null,
  incomplete: true,
  can_edit: true,
  can_correct_cp: true,
  can_correct_length: true,
  can_fill_cp: true,
  version: "v1",
};
const rows: WorkshopRow[] = [
  { ...base, thaan_id: "a", stock_id: "sa", barcode: "RDS-10001a" },
  { ...base, thaan_id: "b", stock_id: "sb", barcode: "RDS-10001b" },
  {
    ...base,
    thaan_id: "c",
    stock_id: "sc",
    barcode: "RDS-10001c",
    colour: "Blue",
    original_mm: 10000,
    saved_length_mm: 10000,
    workshop_mm: 10000,
    status: "active",
    cp_paise_per_m: 9000,
  },
];
const receipts = new Set<string>();
export const controls = {
  calls: [] as { name: string; args: Record<string, unknown> }[],
  interruptEdit: false,
  interruptTransfer: false,
  floorBalances: {} as Record<string, number>,
};
Object.assign(window, { multiControls: controls });
export const supabase = {
  rpc: async (name: string, args: Record<string, unknown> = {}) => {
    controls.calls.push({ name, args: structuredClone(args) });
    if (name === "workshop_fabric_inventory") return { data: structuredClone(rows), error: null };
    if (name === "stock_registration_catalog" || name === "stock_transfer_history")
      return { data: [], error: null };
    if (name === "fabric_stock_catalog")
      return {
        data: rows.map((r) => ({
          id: r.stock_id,
          barcode: r.barcode,
          fabric_name: r.name,
          batch_code: r.batch_code,
          thans: [{ id: r.thaan_id, original_mm: r.original_mm }],
        })),
        error: null,
      };
    if (name === "inventory_catalog")
      return {
        data: rows
          .filter((r) => r.original_mm !== null)
          .map((r) => ({
            item_kind: "fabric",
            item_id: r.thaan_id,
            inventory_item_id: "i" + r.thaan_id,
          })),
        error: null,
      };
    if (name === "inventory_locations")
      return {
        data: [
          { id: "workshop", name: "Workshop", kind: "workshop", active: true },
          { id: "floor1", name: "Floor 1", kind: "showroom_sublocation", active: true },
          { id: "floor2", name: "Floor 2", kind: "showroom_sublocation", active: true },
        ],
        error: null,
      };
    if (name === "inventory_location_balances")
      return {
        data: rows
          .filter((r) => r.original_mm !== null)
          .map((r) => ({
            inventory_item_id: "i" + r.thaan_id,
            location_id: "workshop",
            quantity: r.workshop_mm,
          })),
        error: null,
      };
    if (name === "edit_workshop_thaan") {
      const id = String(args.p_request);
      if (receipts.has(id)) return { data: args.p_thaan, error: null };
      const row = rows.find((r) => r.thaan_id === args.p_thaan)!;
      const change = args.p_changes as Record<string, string | number>;
      if (change.colour !== undefined) row.colour = String(change.colour);
      if (change.length_mm !== undefined) {
        row.saved_length_mm = Number(change.length_mm);
        row.workshop_mm = Number(change.length_mm);
      }
      if (change.cp_paise_per_m !== undefined) row.cp_paise_per_m = Number(change.cp_paise_per_m);
      if (row.colour && row.saved_length_mm) {
        row.original_mm = row.saved_length_mm;
        row.status = "active";
      }
      row.version = "v2";
      receipts.add(id);
      if (controls.interruptEdit) {
        controls.interruptEdit = false;
        return { data: null, error: { message: "Synthetic edit response lost after commit" } };
      }
      return { data: row.thaan_id, error: null };
    }
    if (name === "post_inventory_transfer") {
      const id = String(args.p_request_id);
      if (receipts.has(id)) return { data: id, error: null };
      for (const item of args.p_items as { inventory_item_id: string; quantity: number }[]) {
        const row = rows.find((r) => "i" + r.thaan_id === item.inventory_item_id)!;
        row.workshop_mm! -= item.quantity;
        controls.floorBalances[String(args.p_destination)] =
          (controls.floorBalances[String(args.p_destination)] ?? 0) + item.quantity;
      }
      receipts.add(id);
      if (controls.interruptTransfer) {
        controls.interruptTransfer = false;
        return { data: null, error: { message: "Synthetic transfer response lost after commit" } };
      }
      return { data: id, error: null };
    }
    return { data: null, error: { code: "P0001", message: "Unsupported synthetic RPC" } };
  },
};
