import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRoles, useStaff } from "@/features/access";
import { ROLE_LABELS } from "@/app/providers/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { permissionLabel, RETIRED_CREATOR_PERMISSIONS } from "./permissionLabels";
import { sqlNull } from "@/shared/utils/sql-null";

type PermissionState = {
  key: string;
  role_default: boolean;
  effective_allowed: boolean;
  restriction: string | null;
  active: boolean;
};

export function UserPermissions({ userId, onClose }: { userId: string; onClose: () => void }) {
  const staff = useStaff();
  const roles = useRoles();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const overrides = useQuery({
    queryKey: ["user-permission-overrides", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_permission_overrides")
        .select("*")
        .eq("user_id", userId);
      if (error) throw error;
      return data;
    },
  });
  const accessState = useQuery({
    queryKey: ["user-permission-state", userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_user_permission_state", { p_user: userId });
      if (error) throw error;
      return data as unknown as PermissionState[];
    },
  });
  const save = useMutation({
    mutationFn: async ({ permission, value }: { permission: string; value: string }) => {
      const { error } = await supabase.rpc("owner_set_user_permission", {
        p_user: userId,
        p_permission: permission,
        p_granted: value === "inherit" ? sqlNull : value === "allow",
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast.success("Permission saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const person = staff.data?.find((p) => p.id === userId);
  const isOwner = person?.roles.includes("owner");
  const loadError = staff.error || roles.error || overrides.error || accessState.error;
  const loading =
    staff.isPending || roles.isPending || overrides.isPending || accessState.isPending;
  const term = search.trim().toLowerCase();
  const permissions = (roles.data?.permissions ?? []).filter(
    (p) =>
      !RETIRED_CREATOR_PERMISSIONS.has(p.key) &&
      `${permissionLabel(p.key, p.label)} ${p.label} ${p.key} ${p.domain}`
        .toLowerCase()
        .includes(term),
  );
  const domains = [...new Set(permissions.map((p) => p.domain))];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[90dvh] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:p-0"
        onEscapeKeyDown={(event) => {
          if (save.isPending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (save.isPending) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 border-b p-5 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            Manage permissions
          </DialogTitle>
          <DialogDescription>
            Personal access settings for{" "}
            <strong className="text-foreground">{person?.full_name ?? "this staff member"}</strong>.
          </DialogDescription>
          <p className="break-all text-xs text-muted-foreground">{person?.email}</p>
          <div className="flex flex-wrap gap-1.5 pt-2">
            {person?.roles.map((role) => (
              <span
                key={role}
                className="rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground"
              >
                {ROLE_LABELS[role] ?? role}
              </span>
            ))}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="rounded-lg border bg-surface p-3 text-xs leading-relaxed">
            <p>
              <strong>Use role default:</strong> follow this person’s assigned roles.
            </p>
            <p>
              <strong>Allow / Deny:</strong> create an exception for this person only.
            </p>
            <p className="mt-2 text-muted-foreground">
              Changes save immediately. Role eligibility and protected-data restrictions still
              apply. Staff should refresh access after a change.
            </p>
            <p className="mt-2 text-muted-foreground">
              Access follows the person’s modules and actions, regardless of who created a record.
              Creator names remain in the audit history.
            </p>
          </div>
          {isOwner && (
            <p className="rounded-lg border border-primary/20 bg-accent p-3 text-sm">
              Owner accounts always retain full control. Personal overrides cannot restrict an
              Owner.
            </p>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search permissions"
              placeholder="Search actions or modules…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {loadError ? (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>Permissions could not load. Retry before changing access.</p>
              <Button
                variant="outline"
                onClick={() => {
                  void staff.refetch();
                  void roles.refetch();
                  void overrides.refetch();
                  void accessState.refetch();
                }}
              >
                Retry loading permissions
              </Button>
            </div>
          ) : loading ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading permissions…
            </p>
          ) : !person ? (
            <p role="alert">
              This staff account is no longer available. Close this window and refresh staff.
            </p>
          ) : domains.length === 0 ? (
            <p className="text-sm text-muted-foreground">No actions match your search.</p>
          ) : (
            domains.map((domain) => (
              <section key={domain} className="overflow-hidden rounded-lg border">
                <h3 className="border-b bg-surface px-3 py-2 text-sm font-semibold capitalize">
                  {domain.replaceAll("_", " ")}
                </h3>
                <div className="divide-y">
                  {permissions
                    .filter((p) => p.domain === domain)
                    .map((p) => {
                      const override = overrides.data?.find((o) => o.permission_key === p.key);
                      const state = accessState.data?.find((s) => s.key === p.key);
                      const inherited = state?.role_default ?? false;
                      const restricted = state?.restriction;
                      return (
                        <label
                          key={p.key}
                          className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                        >
                          <span className="min-w-0 text-sm font-medium">
                            {permissionLabel(p.key, p.label)}
                            <span className="mt-1 block text-xs font-normal text-muted-foreground">
                              Role default: {inherited ? "Allowed" : "Denied"}
                              {isOwner
                                ? " · Owner access protected"
                                : override
                                  ? " · Personal exception"
                                  : ""}
                            </span>
                            <span className="mt-1 block text-xs font-normal text-muted-foreground">
                              {restricted ??
                                `Current access: ${state?.effective_allowed ? "Allowed" : "Denied"}${state?.active === false ? " · Account disabled" : ""}`}
                              {restricted && override ? " · Saved exception has no effect" : ""}
                            </span>
                          </span>
                          <select
                            aria-label={`${permissionLabel(p.key, p.label)} permission`}
                            className="w-full shrink-0 rounded-md border bg-background p-2 text-sm sm:w-56"
                            value={
                              isOwner || restricted
                                ? "inherit"
                                : override
                                  ? override.granted
                                    ? "allow"
                                    : "deny"
                                  : "inherit"
                            }
                            disabled={isOwner || Boolean(restricted) || !state || save.isPending}
                            onChange={(e) =>
                              save.mutate({ permission: p.key, value: e.target.value })
                            }
                          >
                            <option value="inherit">
                              Use role default ({inherited ? "Allowed" : "Denied"})
                            </option>
                            <option value="allow">Allow for this person</option>
                            <option value="deny">Deny for this person</option>
                          </select>
                        </label>
                      );
                    })}
                </div>
              </section>
            ))
          )}
        </div>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t px-5 py-3">
          <p role="status" className="text-xs text-muted-foreground">
            {save.isPending ? "Saving permission…" : "Each change saves automatically."}
          </p>
          <Button variant="outline" disabled={save.isPending} onClick={onClose}>
            Done
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
