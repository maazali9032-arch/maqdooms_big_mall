import { reportMoney } from "@/features/reports/report-value";
import type { GstInvoice } from "@/features/pos/CounterBillReceipt";

/** Both screen and thermal printing render these fields from the immutable invoice, never live config. */
export function GstInvoiceSummary({ tax }: { tax: GstInvoice }) {
  const rates = [...new Set(tax.lines.map((line) => line.rate_bps))];
  const rate = rates.length === 1 ? rates[0] : undefined;
  const taxLabel = (name: string, divisor: number) =>
    rate == null ? name : `${name} (${rate / divisor}%)`;
  const payable = (
    <div className="invoice-row invoice-grand-total flex justify-between gap-2 text-base font-bold">
      <span>Invoice total</span>
      <span>{reportMoney(tax.final_paise)}</span>
    </div>
  );
  return (
    <div className="invoice-tax-summary space-y-1 border-t border-dashed pt-2 text-xs">
      {tax.invoice_display === "final_first" && payable}
      {tax.discount_paise && BigInt(tax.discount_paise) > 0n && (
        <div className="flex justify-between text-emerald-700">
          <span>Discount ({((tax.discount_bps ?? 0) / 100).toFixed(2)}%)</span>
          <span>-{reportMoney(tax.discount_paise)}</span>
        </div>
      )}
      <div className="flex justify-between">
        <span>Taxable amount</span>
        <span>{reportMoney(tax.taxable_paise)}</span>
      </div>
      {tax.supply_type === "intra_state" ? (
        <>
          <div className="flex justify-between">
            <span>{taxLabel("CGST", 200)}</span>
            <span>{reportMoney(tax.cgst_paise)}</span>
          </div>
          <div className="flex justify-between">
            <span>{taxLabel("SGST", 200)}</span>
            <span>{reportMoney(tax.sgst_paise)}</span>
          </div>
        </>
      ) : (
        <div className="flex justify-between">
          <span>{taxLabel("IGST", 100)}</span>
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
          <div key={line.id} className="invoice-component text-xs">
            <div className="invoice-row flex justify-between gap-2">
              <span>{line.description}</span>
              <span>
                {reportMoney(
                  line.entered_amount_paise ??
                    (tax.price_mode === "inclusive" ? line.final_paise : line.taxable_paise),
                )}
              </span>
            </div>
            <p>
              HSN/SAC {line.classification_code} · GST {line.rate_bps / 100}%
            </p>
          </div>
        ))}
    </>
  );
}
