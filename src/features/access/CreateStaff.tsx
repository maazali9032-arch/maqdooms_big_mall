import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, useSession } from "@/app/providers/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Registration = { p_user: string; p_name: string; p_roles: string[] };
export function CreateStaff({
  onClose,
  initialRole = "stock_entry",
  onCreated,
}: {
  onClose: () => void;
  initialRole?: string;
  onCreated?: (userId: string) => void;
}) {
  const { isOwner } = useSession();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(initialRole);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Registration | null>(null);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  if (!isOwner) return null;
  const submit = async () => {
    setBusy(true);
    try {
      let registration = pending;
      let needsConfirmation = confirmationRequired;
      if (!registration) {
        if (!name.trim() || !email.trim() || password.length < 8)
          throw new Error("Enter name, email and a temporary password of at least 8 characters");
        const url = import.meta.env["VITE_SUPABASE_URL"];
        const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
        if (!url || !key)
          throw new Error("Account creation is unavailable: Supabase connection is not configured");
        // Isolate the new account's session; the Owner stays signed in.
        const isolated = createClient(url, key, {
          global: {
            fetch: (input, init) => {
              const headers = new Headers(init?.headers);
              if (
                key.startsWith("sb_publishable_") &&
                headers.get("Authorization") === `Bearer ${key}`
              )
                headers.delete("Authorization");
              return fetch(input, { ...init, headers });
            },
          },
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: `staff-create-${crypto.randomUUID()}`,
          },
        });
        const { data, error } = await isolated.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        });
        if (error) throw error;
        if (!data.user?.id)
          throw new Error(
            "The account could not be created. Check whether this email already exists.",
          );
        if (data.user.identities?.length === 0)
          throw new Error(
            "This email already has an account. Use Users & Permissions to assign its roles.",
          );
        registration = { p_user: data.user.id, p_name: name.trim(), p_roles: [role] };
        needsConfirmation = !data.session;
        setConfirmationRequired(needsConfirmation);
        setPending(registration);
        setPassword("");
        if (data.session) await isolated.auth.signOut({ scope: "local" });
      }
      const { error } = await supabase.rpc("owner_register_staff", registration);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["staff"] });
      await qc.invalidateQueries({ queryKey: ["tailoring-hierarchy"] });
      toast.success(
        needsConfirmation
          ? "Staff account added. They must confirm their email before signing in."
          : "Staff account added. They can sign in with the temporary password and change it in Account.",
      );
      setPending(null);
      onCreated?.(registration.p_user);
      onClose();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add staff account</DialogTitle>
          <DialogDescription>
            Create a login and assign its role. More roles can be added in Users & Permissions.
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy || !!pending} className="space-y-3">
          <label className="block text-sm">
            Name
            <Input
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="block text-sm">
            Email
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="block text-sm">
            Temporary password
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="block text-sm">
            Role
            <select
              aria-label="Staff role"
              className="mt-1 w-full rounded border bg-background p-3"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {Object.entries(ROLE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        {pending && (
          <p className="text-sm">
            The login was created. Retry to confirm its role assignment before creating another
            account.
          </p>
        )}
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? "Saving…" : pending ? "Retry role assignment" : "Create staff account"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
