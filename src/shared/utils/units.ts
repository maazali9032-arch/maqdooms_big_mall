/**
 * Canonical unit system.
 *
 * Lengths are ALWAYS stored and transported as integer millimetres.
 * Metres exist only at the presentation/input boundary.
 * Money is ALWAYS stored as integer paise.
 */

export const MM_PER_METRE = 1000;

export function metresToMm(metres: number): number {
  return Math.round(metres * MM_PER_METRE);
}

export function mmToMetres(mm: number): number {
  return mm / MM_PER_METRE;
}

/** Display helper: 28500 -> "28.50 m" */
export function formatMetres(mm: number | null | undefined, opts?: { suffix?: boolean }): string {
  if (mm === null || mm === undefined) return "—";
  const value = (mm / MM_PER_METRE).toFixed(2);
  return opts?.suffix === false ? value : `${value} m`;
}

/** Parse a user-entered metre string into integer mm. Returns null when invalid. */
export function parseMetreInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return null;
  return metresToMm(num);
}

export function paiseToRupees(paise: number | null | undefined): number | null {
  if (paise === null || paise === undefined) return null;
  return paise / 100;
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function parseRupeeInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return null;
  return rupeesToPaise(num);
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrPrecise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(paise: number | null | undefined, precise = false): string {
  if (paise === null || paise === undefined) return "—";
  return (precise ? inrPrecise : inr).format(paise / 100);
}

/** Line amount for a cut: mm x price-per-metre (paise), rounded to whole paise. */
export function lineAmountPaise(lengthMm: number, pricePaisePerMetre: number): number {
  return Math.round((lengthMm / MM_PER_METRE) * pricePaisePerMetre);
}
