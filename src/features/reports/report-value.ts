/** Exact display for server-computed report totals beyond the JS number range. */
export function reportMoney(value: string | number) {
  const amount = BigInt(value);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "−" : ""}₹${(absolute / 100n).toLocaleString("en-IN")}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
export function reportQuantity(value: string, unit: string) {
  if (unit !== "mm" || !/^-?\d+(?:\.0+)?$/.test(value)) return `${value} ${unit}`;
  const amount = BigInt(value.split(".")[0]!);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "−" : ""}${absolute / 1000n}.${(absolute % 1000n).toString().padStart(3, "0")} m`;
}
export function reportDateRange(from: string, through: string) {
  const p_from = from ? new Date(`${from}T00:00:00+05:30`).toISOString() : undefined;
  const p_to = through
    ? new Date(new Date(`${through}T00:00:00+05:30`).getTime() + 86400000).toISOString()
    : undefined;
  if (p_from && p_to && p_from >= p_to) throw new Error("Start date must be on or before end date");
  return { ...(p_from ? { p_from } : {}), ...(p_to ? { p_to } : {}) };
}
