import { supabase as registration } from "../labels-first-stock-entry/client";
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
  registered: true,
  name: "Cotton",
  colour: null,
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
  { ...base, thaan_id: "one", ordinal: 1, barcode: "RDS-10001a" },
  {
    ...base,
    thaan_id: "two",
    ordinal: 2,
    barcode: "RDS-10001b",
    cp_paise_per_m: 0,
    incomplete: true,
  },
  {
    ...base,
    thaan_id: "three",
    ordinal: 3,
    barcode: "RDS-10001c",
    original_mm: null,
    saved_length_mm: 9000,
    workshop_mm: null,
    status: "draft",
    cp_paise_per_m: 30000,
  },
];
window.thaanCalls = [];
export const supabase = {
  rpc: async (name: string, args: Record<string, unknown> = {}) => {
    window.thaanCalls.push({ name, args: structuredClone(args) });
    if (name === "workshop_fabric_inventory") return { data: structuredClone(rows), error: null };
    if (name === "edit_workshop_thaan") {
      const r = rows.find((r) => r.thaan_id === args["p_thaan"])!;
      const changes = args["p_changes"] as Record<string, string | number>;
      if (changes["length_mm"] !== undefined) {
        if (r.original_mm === null) r.original_mm = Number(changes["length_mm"]);
        r.saved_length_mm = r.original_mm;
        r.workshop_mm = Number(changes["length_mm"]);
        r.status = "active";
      }
      if (changes["cp_paise_per_m"] !== undefined)
        r.cp_paise_per_m = Number(changes["cp_paise_per_m"]);
      if (changes["colour"]) r.colour = String(changes["colour"]);
      r.incomplete = !(r.saved_length_mm && r.cp_paise_per_m);
      r.version = "v2";
      return { data: r.thaan_id, error: null };
    }
    return registration.rpc(name, args);
  },
};
declare global {
  interface Window {
    thaanCalls: { name: string; args: Record<string, unknown> }[];
  }
}
