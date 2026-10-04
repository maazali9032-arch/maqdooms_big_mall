import { quantityInput } from "../inventory/ledger-quantity.ts";

export function customerTailoringCut(metres: string, availableMm: number) {
  const quantity = quantityInput(metres, "mm");
  if (quantity > availableMm || quantity > 2147483647)
    throw new Error("Required quantity exceeds available stock at this location");
  return quantity;
}
export function customerTailoringItems(cuts: { inventory_item_id: string; quantity: number }[]) {
  if (
    !cuts.length ||
    cuts.length > 50 ||
    new Set(cuts.map((c) => c.inventory_item_id)).size !== cuts.length
  )
    throw new Error("Select 1 to 50 distinct internal Than cuts");
  if (
    cuts.some(
      (c) =>
        !c.inventory_item_id ||
        !Number.isSafeInteger(c.quantity) ||
        c.quantity <= 0 ||
        c.quantity > 2147483647,
    )
  )
    throw new Error("Positive integer millimetres required");
  return cuts
    .map((c) => ({ inventory_item_id: c.inventory_item_id, quantity: c.quantity }))
    .sort((a, b) => a.inventory_item_id.localeCompare(b.inventory_item_id));
}
