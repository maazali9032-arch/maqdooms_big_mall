import { quantityInput } from "./ledger-quantity.ts";

export function consumableQuantity(value: string, unit: string) {
  const quantity = quantityInput(value, unit, false);
  // Preserve all three decimal places across JSON/JavaScript numeric transport.
  if (!Number.isSafeInteger(Math.round(quantity * 1000)) || quantity >= 1e15)
    throw new Error("Quantity exceeds the supported exact range");
  return quantity;
}
export function receiptCost(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter CP in rupees with at most two decimal places");
  const [whole, fraction = ""] = value.trim().split(".");
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise) || paise > 2147483647)
    throw new Error("CP exceeds the supported range");
  return paise;
}
export function issueItems(items: { inventory_item_id: string; quantity: number }[]) {
  if (
    !items.length ||
    items.length > 100 ||
    new Set(items.map((i) => i.inventory_item_id)).size !== items.length
  )
    throw new Error("Choose one to 100 distinct items");
  return [...items].sort((a, b) => a.inventory_item_id.localeCompare(b.inventory_item_id));
}
export function definiteDatabaseRejection(error: unknown) {
  const code = (error as { code?: string })?.code;
  return (
    !!code &&
    (code === "P0001" || code === "42501" || code.startsWith("22") || code.startsWith("23"))
  );
}
