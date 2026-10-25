/** Exact integer conversion for PostgreSQL bigint/numeric text, including values like `3000.000`. */
export function reportInteger(value: string | number | bigint) {
  if (typeof value === "bigint") return value;
  const text = String(value).trim();
  if (!/^-?\d+(?:\.0+)?$/.test(text))
    throw new Error(`Expected a whole numeric value, received ${text}`);
  return BigInt(text.split(".")[0]!);
}

/** Exact display for server-computed report totals beyond the JS number range. */
export function reportMoney(value: string | number) {
  const amount = reportInteger(value);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "−" : ""}₹${(absolute / 100n).toLocaleString("en-IN")}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
export function reportQuantity(value: string, unit: string) {
  if (unit !== "mm" || !/^-?\d+(?:\.0+)?$/.test(value)) return `${value} ${unit}`;
  const amount = reportInteger(value);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "−" : ""}${absolute / 1000n}.${(absolute % 1000n).toString().padStart(3, "0")} m`;
}
export function reportDateRange(from: string, through: string) {
  for (const day of [from, through]) {
    if (
      day &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !Number.isFinite(Date.parse(day + "T12:00:00Z")) ||
        new Date(day + "T12:00:00Z").toISOString().slice(0, 10) !== day)
    )
      throw new Error("Enter a valid calendar date");
  }
  const p_from = from ? new Date(`${from}T00:00:00+05:30`).toISOString() : undefined;
  const p_to = through
    ? new Date(new Date(`${through}T00:00:00+05:30`).getTime() + 86400000).toISOString()
    : undefined;
  if (p_from && p_to && p_from >= p_to) throw new Error("Start date must be on or before end date");
  return { ...(p_from ? { p_from } : {}), ...(p_to ? { p_to } : {}) };
}
