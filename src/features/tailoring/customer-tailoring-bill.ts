import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CounterReceipt } from "@/features/pos/CounterBillReceipt";
import { CustomerReceiptContent } from "@/features/pos/ReceiptContent";
import { receiptPrintStyles } from "@/features/pos/receipt-format";

export type CustomerTailoringBill = {
  salesperson_user_id?: string | null;
  order_code: string;
  garment: string;
  source_name: string;
  created_at: string;
  customer_snapshot: { name: string | null; phone?: string | null; whatsapp_phone?: string | null };
  final_customer_price_paise: number | null;
  issues: { fabric_name: string; batch_code: string; quantity_mm: number; barcode?: string }[];
};

function receiptForCustomerTailoring(bill: CustomerTailoringBill): CounterReceipt {
  if (
    !Number.isSafeInteger(bill.final_customer_price_paise) ||
    bill.final_customer_price_paise! < 0
  ) {
    throw new Error("Authorized final customer price required for bill");
  }
  const total = String(bill.final_customer_price_paise);
  return {
    id: bill.order_code,
    code: bill.order_code,
    created_at: bill.created_at,
    total_paise: total,
    paid_amount_paise: "0",
    balance_paise: total,
    paid: false,
    paid_at: null,
    source: bill.source_name,
    salesperson: "",
    customer: { name: bill.customer_snapshot.name, phone: bill.customer_snapshot.phone ?? null },
    lines: [
      {
        id: bill.order_code,
        kind: "tailoring",
        barcode: null,
        name: bill.garment,
        size: null,
        design: null,
        quantity: "1",
        unit: "job",
        price_paise: null,
        amount_paise: total,
        job_id: null,
        job_code: bill.order_code,
        delivery_date: null,
        fabrics: bill.issues.map((issue) => ({
          barcode: issue.barcode ?? issue.batch_code,
          name: issue.fabric_name,
          quantity_mm: String(issue.quantity_mm),
        })),
      },
    ],
  };
}

export function customerTailoringBillHtml(bill: CustomerTailoringBill) {
  const receipt = receiptForCustomerTailoring(bill);
  const content = renderToStaticMarkup(
    createElement(
      "div",
      { className: "thermal-invoice customer-invoice" },
      createElement(CustomerReceiptContent, { receipt }),
    ),
  );
  return `<!doctype html><html><head><meta charset="utf-8"><title>${bill.order_code.replace(/[<>]/g, "")}</title><style>${receiptPrintStyles()}</style></head><body>${content}</body></html>`;
}

export function printCustomerTailoringBill(bill: CustomerTailoringBill) {
  const popup = window.open("", "_blank", "width=520,height=760");
  if (!popup) throw new Error("Allow the bill print window");
  popup.document.write(customerTailoringBillHtml(bill));
  popup.document.close();
  popup.focus();
  setTimeout(() => popup.print(), 150);
}
