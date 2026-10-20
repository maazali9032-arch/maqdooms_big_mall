import { fabricMoneyInput } from "../inventory/fabric-entry-input.ts";

/** One entered amount determines payment state; no independent paid/unpaid selector. */
export function counterPayment(total: bigint | null, tailoring: boolean, amount: string) {
  if (total === null) throw new Error("Check the bill quantities and prices");
  const received = tailoring ? BigInt(fabricMoneyInput(amount.trim() || "0")) : total;
  if (received > total) throw new Error("Advance cannot exceed the bill total");
  return {
    received,
    balance: total - received,
    paid: received === total,
    advancePaise: tailoring && received !== total ? Number(received) : undefined,
  };
}
