import { reportMoney } from "@/features/reports/report-value";
import type { GstInvoice } from "@/features/pos/CounterBillReceipt";

/** Both screen and thermal printing render these fields from the immutable invoice, never live config. */
export function GstInvoiceSummary({ tax }: { tax: GstInvoice }) {
  const payable = <p className="text-base font-bold">Payable {reportMoney(tax.final_paise)}</p>;
  return (
    <div className="space-y-1 border-t border-dashed pt-2 text-xs">
      {tax.invoice_display === "final_first" && payable}
      <div className="flex justify-between">
        <span>Taxable</span>
        <span>{reportMoney(tax.taxable_paise)}</span>
      </div>
      {tax.supply_type === "intra_state" ? (
        <>
          <div className="flex justify-between">
            <span>CGST</span>
            <span>{reportMoney(tax.cgst_paise)}</span>
          </div>
          <div className="flex justify-between">
            <span>SGST</span>
            <span>{reportMoney(tax.sgst_paise)}</span>
          </div>
        </>
      ) : (
        <div className="flex justify-between">
          <span>IGST</span>
          <span>{reportMoney(tax.igst_paise)}</span>
        </div>
      )}
      <div className="flex justify-between font-semibold">
        <span>Total GST</span>
        <span>{reportMoney(tax.gst_paise)}</span>
      </div>
      {tax.invoice_display === "taxable_first" && payable}
    </div>
  );
}

export function GstTailoringComponents({
  tax,
  sourceItem,
}: {
  tax: GstInvoice;
  sourceItem: string;
}) {
  if (tax.tailoring_display !== "separate") return null;
  return (
    <>
      {tax.lines
        .filter((line) => line.source_item_id === sourceItem)
        .map((line) => (
          <p key={line.id} className="text-xs">
            {line.description} · HSN/SAC {line.classification_code} · Taxable{" "}
            {reportMoney(line.taxable_paise)} + GST {reportMoney(line.gst_paise)} ={" "}
            {reportMoney(line.final_paise)}
          </p>
        ))}
    </>
  );
}
