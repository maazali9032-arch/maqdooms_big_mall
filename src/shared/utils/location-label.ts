/** A root Showroom record does not identify a physical floor. */
export function locationLabel(location: { name: string; kind: string }) {
  return location.kind === "showroom" ? `${location.name} — floor not assigned` : location.name;
}
