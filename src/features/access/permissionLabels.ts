/** Stable historical keys; current module-based wording and obsolete controls. */
export const RETIRED_CREATOR_PERMISSIONS = new Set([
  "inventory.edit_others_thaans",
  "inventory.view_others_cp",
  "inventory.correct_others_cp",
]);
export function permissionLabel(key: string, fallback: string): string {
  if (key === "inventory.view_cost") return "Owner-only cost access";
  if (key === "inventory.view_registered_cp") return "View fabric CP";
  if (key === "inventory.fill_missing_cp") return "Fill missing fabric CP";
  return fallback;
}
