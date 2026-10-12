const profiles = [
  {
    id: "owner",
    full_name: "Owner Example",
    email: "owner@example.test",
    active: true,
    last_login: null,
  },
  {
    id: "stock",
    full_name: "Stock Example",
    email: "stock@example.test",
    active: true,
    last_login: null,
  },
  {
    id: "counter",
    full_name: "Counter Example",
    email: "counter@example.test",
    active: true,
    last_login: null,
  },
];
const roles = [
  { key: "owner", label: "Owner" },
  { key: "stock_entry", label: "Stock Entry" },
  { key: "counter", label: "Counter" },
];
const userRoles = [
  { user_id: "owner", role_key: "owner" },
  { user_id: "stock", role_key: "stock_entry" },
  { user_id: "counter", role_key: "counter" },
];
const permissions = [
  { key: "stock.transfer", label: "Transfer stock", domain: "stock" },
  { key: "stock.print_barcode", label: "Print barcodes", domain: "stock" },
  { key: "audit.view", label: "View audit trail", domain: "audit" },
];
const rolePermissions = [{ role_key: "stock_entry", permission_key: "stock.transfer" }];
let overrides = [{ user_id: "stock", permission_key: "stock.print_barcode", granted: true }];
export const controls = {
  failTable: "",
  failSave: false,
  holdSave: false,
  calls: [] as Record<string, unknown>[],
  release: () => {},
};
Object.assign(window, { accessControls: controls });
export const supabase = {
  from(table: string) {
    let filter: { key: string; value: string } | undefined;
    const query = {
      select() {
        return query;
      },
      order() {
        return query;
      },
      eq(key: string, value: string) {
        filter = { key, value };
        return query;
      },
      then(resolve: (result: unknown) => void) {
        const data =
          (
            {
              profiles,
              roles,
              user_roles: userRoles,
              permissions,
              role_permissions: rolePermissions,
              user_permission_overrides: overrides,
            } as Record<string, Record<string, unknown>[]>
          )[table] ?? [];
        const rows = filter ? data.filter((row) => row[filter!.key] === filter!.value) : data;
        return Promise.resolve({
          data: structuredClone(rows),
          error: controls.failTable === table ? new Error("Synthetic load failure") : null,
        }).then(resolve);
      },
    };
    return query;
  },
  async rpc(name: string, args: Record<string, unknown>) {
    controls.calls.push({ name, ...args });
    if (controls.holdSave)
      await new Promise<void>((resolve) => {
        controls.release = resolve;
      });
    if (controls.failSave)
      return { data: null, error: new Error("Synthetic permission save failed") };
    overrides = overrides.filter(
      (o) => !(o.user_id === args.p_user && o.permission_key === args.p_permission),
    );
    if (args.p_granted !== null)
      overrides.push({
        user_id: String(args.p_user),
        permission_key: String(args.p_permission),
        granted: Boolean(args.p_granted),
      });
    return { data: null, error: null };
  },
};
