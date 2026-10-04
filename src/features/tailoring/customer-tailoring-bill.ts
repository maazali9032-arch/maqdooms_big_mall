export type CustomerTailoringBill = {
  order_code: string;
  garment: string;
  source_name: string;
  created_at: string;
  customer_snapshot: { name: string | null; phone?: string | null; whatsapp_phone?: string | null };
  final_customer_price_paise: number | null;
  issues: { fabric_name: string; batch_code: string; quantity_mm: number }[];
};
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export function customerTailoringBillHtml(bill: CustomerTailoringBill) {
  if (
    !Number.isSafeInteger(bill.final_customer_price_paise) ||
    bill.final_customer_price_paise! < 0
  )
    throw new Error("Authorized final customer price required for bill");
  // Explicit safe projection: never serialize Owner cost data into print content.
  const price = BigInt(bill.final_customer_price_paise!);
  const displayPrice = `${price / 100n}.${(price % 100n).toString().padStart(2, "0")}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(bill.order_code)}</title>
  <style>body{font:16px system-ui;max-width:700px;margin:24px auto;padding:0 16px}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left;overflow-wrap:anywhere}@page{margin:12mm}@media print{body{margin:0;padding:0}thead{display:table-header-group}tr{break-inside:avoid}}</style></head>
  <body><h1>Maqdoom’s Big Mall</h1><h2>Customer Tailoring Order</h2><p>${escape(bill.order_code)}</p>
  <p>${escape(bill.customer_snapshot.name)} · ${escape(bill.customer_snapshot.phone)}<br>WhatsApp: ${escape(bill.customer_snapshot.whatsapp_phone)}</p>
  <p>Garment: ${escape(bill.garment)}<br>Location: ${escape(bill.source_name)}<br>Date: ${escape(bill.created_at)}</p>
  <table><thead><tr><th>Fabric / Batch</th><th>Required quantity</th></tr></thead><tbody>${bill.issues.map((i) => `<tr><td>${escape(i.fabric_name)} / ${escape(i.batch_code)}</td><td>${escape(i.quantity_mm / 1000)} m</td></tr>`).join("")}</tbody></table>
  <h3>Final customer price: ₹${displayPrice}</h3></body></html>`;
}
export function printCustomerTailoringBill(bill: CustomerTailoringBill) {
  const html = customerTailoringBillHtml(bill);
  const popup = window.open("", "_blank", "width=800,height=700");
  if (!popup) throw new Error("Allow the bill print window");
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
}
