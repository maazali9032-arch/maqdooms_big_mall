type Row = { key: string; event_at: string | null; data: Record<string, unknown> };
const day = "2026-10-13";
const row = (
  key: string,
  data: Record<string, unknown>,
  event_at: string | null = day + "T08:00:00Z",
): Row => ({ key, event_at, data });
const datasets: Record<string, Row[]> = {
  orders: [
    row("old-created", {
      code: "BILL-FAB",
      created_at: "2026-10-01T08:00:00Z",
      completed_at: day + "T08:00:00Z",
      payment_confirmed_at: day + "T08:00:00Z",
      kind: "direct_fabric_sale",
      status: "completed",
      final_customer_price_paise: "10000",
      source: "Floor 1",
      items: [{ fabric_stock_id: "fabric-1", quantity: "5000" }],
    }),
    row("product", {
      code: "BILL-PROD",
      created_at: day + "T08:00:00Z",
      completed_at: day + "T09:00:00Z",
      payment_confirmed_at: day + "T09:00:00Z",
      kind: "finished_product_sale",
      status: "completed",
      final_customer_price_paise: "20000",
      source: "Floor 2",
      items: [{ finished_product_id: "piece-1", quantity: "1" }],
    }),
    row("booking", {
      code: "BOOK-1",
      created_at: day + "T08:00:00Z",
      kind: "customer_tailoring",
      status: "completed",
      final_customer_price_paise: "5000",
      source: "Floor 1",
    }),
    row("unpaid", {
      code: "UNPAID",
      created_at: day + "T08:00:00Z",
      kind: "direct_fabric_sale",
      status: "pending",
      final_customer_price_paise: "900000",
      source: "Floor 2",
    }),
  ],
  stock: [
    row(
      "stock",
      {
        barcode: "RDS-1a",
        item: "Cotton",
        kind: "fabric",
        location: "Workshop",
        quantity: "12500.000",
        unit: "mm",
      },
      null,
    ),
    row(
      "stock-piece",
      {
        item: "Shirt",
        kind: "finished_product",
        location: "Floor 1",
        quantity: "2",
        unit: "piece",
      },
      null,
    ),
  ],
  production_jobs: [
    row("job", {
      code: "OP-1",
      status: "in_progress",
      product: "Shirt",
      created_at: "2026-09-01T08:00:00Z",
    }),
  ],
  customer_tailoring: [row("ct", { code: "CT-1", customer: "Customer A", status: "booked" })],
  movements: [
    row("move", {
      movement_type: "transfer",
      quantity: "5000",
      unit: "mm",
      source: "Workshop",
      destination: "Floor 1",
    }),
  ],
  material_issues: [
    row("issue", {
      job: "OP-1",
      job_kind: "owner_production",
      item: "Cotton",
      quantity_issued: "5000",
      actual_piece_usage: "3000",
      unit: "mm",
      actual_usage_scope: "recorded_finished_piece_allocations",
    }),
  ],
  production_history: [row("receipt", { kind: "workshop_receipt", job: "OP-2" })],
  controls: [row("control", { control: "received_jobs_without_final_cost", record: "OP-2" }, null)],
  production_costs: [
    row("cost", { job: "OP-2", finalized: false, total_paise: "0", components: null }),
  ],
  audit: [
    row("audit1", {
      action: "row_update",
      entity_table: "thaans",
      entity_id: "thaan-1",
      reference: "RDS-1a",
      actor: "Stock Staff",
      actor_id: "staff",
      occurred_at: day + "T08:00:00Z",
      previous_value: { length_mm: 12000 },
      new_value: { length_mm: 11500 },
      source: "canonical",
    }),
    row("audit2", {
      action: "row_insert",
      entity_table: "user_roles",
      actor_id: "owner",
      reference: "staff:counter",
      previous_value: null,
      new_value: { role_key: "counter" },
      source: "canonical",
    }),
    row("audit3", {
      action: "updated",
      entity_table: "sales",
      actor_id: null,
      reference: "LEGACY-BILL",
      previous_value: null,
      new_value: null,
      source: "legacy",
    }),
  ],
};
datasets["finished_products"] = Array.from({ length: 31 }, (_, i) =>
  row("piece-" + i, {
    id: "piece-" + i,
    barcode: "PIECE-" + String(i).padStart(2, "0"),
    product: i % 2 ? "Shirt" : "Jacket",
    status: "available",
    production_cost_paise: i % 3 === 0 ? null : "20000",
    quantity: "1",
    location: "Workshop",
    unit: "piece",
  }),
);
datasets["fabric_stock"] = [row("fabric-1", { id: "fabric-1", fabric: "Cotton", batch: "B001" })];
window.ownerCalls = [];

const rpc = (name: string, args: Record<string, unknown> = {}) => {
  const run = async () => {
    window.ownerCalls.push({ name, args });
    if (window.ownerFail === name) return { data: null, error: new Error("Synthetic load failed") };
    if (name === "owner_erp_overview") {
      const matches =
        args["p_from"] === day + "T00:00:00+05:30" ||
        String(args["p_from"]).startsWith("2026-10-12T18:30");
      return {
        data: {
          paid_sales: matches
            ? [
                {
                  kind: "direct_fabric_sale",
                  orders: "1",
                  total_paise: window.ownerZero ? "0" : "10000",
                },
                {
                  kind: "finished_product_sale",
                  orders: "1",
                  total_paise: window.ownerZero ? "0" : "20000",
                },
              ]
            : [],
          customer_tailoring_bookings: {
            orders: matches ? "1" : "0",
            booked_customer_price_paise: matches ? "5000" : "0",
          },
          controls: { unresolved_legacy: 1, received_jobs_without_final_cost: 1 },
        },
        error: null,
      };
    }
    const source = (datasets[String(args["p_dataset"])] ?? [])
      .map((r) =>
        window.ownerZero && args["p_dataset"] === "orders"
          ? { ...r, data: { ...r.data, final_customer_price_paise: "0" } }
          : r,
      )
      .filter(
        (r) =>
          !r.event_at ||
          ((!args["p_from"] || Date.parse(r.event_at) >= Date.parse(String(args["p_from"]))) &&
            (!args["p_to"] || Date.parse(r.event_at) < Date.parse(String(args["p_to"])))),
      );

    // Simulate multiple cursor pages even for small data, to verify complete aggregation.
    const offset = args["p_after"] ? Number(args["p_after"]) : 0,
      rows = source.slice(offset, offset + 2);
    return {
      data: {
        rows,
        total_rows: String(source.length),
        next_cursor: offset + 2 < source.length ? String(offset + 2) : null,
      },
      error: null,
    };
  };
  return {
    then: (resolve: unknown, reject: unknown) => run().then(resolve as never, reject as never),
    abortSignal: () => run(),
  };
};
export const supabase = { rpc };
declare global {
  interface Window {
    ownerCalls: { name: string; args: Record<string, unknown> }[];
    ownerFail?: string;
    ownerZero?: boolean;
  }
}
