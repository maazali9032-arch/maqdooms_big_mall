import { quantityInput } from "../inventory/ledger-quantity.ts";

export function fabricSaleAmount(quantityMm: number, spPaisePerM: number): number {
  if (
    !Number.isSafeInteger(quantityMm) ||
    quantityMm <= 0 ||
    !Number.isSafeInteger(spPaisePerM) ||
    spPaisePerM < 0
  ) {
    throw new Error("Positive millimetres and a valid SP are required");
  }
  const value = (BigInt(quantityMm) * BigInt(spPaisePerM) + 500n) / 1000n;
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Sale amount exceeds supported range");
  return Number(value);
}

export function fabricSaleCut(metres: string, availableMm: number, sp: number) {
  const quantity = quantityInput(metres, "mm");
  if (quantity > availableMm) throw new Error("Cut exceeds stock at this location");
  return { quantity, amount: fabricSaleAmount(quantity, sp) };
}
