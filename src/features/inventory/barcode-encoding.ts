import JsBarcode from "jsbarcode";
export function fabricBarcodeBars(code: string): string {
  const target = {} as { encodings: { data: string }[] };
  JsBarcode(target, code, { format: "CODE128", displayValue: false });
  return target.encodings.map((encoding) => encoding.data).join("");
}
