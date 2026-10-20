import { receiptPrintStyles } from "./receipt-format";
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Panel } from "@/shared/components/page";
import { CustomerReceiptContent, TailorWorkOrderContent, type TailorOrder } from "./ReceiptContent";
export type GstInvoice = {
  invoice_number: string;
  price_mode?: "inclusive" | "exclusive";
  invoice_display: "final_first" | "taxable_first";
  tailoring_display: "separate" | "combined";
  supply_type: string;
  payment_method: string | null;
  business: {
    legal_name: string;
    trading_name: string;
    address: string;
    contact: string;
    gstin: string;
    state_code: string;
  };
  customer: {
    name?: string | null;
    phone?: string | null;
    gstin?: string | null;
    state_code?: string | null;
  };
  taxable_paise: string;
  cgst_paise: string;
  sgst_paise: string;
  igst_paise: string;
  gst_paise: string;
  final_paise: string;
  lines: {
    id: string;
    source_item_id: string;
    description: string;
    classification_code: string;
    quantity: string;
    unit: string;
    rate_bps: number;
    taxable_paise: string;
    gst_paise: string;
    final_paise: string;
  }[];
};
export type CounterReceipt = {
  id: string;
  code: string;
  scan_code?: string | null;
  created_at: string;
  total_paise: string;
  paid_amount_paise?: string;
  balance_paise?: string;
  pos_code?: string | null;
  paid: boolean;
  paid_at: string | null;
  source: string;
  salesperson: string;
  customer: { name: string | null; phone: string | null };
  lines: {
    id: string;
    kind: string;
    barcode: string | null;
    name: string;
    size: string | null;
    design: string | null;
    quantity: string;
    unit: string;
    price_paise: string | null;
    amount_paise: string;
    source?: string | null;
    fabric_amount_paise?: string | null;
    stitching_paise?: string | null;
    job_id: string | null;
    job_code: string | null;
    delivery_date: string | null;
    fabrics:
      { barcode: string; name: string; quantity_mm: string; source?: string | null }[] | null;
  }[];
  tax?: GstInvoice | null;
};
function printThermal(node: HTMLElement, title: string, width: 58 | 80) {
  const popup = window.open("", "_blank", "width=520,height=760");
  if (!popup) throw new Error("Allow pop-ups to print the invoice");
  popup.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<>]/g, "")}</title><style>${receiptPrintStyles(width)}</style></head><body>${node.innerHTML}</body></html>`,
  );
  popup.document.close();
  popup.focus();
  setTimeout(() => popup.print(), 150);
}
export function CounterBillReceipt({ receipt }: { receipt: CounterReceipt }) {
  const printable = useRef<HTMLDivElement>(null);
  const tailorPrintable = useRef<HTMLDivElement>(null);
  const tailorOrder = useQuery({
    queryKey: ["tailor-work-order", receipt.id],
    enabled: false,
    queryFn: async () => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: Error | null }>
      )("tailor_work_order", {
        p_bill: receipt.id,
      });
      if (error) throw error;
      return (data ?? []) as TailorOrder[];
    },
  });
  return (
    <Panel
      title="Customer bill"
      actions={
        <div className="flex gap-2">
          <Button
            onClick={() =>
              printable.current &&
              printThermal(printable.current, "Tax invoice " + receipt.code, 58)
            }
          >
            Print 58 mm
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              printable.current &&
              printThermal(printable.current, "Tax invoice " + receipt.code, 80)
            }
          >
            Print 80 mm
          </Button>
        </div>
      }
    >
      <div
        ref={printable}
        className="thermal-invoice mx-auto max-w-[58mm] space-y-2 border bg-white p-2 text-black shadow-sm"
      >
        <CustomerReceiptContent receipt={receipt} />
      </div>
      {receipt.lines.some((line) => line.kind === "tailoring") && (
        <div className="mt-5 border-t pt-4">
          <Button
            variant="outline"
            disabled={tailorOrder.isFetching}
            onClick={() =>
              void tailorOrder.refetch().then((result) => {
                if (result.error) toast.error(result.error.message);
              })
            }
          >
            {tailorOrder.isFetching ? "Preparing tailor work order…" : "Prepare tailor work order"}
          </Button>
          {tailorOrder.data?.length ? (
            <div className="mt-4 space-y-3">
              <div
                ref={tailorPrintable}
                className="thermal-invoice mx-auto max-w-[80mm] space-y-2 border bg-white p-3 text-black"
              >
                <TailorWorkOrderContent receipt={receipt} jobs={tailorOrder.data} />
              </div>
              <Button
                onClick={() =>
                  tailorPrintable.current &&
                  printThermal(
                    tailorPrintable.current,
                    `Tailor work order ${receipt.scan_code ?? receipt.code}`,
                    80,
                  )
                }
              >
                Print tailor work order
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
