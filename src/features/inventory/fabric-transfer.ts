import { quantityInput } from "./ledger-quantity.ts";

export type TransferThan = {
  thaan_id: string;
  inventory_item_id: string | null;
  source_mm: number;
};

/** Explicit physical Than choices; never silently choose which roll to deduct. */
export function prepareFabricTransfer(
  thans: TransferThan[],
  choices: Record<string, string>,
  validateBalance = true,
) {
  const lines: { inventory_item_id: string; quantity: number }[] = [];
  let total_mm = 0;
  for (const [id, text] of Object.entries(choices)) {
    if (!text.trim() || /^0+(\.0{1,3})?$/.test(text.trim())) continue;
    const than = thans.find((t) => t.thaan_id === id);
    if (!than?.inventory_item_id) throw new Error("Selected Than requires location reconciliation");
    const quantity = quantityInput(text, "mm");
    if (validateBalance && quantity > than.source_mm)
      throw new Error("Transfer exceeds this Than's source balance");
    if (lines.some((line) => line.inventory_item_id === than.inventory_item_id))
      throw new Error("Duplicate internal Than selection");
    lines.push({ inventory_item_id: than.inventory_item_id, quantity });
    total_mm += quantity;
  }
  if (!lines.length) throw new Error("Enter a transfer quantity for at least one internal Than");
  if (!Number.isSafeInteger(total_mm)) throw new Error("Transfer total exceeds supported range");
  lines.sort((a, b) => a.inventory_item_id.localeCompare(b.inventory_item_id));
  return { lines, total_mm };
}
