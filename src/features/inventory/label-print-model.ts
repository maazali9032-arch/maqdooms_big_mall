import { fabricBarcodeBars } from "./barcode-encoding";
export type Sticker = {
  code: string;
  name: string;
  description: string;
  detail: string;
  price: string;
};
export type LabelProfile = {
  width: number;
  height: number;
  columns: number;
  gap: number;
  dpi: number;
};
export const STARTING_LABEL_PROFILE: LabelProfile = {
  width: 40,
  height: 30,
  columns: 2,
  gap: 3,
  dpi: 203,
};
export function validProfile(p: LabelProfile) {
  return (
    [p.width, p.height, p.columns, p.gap, p.dpi].every(Number.isFinite) &&
    p.width >= 20 &&
    p.width <= 108 &&
    p.height >= 20 &&
    p.height <= 150 &&
    [1, 2, 3].includes(p.columns) &&
    p.gap >= 0 &&
    p.gap <= 10 &&
    [203, 300].includes(p.dpi) &&
    p.width * p.columns + p.gap * (p.columns - 1) <= 108
  );
}
export function symbolSize(code: string, profile: LabelProfile) {
  const bars = fabricBarcodeBars(code),
    modules = bars.length + 20;
  const dotsPerMm = profile.dpi / 25.4;
  const dots = Math.floor(((profile.width - 4) * dotsPerMm) / modules);
  return { bars, modules, dots, width: (modules * dots) / dotsPerMm };
}
export function labelRows(labels: Sticker[], columns: number) {
  return Array.from({ length: Math.ceil(labels.length / columns) }, (_, i) =>
    labels.slice(i * columns, (i + 1) * columns),
  );
}
/** Standalone print CSS; never depends on the application's Tailwind styles. */
export function labelPrintCSS(p: LabelProfile) {
  if (!validProfile(p))
    throw new Error("Enter valid label and roll dimensions (up to 108 mm wide)");
  return `@page{size:${p.width * p.columns + p.gap * (p.columns - 1)}mm ${p.height}mm;margin:0}html,body{margin:0;padding:0;background:white;color:black}*{box-sizing:border-box}.label-row{display:grid;grid-template-columns:repeat(${p.columns},${p.width}mm);column-gap:${p.gap}mm;width:${p.width * p.columns + p.gap * (p.columns - 1)}mm;height:${p.height}mm;break-after:page;page-break-after:always;overflow:hidden}.label-row:last-child{break-after:auto;page-break-after:auto}.sticker{width:${p.width}mm;height:${p.height}mm;padding:1.5mm 2mm;font:8pt Arial,sans-serif;overflow:hidden;display:flex;flex-direction:column;justify-content:center;gap:.4mm}.sticker p{margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.15}.sticker .name{font-weight:bold}.sticker .code{font:7pt monospace}.sticker .price{font-weight:bold;font-size:11pt}.sticker svg{height:8mm;max-width:100%;flex-shrink:0;align-self:center;shape-rendering:crispEdges}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}`;
}
