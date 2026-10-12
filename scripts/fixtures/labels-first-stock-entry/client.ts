type Variant = {
  id: string;
  code: string;
  original_mm: number | null;
  colour: string | null;
  saved_length_mm?: number | null;
  cp?: number | null;
};
type Batch = {
  id: string;
  code: string;
  provider_name: string;
  arrival_date: string;
  remarks: string | null;
  fabric_types: { id: string; code: string; name: string; variants: Variant[] }[];
};
export const calls: { name: string; args: Record<string, unknown> }[] = [];
const batches: Batch[] = [];
let first = true,
  measurementFirst = true;
export const supabase = {
  auth: { signOut: async () => ({}) },
  rpc: async (name: string, args: Record<string, unknown> = {}) => {
    calls.push({ name, args: structuredClone(args) });
    const input = args as {
      p_provider: string;
      p_arrival_date: string;
      p_remarks: string | null;
      p_fabrics: {
        name: string;
        quantity: number;
        rows: { colour: string | null; length_mm: number | null; cp_paise_per_m: number | null }[];
      }[];
      p_barcode: string;
      p_length_mm: number | null;
      p_colour: string | null;
      p_cp: number | null;
      p_fabric_type: string;
      p_rows: { length_mm: number | null }[];
    };
    if (name === "stock_registration_catalog")
      return { data: structuredClone(batches), error: null };
    if (name === "create_barcode_batch_with_details") {
      if (first) {
        first = false;
        batches.push({
          id: "batch",
          code: "B0001",
          provider_name: input.p_provider,
          arrival_date: input.p_arrival_date,
          remarks: input.p_remarks,
          fabric_types: input.p_fabrics.map((f, i) => ({
            id: "group-" + i,
            code: "RDS-" + (31001 + i),
            name: f.name,
            variants: Array.from({ length: f.quantity }, (_, j) => ({
              id: "than-" + i + "-" + j,
              code: "RDS-" + (31001 + i) + String.fromCharCode(97 + j),
              original_mm: f.rows[j]?.colour && f.rows[j]?.length_mm ? f.rows[j].length_mm : null,
              colour: f.rows[j]?.colour ?? null,
              saved_length_mm: f.rows[j]?.length_mm ?? null,
              cp: f.rows[j]?.cp_paise_per_m ?? null,
            })),
          })),
        });
        return { data: null, error: { message: "Response interrupted after commit" } };
      }
      return { data: "batch", error: null };
    }
    const group = batches[0]?.fabric_types.find((g) =>
        g.variants.some((v) => v.code === input.p_barcode),
      ),
      v = group?.variants.find((v) => v.code === input.p_barcode);
    if (name === "registered_thaan_details")
      return {
        data: v
          ? {
              code: v.code,
              batch_code: "B0001",
              supplier: "Raymonds",
              fabric_type: group!.name,
              original_mm: v.original_mm,
              saved_length_mm: v.saved_length_mm ?? v.original_mm,
              colour: v.colour,
              measured: v.original_mm !== null,
              can_complete: true,
              cp_visible: true,
              cp_missing: v.cp == null,
              cp_paise_per_m: v.cp ?? null,
              available_mm: v.original_mm,
              status: v.original_mm === null ? "draft" : "active",
              locations:
                v.original_mm === null
                  ? []
                  : [{ id: "workshop", name: "Workshop", quantity_mm: v.original_mm }],
            }
          : null,
        error: null,
      };
    if (name === "save_registered_thaan_details") {
      v!.saved_length_mm = input.p_length_mm ?? v!.saved_length_mm ?? null;
      v!.colour = input.p_colour ?? v!.colour;
      v!.cp = input.p_cp ?? v!.cp ?? null;
      if (v!.colour && v!.saved_length_mm) v!.original_mm = v!.saved_length_mm;
      if (measurementFirst) {
        measurementFirst = false;
        return { data: null, error: { message: "Response interrupted after commit" } };
      }
      return { data: v!.id, error: null };
    }
    if (name === "fabric_stock_catalog") return { data: [], error: null };
    if (name === "append_registered_thans") {
      const g = batches[0].fabric_types.find((g) => g.id === input.p_fabric_type)!;
      for (const r of input.p_rows) {
        const n = g.variants.length;
        g.variants.push({
          id: "extra-" + n,
          code: g.code + String.fromCharCode(97 + n),
          original_mm: r.length_mm,
          colour: null,
        });
      }
      return { data: g.id, error: null };
    }
    return { data: [], error: null };
  },
};
