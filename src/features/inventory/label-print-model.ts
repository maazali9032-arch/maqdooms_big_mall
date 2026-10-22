import { fabricBarcodeBars } from "./barcode-encoding";

export type Sticker = {
  code: string;
  name: string;
  description: string;
  detail: string;
  price: string;
};

export type LabelMode = "roll" | "sheet";
export type LabelProfile = {
  mode: LabelMode;
  width: number;
  height: number;
  columns: number;
  rows: number;
  gap: number;
  rowGap: number;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  dpi: number;
};

/**
 * The original showroom driver configuration: USER 4 × 6 inches with two
 * 2 × 1 inch labels across and six rows on each printer page. Labels fill
 * left-to-right then continue onto the next row and page automatically.
 */
export const STARTING_LABEL_PROFILE: LabelProfile = {
  mode: "sheet",
  width: 50.8,
  height: 25.4,
  columns: 2,
  rows: 6,
  gap: 0,
  rowGap: 0,
  pageWidth: 101.6,
  pageHeight: 152.4,
  margin: 0,
  dpi: 203,
};

export function normalizeProfile(profile: Partial<LabelProfile> | null | undefined): LabelProfile {
  return {
    ...STARTING_LABEL_PROFILE,
    ...profile,
    mode:
      profile?.mode === "sheet" || profile?.mode === "roll"
        ? profile.mode
        : STARTING_LABEL_PROFILE.mode,
  };
}

export function rowWidth(p: LabelProfile) {
  return p.width * p.columns + p.gap * (p.columns - 1);
}

export function validProfile(raw: LabelProfile | Partial<LabelProfile>) {
  const p = normalizeProfile(raw);
  const numbers = [
    p.width,
    p.height,
    p.columns,
    p.rows,
    p.gap,
    p.rowGap,
    p.pageWidth,
    p.pageHeight,
    p.margin,
    p.dpi,
  ];
  if (
    !numbers.every(Number.isFinite) ||
    p.width < 12 ||
    p.width > 210 ||
    p.height < 10 ||
    p.height > 297
  )
    return false;
  if (!Number.isInteger(p.columns) || p.columns < 1 || p.columns > 12) return false;
  if (!Number.isInteger(p.rows) || p.rows < 1 || p.rows > 30) return false;
  if (p.gap < 0 || p.gap > 30 || p.rowGap < 0 || p.rowGap > 30 || p.margin < 0 || p.margin > 30)
    return false;
  if (p.dpi < 100 || p.dpi > 1200) return false;
  if (p.mode === "roll") return rowWidth(p) <= 220;
  return (
    p.pageWidth >= 100 &&
    p.pageWidth <= 420 &&
    p.pageHeight >= 100 &&
    p.pageHeight <= 594 &&
    rowWidth(p) + p.margin * 2 <= p.pageWidth &&
    p.height * p.rows + p.rowGap * (p.rows - 1) + p.margin * 2 <= p.pageHeight
  );
}

export function symbolSize(code: string, profile: LabelProfile) {
  const bars = fabricBarcodeBars(code),
    modules = bars.length + 20;
  const dotsPerMm = profile.dpi / 25.4;
  // Keep a generous physical quiet area on compact showroom stickers. At
  // 203 DPI this also avoids stretching six-character symbols across the label.
  const dots = Math.floor(((profile.width - 12) * dotsPerMm) / modules);
  return { bars, modules, dots, width: (modules * dots) / dotsPerMm };
}

/** Labels in one row (used for roll media and the visual preview). */
export function labelRows(labels: Sticker[], columns: number) {
  return Array.from({ length: Math.ceil(labels.length / columns) }, (_, i) =>
    labels.slice(i * columns, (i + 1) * columns),
  );
}

/** Each result is one browser print page. Roll media prints one row per page; sheets fill a page. */
export function labelPages(labels: Sticker[], profile: LabelProfile) {
  const capacity = profile.mode === "roll" ? profile.columns : profile.columns * profile.rows;
  return Array.from({ length: Math.ceil(labels.length / capacity) }, (_, i) =>
    labels.slice(i * capacity, (i + 1) * capacity),
  );
}

/** Standalone print CSS; never depends on the application's Tailwind styles. */
export function labelPrintCSS(raw: LabelProfile) {
  const p = normalizeProfile(raw);
  if (!validProfile(p)) throw new Error("Enter valid label, page and gap dimensions.");
  const sheet = p.mode === "sheet";
  const printWidth = sheet ? p.pageWidth : rowWidth(p);
  const printHeight = sheet ? p.pageHeight : p.height;
  const pageStyle = sheet
    ? `padding:${p.margin}mm;grid-template-columns:repeat(${p.columns},${p.width}mm);grid-template-rows:repeat(${p.rows},${p.height}mm);column-gap:${p.gap}mm;row-gap:${p.rowGap}mm;`
    : `grid-template-columns:repeat(${p.columns},${p.width}mm);column-gap:${p.gap}mm;grid-auto-rows:${p.height}mm;`;
  return `@page{size:${printWidth}mm ${printHeight}mm;margin:0}html,body{margin:0;padding:0;background:white;color:black}*{box-sizing:border-box}.label-page{display:grid;${pageStyle}width:${printWidth}mm;height:${printHeight}mm;break-after:page;page-break-after:always;overflow:hidden}.label-page:last-child{break-after:auto;page-break-after:auto}.sticker{position:relative;width:${p.width}mm;height:${p.height}mm;padding:1.2mm 4mm;font:7pt Arial,sans-serif;overflow:hidden;break-inside:avoid;display:flex;flex-direction:column;justify-content:center}.label-content{min-width:0;display:flex;flex-direction:column;justify-content:center;gap:.1mm;transform:translateY(-4mm)}.label-content.with-price{transform:translateY(-2mm)}.sticker p{flex:0 0 auto;margin:0;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.05}.sticker .name{font-weight:bold;font-size:8pt}.sticker .code{text-align:center;font:700 6.8pt/1.05 monospace;letter-spacing:.15mm}.sticker .price{font-weight:bold;font-size:9pt}.sticker svg{max-width:100%;height:6.5mm;flex:0 0 6.5mm;align-self:center;shape-rendering:crispEdges}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}`;
}
