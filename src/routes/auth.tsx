import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Maqdoom's Big Mall ERP" },
      {
        name: "description",
        content: "Staff sign-in for the Maqdoom's Big Mall operations platform.",
      },
      { property: "og:title", content: "Sign in — Maqdoom's Big Mall ERP" },
      {
        property: "og:description",
        content: "Staff sign-in for the Maqdoom's Big Mall operations platform.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName || email.split("@")[0] },
            emailRedirectTo: `${window.location.origin}/dashboard`,
          },
        });
        if (error) throw error;
        toast.success("Account created. Signing you in…");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      await navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Google sign-in failed");
      return;
    }
    if (result.redirected) return;
    await navigate({ to: "/dashboard" });
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_0.95fr]">
      <div className="relative hidden overflow-hidden bg-sidebar p-12 lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_15%_85%,#b18a4a_0,transparent_27%),repeating-linear-gradient(135deg,transparent_0_10px,#b18a4a0d_10px_11px)]" />
        <div className="relative flex items-center gap-3">
          <span className="flex size-11 items-center justify-center border border-sidebar-primary/70 text-2xl font-medium text-sidebar-primary">
            M
          </span>
          <span className="leading-tight">
            <span className="block text-[15px] font-semibold tracking-[0.03em] text-sidebar-accent-foreground">
              MAQDOOM&apos;S BIG MALL
            </span>
            <span className="mt-1 block text-[8px] font-medium uppercase tracking-[0.28em] text-sidebar-primary">
              ERP &amp; Operations
            </span>
          </span>
        </div>
        <div className="relative max-w-lg">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.24em] text-sidebar-primary">
            Heritage Enterprise
          </p>
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-sidebar-accent-foreground xl:text-4xl">
            Every thaan tracked. Every cut recorded.
          </h2>
          <p className="mt-5 max-w-md text-sm leading-7 text-sidebar-foreground/75">
            Stock is a ledger, not a number. Receiving, counter sales, tailoring consumption and
            online availability all resolve from the same movement history — with every action
            attributed to the staff member who performed it.
          </p>
        </div>
        <p className="relative text-[10px] uppercase tracking-[0.15em] text-sidebar-foreground/55">
          Internal operations platform · Demo environment
        </p>
      </div>

      <div className="heritage-grid flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm shadow-black/[0.025] sm:p-8">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex size-9 items-center justify-center border border-primary/60 text-lg font-semibold text-primary">
              M
            </span>
            <span className="text-sm font-semibold">MAQDOOM&apos;S BIG MALL</span>
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            Secure staff access
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {mode === "signin" ? "Staff sign in" : "Create staff account"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            The first account created becomes the Owner. Later accounts start as Counter staff until
            the owner assigns roles.
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            {mode === "signup" ? (
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Mohammed Maqdoom"
                  className="h-11"
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                className="h-11"
              />
            </div>
            <Button type="submit" disabled={busy} className="h-11 w-full">
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" className="h-11 w-full" onClick={google}>
            Continue with Google
          </Button>

          <button
            type="button"
            className="mt-6 w-full text-center text-sm text-primary underline-offset-4 hover:underline"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "No account yet? Create one" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
