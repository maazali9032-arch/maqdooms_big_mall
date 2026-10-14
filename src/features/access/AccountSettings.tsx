import { useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/app/providers/session";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/shared/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AccountSettings() {
  const session = useSession();
  const [name, setName] = useState(session.fullName);
  const [email, setEmail] = useState(session.email ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (kind: "name" | "email" | "password") => {
    setBusy(true);
    try {
      if (kind === "name") {
        const { error } = await supabase.rpc("update_account_name", { p_name: name.trim() });
        if (error) throw error;
        await session.refresh();
        toast.success("Name updated");
      } else if (kind === "email") {
        if (!email.trim() || email.trim() === session.email)
          throw new Error("Enter a different email address");
        const { error } = await supabase.auth.updateUser({ email: email.trim() });
        if (error) throw error;
        toast.success(
          "Email change requested. Follow the confirmation instructions from Supabase before using the new address.",
        );
      } else {
        if (password.length < 8 || password !== confirm)
          throw new Error("Passwords must match and contain at least 8 characters");
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPassword("");
        setConfirm("");
        toast.success("Password updated");
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Update your account">
      <fieldset disabled={busy} className="grid gap-6 md:grid-cols-3">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save("name");
          }}
        >
          <label className="block text-sm">
            Name
            <Input
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
          </label>
          <Button type="submit" variant="outline">
            Save name
          </Button>
        </form>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save("email");
          }}
        >
          <label className="block text-sm">
            Email
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <Button type="submit" variant="outline">
            Change email
          </Button>
        </form>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save("password");
          }}
        >
          <label className="block text-sm">
            New password
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <label className="block text-sm">
            Confirm password
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <Button type="submit" variant="outline">
            Change password
          </Button>
        </form>
      </fieldset>
    </Panel>
  );
}
