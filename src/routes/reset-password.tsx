import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set a new password — Maqdoom's Big Mall ERP" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

const MIN_LENGTH = 8;

/** Reads an error Supabase puts in the link (for example an expired or already used link). */
function linkError() {
  const params = new URLSearchParams(
    window.location.hash.replace(/^#/, "") || window.location.search.replace(/^\?/, ""),
  );
  const description = params.get("error_description");
  return description ? description.replace(/\+/g, " ") : null;
}

/**
 * Opened from the password-reset email. The link signs the person in for this one purpose;
 * they then choose a new password.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");
  const [problem, setProblem] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fromLink = linkError();
    if (fromLink) {
      setProblem(fromLink);
      setState("invalid");
      return;
    }
    let settled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        settled = true;
        setState("ready");
      }
    });
    // The client reads the link's tokens on load; give it a moment, then check for a session.
    const timer = window.setTimeout(async () => {
      if (settled) return;
      const { data } = await supabase.auth.getSession();
      setState(data.session ? "ready" : "invalid");
    }, 1200);
    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_LENGTH) {
      toast.error(`Use at least ${MIN_LENGTH} characters`);
      return;
    }
    if (password !== confirm) {
      toast.error("The two passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      // Clear the reset tokens from the address bar.
      window.history.replaceState(null, "", "/reset-password");
      toast.success("Password changed. You are signed in.");
      await navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="heritage-grid flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm shadow-black/[0.025] sm:p-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
          MAQDOOM&apos;S BIG MALL · Staff access
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Set a new password</h1>

        {state === "checking" && (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Checking your reset link…
          </p>
        )}

        {state === "invalid" && (
          <div role="alert" className="mt-4 space-y-3 text-sm">
            <p>
              This reset link is not valid any more. Links work once and expire after a short time.
            </p>
            {problem && <p className="text-muted-foreground">Details: {problem}</p>}
            <Button asChild className="w-full">
              <Link to="/auth">Request a new link</Link>
            </Button>
          </div>
        )}

        {state === "ready" && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <fieldset disabled={busy} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  required
                  minLength={MIN_LENGTH}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">At least {MIN_LENGTH} characters.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Type it again</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="h-11"
                />
              </div>
              <Button type="submit" className="h-11 w-full">
                {busy ? "Saving…" : "Save new password"}
              </Button>
            </fieldset>
          </form>
        )}
      </div>
    </div>
  );
}
