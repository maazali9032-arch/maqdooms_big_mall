import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Filter,
  KeyRound,
  MoreVertical,
  Search,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useRoles, useSetActive, useSetUserRole, useStaff } from "@/features/access";
import { ROLE_LABELS } from "@/app/providers/session";
import { PageHeader, StatusBadge, EmptyState, StatCard } from "@/shared/components/page";
import { formatDateTime, initials, relativeTime } from "@/shared/utils/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

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

function AccessPage() {
  const staff = useStaff();
  const roles = useRoles();
  const setRole = useSetUserRole();
  const setActive = useSetActive();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");

  const roleList = roles.data?.roles ?? [];
  const permissions = roles.data?.permissions ?? [];
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
    return statusMatches && searchMatches;
  });

  async function updateActive(user: (typeof staffList)[number]) {
    try {
      await setActive.mutateAsync({ userId: user.id, active: !user.active });
      toast.success(user.active ? "User deactivated" : "User reactivated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function copyStaffSignupLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/auth`);
      toast.success("Staff sign-up link copied. Assign roles after the account is created.");
    } catch {
      toast.error("Could not copy the sign-up link");
    }
  }

  return (
    <>
      <PageHeader
        title="Manage Access"
        description="Control staff roles and access across Maqdoom's Big Mall."
        actions={
          <Button onClick={() => void copyStaffSignupLink()} title="Copy the staff sign-up link">
            <UserPlus />
            Add Staff
          </Button>
        }
      />

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
              Manage user roles and account status. Access is enforced in the database, not only
              hidden in the interface.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
            <div className="relative min-w-0 sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
                placeholder="Search staff, email or role…"
                aria-label="Search staff"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="justify-start sm:justify-center">
                  <Filter />
                  {statusFilter === "all"
                    ? "All staff"
                    : statusFilter === "active"
                      ? "Active"
                      : "Disabled"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Account status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setStatusFilter("all")}>
                  All staff
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setStatusFilter("active")}>
                  Active
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setStatusFilter("disabled")}>
                  Disabled
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
            <table className="w-full min-w-[1040px] text-left">
              <thead className="border-b border-border bg-surface">
                <tr className="label-eyebrow">
                  <th className="px-5 py-3 font-semibold">User</th>
                  <th className="px-4 py-3 font-semibold">Last login</th>
                  <th className="px-4 py-3 font-semibold">Roles &amp; permissions</th>
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
                        <div className="flex max-w-[590px] flex-wrap gap-1.5">
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
                                  "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors",
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
                                      toast.error(
                                        err instanceof Error ? err.message : "Update failed",
                                      );
                                    }
                                  }}
                                />
                                {ROLE_LABELS[role.key] ?? role.label}
                              </label>
                            );
                          })}
                        </div>
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

      <details className="panel group overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 sm:px-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
            <KeyRound className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Role – Permission Matrix</span>
            <span className="block text-xs text-muted-foreground">
              Overview of what each role can access.
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
