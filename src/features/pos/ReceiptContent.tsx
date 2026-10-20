import { deliveryDate } from "./receipt-format";
import { Fragment } from "react";
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
  const paymentStatus =
    BigInt(balance) === 0n ? "Paid" : BigInt(received) > 0n ? "Partially paid" : "Unpaid";
  const fabricSubtotal = receipt.lines.reduce(
    (sum, line) =>
      sum +
      BigInt(
        line.kind === "fabric"
          ? line.amount_paise
          : line.kind === "tailoring"
            ? (line.fabric_amount_paise ?? "0")
            : "0",
      ),
    0n,
  );
  const stitchingSubtotal = receipt.lines.reduce(
    (sum, line) => sum + BigInt(line.stitching_paise ?? "0"),
    0n,
  );
  const finishedSubtotal = receipt.lines.reduce(
    (sum, line) => sum + BigInt(line.kind === "product" ? line.amount_paise : "0"),
    0n,
  );
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
      <p className="invoice-heading text-center font-semibold">
        Bill reference: {receipt.scan_code ?? receipt.code}
      </p>
      <BarcodeGraphic code={receipt.scan_code ?? receipt.code} />
      <p className="invoice-reference break-all font-mono text-xs">
        Invoice number: {receipt.tax?.invoice_number ?? receipt.code}
      </p>
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
                <>
                  <p className="break-all">Fabric ref: {line.barcode ?? "Not recorded"}</p>
                  <p>
                    {reportQuantity(line.quantity, line.unit)} × {reportMoney(line.price_paise!)} /
                    m
                    {receipt.tax
                      ? receipt.tax.price_mode === "inclusive"
                        ? " (incl. GST)"
                        : " (before GST)"
                      : ""}
                  </p>
                </>
              )}
              {line.size && (
                <p>
                  Size: {line.size}
                  {line.design ? ` · ${line.design}` : ""}
                </p>
              )}
              {line.kind === "tailoring" && (
                <>
                  {line.delivery_date && <p>Delivery: {deliveryDate(line.delivery_date)}</p>}
                  {line.fabrics?.map((fabric, index) => (
                    <p key={index}>
                      {fabric.name} · {reportQuantity(fabric.quantity_mm, "mm")} for stitching
                      <br />
                      <span className="break-all">Fabric ref: {fabric.barcode}</span>
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
      {tailoring && (
        <div className="invoice-cost-summary space-y-1 border-t pt-2 text-xs">
          <p className="font-semibold">
            Sale summary
            {receipt.tax?.price_mode === "inclusive"
              ? " (including GST)"
              : receipt.tax
                ? " (before GST)"
                : ""}
          </p>
          <div className="invoice-row flex justify-between">
            <span>Fabric</span>
            <span>{reportMoney(fabricSubtotal.toString())}</span>
          </div>
          <div className="invoice-row flex justify-between">
            <span>Stitching</span>
            <span>{reportMoney(stitchingSubtotal.toString())}</span>
          </div>
          {finishedSubtotal > 0n && (
            <div className="invoice-row flex justify-between">
              <span>Finished items</span>
              <span>{reportMoney(finishedSubtotal.toString())}</span>
            </div>
          )}
        </div>
      )}
      {receipt.tax ? (
        <GstInvoiceSummary tax={receipt.tax} />
      ) : (
        <div className="invoice-row invoice-total flex justify-between border-t pt-2 font-bold">
          <span>Total</span>
          <span>{reportMoney(receipt.total_paise)}</span>
        </div>
      )}
      <div className="invoice-payment space-y-1 border-t pt-2 text-xs">
        <div className="invoice-row flex justify-between font-semibold">
          <span>Payment status</span>
          <span>{paymentStatus}</span>
        </div>
        <div className="invoice-row flex justify-between">
          <span>Amount paid</span>
          <strong>{reportMoney(received)}</strong>
        </div>
        <div className="invoice-row flex justify-between">
          <strong>Balance due</strong>
          <strong>{reportMoney(balance)}</strong>
        </div>
        {payment && <p className="capitalize">Payment: {payment}</p>}
        {BigInt(received) > 0n && receipt.paid_at && (
          <p>
            Payment date:{" "}
            {new Date(receipt.paid_at).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        )}
      </div>
    </>
  );
}

export type TailorOrder = {
  job_code: string;
  scan_code?: string | null;
  status?: string;
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
      {jobs.map((job) => (
        <article
          key={job.job_code}
          className="workorder-sheet rounded-2xl border bg-white p-4 text-sm"
        >
          <header className="workorder-header flex items-start justify-between gap-3 border-b pb-4">
            <div>
              <h2 className="text-lg font-semibold">
                {receipt.tax?.business.trading_name ?? "MAQDOOM’S Big Mall"}
              </h2>
              <p className="text-xs uppercase text-muted-foreground">
                Customer stitching work order
              </p>
            </div>
            <span className="workorder-badge rounded bg-muted px-2 py-1 text-xs">
              Workshop copy
            </span>
          </header>
          <div className="workorder-meta grid grid-cols-2 gap-4 py-4">
            <div>
              <p className="workorder-label text-xs uppercase text-muted-foreground">Work order</p>
              <strong className="break-all">{job.scan_code ?? job.job_code}</strong>
            </div>
            <div>
              <p className="workorder-label text-xs uppercase text-muted-foreground">
                Customer bill
              </p>
              <strong className="break-all">{receipt.scan_code ?? receipt.code}</strong>
            </div>
          </div>
          <div className="workorder-barcode mx-auto max-w-[240px] text-center">
            <BarcodeGraphic code={job.scan_code ?? job.job_code} />
            <p className="text-xs">Scan to open this stitching job</p>
          </div>
          <section className="workorder-section mt-4 border-t py-4">
            <h3 className="mb-3 font-semibold">Garment details</h3>
            <dl className="space-y-3">
              <div className="workorder-row flex justify-between gap-4">
                <dt>Garment</dt>
                <dd className="text-right font-semibold">{job.garment}</dd>
              </div>
              {receipt.customer?.name && (
                <div className="workorder-row flex justify-between gap-4">
                  <dt>Customer</dt>
                  <dd className="text-right">{receipt.customer.name}</dd>
                </div>
              )}
              {job.fabrics.map((fabric, index) => (
                <Fragment key={index}>
                  <div className="workorder-row flex justify-between gap-4">
                    <dt>Fabric allocated</dt>
                    <dd className="text-right font-semibold">
                      {fabric.name} · {reportQuantity(fabric.quantity_mm, "mm")}
                    </dd>
                  </div>
                  <div className="workorder-row flex justify-between gap-4">
                    <dt>Fabric reference</dt>
                    <dd className="break-all text-right font-mono text-xs">{fabric.barcode}</dd>
                  </div>
                </Fragment>
              ))}
              <div className="workorder-row flex justify-between gap-4">
                <dt>Factory</dt>
                <dd className="text-right">{job.factory}</dd>
              </div>
              <div className="workorder-row flex justify-between gap-4">
                <dt>Assigned tailor</dt>
                <dd className="text-right font-semibold">{job.tailor}</dd>
              </div>
              {job.delivery_date && (
                <div className="workorder-row flex justify-between gap-4">
                  <dt>Delivery date</dt>
                  <dd className="text-right font-semibold">{deliveryDate(job.delivery_date)}</dd>
                </div>
              )}
              {job.status && (
                <div className="workorder-row flex justify-between gap-4">
                  <dt>Status</dt>
                  <dd className="workorder-status rounded bg-muted px-2 text-right capitalize">
                    {job.status.replaceAll("_", " ")}
                  </dd>
                </div>
              )}
            </dl>
          </section>
          <section className="workorder-section border-t pt-4">
            <h3 className="mb-3 font-semibold">Tailoring instructions</h3>
            {job.design && (
              <p>
                <strong>Design / style:</strong> {job.design}
              </p>
            )}
            {job.notes && <p className="whitespace-pre-wrap">{job.notes}</p>}
            {!job.design && !job.notes && (
              <p className="text-muted-foreground">No additional instructions recorded.</p>
            )}
          </section>
        </article>
      ))}
    </>
  );
}
