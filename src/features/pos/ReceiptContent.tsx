import { deliveryDate } from "./receipt-format";
import { BarcodeGraphic } from "@/features/tailoring/ProductionDocument";
import { reportMoney, reportQuantity } from "@/features/reports/report-value";
import { GstInvoiceSummary, GstTailoringComponents } from "@/features/gst/GstInvoicePresentation";
import type { CounterReceipt } from "./CounterBillReceipt";

/** Customer presentation deliberately excludes internal location/operator/job identifiers. */
export function CustomerReceiptContent({ receipt }: { receipt: CounterReceipt }) {
  const tailoring = receipt.lines.some((line) => line.kind === "tailoring");
  const received = receipt.paid_amount_paise ?? (receipt.paid ? receipt.total_paise : "0");
  const balance =
    receipt.balance_paise ?? (BigInt(receipt.total_paise) - BigInt(received)).toString();
  const payment = receipt.tax?.payment_method?.replaceAll("_", " ");
  return (
    <>
      <h2 className="invoice-heading text-center text-base font-semibold">
        {receipt.tax?.business.trading_name ?? "MAQDOOM’S Big Mall"}
      </h2>
      {receipt.tax && (
        <p className="invoice-business text-center text-[10px]">
          {receipt.tax.business.address}
          <br />
          GSTIN: {receipt.tax.business.gstin}
          <br />
          {receipt.tax.business.contact}
        </p>
      )}
      <p className="invoice-heading text-center font-semibold">
        {receipt.tax ? "TAX INVOICE" : "SALES RECEIPT"}
      </p>
      <p className="invoice-reference break-all font-mono text-xs">
        Invoice: {receipt.tax?.invoice_number ?? receipt.code}
      </p>
      <BarcodeGraphic code={receipt.scan_code ?? receipt.code} />
      {receipt.scan_code && (
        <p className="invoice-heading text-center font-mono text-xs">{receipt.scan_code}</p>
      )}
      <p className="invoice-meta text-xs">
        Date:{" "}
        {new Date(receipt.created_at).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
      {(receipt.customer?.name || receipt.customer?.phone) && (
        <p className="invoice-meta text-xs">
          Customer: {receipt.customer.name}
          {receipt.customer.phone ? ` · ${receipt.customer.phone}` : ""}
        </p>
      )}
      {receipt.tax?.customer.gstin && (
        <p className="text-xs">Customer GSTIN: {receipt.tax.customer.gstin}</p>
      )}
      <div>
        {receipt.lines.map((line) => {
          const components =
            receipt.tax?.lines.filter((tax) => tax.source_item_id === line.id) ?? [];
          const amount = components.length
            ? components.reduce((sum, tax) => sum + BigInt(tax.final_paise), 0n).toString()
            : line.amount_paise;
          return (
            <section
              key={line.id}
              className="invoice-line space-y-1 border-t border-dashed py-2 text-xs"
            >
              <div className="invoice-row flex justify-between gap-2 font-semibold">
                <strong>{line.name}</strong>
                <strong>{reportMoney(amount)}</strong>
              </div>
              {line.kind === "fabric" && (
                <p>
                  {reportQuantity(line.quantity, line.unit)} × {reportMoney(line.price_paise!)} / m
                  {receipt.tax
                    ? receipt.tax.price_mode === "inclusive"
                      ? " (incl. GST)"
                      : " (before GST)"
                    : ""}
                </p>
              )}
              {line.size && (
                <p>
                  Size: {line.size}
                  {line.design ? ` · ${line.design}` : ""}
                </p>
              )}
              {line.kind === "tailoring" && (
                <>
                  <p>Delivery: {deliveryDate(line.delivery_date)}</p>
                  {line.design && <p>Design: {line.design}</p>}
                  {line.fabrics?.map((fabric, index) => (
                    <p key={index}>
                      {fabric.name} · {reportQuantity(fabric.quantity_mm, "mm")} for stitching
                    </p>
                  ))}
                  {receipt.tax ? (
                    <GstTailoringComponents tax={receipt.tax} sourceItem={line.id} />
                  ) : (
                    line.fabric_amount_paise != null &&
                    line.stitching_paise != null && (
                      <p>
                        Fabric {reportMoney(line.fabric_amount_paise)} + Stitching{" "}
                        {reportMoney(line.stitching_paise)}
                      </p>
                    )
                  )}
                </>
              )}
              {line.kind !== "tailoring" &&
                components.map((tax) => (
                  <p key={tax.id}>
                    HSN/SAC {tax.classification_code} · GST {tax.rate_bps / 100}%
                  </p>
                ))}
            </section>
          );
        })}
      </div>
      {receipt.tax ? (
        <GstInvoiceSummary tax={receipt.tax} />
      ) : (
        <div className="invoice-row invoice-total flex justify-between border-t pt-2 font-bold">
          <span>Total</span>
          <span>{reportMoney(receipt.total_paise)}</span>
        </div>
      )}
      <div className="invoice-payment space-y-1 border-t pt-2 text-xs">
        {tailoring ? (
          <>
            <div className="invoice-row flex justify-between">
              <span>{receipt.paid ? "Amount paid" : "Advance received"}</span>
              <strong>{reportMoney(received)}</strong>
            </div>
            <div className="invoice-row flex justify-between">
              <strong>Balance due</strong>
              <strong>{reportMoney(balance)}</strong>
            </div>
          </>
        ) : (
          <p className="font-semibold">{receipt.paid ? "Paid in full" : "Unpaid"}</p>
        )}
        {payment && <p className="capitalize">Payment: {payment}</p>}
      </div>
    </>
  );
}

export type TailorOrder = {
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

/** Price-free work sheet: each garment retains its own scannable job identity. */
export function TailorWorkOrderContent({
  receipt,
  jobs,
}: {
  receipt: CounterReceipt;
  jobs: TailorOrder[];
}) {
  return (
    <>
      <h2 className="invoice-heading text-center text-base font-semibold">
        {receipt.tax?.business.trading_name ?? "MAQDOOM’S Big Mall"}
      </h2>
      <p className="invoice-heading text-center font-semibold">TAILOR WORK ORDER</p>
      <p className="invoice-reference break-all text-xs">
        Customer bill ref: {receipt.scan_code ?? receipt.code}
      </p>
      {receipt.customer?.name && <p className="text-xs">Customer: {receipt.customer.name}</p>}
      {jobs.map((job) => (
        <section
          key={job.job_code}
          className="invoice-line space-y-1 border-t border-dashed py-2 text-xs"
        >
          <strong className="block text-sm">{job.garment}</strong>
          <BarcodeGraphic code={job.scan_code ?? job.job_code} />
          <p className="invoice-heading text-center font-mono">{job.scan_code ?? job.job_code}</p>
          <p>
            <strong>Delivery:</strong> {deliveryDate(job.delivery_date)}
          </p>
          <p>
            <strong>Factory:</strong> {job.factory}
          </p>
          <p>
            <strong>Tailor:</strong> {job.tailor}
          </p>
          {job.design && (
            <p>
              <strong>Design:</strong> {job.design}
            </p>
          )}
          {job.notes && (
            <p className="whitespace-pre-wrap">
              <strong>Instructions:</strong> {job.notes}
            </p>
          )}
          <p className="font-semibold">Fabric issued</p>
          {job.fabrics.map((fabric, index) => (
            <div key={index} className="invoice-row flex justify-between gap-2">
              <span>
                {fabric.name}
                <small className="block">{fabric.barcode}</small>
              </span>
              <strong>{reportQuantity(fabric.quantity_mm, "mm")}</strong>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
