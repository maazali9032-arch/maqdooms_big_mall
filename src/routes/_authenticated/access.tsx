import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  KeyRound,
  Hash,
  MoreVertical,
  Search,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import {
  useRoles,
  useSetActive,
  useSetSalespersonCode,
  useSetStockAuditAccess,
  useSetUserRole,
  useStaff,
  useStockAuditAccess,
} from "@/features/access";
import { ROLE_LABELS } from "@/app/providers/session";
import { PageHeader, StatusBadge, EmptyState, StatCard } from "@/shared/components/page";
import { formatDateTime, initials, relativeTime } from "@/shared/utils/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { UserPermissions } from "@/features/access/UserPermissions";
import { CreateStaff } from "@/features/access/CreateStaff";
import { RETIRED_CREATOR_PERMISSIONS } from "@/features/access/permissionLabels";
import { PosTerminalManagement, PosUserAssignment } from "@/features/access/PosTerminalManagement";

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

const AVATAR_TONES = [
  "bg-[#eaf0fa] text-[#294779]",
  "bg-[#e7f2ec] text-[#28624d]",
  "bg-[#f5ecdc] text-[#8a6227]",
  "bg-[#eeeafa] text-[#4b3d8c]",
  "bg-[#f7e8e5] text-[#8a4037]",
];

function mutationErrorMessage(error: unknown, fallback = "Update failed") {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return fallback;
}

