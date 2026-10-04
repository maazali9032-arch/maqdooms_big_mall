export function fabricMoneyInput(value: string): number {
  const clean = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(clean))
    throw new Error("Enter a nonnegative price with up to two decimal places");
  const [whole, fraction = ""] = clean.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount)) throw new Error("Price exceeds supported range");
  return amount;
}
