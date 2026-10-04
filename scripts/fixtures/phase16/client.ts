export const calls: string[] = [];
export let fail = false;
export function setFailure(value: boolean) {
  fail = value;
}
export const supabase = {
  rpc: async (name: string, args?: Record<string, unknown>) => {
    calls.push(name);
    if (fail) return { data: null, error: new Error("Fixture connection failure") };
    if (name === "owner_erp_overview")
      return {
        error: null,
        data: {
          stock: [
            { location_id: "workshop", location: "Workshop", unit: "mm", quantity: "100000" },
            { location_id: "showroom", location: "Showroom", unit: "pc", quantity: "3" },
          ],
          paid_sales: [{ kind: "direct_fabric_sale", orders: "2", total_paise: "123456" }],
          customer_tailoring_bookings: { orders: "1", booked_customer_price_paise: "85000" },
          controls: { unresolved_legacy: 4 },
        },
      };
    const fields = {
      barcode: "FAB-FIXTURE",
      fabric: "Cotton",
      batch: "B1",
      location: "Workshop",
      quantity: "100000",
      unit: "mm",
      cp_paise_per_m: "50000",
      sp_paise_per_m: "85000",
      complete_cost_evidence: { total_paise: "100000", design_charge: "2000" },
    };
    return {
      error: null,
      data: {
        rows:
          args?.p_search === "missing" ? [] : [{ key: "fixture", event_at: null, data: fields }],
        total_rows: args?.p_search === "missing" ? "0" : "1",
        next_cursor: null,
      },
    };
  },
};
