import { indiaDay, shiftDay } from "./evidence-model";
import { reportInteger } from "./report-value";

export function monthPeriod(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Choose a valid month");
  const start = new Date(month + "-01T12:00:00Z");
  start.setUTCMonth(start.getUTCMonth() + 1);
  return { from: month + "-01", through: shiftDay(start.toISOString().slice(0, 10), -1) };
}
export function previousMonthPeriod(day = indiaDay()) {
  const start = new Date(day.slice(0, 7) + "-01T12:00:00Z");
  start.setUTCMonth(start.getUTCMonth() - 1);
  return monthPeriod(start.toISOString().slice(0, 7));
}
export function precedingPeriod(from: string, through: string) {
  if (from.endsWith("-01") && monthPeriod(from.slice(0, 7)).through === through)
    return previousMonthPeriod(from);
  const days =
    (Date.parse(through + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86400000 + 1;
  return { from: shiftDay(from, -days), through: shiftDay(from, -1) };
}
export function growthLabel(current: string, previous: string) {
  const c = reportInteger(current),
    p = reportInteger(previous);
  if (p === 0n)
    return c === 0n ? "No sales in either period" : "No previous-period sales to compare";
  const delta = c - p,
    scaled = (delta * 10000n) / p;
  const absolute = scaled < 0n ? -scaled : scaled;
  return `${delta > 0n ? "+" : delta < 0n ? "−" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}% vs previous period`;
}
