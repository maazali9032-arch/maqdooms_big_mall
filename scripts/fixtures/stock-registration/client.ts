type Row = { length_mm: number; cp_paise_per_m: number | null };
type Variant = {
  id: string;
  code: string;
  ordinal: number;
  stock_id: string;
  thaan_id: string;
  original_mm: number;
  available_mm: string;
  cp_missing: boolean;
  can_fill_cp: boolean;
  cp_paise_per_m: null;
};
type Group = { id: string; code: string; name: string; variants: Variant[] };
type Batch = { id: string; code: string; provider_name: string; fabric_types: Group[] };
type Args = {
  p_provider?: string;
  p_batch?: string;
  p_fabric_type?: string;
  p_name?: string;
  p_rows?: Row[];
  p_barcode?: string;
  p_cp?: number;
};
const batches: Batch[] = [];
export const calls: { name: string; args: Args }[] = [];
export const supabase = {
  auth: { signOut: async () => ({}) },
  rpc: async (name: string, args: Args) => {
    calls.push({ name, args });
    if (name === "stock_registration_catalog")
      return { error: null, data: structuredClone(batches) };
    if (name === "register_delivery_batch") {
      const id = "batch-" + (batches.length + 1);
      batches.unshift({
        id,
        code: "B" + String(batches.length + 1).padStart(4, "0"),
        provider_name: args.p_provider ?? "",
        fabric_types: [],
      });
      return { error: null, data: id };
    }
    if (name === "register_fabric_type" || name === "append_registered_thans") {
      let batch = batches.find((batch) => batch.id === args.p_batch),
        group: Group | undefined;
      if (name === "register_fabric_type") {
        group = {
          id: "group-" + calls.length,
          code: "RDS-" + (31000 + calls.length),
          name: args.p_name ?? "",
          variants: [],
        };
        batch!.fabric_types.push(group);
      } else {
        batch = batches.find((batch) =>
          batch.fabric_types.some((group) => group.id === args.p_fabric_type),
        );
        group = batch!.fabric_types.find((group) => group.id === args.p_fabric_type);
      }
      if (!group) throw new Error("Fixture group missing");
      for (const row of args.p_rows ?? []) {
        const ordinal = group.variants.length + 1;
        group.variants.push({
          id: "variant-" + calls.length + "-" + ordinal,
          code: group.code + String.fromCharCode(96 + ordinal),
          ordinal,
          stock_id: "stock-" + ordinal,
          thaan_id: "than-" + ordinal,
          original_mm: row.length_mm,
          available_mm: String(row.length_mm),
          cp_missing: row.cp_paise_per_m === null,
          can_fill_cp: true,
          cp_paise_per_m: null,
        });
      }
      return { error: null, data: group.id };
    }
    if (name === "fill_registered_thaan_cp") {
      const variant = batches
        .flatMap((batch) => batch.fabric_types)
        .flatMap((group) => group.variants)
        .find((variant) => variant.code === args.p_barcode);
      variant!.cp_missing = false;
      return { error: null, data: variant!.stock_id };
    }
    return { error: { message: "Unknown fixture call" }, data: null };
  },
};
