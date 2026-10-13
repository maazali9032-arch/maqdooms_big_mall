import type { EvidenceRow } from "./use-evidence";
export const categories: { name: string; reports: readonly (readonly [string, string])[] }[] = [
  {
    name: "Sales & Payments",
    reports: [
      ["orders", "Sales, bills & bookings"],
      ["legacy_sales", "Legacy sales"],
    ],
  },
  {
    name: "Stock & Inventory",
    reports: [
      ["stock", "Current stock by location"],
      ["fabric_stock", "Fabric identity & recorded prices"],
      ["batches", "Batches"],
      ["thans", "Physical Thaans"],
      ["consumables", "Consumables"],
      ["consumable_receipts", "Material receipts"],
      ["movements", "Stock movements"],
      ["legacy_movements", "Legacy movements"],
    ],
  },
  {
    name: "Production & Costs",
    reports: [
      ["production_jobs", "Production jobs"],
      ["production_costs", "Recorded cost revisions"],
      ["material_issues", "Material issues"],
      ["tailor_usage", "Recorded piece allocations"],
      ["production_history", "Production status & receipts"],
      ["configuration", "Factories, assignments & designs"],
    ],
  },
  {
    name: "Orders & Tailoring",
    reports: [
      ["customer_tailoring", "Customer tailoring jobs"],
      ["legacy_tailoring", "Legacy tailoring"],
    ],
  },
  { name: "Finished Products", reports: [["finished_products", "Individual finished pieces"]] },
  { name: "Transfers & Locations", reports: [["transfers", "Transfer documents & lines"]] },
  {
    name: "Audit & Reconciliation",
    reports: [
      ["audit", "Recorded audit evidence"],
      ["controls", "Owner review exceptions"],
      ["reconciliation", "Legacy reconciliation"],
      ["access", "Staff access & permissions"],
    ],
  },
];
export const snapshots = new Set([
  "stock",
  "fabric_stock",
  "batches",
  "thans",
  "consumables",
  "configuration",
  "finished_products",
  "access",
  "controls",
]);
export const title = (key: string) =>
  key.replaceAll("_", " ").replace(/\b\w/g, (s) => s.toUpperCase());
export const text = (value: unknown) =>
  value === null || value === undefined || value === ""
    ? "Not recorded"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
