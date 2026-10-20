export function deliveryDate(value: string | null) {
  if (!value) return "To be confirmed";
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

/** Explicit CSS is required: print windows do not inherit Tailwind from the app. */
export function receiptPrintStyles(width: 58 | 80) {
  return `@page{size:${width}mm auto;margin:2mm}*{box-sizing:border-box}body{margin:0;width:${width - 4}mm;font:11px/1.35 Arial,sans-serif;color:#000;background:white}h2,p{margin:3px 0}.invoice-heading{text-align:center}h2{font-size:14px}.invoice-business{font-size:10px;text-align:center}.invoice-reference{font:10px/1.3 monospace;overflow-wrap:anywhere}.invoice-meta{font-size:10px}.invoice-line{border-top:1px dashed #777;padding:7px 0;break-inside:avoid}.invoice-row,.invoice-tax-summary .flex{display:flex;justify-content:space-between;gap:8px}.invoice-row>strong:last-child{white-space:nowrap}.invoice-tax-summary,.invoice-payment,.invoice-total{border-top:1px dashed #777;padding-top:6px;margin-top:6px}.invoice-tax-summary .font-bold,.font-semibold{font-weight:bold}.invoice-tax-summary .text-base{font-size:14px}.invoice-payment p{text-transform:capitalize}small{display:block;font:9px monospace}.whitespace-pre-wrap{white-space:pre-wrap}svg{width:100%;height:18mm;shape-rendering:crispEdges}button,.screen-only{display:none}`;
}
