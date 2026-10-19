/** datetime-local expects wall-clock components, not a truncated UTC ISO timestamp. */
export function gstLocalDateTime(value: string | Date) {
  const date = new Date(value);
  const part = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}
