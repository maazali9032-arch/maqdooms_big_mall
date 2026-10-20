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
  return `@page{size:${width}mm auto;margin:2mm}*{box-sizing:border-box}body{margin:0;width:${width - 4}mm;font:11px/1.35 Arial,sans-serif;color:#000;background:white}h2,p{margin:3px 0}.invoice-heading{text-align:center}h2{font-size:14px}.invoice-business{font-size:10px;text-align:center}.invoice-reference{font:9px/1.3 monospace;overflow-wrap:anywhere}.invoice-meta{font-size:10px}.break-all{overflow-wrap:anywhere}.invoice-line{border-top:1px dashed #777;padding:7px 0;break-inside:avoid}.invoice-row,.invoice-tax-summary .flex{display:flex;justify-content:space-between;gap:8px}.invoice-row>strong:last-child,.invoice-grand-total>span:last-child{white-space:nowrap}.invoice-tax-summary,.invoice-payment,.invoice-total,.invoice-cost-summary{border-top:1px dashed #777;padding-top:6px;margin-top:6px}.invoice-grand-total{font-size:14px;font-weight:bold;margin:5px 0}.invoice-tax-summary .font-bold,.font-semibold{font-weight:bold}.capitalize{text-transform:capitalize}small{display:block;font:9px monospace}.whitespace-pre-wrap{white-space:pre-wrap}svg{width:100%;height:18mm;shape-rendering:crispEdges}.workorder-sheet{border:1px solid #bbb;border-radius:8px;padding:8px;margin-bottom:12px;break-inside:avoid}.workorder-header{display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid #ccc;padding-bottom:8px}.workorder-header h2{font-size:13px}.workorder-badge{font-size:9px;white-space:nowrap}.workorder-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px 0}.workorder-label{font-size:9px;text-transform:uppercase}.workorder-meta strong{font-size:10px;overflow-wrap:anywhere}.workorder-barcode{max-width:220px;margin:auto;text-align:center}.workorder-barcode p{font-size:9px}.workorder-section{border-top:1px solid #ccc;margin-top:8px;padding-top:8px}.workorder-section h3{font-size:11px;margin:0 0 8px}.workorder-row{display:flex;justify-content:space-between;gap:10px;margin-bottom:8px}.workorder-row dt{flex-shrink:0;font-size:10px}.workorder-row dd{margin:0;text-align:right;overflow-wrap:anywhere}.workorder-status{text-transform:capitalize}.workorder-section p{overflow-wrap:anywhere}button,.screen-only{display:none}`;
}
