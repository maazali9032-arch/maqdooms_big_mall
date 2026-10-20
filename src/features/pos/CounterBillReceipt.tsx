import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Panel } from "@/shared/components/page";
import { BarcodeGraphic } from "@/features/tailoring/ProductionDocument";
import { reportMoney, reportQuantity } from "@/features/reports/report-value";
import { printFabricLabel } from "@/features/inventory/fabric-label";
import { GstInvoiceSummary, GstTailoringComponents } from "@/features/gst/GstInvoicePresentation";
export type GstInvoice = {
  invoice_number: string;
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
    `<!doctype html><html><head><title>${title.replace(/[<>]/g, "")}</title><style>@page{size:${width}mm auto;margin:2mm}*{box-sizing:border-box}body{margin:0;width:${width - 4}mm;font:10px/1.25 ui-monospace,monospace;color:#000}h2{font-size:13px;margin:0;text-align:center}p{margin:2px 0}.thermal-invoice{width:100%}.screen-only{display:none}.line{border-top:1px dashed #000;padding:3px 0}.row{display:flex;justify-content:space-between;gap:4px}.right{text-align:right}.strong{font-weight:700}@media print{button{display:none}}</style></head><body>${node.innerHTML}</body></html>`,
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
        <h2 className="text-center text-base font-semibold">
          {receipt.tax?.business.trading_name ?? "MAQDOOM’S Big Mall"}
        </h2>
        {receipt.tax && (
          <>
            <p className="text-center text-[10px]">
              {receipt.tax.business.address}
              <br />
              GSTIN: {receipt.tax.business.gstin} · {receipt.tax.business.contact}
            </p>
            <p className="text-center font-semibold">TAX INVOICE</p>
          </>
        )}
        <p className="break-all font-mono text-xs">{receipt.code}</p>
        <div>
          <BarcodeGraphic code={receipt.scan_code ?? receipt.code} />
          {receipt.scan_code && (
            <p className="text-center font-mono text-xs">{receipt.scan_code}</p>
          )}
        </div>
        <p className="text-sm">
          {new Date(receipt.created_at).toLocaleString("en-IN")} · {receipt.source}
          {receipt.pos_code ? ` · ${receipt.pos_code}` : ""}
        </p>
        {(receipt.customer?.name || receipt.customer?.phone) && (
          <p className="text-sm">
            {receipt.customer.name} {receipt.customer.phone}
          </p>
        )}
        <div className="divide-y rounded-lg border">
          {receipt.lines.map((line) => (
            <div key={line.id} className="space-y-1 p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{line.name}</strong>
                <strong>
                  {reportMoney(
                    receipt.tax?.lines.some((taxLine) => taxLine.source_item_id === line.id)
                      ? receipt.tax.lines
                          .filter((taxLine) => taxLine.source_item_id === line.id)
                          .reduce((sum, taxLine) => sum + BigInt(taxLine.final_paise), 0n)
                          .toString()
                      : line.amount_paise,
                  )}
                </strong>
              </div>
              {line.barcode && <p className="break-all font-mono text-xs">{line.barcode}</p>}
              {line.source && <p className="text-xs">Stock source: {line.source}</p>}
              {line.size && (
                <p>
                  Size {line.size} · {line.design}
                </p>
              )}
              {line.kind === "fabric" && (
                <p>
                  {reportQuantity(line.quantity, line.unit)} × {reportMoney(line.price_paise!)} / m
                </p>
              )}
              {line.kind === "tailoring" && (
                <>
                  <p>
                    {receipt.tax?.tailoring_display !== "combined" &&
                    line.fabric_amount_paise != null &&
                    line.stitching_paise != null
                      ? `Fabric ${reportMoney(line.fabric_amount_paise)} + Stitching ${reportMoney(line.stitching_paise)} · Delivery: ${line.delivery_date}`
                      : `Customer tailoring · Entire job total · Delivery: ${line.delivery_date}`}
                  </p>
                  {receipt.tax && <GstTailoringComponents tax={receipt.tax} sourceItem={line.id} />}
                  <p className="break-all font-mono text-xs">{line.job_code}</p>
                  {line.design && <p>Design: {line.design}</p>}
                  {line.fabrics?.map((cut, i) => (
                    <p key={i} className="break-words">
                      {cut.name} · {cut.barcode} · {reportQuantity(cut.quantity_mm, "mm")}
                      {cut.source ? ` · ${cut.source}` : ""}
                    </p>
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
        {receipt.tax && <GstInvoiceSummary tax={receipt.tax} />}
        <div className="flex justify-between border-t pt-3">
          <strong>Total {reportMoney(receipt.total_paise)}</strong>
          <strong>
            {receipt.paid ? "Paid" : receipt.paid_amount_paise ? "Advance received" : "Unpaid"}
          </strong>
        </div>
        {receipt.paid_amount_paise !== undefined && (
          <div className="flex justify-between text-sm">
            <span>Advance {reportMoney(receipt.paid_amount_paise)}</span>
            <strong>Balance {reportMoney(receipt.balance_paise ?? "0")}</strong>
          </div>
        )}
        {receipt.paid_at && (
          <p className="text-xs">Paid: {new Date(receipt.paid_at).toLocaleString("en-IN")}</p>
        )}
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
              <div ref={tailorPrintable} className="space-y-4 bg-white p-4 text-black">
                <h2 className="text-xl font-semibold">MAQDOOM’S Big Mall · Tailor work order</h2>
                <p className="font-mono text-xs">Customer bill: {receipt.code}</p>
                {tailorOrder.data.map((job) => (
                  <section key={job.job_code} className="rounded border p-3 text-sm">
                    <strong>{job.garment}</strong>
                    <p className="font-mono text-xs">{job.job_code}</p>
                    <BarcodeGraphic code={job.scan_code ?? job.job_code} />
                    {job.scan_code && <p className="font-mono text-xs">{job.scan_code}</p>}
                    <p>
                      Delivery: {job.delivery_date} · {job.factory} → {job.tailor}
                    </p>
                    {job.design && <p>Design: {job.design}</p>}
                    {job.notes && <p>Notes: {job.notes}</p>}
                    <div className="mt-2 border-t pt-2">
                      <strong>Fabric to stitch</strong>
                      {job.fabrics.map((fabric, index) => (
                        <p key={index}>
                          {fabric.name} · {reportQuantity(fabric.quantity_mm, "mm")} ·{" "}
                          {fabric.barcode}
                        </p>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <Button
                onClick={() =>
                  tailorPrintable.current &&
                  printFabricLabel(tailorPrintable.current, `Tailor work order ${receipt.code}`)
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

type TailorOrder = {
  job_code: string;
  scan_code?: string | null;
  garment: string;
  delivery_date: string;
  design: string | null;
  notes: string | null;
  factory: string;
  tailor: string;
  fabrics: { barcode: string; name: string; quantity_mm: string }[];
};
