import { Link, Navigate, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { allowedModules, canAccessPath, homePath, type ModuleKey } from "@/app/access/modules";
import {
  Boxes,
  ClipboardList,
  Gauge,
  KeyRound,
  LineChart,
  LogOut,
  Menu,
  MessageSquare,
  Scissors,
  Settings,
  ShoppingBag,
  Store,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { ROLE_LABELS, useSession } from "@/app/providers/session";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { initials } from "@/shared/utils/format";

type NavItem = { to: string; label: string; icon: typeof Gauge; module: ModuleKey };

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: Gauge, module: "dashboard" },
  { to: "/inventory", label: "Inventory", icon: Boxes, module: "inventory" },
  { to: "/pos", label: "Counter / POS", icon: ShoppingBag, module: "pos" },
  { to: "/tailoring", label: "Tailoring", icon: Scissors, module: "tailoring" },
  { to: "/customers", label: "Customers", icon: Users, module: "customers" },
  { to: "/ecommerce", label: "E-commerce", icon: Store, module: "ecommerce" },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageSquare, module: "whatsapp" },
  { to: "/reports", label: "Reports", icon: LineChart, module: "reports" },
  { to: "/audit", label: "Audit trail", icon: ClipboardList, module: "audit" },
  { to: "/access", label: "Manage Access", icon: KeyRound, module: "access" },
  { to: "/settings", label: "Settings", icon: Settings, module: "settings" },
];

/** Blocks pages outside the user's role modules (same source as the sidebar). */
function RouteGuard({ children }: { children: ReactNode }) {
  const { loading, roles, permissions, userId } = useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const denied = !loading && !!userId && !canAccessPath(roles, permissions, pathname);
  useEffect(() => {
    if (denied) toast.error("You do not have access to that page");
  }, [denied, pathname]);
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!userId) return <Navigate to="/auth" replace />;
  if (denied) return <Navigate to={homePath(roles)} replace />;
  return <>{children}</>;
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { roles } = useSession();
  const allowed = allowedModules(roles);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="space-y-0.5 px-2 py-3">
      {NAV.filter((item) => allowed.has(item.module)).map((item) => {
        const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-3.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
        M
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-sidebar-accent-foreground">
          Maqdoom&apos;s Big Mall
        </span>
        <span className="block text-[11px] text-sidebar-foreground/70">ERP &amp; Operations</span>
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { fullName, roles, email } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto">
          <NavLinks />
        </div>
        <div className="border-t border-sidebar-border px-4 py-3 text-[11px] text-sidebar-foreground/60">
          Demo environment — sample data
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card px-3 sm:px-4">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-sidebar p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Brand />
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium lg:hidden">Maqdoom&apos;s Big Mall</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium leading-tight">{fullName}</p>
              <p className="text-[11px] leading-tight text-muted-foreground">
                {roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") || email}
              </p>
            </div>
            <span className="flex size-8 items-center justify-center rounded-sm bg-primary text-xs font-semibold text-primary-foreground">
              {initials(fullName)}
            </span>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>

        <main className="flex-1 px-3 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto w-full max-w-[1400px] space-y-5">
            <RouteGuard>{children}</RouteGuard>
          </div>
        </main>
      </div>
    </div>
  );
}
