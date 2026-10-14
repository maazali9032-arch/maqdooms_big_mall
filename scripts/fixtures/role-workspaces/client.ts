export const calls: { name: string; args: unknown }[] = [];
export let roles = ["production"];
export const setRoles = (value: string[]) => {
  roles = value;
};
const failures = new Set<string>();
let received = false,
  priced = false;
export const locations = [
  { id: "workshop", name: "Workshop", kind: "workshop", active: true },
  {
    id: "floor",
    name: "Floor 1",
    kind: "showroom_sublocation",
    active: true,
    parent_id: "showroom",
  },
];
const fabric = {
  barcode: "TH-1",
  fabric_name: "Cotton",
  batch_code: "B0001",
  cuts: [
    {
      inventory_item_id: "item",
      thaan_id: "thaan",
      locations: [
        { id: "workshop", name: "Workshop", quantity_mm: 50000 },
        { id: "floor", name: "Floor 1", quantity_mm: 10000 },
      ],
    },
  ],
};
const job = {
  id: "job",
  code: "PJ-TEST",
  product: "Sherwani",
  design: "Custom embroidery",
  size: "38",
  quantity: 5,
  status: "completed",
  tailors: [{ code: "T1", name: "Tailor A" }],
  issued_at: "2026-10-14T09:00:00Z",
  finished_at: "2026-10-14T10:00:00Z",
  fabrics: [
    {
      barcode: "TH-1",
      name: "Cotton",
      quantity_mm: 25000,
      source: "Workshop",
      issue_type: "required",
    },
    {
      barcode: "TH-1",
      name: "Cotton",
      quantity_mm: 1000,
      source: "Workshop",
      issue_type: "additional",
    },
  ],
};
export const supabase = {
  auth: {
    updateUser: async (args: unknown) => {
      calls.push({ name: "updateUser", args });
      return { error: null };
    },
  },
  from: (_name: string) => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }),
  rpc: async (name: string, args: Record<string, unknown> = {}) => {
    calls.push({ name, args: structuredClone(args) });
    if (
      [
        "create_production_batch",
        "complete_production_batch",
        "set_workshop_product_sp",
        "issue_additional_production_fabric",
        "owner_register_staff",
      ].includes(name) &&
      !failures.has(name)
    ) {
      failures.add(name);
      return { data: null, error: { message: "Response interrupted after commit" } };
    }
    let data: unknown = [];
    if (name === "owner_production_catalog")
      data = {
        products: [{ id: "product", code: "SH", name: "Sherwani", active: true }],
        designs: [],
      };
    if (name === "production_fabric_catalog" || name === "pos_reserve_variants") data = [fabric];
    if (name === "tailoring_assignment_options")
      data = [
        {
          id: "assignment",
          factory_id: "factory",
          factory_name: "Factory A",
          section_id: "section",
          section_name: "Section A",
          tailor_code: "T1",
          tailor_name: "Tailor A",
        },
      ];
    if (name === "inventory_locations") data = locations;
    if (name === "create_production_batch") data = "job";
    if (name === "production_job_document")
      data = {
        ...job,
        received_at: received ? "2026-10-14T11:00:00Z" : null,
        ...(roles.some((r) => ["owner", "stock_entry"].includes(r))
          ? { cp_total_paise: 1040000, cost_known: true }
          : {}),
      };
    if (name === "complete_production_batch") {
      received = true;
      data = "job";
    }
    if (name === "set_workshop_product_sp") {
      priced = true;
      data = "job";
    }
    if (name === "workshop_production_pieces")
      data = received
        ? Array.from({ length: 5 }, (_, i) => ({
            id: `piece-${i + 1}`,
            job_id: "job",
            piece_number: i + 1,
            barcode: `PRD-${i + 1}`,
            product: "Sherwani",
            design: "Custom embroidery",
            size: "38",
            status: "available",
            location_kind: "workshop",
            cp_visible: true,
            cp_paise: 208000,
            sp_paise: priced ? 400000 : null,
          }))
        : [];
    if (name === "showroom_stock")
      data = [
        {
          id: "thaan",
          kind: "fabric",
          name: "Cotton",
          barcode: "TH-1",
          available_mm: 10000,
          locations: [{ name: "Floor 1" }],
        },
      ];
    return { data, error: null };
  },
};
