import { deliveryDate, receiptBarcodeGeometry } from "./receipt-format";
import { Fragment } from "react";
import { BarcodeGraphic } from "@/features/tailoring/ProductionDocument";
import { reportMoney, reportQuantity } from "@/features/reports/report-value";
import { GstInvoiceSummary, GstTailoringComponents } from "@/features/gst/GstInvoicePresentation";
import type { CounterReceipt } from "./CounterBillReceipt";

function CustomerBillBarcode({ code }: { code: string }) {
  const { bars, modules, widthMm } = receiptBarcodeGeometry(code);
  return (
    <svg
      role="img"
      aria-label={`Barcode ${code}`}
      viewBox={`0 0 ${modules} 60`}
      preserveAspectRatio="none"
      className="invoice-barcode-symbol"
      style={{ width: `${widthMm}mm` }}
      shapeRendering="crispEdges"
    >
      <rect width="100%" height="100%" fill="white" />
      {[...bars].map((bit, index) =>
        bit === "1" ? <rect key={index} x={index + 10} width="1" height="60" fill="black" /> : null,
      )}
    </svg>
  );
}

/** Customer presentation deliberately excludes internal location/operator/job identifiers. */
export function CustomerReceiptContent({ receipt }: { receipt: CounterReceipt }) {
  const tradingName = receipt.tax?.business.trading_name ?? "MAQDOOM’S Big Mall";
  const mallBrand = / big mall$/i.test(tradingName);
  const fabricOnly = receipt.lines.every((line) => line.kind === "fabric");
  const tailoring = receipt.lines.some((line) => line.kind === "tailoring");
  const hasTailoringBreakdown = receipt.lines.some(
    (line) =>
      line.kind === "tailoring" &&
      (line.fabric_amount_paise != null || line.stitching_paise != null),
  );
  const received = receipt.paid_amount_paise ?? (receipt.paid ? receipt.total_paise : "0");
  const balance =
    receipt.balance_paise ?? (BigInt(receipt.total_paise) - BigInt(received)).toString();
  const priceMode = receipt.tax?.price_mode ?? "inclusive";
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
      <header className="invoice-brand text-center">
        <h2 className="invoice-heading font-semibold">
          {mallBrand ? (
            <>
              {tradingName.replace(/ big mall$/i, "")}
              <span className="invoice-brand-subtitle">BIG MALL</span>
            </>
          ) : (
            tradingName
          )}
        </h2>
        {receipt.tax && (
          <p className="invoice-business">
            {receipt.tax.business.address}
            <br />
            GSTIN: {receipt.tax.business.gstin}
            {receipt.tax.business.contact && (
              <>
                <br />
                {receipt.tax.business.contact}
              </>
            )}
          </p>
        )}
        <h3 className="invoice-title">{receipt.tax ? "TAX INVOICE" : "SALES RECEIPT"}</h3>
      </header>
      <div className="invoice-identification">
        <p className="invoice-bill-number">
          Bill No: <strong>{receipt.scan_code ?? receipt.code}</strong>
        </p>
        <p className="invoice-date">
          Date:{" "}
          {new Date(receipt.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}
          <br />
          Time:{" "}
          {new Date(receipt.created_at).toLocaleTimeString("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
      {(receipt.customer?.name || receipt.customer?.phone) && (
        <p className="invoice-meta text-xs">
          Customer: {receipt.customer.name}
          {receipt.customer.phone ? ` · ${receipt.customer.phone}` : ""}
        </p>
      )}
      {receipt.tax?.customer.gstin && (
        <p className="text-xs">Customer GSTIN: {receipt.tax.customer.gstin}</p>
      )}
      <div className="invoice-barcode">
        <CustomerBillBarcode code={receipt.scan_code ?? receipt.code} />
        <p>{receipt.scan_code ?? receipt.code}</p>
      </div>
      {receipt.exchange && (
        <div className="invoice-cost-summary space-y-1 border-y py-2 text-xs">
          <p className="font-semibold">Finished-product exchange</p>
          <p>Original bill: {receipt.exchange.original_bill_code}</p>
          {receipt.exchange.returns?.map((item) => (
            <p key={`return-${item.barcode}`}>
              Return · {item.name} · {item.barcode} · {reportMoney(item.value_paise)}
            </p>
          ))}
          {receipt.exchange.replacements?.map((item) => (
            <p key={`replacement-${item.barcode}`}>
              Replacement · {item.name} · {item.barcode} · {reportMoney(item.value_paise)}
            </p>
          ))}
          <div className="invoice-row flex justify-between">
            <span>Return credit</span>
            <strong>{reportMoney(receipt.exchange.return_credit_paise ?? "0")}</strong>
          </div>
          <div className="invoice-row flex justify-between">
            <span>Replacement value</span>
            <strong>{reportMoney(receipt.exchange.replacement_value_paise ?? "0")}</strong>
          </div>
          <div className="invoice-row flex justify-between">
            <strong>
              {BigInt(receipt.exchange.net_difference_paise ?? "0") >= 0n
                ? "Amount collected"
                : "Amount refunded"}
            </strong>
            <strong>
              {reportMoney(
                (BigInt(receipt.exchange.net_difference_paise ?? "0") < 0n
                  ? -BigInt(receipt.exchange.net_difference_paise ?? "0")
                  : BigInt(receipt.exchange.net_difference_paise ?? "0")
                ).toString(),
              )}
            </strong>
          </div>
          {receipt.exchange.payment_method && (
            <p className="capitalize">
              Method: {receipt.exchange.payment_method.replaceAll("_", " ")}
            </p>
          )}
        </div>
      )}
      <details className="screen-only invoice-accounting-reference">
        <summary>Accounting invoice reference</summary>
        {receipt.tax?.invoice_number ?? receipt.code}
      </details>
      <table className="invoice-items">
        <colgroup>
          <col className="item-number" />
          <col className="item-description" />
          <col className="item-quantity" />
          <col className="item-rate" />
          <col className="item-amount" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Item</th>
            <th scope="col">{fabricOnly ? "Qty (m)" : "Qty"}</th>
            <th scope="col">Rate (₹)</th>
            <th scope="col">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line, index) => {
            const components =
              receipt.tax?.lines.filter((tax) => tax.source_item_id === line.id) ?? [];
            const amount = components.length
              ? components
                  .reduce(
                    (sum, tax) =>
                      sum + BigInt(priceMode === "exclusive" ? tax.taxable_paise : tax.final_paise),
                    0n,
                  )
                  .toString()
              : line.amount_paise;
            return (
              <Fragment key={line.id}>
                <tr className="invoice-line">
                  <td>{index + 1}</td>
                  <td className="invoice-item-details">
                    <strong>{line.name}</strong>
                    {line.kind === "fabric" && (
                      <p className="break-all invoice-fabric-reference">
                        <span className="sr-only">Fabric ref: </span>
                        {line.barcode ?? "Not recorded"}
                      </p>
                    )}
                    {line.size && (
                      <p>
                        Size: {line.size}
                        {line.design ? ` · ${line.design}` : ""}
                      </p>
                    )}
                    {line.kind !== "tailoring" &&
                      components.map((tax) => (
                        <p key={tax.id}>
                          HSN/SAC {tax.classification_code} · GST {tax.rate_bps / 100}%
                        </p>
                      ))}
                  </td>
                  <td className="invoice-numeric">
                    {line.kind === "tailoring"
                      ? "—"
                      : line.unit === "mm"
                        ? fabricOnly
                          ? reportQuantity(line.quantity, line.unit).replace(/ m$/, "")
                          : reportQuantity(line.quantity, line.unit)
                        : `${line.quantity} ${line.unit}`}
                  </td>
                  <td className="invoice-numeric">
                    {line.kind === "tailoring" || line.price_paise == null
                      ? "—"
                      : reportMoney(line.price_paise).replace("₹", "")}
                  </td>
                  <td className="invoice-numeric invoice-line-amount">
                    {reportMoney(amount).replace("₹", "")}
                  </td>
                </tr>
                {line.kind === "tailoring" && (
                  <tr className="invoice-tailoring-detail">
                    <td></td>
                    <td colSpan={4}>
                      {" "}
                      {line.kind === "tailoring" && (
                        <>
                          {line.delivery_date && (
                            <p>Delivery: {deliveryDate(line.delivery_date)}</p>
                          )}
                          {line.fabrics?.map((fabric, index) => (
                            <p key={index}>
                              {fabric.name} · {reportQuantity(fabric.quantity_mm, "mm")} for
                              stitching
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
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {receipt.tax && (
        <p className="invoice-price-basis">
          Item rates and amounts {priceMode === "inclusive" ? "include GST" : "exclude GST"}.
        </p>
      )}
      {tailoring && hasTailoringBreakdown && (
        <div className="invoice-cost-summary space-y-1 border-t pt-2 text-xs">
          <p className="font-semibold">
            Sale summary
            {priceMode === "inclusive" ? " (including GST)" : receipt.tax ? " (before GST)" : ""}
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
        <div className="invoice-row flex justify-between">
          <span>Amount paid</span>
          <strong>{reportMoney(received)}</strong>
        </div>
        <div className="invoice-row flex justify-between">
          <strong>Balance due</strong>
          <strong>{reportMoney(balance)}</strong>
        </div>
        {payment && <p className="capitalize">Payment Mode: {payment}</p>}
        {BigInt(received) > 0n && receipt.paid_at && (
          <p>
            Paid On:{" "}
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
        <div className="invoice-row flex justify-between font-semibold">
          <span>Payment status</span>
          <span
            className={`invoice-status ${paymentStatus === "Paid" ? "is-paid" : "is-outstanding"}`}
          >
            {paymentStatus}
          </span>
        </div>
      </div>
      <footer className="invoice-footer">
        Thank you for shopping at
        <br />
        <strong>{receipt.tax?.business.trading_name ?? "MAQDOOM’S Big Mall"}</strong>
      </footer>
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