export const indiaDay = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export function shiftDay(day: string, amount: number) {
  return new Date(new Date(day + "T12:00:00Z").getTime() + amount * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function inRange(value: unknown, from: string, through: string) {
  if (!value) return false;
  const at = Date.parse(String(value));
  return (
    Number.isFinite(at) &&
    (!from || at >= Date.parse(from + "T00:00:00+05:30")) &&
    (!through || at < Date.parse(shiftDay(through, 1) + "T00:00:00+05:30"))
  );
}
export function integer(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  return /^-?\d+(?:\.0+)?$/.test(String(value)) &&
    (typeof value !== "number" || Number.isSafeInteger(value))
    ? BigInt(String(value).split(".")[0]!)
    : null;
}
export function sum(rows: EvidenceRow[], field: string) {
  let total = 0n,
    unknown = 0;
  for (const r of rows) {
    const n = integer(r.data[field]);
    if (n === null) unknown++;
    else total += n;
  }
  return { total, unknown };
}
export function paid(r: EvidenceRow) {
  return (
    r.data["status"] === "completed" &&
    Boolean(r.data["payment_confirmed_at"]) &&
    ["direct_fabric_sale", "finished_product_sale"].includes(String(r.data["kind"]))
  );
}
export function orderDate(r: EvidenceRow) {
  return paid(r) ? r.data["completed_at"] : r.data["created_at"];
}
export function group(rows: EvidenceRow[], field: string, amount?: string) {
  const groups = new Map<string, bigint>();
  for (const r of rows) {
    const key = text(r.data[field]);
    const n = amount ? integer(r.data[amount]) : 1n;
    if (n !== null) groups.set(key, (groups.get(key) ?? 0n) + n);
  }
  return [...groups]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) =>
      a.value === b.value ? a.name.localeCompare(b.name) : a.value > b.value ? -1 : 1,
    );
}
export const moduleNames = [
  "Stock Entry",
  "Inventory",
  "Transfers",
  "Sales & Bills",
  "Customer Tailoring",
  "Owner Production",
  "Finished Products",
  "Staff & Permissions",
] as const;
export function auditModule(r: EvidenceRow): string {
  const table = String(r.data["entity_table"] ?? r.data["table_name"] ?? "");
  if (["receiving_batches", "suppliers", "consumable_receipts"].includes(table))
    return "Stock Entry";
  if (["stock_transfers", "stock_transfer_lines"].includes(table)) return "Transfers";
  if (["orders", "order_items", "sales", "sale_items", "order_item_financials"].includes(table))
    return "Sales & Bills";
  if (
    table.startsWith("customer_tailoring") ||
    ["tailoring_jobs", "tailoring_job_lines"].includes(table)
  )
    return "Customer Tailoring";
  if (table.startsWith("material_issue")) {
    const captured = r.data["new_value"] ?? r.data["previous_value"];
    const details =
      captured && typeof captured === "object" ? (captured as Record<string, unknown>) : {};
    if (details["customer_tailoring_job_id"] || details["job_kind"] === "customer_tailoring")
      return "Customer Tailoring";
    if (details["production_job_id"] || details["job_kind"] === "owner_production")
      return "Owner Production";
    return "Other / unclassified";
  }
  if (table.startsWith("production_")) return "Owner Production";
  if (table.startsWith("finished_product")) return "Finished Products";
  if (
    [
      "profiles",
      "user_roles",
      "user_permission_overrides",
      "roles",
      "permissions",
      "role_permissions",
    ].includes(table)
  )
    return "Staff & Permissions";
  if (
    [
      "thaans",
      "thaan_costs",
      "fabric_stock",
      "fabric_stock_costs",
      "fabric_stock_prices",
      "inventory_movements",
      "stock_movements",
      "materials",
      "fabrics",
      "barcodes",
      "locations",
    ].includes(table)
  )
    return "Inventory";
  return "Other / unclassified";
}
export function auditAction(r: EvidenceRow) {
  const action = String(r.data["action"] ?? "");
  if (action === "set_user_permission") return "Permission Changed";
  const value = r.data["new_value"];
  if (
    action === "progress_owner_production" &&
    value &&
    typeof value === "object" &&
    (value as Record<string, unknown>)["status"] === "completed"
  )
    return "Completed";
  if (
    auditModule(r) === "Staff & Permissions" &&
    ["user_roles", "user_permission_overrides", "role_permissions", "permissions"].includes(
      String(r.data["entity_table"]),
    )
  )
    return "Permission Changed";
  const explicit: Record<string, string> = {
    row_insert: "Created",
    row_update: "Updated",
    row_delete: "Deleted",
    create_fabric_entry: "Created",
    create_owner_production: "Created",
    create_customer_tailoring: "Created",
    book_counter_tailoring: "Created",
    edit_workshop_thaan: "Updated",
    update_fabric_entry: "Updated",
    complete_fabric_entry: "Completed",
    post_inventory_transfer: "Transferred",
    complete_counter_fabric_sale: "Completed",
    complete_finished_product_sale: "Completed",
    stock_adjustment: "Adjusted",
    transfer: "Transferred",
    production_completed: "Completed",
    cancelled: "Cancelled",
  };
  return explicit[action] ?? title(action || "Not recorded");
}
export function recordType(r: EvidenceRow) {
  const table = String(r.data["entity_table"] ?? "");
  if (["thaans", "fabric_stock", "barcodes", "thaan_costs"].includes(table)) return "Barcode/Thaan";
  if (["sales", "sale_items"].includes(table)) return "Bill";
  if (["orders", "order_items"].includes(table)) return "Order";
  if (table.startsWith("production_")) return "Production Order";
  if (
    ["inventory_movements", "stock_movements", "stock_transfers", "stock_transfer_lines"].includes(
      table,
    )
  )
    return "Stock Movement";
  if (["profiles", "user_roles", "user_permission_overrides"].includes(table))
    return "Staff Account";
  return table ? title(table) : "Not recorded";
}

export function quantityTotal(rows: EvidenceRow[], field = "quantity") {
  const known = rows
    .map((r) =>
      typeof r.data[field] === "number" && !Number.isSafeInteger(r.data[field])
        ? ""
        : String(r.data[field] ?? ""),
    )
    .filter((v) => /^-?\d+(?:\.\d+)?$/.test(v));
  const scale = known.reduce((max, v) => Math.max(max, v.split(".")[1]?.length ?? 0), 0);
  const divisor = 10n ** BigInt(scale);
  const total = known.reduce((sum, value) => {
    const negative = value.startsWith("-"),
      [whole, fraction = ""] = value.replace("-", "").split(".");
    return (
      sum +
      (negative ? -1n : 1n) *
        (BigInt(whole!) * divisor + BigInt(fraction.padEnd(scale, "0") || "0"))
    );
  }, 0n);
  const absolute = total < 0n ? -total : total;
  return {
    value:
      (total < 0n ? "-" : "") +
      (absolute / divisor).toString() +
      (scale ? "." + (absolute % divisor).toString().padStart(scale, "0") : ""),
    unknown: rows.length - known.length,
  };
}

export function compareEvidence(a: unknown, b: unknown) {
  const av = text(a),
    bv = text(b);
  if (!/^-?\d+(?:\.\d+)?$/.test(av) || !/^-?\d+(?:\.\d+)?$/.test(bv)) return av.localeCompare(bv);
  const scale = Math.max(av.split(".")[1]?.length ?? 0, bv.split(".")[1]?.length ?? 0);
  const n = (value: string) => {
    const [whole, fraction = ""] = value.replace("-", "").split(".");
    return (
      (value.startsWith("-") ? -1n : 1n) *
      (BigInt(whole!) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0") || "0"))
    );
  };
  const an = n(av),
    bn = n(bv);
  return an === bn ? 0 : an > bn ? 1 : -1;
}
