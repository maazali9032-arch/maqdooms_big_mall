import { createRoot } from "react-dom/client";
import { LabelPrintDialog } from "./LabelPrintDialog";

export function openLabelPrintDialog(element: HTMLElement, title: string) {
  const elements = [
    ...(element.matches("[data-barcode-label]") ? [element] : []),
    ...element.querySelectorAll<HTMLElement>("[data-barcode-label]"),
  ];
  const labels = elements.map((el) => ({
    code: el.dataset["code"] ?? "",
    name: el.dataset["name"] ?? "",
    description: el.dataset["description"] ?? "",
    detail: el.dataset["detail"] ?? "",
    price: el.dataset["price"] ?? "",
  }));
  if (!labels.length || labels.some((label) => !label.code))
    throw new Error("No valid barcode labels selected");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  root.render(<LabelPrintDialog labels={labels} title={title} close={close} />);
}
