import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useRoles, useSetActive, useSetUserRole, useStaff } from "@/features/access";
import { ROLE_LABELS } from "@/app/providers/session";
import { PageHeader, Panel, StatusBadge, EmptyState } from "@/shared/components/page";
import { formatDateTime } from "@/shared/utils/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/access")({
  head: () => ({
    meta: [
      { title: "Manage Access — Maqdoom's Big Mall ERP" },
      { name: "description", content: "Staff accounts, roles and permission layers." },
      { property: "og:title", content: "Manage Access — Maqdoom's Big Mall ERP" },
      { property: "og:description", content: "Staff accounts, roles and permission layers." },
    ],
  }),
  component: AccessPage,
});

function AccessPage() {
  const staff = useStaff();
  const roles = useRoles();
  const setRole = useSetUserRole();
  const setActive = useSetActive();

  const roleList = roles.data?.roles ?? [];
  const permissions = roles.data?.permissions ?? [];
  const rolePermissions = roles.data?.rolePermissions ?? [];
  const activeOwnerCount = (staff.data ?? []).filter(
    (user) => user.active && user.roles.includes("owner"),
  ).length;

  return (
    <>
      <PageHeader
        title="Manage access"
        description="Roles and permissions are enforced in the database, not just hidden in the interface."
      />

      <Panel title="Staff" bodyClassName="p-0">
        {(staff.data ?? []).length === 0 ? (
          <EmptyState title="No staff accounts yet" />
        ) : (
          <div className="divide-y divide-border">
            {(staff.data ?? []).map((u) => (
              <div key={u.id} className="space-y-3 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{u.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.email} · last login {formatDateTime(u.last_login)}
                    </p>
                  </div>
                  <StatusBadge
                    status={u.active ? "active" : "archived"}
                    label={u.active ? "active" : "disabled"}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={u.active && u.roles.includes("owner") && activeOwnerCount <= 1}
                    title={
                      u.active && u.roles.includes("owner") && activeOwnerCount <= 1
                        ? "The last active Owner cannot be deactivated"
                        : undefined
                    }
                    onClick={async () => {
                      try {
                        await setActive.mutateAsync({ userId: u.id, active: !u.active });
                        toast.success(u.active ? "User deactivated" : "User reactivated");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Update failed");
                      }
                    }}
                  >
                    {u.active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-4">
                  {roleList.map((r) => (
                    <label key={r.key} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={u.roles.includes(r.key)}
                        disabled={
                          r.key === "owner" &&
                          u.active &&
                          u.roles.includes("owner") &&
                          activeOwnerCount <= 1
                        }
                        onCheckedChange={async (v) => {
                          try {
                            await setRole.mutateAsync({
                              userId: u.id,
                              roleKey: r.key,
                              grant: Boolean(v),
                            });
                            toast.success("Access updated");
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Update failed");
                          }
                        }}
                      />
                      {ROLE_LABELS[r.key] ?? r.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Role → permission matrix" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="border-b border-border bg-surface">
              <tr className="label-eyebrow">
                <th className="px-3 py-2 font-semibold">Permission</th>
                {roleList.map((r) => (
                  <th key={r.key} className="px-3 py-2 text-center font-semibold">
                    {ROLE_LABELS[r.key] ?? r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissions.map((p) => (
                <tr key={p.key} className="border-b border-border last:border-0">
                  <td className="numeric px-3 py-2 text-xs">{p.key}</td>
                  {roleList.map((r) => (
                    <td key={r.key} className="px-3 py-2 text-center text-sm">
                      {rolePermissions.some(
                        (rp) => rp.role_key === r.key && rp.permission_key === p.key,
                      )
                        ? "●"
                        : "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
