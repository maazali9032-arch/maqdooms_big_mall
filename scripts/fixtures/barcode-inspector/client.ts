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
    if (args["p_barcode"] === "AMBIGUOUS")
      return { data: { status: "ambiguous", barcode: "AMBIGUOUS" }, error: null };
    const record: BarcodeInspection = {
      status: "found",
      barcode: String(args["p_barcode"]),
      matches: [{ kind: "legacy_thaan", id: "thaan" }],
      items: [
        {
          id: "thaan",
          kind: "fabric",
          barcode: String(args["p_barcode"]),
          batch: "B0012",
          supplier: "maaz",
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
    if (args["p_barcode"] === "T00000") {
      record.items[0] = { ...record.items[0], name: "Giza", latest_cp_paise_per_m: "25000" };
      record.current_stock = [
        {
          inventory_item_id: "inventory-1",
          unit: "mm",
          locations: [{ location: "Workshop", quantity: "100000", unit: "mm" }],
        },
      ];
    }
    if (args["p_barcode"] === "MANY") {
      record.total_events = 9;
      record.events = args["p_before"]
        ? [{ ...event("old"), title: "INWARD" }]
        : Array.from({ length: 8 }, (_, i) => ({ ...event("event-" + i), title: "TRANSFER " + i }));
    }
    if (args["p_barcode"] === "EMPTY") {
      record.items = [
        {
          kind: "customer_finished_garment",
          id: "customer-piece",
          name: "Kurta",
          barcode: "EMPTY",
          latest_sp_paise: "200000",
          status: "ready",
        },
      ];
      record.matches = [{ kind: "customer_piece", id: "customer-piece" }];
      record.current_stock = [];
      record.linked_records = [];
      record.events = [];
      record.total_events = 0;
      record.next_cursor = null;
    }
    if (args["p_barcode"] === "MIXED") {
      record.current_stock = [
        {
          locations: [
            { location: "Workshop", quantity: "10000", unit: "mm" },
            { location: "Showroom", quantity: "1", unit: "piece" },
          ],
        },
      ];
    }
    if (args["p_barcode"] === "EXACT") {
      record.current_stock = [
        {
          locations: [
            { location: "Workshop", quantity: "9007199254740993000", unit: "mm" },
            { location: "Showroom", quantity: "1000", unit: "mm" },
          ],
        },
      ];
    }
    if (args["p_barcode"] === "B00001") {
      record.matches = [{ kind: "order", id: "bill" }];
      record.linked_records[0]!.data = {
        id: "bill",
        code: "BILL-001",
        scan_code: "B00001",
        status: "paid",
      };
    }
    return { data: record, error: null };
  },
};
