export const calls: { name: string; args: Record<string, unknown> }[] = [];
const assignment = {
  id: "assignment",
  factory_id: "factory",
  factory_name: "Factory A",
  section_id: "section",
  section_name: "Section A",
  tailor_name: "Tailor A",
  tailor_code: "T-A",
};
const fabric = {
  fabric_name: "Cotton",
  batch_code: "B0001",
  barcode: "RDS-12345c",
  cuts: [
    {
      inventory_item_id: "item",
      thaan_id: "thaan",
      locations: [{ id: "workshop", quantity_mm: 50000 }],
    },
  ],
};
const locations = [
  { id: "workshop", name: "Workshop", kind: "workshop", active: true, parent_id: null },
  { id: "showroom", name: "Showroom", kind: "showroom", active: true, parent_id: null },
  {
    id: "floor",
    name: "Floor 2",
    kind: "showroom_sublocation",
    active: true,
    parent_id: "showroom",
  },
];
const piece = {
  id: "piece",
  barcode: "PRD-1234567",
  piece_number: 1,
  product: "Kurta",
  design: "Design A",
  job_code: "PJ-test",
  production_job: "PJ-test",
  production_job_id: "job",
  job_quantity: 3,
  job_status: "completed",
  factory: "Factory A",
  section: "Section A",
  tailor: "Tailor A",
  tailors: [
    { code: "T-A", name: "Tailor A" },
    { code: "T-B", name: "Tailor B" },
  ],
  location_id: "workshop",
  location: "Workshop",
  location_active: true,
  quantity: 1,
  quantity_at_location: 1,
  available: true,
  status: "available",
  sp_paise: 100000,
  materials: [],
  production_history: [],
  receipt: null,
  production_summary: { planned: 3, produced: 3, sold: 1, remaining: 2, archived: 0 },
};
let createRequest: unknown, transferRequest: unknown;
export const supabase = {
  rpc: async (name: string, args: Record<string, unknown> = {}) => {
    calls.push({ name, args: structuredClone(args) });
    let data: unknown = [];
    if (name === "owner_production_catalog")
      data = {
        products: [{ id: "product", code: "P", name: "Kurta", active: true }],
        designs: [{ id: "design", code: "D", name: "Design A", active: true }],
      };
    if (name === "tailoring_assignment_options")
      data = [
        assignment,
        { ...assignment, id: "second", tailor_code: "T-B", tailor_name: "Tailor B" },
      ];
    if (name === "inventory_locations") data = locations;
    if (name === "customer_tailoring_catalog") data = { stocks: [fabric] };
    if (name === "direct_fabric_sale_catalog")
      data = args.p_barcode === fabric.barcode ? [fabric] : [];
    if (name === "create_owner_production_shared") {
      if (!createRequest) {
        createRequest = args.p_request;
        return { data: null, error: { message: "Response interrupted after commit" } };
      }
      data = "job";
    }
    if (name === "finished_product_inventory") data = [];
    if (name === "finished_product_transfer_scan")
      data = [
        args.p_barcode === "PRD-SECOND"
          ? { ...piece, id: "piece-2", barcode: "PRD-SECOND", piece_number: 2 }
          : piece,
      ];
    if (name === "transfer_finished_products") {
      if (!transferRequest) {
        transferRequest = args.p_request;
        piece.location_id = "floor";
        piece.location = "Floor 2";
        return { data: null, error: { message: "Response interrupted after commit" } };
      }
      data = "transfer";
    }
    if (name === "finished_product_catalog") data = [piece];
    return { data: structuredClone(data), error: null };
  },
};
