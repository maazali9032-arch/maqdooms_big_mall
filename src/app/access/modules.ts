/**
 * Single source of truth for which app modules each role may open.
 * Used by both the sidebar and the route guard. Data access is separately
 * enforced by database policies.
 */
export type ModuleKey =
  | "dashboard"
  | "inventory"
  | "stock_entry"
  | "stock_transfer"
  | "pos"
  | "salesperson_work"
  | "tailoring"
  | "customers"
  | "ecommerce"
  | "whatsapp"
  | "reports"
  | "audit"
  | "access"
  | "settings";

export const MODULE_PATHS: Record<ModuleKey, string> = {
  dashboard: "/dashboard",
  stock_entry: "/inventory/receiving",
  stock_transfer: "/inventory/transfers",
  inventory: "/inventory",
  pos: "/pos",
  salesperson_work: "/my-work",
  tailoring: "/tailoring",
  customers: "/customers",
  ecommerce: "/ecommerce",
  whatsapp: "/whatsapp",
  reports: "/reports",
  audit: "/audit",
  access: "/access",
  settings: "/settings",
};

const ALL = Object.keys(MODULE_PATHS) as ModuleKey[];

export const ROLE_MODULES: Record<string, ModuleKey[]> = {
  owner: ALL,
  stock_entry: ["stock_entry", "stock_transfer", "inventory", "settings"],
  counter: ["pos", "tailoring", "settings"],
  salesperson: ["salesperson_work", "settings"],
  ecommerce_manager: ["ecommerce", "settings"],
  tailor: ["tailoring", "settings"],
  production: ["tailoring", "settings"],
};

/** Union of modules across all of the user's roles; Settings is always available. */
export function allowedModules(roles: string[]): Set<ModuleKey> {
  const set = new Set<ModuleKey>(["settings"]);
  for (const r of roles) for (const m of ROLE_MODULES[r] ?? []) set.add(m);
  return set;
}

export function moduleForPath(pathname: string): ModuleKey | null {
  if (
    pathname === MODULE_PATHS.stock_transfer ||
    pathname.startsWith(`${MODULE_PATHS.stock_transfer}/`)
  )
    return "stock_transfer";
  if (pathname === MODULE_PATHS.stock_entry || pathname.startsWith(`${MODULE_PATHS.stock_entry}/`))
    return "stock_entry";
  for (const key of ALL) {
    const p = MODULE_PATHS[key];
    if (pathname === p || pathname.startsWith(`${p}/`)) return key;
  }
  return null;
}

/**
 * Module access is role-based. A small number of nested operational screens
 * additionally require the same action permission that protects their writes
 * in Postgres.
 */
export function canAccessPath(roles: string[], permissions: string[], pathname: string): boolean {
  if (
    pathname === "/tailoring" &&
    roles.includes("production") &&
    !roles.some((r) => ["owner", "counter", "tailor"].includes(r))
  )
    return permissions.includes("production.view");
  if (pathname === "/my-work" || pathname.startsWith("/my-work/"))
    return (
      roles.includes("owner") ||
      (roles.includes("salesperson") && permissions.includes("salesperson.view_work"))
    );
  if (pathname === "/inventory/transfers" || pathname.startsWith("/inventory/transfers/"))
    return (
      roles.includes("owner") ||
      (roles.includes("stock_entry") &&
        (permissions.includes("stock.transfer") || permissions.includes("stock.transfer_finished")))
    );
  const module = moduleForPath(pathname);
  if (module !== null && !allowedModules(roles).has(module)) return false;
  if (pathname === "/inventory/receiving" || pathname.startsWith("/inventory/receiving/")) {
    return roles.includes("owner") || permissions.includes("inventory.receive");
  }
  return true;
}

/** First permitted module in sidebar order — the user's landing page. */
export function homePath(roles: string[], permissions?: string[]): string {
  const allowed = allowedModules(roles);
  const first =
    ALL.find(
      (m) =>
        m !== "settings" &&
        allowed.has(m) &&
        (permissions === undefined || canAccessPath(roles, permissions, MODULE_PATHS[m])),
    ) ?? "settings";
  return MODULE_PATHS[first];
}
