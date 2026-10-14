import { supabase as previous } from "../owner-workspace/client";
type Args = Record<string, unknown>;
const sale = (key: string, kind: string, channel: string, amount: string, at: string) => ({
  key,
  event_at: at,
  data: {
    code: key,
    kind,
    channel,
    status: "completed",
    payment_confirmed_at: at,
    completed_at: at,
    created_at: at,
    final_customer_price_paise: amount,
    revenue_paise: amount,
    fabric: kind === "direct_fabric_sale" ? "Cotton" : null,
    product: kind === "finished_product_sale" ? "Custom Kurta" : null,
    vendor: "Vendor A",
    salesperson_id: channel === "counter" ? "salesperson" : null,
    salesperson: channel === "counter" ? "Credited Person" : null,
    source: "Showroom Floor 1",
    quantity: kind === "direct_fabric_sale" ? "1000" : "1",
    unit: kind === "direct_fabric_sale" ? "mm" : "pc",
  },
});
const september = Array.from({ length: 16 }, (_, i) =>
  sale(
    "SEP-" + i,
    "direct_fabric_sale",
    i % 2 ? "counter" : "ecommerce",
    String(10000 + i * 1000),
    `2026-09-${String(i + 1).padStart(2, "0")}T08:00:00Z`,
  ),
);
const day = "2026-10-13",
  at = day + "T08:00:00Z";
const lines = [
  sale("FAB", "direct_fabric_sale", "counter", "10000", at),
  sale("PROD", "finished_product_sale", "counter", "20000", at),
  sale("WEB-FAB", "direct_fabric_sale", "ecommerce", "10000", at),
  sale("WEB-PROD", "finished_product_sale", "ecommerce", "15000", at),
  ...september,
];
const all = (args: Args) =>
  lines.filter(
    (r) =>
      (!args["p_from"] || Date.parse(r.event_at) >= Date.parse(String(args["p_from"]))) &&
      (!args["p_to"] || Date.parse(r.event_at) < Date.parse(String(args["p_to"]))),
  );
const rpc = (name: string, args: Args = {}) => {
  if (
    !["owner_daily_business", "owner_monthly_business"].includes(name) &&
    args["p_dataset"] !== "sales_lines" &&
    args["p_dataset"] !== "orders"
  )
    return previous.rpc(name, args);
  const run = async () => {
    window.ownerCalls.push({ name, args });
    if (window.ownerFail === name)
      return { data: null, error: new Error("Business service temporarily unavailable") };
    if (name === "owner_daily_business") {
      const match = args["p_day"] === day;
      return {
        data: {
          revenue_paise: match ? "55000" : "0",
          fabric_revenue_paise: match ? "20000" : "0",
          product_revenue_paise: match ? "35000" : "0",
          counter_paise: match ? "30000" : "0",
          ecommerce_paise: match ? "25000" : "0",
          bills: match ? 3 : 0,
          tailoring_booked_paise: match ? "5000" : "0",
          batches_registered: match ? 2 : 0,
          thaans_registered: match ? 20 : 0,
          received_fabric_mm: match ? "90000" : "0",
          transfers: match ? 4 : 0,
          production_issued: match ? 3 : 0,
          production_issued_mm: match ? "25000" : "0",
          production_finished: match ? 2 : 0,
          finished_pieces_received: match ? 10 : 0,
          tailoring_jobs: match ? 6 : 0,
        },
        error: null,
      };
    }
    if (name === "owner_monthly_business") {
      const rows = all(args),
        revenue = rows.reduce((s, r) => s + BigInt(r.data.revenue_paise), 0n).toString();
      const summary = {
        revenue_paise: revenue,
        bills: rows.length,
        customers: 2,
        unidentified_customer_bills: 3,
        fabric_mm: "16000",
        pieces: "0",
        known_margin_paise: "50000",
        unknown_cost_lines: 1,
        lines: rows.length,
        counter_paise: "150000",
        ecommerce_paise: "130000",
      };
      const rankings = rows.flatMap((r, i) =>
        ["fabric_vendor", "vendor", "product", "salesperson", "channel"].map((d) => ({
          dimension: d,
          identity: d + ":" + i,
          name:
            d === "product"
              ? "Custom Kurta " + i
              : d === "salesperson"
                ? "Credited Person " + i
                : "Cotton " + i,
          context: d === "fabric_vendor" ? "Vendor " + i : null,
          revenue_paise: r.data.revenue_paise,
          known_margin_paise: i === 0 ? null : String(1000 + i * 200),
          unknown_cost_lines: i === 0 ? 1 : 0,
          lines: 1,
          bills: 1,
          customers: 1,
          unidentified_customer_bills: 0,
          fabric_mm: String(1000 + i * 100),
          pieces: String(i + 1),
        })),
      );
      return {
        data: {
          current: summary,
          previous: { ...summary, revenue_paise: "0", bills: 0, fabric_mm: "0", pieces: "0" },
          rankings,
          daily_sales: rows.map((r) => ({
            day: r.event_at.slice(0, 10),
            revenue_paise: r.data.revenue_paise,
            bills: 1,
          })),
        },
        error: null,
      };
    }
    let rows = all(args);
    if (args["p_dataset"] === "orders")
      rows = [
        lines[0]!,
        lines[1]!,
        {
          ...lines[2]!,
          key: "WEB",
          data: { ...lines[2]!.data, kind: "ecommerce_sale", final_customer_price_paise: "25000" },
        },
      ];
    const offset = Number(args["p_after"] ?? 0);
    return {
      data: {
        rows: rows.slice(offset, offset + 2),
        total_rows: String(rows.length),
        next_cursor: offset + 2 < rows.length ? String(offset + 2) : null,
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
