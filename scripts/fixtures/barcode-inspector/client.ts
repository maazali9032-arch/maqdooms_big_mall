import { supabase as previous } from "../owner-business/client";
import type { BarcodeInspection } from "@/features/reports/OwnerBarcodeInspector";
const calls: string[] = [];
Object.assign(window, { inspectorCalls: calls });
let failures = 0;
const event = (key: string) => ({
  key,
  source: "inventory_movements",
  title: "TRANSFER",
  event_at: "2026-10-15T08:00:00Z",
  actor: "Stock Staff",
  actor_id: "staff-id",
  data: {
    quantity: "10000",
    unit: "mm",
    source_location: "Workshop",
    destination_location: "Showroom Floor 1",
    reference: "TR-001",
    reason: null,
  },
});
export const supabase = {
  ...previous,
  async rpc(name: string, args: Record<string, unknown> = {}) {
    calls.push(name);
    if (name === "workshop_fabric_inventory") return { data: [], error: null };
    if (name !== "owner_barcode_inspect") return previous.rpc(name, args);
    if (args["p_barcode"] === "ERROR" && failures++ === 0)
      return { data: null, error: { message: "Connection interrupted" } };
    if (args["p_barcode"] === "UNKNOWN")
      return { data: { status: "unknown", barcode: "UNKNOWN" }, error: null };
    const record: BarcodeInspection = {
      status: "found",
      barcode: String(args["p_barcode"]),
      items: [
        {
          id: "thaan",
          name: "Cotton",
          latest_cp_paise_per_m: "40000",
          thaan: { colour: null, saved_length_mm: 10000 },
        },
      ],
      current_stock: [
        { locations: [{ location: "Showroom Floor 1", quantity: "10000", unit: "mm" }] },
      ],
      linked_records: [
        {
          key: "bill",
          source: "orders",
          title: "Linked order / bill",
          data: { code: "BILL-001", final_customer_price_paise: "250000" },
        },
      ],
      undated_records: [
        {
          key: "line",
          source: "order_items",
          title: "Linked order line",
          data: { quantity: "1000", unit: "mm" },
        },
      ],
      events: args["p_before"] ? [{ ...event("old"), title: "INWARD" }] : [event("new")],
      next_cursor: args["p_before"] ? null : { before: "2026-10-15T08:00:00Z", key: "new" },
      total_events: 2,
      inspected_at: "2026-10-15T09:00:00Z",
      history_note: "Only recorded evidence is shown. Current stock is not a historical balance.",
    };
    return { data: record, error: null };
  },
};
