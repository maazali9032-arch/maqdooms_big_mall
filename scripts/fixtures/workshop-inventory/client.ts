import type { WorkshopRow } from "@/features/inventory/WorkshopFabricStock";
const base = {
  stock_id: "stock",
  batch_id: "batch-new",
  batch_code: "B0002",
  batch_created_at: "2026-10-14",
  arrival_date: "2026-10-14",
  supplier: "Raymonds",
  group_id: "cotton",
  type_name: "Cotton",
  ordinal: 1,
  registered: true,
  name: "Cotton",
  colour: "Blue",
  original_mm: 10000,
  saved_length_mm: 10000,
  workshop_mm: 10000,
  status: "active",
  unlocated: false,
  cp_visible: true,
  cp_paise_per_m: 10000,
  incomplete: false,
  can_edit: true,
  can_correct_cp: true,
  can_correct_length: true,
  can_fill_cp: true,
  version: "v1",
};
const rows: WorkshopRow[] = [
  { ...base, thaan_id: "one", barcode: "RDS-10001a" },
  {
    ...base,
    thaan_id: "two",
    barcode: "RDS-10001b",
    ordinal: 2,
    cp_paise_per_m: 0,
    incomplete: true,
  },
  {
    ...base,
    thaan_id: "three",
    barcode: "AND-20001a",
    batch_id: "batch-old",
    batch_code: "B0001",
    batch_created_at: "2026-10-10",
    arrival_date: "2026-10-10",
    supplier: "Arvind",
    group_id: "velvet",
    type_name: "Velvet",
    name: "Velvet",
    cp_paise_per_m: null,
    incomplete: true,
  },
];
export const calls: { name: string; args: Record<string, unknown> }[] = [];
let first = true;
export const supabase = {
  auth: { signOut: async () => ({}) },
  rpc: async (name: string, args: Record<string, unknown> = {}) => {
    calls.push({ name, args: structuredClone(args) });
    if (name === "workshop_fabric_inventory") return { data: structuredClone(rows), error: null };
    if (name === "edit_workshop_thaan") {
      const row = rows.find((r) => r.thaan_id === args["p_thaan"])!;
      const changes = args["p_changes"] as Record<string, string | number>;
      if (first) {
        for (const [key, value] of Object.entries(changes)) {
          if (key === "name") row.name = String(value);
          if (key === "colour") row.colour = String(value);
          if (key === "cp_paise_per_m") row.cp_paise_per_m = Number(value);
          if (key === "length_mm") row.workshop_mm = Number(value);
        }
        row.incomplete = !row.name || !row.colour || !row.saved_length_mm || !row.cp_paise_per_m;
        row.version = "v2";
        first = false;
        return { data: null, error: { message: "Response interrupted after commit" } };
      }
      return { data: row.thaan_id, error: null };
    }
    return { data: [], error: null };
  },
};
