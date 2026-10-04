/** Fabric ledger input in metres becomes exact integer millimetres. */
export function quantityText(value: number, unit: string, fabric = unit === "mm") {
  return fabric ? `${value / 1000} m` : `${value} ${unit}`;
}
export function quantityInput(value: string, unit: string, fabric = unit === "mm") {
  if (!/^\d+(\.\d{1,3})?$/.test(value.trim()))
    throw new Error("Enter a positive quantity with at most three decimal places");
  const [whole, fraction = ""] = value.trim().split(".");
  const quantity = fabric ? Number(whole) * 1000 + Number(fraction.padEnd(3, "0")) : Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || (fabric && !Number.isSafeInteger(quantity)))
    throw new Error("Enter a valid quantity for this item");
  return quantity;
}
