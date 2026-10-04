import JsBarcode from "jsbarcode";

/** Local Code 128 symbol; quiet zones and identity only, never financial values. */
export function fabricBarcodeBars(code: string): string {
  const target = {} as { encodings: { data: string }[] };
  JsBarcode(target, code, { format: "CODE128", displayValue: false });
  return target.encodings.map((encoding) => encoding.data).join("");
}

export function printFabricLabel(element: HTMLElement, title = "Fabric Barcode label") {
  const frame = document.createElement("iframe");
  frame.title = title;
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", width: "0", height: "0", border: "0" });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    throw new Error("Print preview could not open");
  }
  const style = doc.createElement("style");
  doc.title = title;
  style.textContent =
    "@page{margin:8mm}body{font:14px Arial;color:black;background:white}svg{width:120mm;max-width:100%;height:28mm;shape-rendering:crispEdges}p{margin:5px 0}button{display:none}article{break-inside:avoid}";
  doc.head.appendChild(style);
  doc.body.appendChild(element.cloneNode(true));
  win.addEventListener("afterprint", () => frame.remove(), { once: true });
  win.focus();
  win.print();
  window.setTimeout(() => frame.remove(), 60000);
}