function AccessPage() {
  const staff = useStaff();
  const roles = useRoles();
  const setRole = useSetUserRole();
  const setActive = useSetActive();
  const saveSalespersonCode = useSetSalespersonCode();
  const stockAuditAccess = useStockAuditAccess();
  const setStockAuditAccess = useSetStockAuditAccess();
  const [search, setSearch] = useState("");
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [permissionUserId, setPermissionUserId] = useState<string | null>(null);
  const [salespersonCodeUserId, setSalespersonCodeUserId] = useState<string | null>(null);
  const [salespersonCode, setSalespersonCode] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");
  const [roleFilter, setRoleFilter] = useState("all");

  const roleList = roles.data?.roles ?? [];
  const permissions = (roles.data?.permissions ?? []).filter(
    (p) => !RETIRED_CREATOR_PERMISSIONS.has(p.key),
  );
  const rolePermissions = roles.data?.rolePermissions ?? [];
  const staffList = staff.data ?? [];
  const activeOwnerCount = staffList.filter(
    (user) => user.active && user.roles.includes("owner"),
  ).length;

  const recentLoginCount = staffList.filter((user) => {
    if (!user.last_login) return false;
    return Date.now() - new Date(user.last_login).getTime() <= 24 * 60 * 60 * 1000;
  }).length;

  const term = search.trim().toLowerCase();
  const visibleStaff = staffList.filter((user) => {
    const statusMatches =
      statusFilter === "all" ||
      (statusFilter === "active" && user.active) ||
      (statusFilter === "disabled" && !user.active);
    const searchMatches =
      !term ||
      user.full_name.toLowerCase().includes(term) ||
      (user.email?.toLowerCase().includes(term) ?? false) ||
      user.roles.some((role) => (ROLE_LABELS[role] ?? role).toLowerCase().includes(term));
    const roleMatches = roleFilter === "all" || user.roles.includes(roleFilter);
    return statusMatches && searchMatches && roleMatches;
  });

  async function updateActive(user: (typeof staffList)[number]) {
    try {
      await setActive.mutateAsync({ userId: user.id, active: !user.active });
      toast.success(user.active ? "User deactivated" : "User reactivated");
    } catch (err) {
      toast.error(mutationErrorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Manage Access"
        description="Control staff roles and access across Maqdoom's Big Mall."
        actions={
          <Button
            onClick={() => setCreatingStaff(true)}
            title="Create a staff account and assign its role"
          >
            <UserPlus />
            Add Staff
          </Button>
        }
      />
      {creatingStaff && <CreateStaff onClose={() => setCreatingStaff(false)} />}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Total Staff"
          value={staffList.length}
          hint="System user accounts"
          icon={Users}
        />
        <StatCard
          label="Active Users"
          value={staffList.filter((user) => user.active).length}
          hint="Enabled accounts"
          icon={UserCheck}
          tone="success"
        />
        <StatCard
          label="Roles"
          value={roleList.length}
          hint="Role-based access groups"
          icon={KeyRound}
        />
        <StatCard
          label="Recent Logins"
          value={recentLoginCount}
          hint="Within the last 24 hours"
          icon={ShieldCheck}
        />
      </div>

      <section className="panel overflow-hidden">
        <header className="flex flex-col gap-4 border-b border-border px-4 py-4 sm:px-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Staff</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Assign roles below. For personal access exceptions, open a staff member’s Actions menu
              and choose Manage permissions.
            </p>
          </div>
          <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-auto xl:grid-cols-[280px_150px_140px]">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
                placeholder="Search staff, email or role…"
                aria-label="Search staff"
              />
            </div>
            <select
              aria-label="Filter by role"
              className="h-11 rounded-lg border border-input bg-background px-3 text-sm"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value="all">All Roles</option>
              {roleList.map((role) => (
                <option key={role.key} value={role.key}>
                  {ROLE_LABELS[role.key] ?? role.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by status"
              className="h-11 rounded-lg border border-input bg-background px-3 text-sm"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as "all" | "active" | "disabled")
              }
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
        </header>

        {visibleStaff.length === 0 ? (
          <EmptyState
            title={staffList.length ? "No staff match these filters" : "No staff accounts yet"}
            description={
              staffList.length ? "Try another search or account-status filter." : undefined
            }
          />
        ) : (
          <div className="scrollbar-subtle overflow-x-auto">
            <table className="w-full min-w-[1380px] table-fixed text-left">
              <colgroup>
                <col className="w-[245px]" />
                <col className="w-[180px]" />
                <col className="w-[680px]" />
                <col className="w-[135px]" />
                <col className="w-[100px]" />
                <col className="w-[70px]" />
              </colgroup>
              <thead className="border-b border-border bg-surface">
                <tr className="label-eyebrow">
                  <th className="px-5 py-3 font-semibold">User</th>
                  <th className="px-4 py-3 font-semibold">Last login</th>
                  <th className="px-4 py-3 font-semibold">Assigned roles</th>
                  <th className="px-4 py-3 font-semibold">POS ID</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleStaff.map((user, userIndex) => {
                  const protectsLastOwner =
                    user.active && user.roles.includes("owner") && activeOwnerCount <= 1;
                  return (
                    <tr
                      key={user.id}
                      className="border-b border-border last:border-0 hover:bg-surface/45"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-medium",
                              AVATAR_TONES[userIndex % AVATAR_TONES.length],
                            )}
                          >
                            {initials(user.full_name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">
                              {user.full_name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {user.email}
                            </span>
                            {user.roles.includes("salesperson") && user.salesperson_code ? (
                              <span className="mt-0.5 block text-[11px] font-medium text-primary">
                                Salesperson #{user.salesperson_code}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="numeric text-xs">{formatDateTime(user.last_login)}</p>
                        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              user.last_login &&
                                Date.now() - new Date(user.last_login).getTime() < 15 * 60 * 1000
                                ? "bg-success"
                                : "bg-muted-foreground/55",
                            )}
                          />
                          {user.last_login ? relativeTime(user.last_login) : "Never signed in"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="grid grid-cols-3 gap-1.5">
                          {roleList.map((role) => {
                            const checked = user.roles.includes(role.key);
                            const disabled =
                              role.key === "owner" &&
                              checked &&
                              user.active &&
                              activeOwnerCount <= 1;
                            return (
                              <label
                                key={role.key}
                                className={cn(
                                  "flex min-w-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1.5 text-[11px] transition-colors",
                                  checked
                                    ? "border-primary/20 bg-accent text-accent-foreground"
                                    : "border-border bg-card text-foreground hover:border-primary/30",
                                  disabled && "cursor-not-allowed opacity-65",
                                )}
                                title={
                                  disabled ? "The last active Owner cannot be demoted" : undefined
                                }
                              >
                                <Checkbox
                                  checked={checked}
                                  disabled={disabled}
                                  onCheckedChange={async (value) => {
                                    try {
                                      await setRole.mutateAsync({
                                        userId: user.id,
                                        roleKey: role.key,
                                        grant: Boolean(value),
                                      });
                                      toast.success("Access updated");
                                    } catch (err) {
                                      toast.error(mutationErrorMessage(err));
                                    }
                                  }}
                                />
                                {ROLE_LABELS[role.key] ?? role.label}
                              </label>
                            );
                          })}
                          <label
                            className={cn(
                              "flex min-w-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1.5 text-[11px] transition-colors",
                              user.roles.includes("owner") || stockAuditAccess.data?.get(user.id)
                                ? "border-primary/20 bg-accent text-accent-foreground"
                                : "border-border bg-card text-foreground hover:border-primary/30",
                              (!user.active || user.roles.includes("owner")) &&
                                "cursor-not-allowed opacity-65",
                            )}
                            title={
                              user.roles.includes("owner")
                                ? "Owners always have Stock Audit access"
                                : "Allows this staff member to see Stock Audit and receive audit assignments"
                            }
                          >
                            <Checkbox
                              checked={
                                user.roles.includes("owner") ||
                                stockAuditAccess.data?.get(user.id) === true
                              }
                              disabled={
                                !user.active ||
                                user.roles.includes("owner") ||
                                setStockAuditAccess.isPending
                              }
                              onCheckedChange={async (value) => {
                                try {
                                  await setStockAuditAccess.mutateAsync({
                                    userId: user.id,
                                    granted: Boolean(value),
                                  });
                                  toast.success(
                                    value
                                      ? "Stock Audit access granted"
                                      : "Stock Audit access revoked",
                                  );
                                } catch (err) {
                                  toast.error(mutationErrorMessage(err));
                                }
                              }}
                            />
                            Stock Audit
                          </label>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <PosUserAssignment user={user} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={user.active ? "active" : "archived"}
                          label={user.active ? "Active" : "Disabled"}
                        />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              className="size-8"
                              aria-label={`Actions for ${user.full_name}`}
                            >
                              <MoreVertical className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>{user.full_name}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setPermissionUserId(user.id)}>
                              <ShieldCheck className="mr-2 size-4" />
                              Manage permissions
                            </DropdownMenuItem>
                            {user.roles.includes("salesperson") ? (
                              <DropdownMenuItem
                                onSelect={() => {
                                  setSalespersonCodeUserId(user.id);
                                  setSalespersonCode(user.salesperson_code ?? "");
                                }}
                              >
                                <Hash className="mr-2 size-4" />
                                Edit salesperson number
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem
                              disabled={protectsLastOwner}
                              onSelect={() => void updateActive(user)}
                              className={
                                user.active ? "text-destructive focus:text-destructive" : undefined
                              }
                            >
                              {user.active ? "Deactivate account" : "Reactivate account"}
                            </DropdownMenuItem>
                            {protectsLastOwner ? (
                              <p className="max-w-56 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                                The last active Owner cannot be deactivated.
                              </p>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {permissionUserId && (
        <UserPermissions
          key={permissionUserId}
          userId={permissionUserId}
          onClose={() => setPermissionUserId(null)}
        />
      )}
      <Dialog
        open={Boolean(salespersonCodeUserId)}
        onOpenChange={(open) => {
          if (!open && !saveSalespersonCode.isPending) setSalespersonCodeUserId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit salesperson number</DialogTitle>
            <DialogDescription>
              This digits-only number identifies the credited salesperson on future customer bills.
              Existing bills keep their original snapshot.
            </DialogDescription>
          </DialogHeader>
          <label className="text-sm font-medium">
            Salesperson number
            <Input
              className="mt-1 numeric"
              inputMode="numeric"
              autoFocus
              maxLength={12}
              value={salespersonCode}
              onChange={(event) => setSalespersonCode(event.target.value.replace(/\D/g, ""))}
              placeholder="For example: 101"
            />
          </label>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saveSalespersonCode.isPending}
              onClick={() => setSalespersonCodeUserId(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={!salespersonCode || saveSalespersonCode.isPending}
              onClick={async () => {
                if (!salespersonCodeUserId) return;
                try {
                  await saveSalespersonCode.mutateAsync({
                    userId: salespersonCodeUserId,
                    code: salespersonCode,
                  });
                  toast.success("Salesperson number updated");
                  setSalespersonCodeUserId(null);
                } catch (error) {
                  toast.error(mutationErrorMessage(error));
                }
              }}
            >
              {saveSalespersonCode.isPending ? "Saving…" : "Save number"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PosTerminalManagement staff={staffList} />
      <details className="panel group overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 sm:px-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
            <KeyRound className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Stored role defaults</span>
            <span className="block text-xs text-muted-foreground">
              Stored role grants. Manage permissions shows actual access and database restrictions.
            </span>
          </span>
          <span className="text-xs font-medium text-primary group-open:hidden">View matrix →</span>
          <span className="hidden text-xs font-medium text-primary group-open:inline">
            Hide matrix ↑
          </span>
        </summary>
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[720px] text-left">
            <thead className="border-b border-border bg-surface">
              <tr className="label-eyebrow">
                <th className="px-4 py-3 font-semibold">Permission</th>
                {roleList.map((role) => (
                  <th key={role.key} className="px-3 py-3 text-center font-semibold">
                    {ROLE_LABELS[role.key] ?? role.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissions.map((permission) => (
                <tr
                  key={permission.key}
                  className="border-b border-border last:border-0 hover:bg-surface/40"
                >
                  <td className="numeric px-4 py-2.5 text-xs">{permission.key}</td>
                  {roleList.map((role) => (
                    <td key={role.key} className="px-3 py-2.5 text-center text-sm">
                      {rolePermissions.some(
                        (item) =>
                          item.role_key === role.key && item.permission_key === permission.key,
                      ) ? (
                        <span
                          className="inline-flex size-5 items-center justify-center rounded-full bg-success/10 text-success"
                          aria-label="Granted"
                        >
                          ✓
                        </span>
                      ) : (
                        <span className="text-muted-foreground/55" aria-label="Not granted">
                          —
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
