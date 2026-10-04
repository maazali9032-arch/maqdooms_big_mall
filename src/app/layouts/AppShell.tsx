import { Link, Navigate, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { allowedModules, canAccessPath, homePath, type ModuleKey } from "@/app/access/modules";
import {
  BarChart3,
  RefreshCw,
  Boxes,
  ChevronDown,
  ClipboardList,
  Gauge,
  KeyRound,
  LogOut,
  Menu,
  MessageCircle,
  Scissors,
  Search,
  Settings,
  ShoppingCart,
  Store,
  UserRound,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { ROLE_LABELS, useSession } from "@/app/providers/session";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { initials } from "@/shared/utils/format";

type NavItem = { to: string; label: string; icon: typeof Gauge; module: ModuleKey };
type NavSection = { label: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [{ to: "/dashboard", label: "Dashboard", icon: Gauge, module: "dashboard" }],
  },
  {
    label: "Operations",
    items: [
      { to: "/inventory", label: "Inventory", icon: Boxes, module: "inventory" },
      { to: "/pos", label: "Counter / POS", icon: ShoppingCart, module: "pos" },
      { to: "/tailoring", label: "Tailoring", icon: Scissors, module: "tailoring" },
      { to: "/customers", label: "Customers", icon: Users, module: "customers" },
    ],
  },
  {
    label: "Commerce",
    items: [
      { to: "/ecommerce", label: "E-commerce", icon: Store, module: "ecommerce" },
      { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle, module: "whatsapp" },
    ],
  },
  {
    label: "Insights",
    items: [
      { to: "/reports", label: "Reports", icon: BarChart3, module: "reports" },
      { to: "/audit", label: "Audit Trail", icon: ClipboardList, module: "audit" },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/access", label: "Manage Access", icon: KeyRound, module: "access" },
      { to: "/settings", label: "Settings", icon: Settings, module: "settings" },
    ],
  },
];

const ALL_NAV = NAV_SECTIONS.flatMap((section) => section.items);

/** Blocks pages outside the user's role modules (same source as the sidebar). */
function RouteGuard({ children }: { children: ReactNode }) {
  const { loading, roles, permissions, userId } = useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const denied = !loading && !!userId && !canAccessPath(roles, permissions, pathname);

  useEffect(() => {
    if (denied) toast.error("You do not have access to that page");
  }, [denied, pathname]);

  if (loading) {
    return (
      <div className="panel flex min-h-44 items-center justify-center text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }
  if (!userId) return <Navigate to="/auth" replace />;
  if (denied) return <Navigate to={homePath(roles)} replace />;
  return <>{children}</>;
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { roles } = useSession();
  const allowed = allowedModules(roles);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="scrollbar-subtle space-y-5 px-3 py-5" aria-label="Primary navigation">
      {NAV_SECTIONS.map((section) => {
        const visibleItems = section.items.filter((item) => allowed.has(item.module));
        if (visibleItems.length === 0) return null;
        return (
          <section key={section.label} aria-labelledby={`nav-${section.label}`}>
            <p
              id={`nav-${section.label}`}
              className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-primary"
            >
              {section.label}
            </p>
            <div className="space-y-0.5">
              {visibleItems.map((item) => {
                const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    onClick={onNavigate}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-all duration-150",
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--color-sidebar-primary)]"
                        : "text-sidebar-foreground/85 hover:bg-white/[0.045] hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-[18px] shrink-0 transition-colors",
                        active
                          ? "text-sidebar-primary"
                          : "text-sidebar-foreground/75 group-hover:text-sidebar-primary",
                      )}
                      strokeWidth={1.8}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex h-[88px] items-center gap-3 border-b border-sidebar-border px-5">
      <span className="flex size-10 shrink-0 items-center justify-center border border-sidebar-primary/70 text-2xl font-medium text-sidebar-primary">
        M
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[15px] font-semibold tracking-[0.02em] text-sidebar-accent-foreground">
          MAQDOOM&apos;S
        </span>
        <span className="block truncate text-[15px] font-semibold tracking-[0.02em] text-sidebar-accent-foreground">
          BIG MALL
        </span>
        <span className="mt-1 block text-[8px] font-medium uppercase tracking-[0.28em] text-sidebar-primary">
          ERP &amp; Operations
        </span>
      </span>
    </div>
  );
}

function SidebarFooter() {
  return (
    <div className="relative overflow-hidden border-t border-sidebar-border px-6 py-6">
      <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_15%_20%,#b18a4a_0,transparent_28%),repeating-linear-gradient(135deg,transparent_0_8px,#b18a4a0d_8px_9px)]" />
      <div className="relative">
        <p className="text-[10px] font-medium uppercase leading-relaxed tracking-[0.24em] text-sidebar-primary">
          Heritage in
          <br />
          every thread
        </p>
        <span className="mt-3 block h-px w-6 bg-sidebar-primary" />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { fullName, roles, email } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const allowed = allowedModules(roles);
  const roleLabel = roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") || "Staff";

  const searchMatches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return ALL_NAV.filter(
      (item) => allowed.has(item.module) && item.label.toLowerCase().includes(term),
    ).slice(0, 5);
  }, [allowed, search]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const first = searchMatches[0];
    if (first) {
      setSearch("");
      void navigate({ to: first.to });
    } else if (search.trim()) {
      toast.info("No permitted module matches that search");
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      <a
        href="#workspace-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-card focus:p-3"
      >
        Skip to workspace
      </a>
      <aside className="sticky top-0 hidden h-screen w-[256px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Brand />
        <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto">
          <NavLinks />
        </div>
        <SidebarFooter />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          data-workspace-header
          className="sticky top-0 z-30 flex h-[72px] items-center gap-3 border-b border-border bg-card/95 px-3 backdrop-blur sm:px-6"
        >
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
            <SheetContent side="left" className="w-[280px] border-sidebar-border bg-sidebar p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Brand />
              <div className="max-h-[calc(100vh-88px)] overflow-y-auto">
                <NavLinks onNavigate={() => setMobileOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          <form className="relative min-w-0 max-w-lg flex-1" onSubmit={submitSearch}>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-10 w-full rounded-md border border-border bg-surface/60 pl-10 pr-4 text-sm text-foreground shadow-sm shadow-black/[0.015] outline-none transition-all placeholder:text-muted-foreground focus:border-primary/45 focus:bg-card focus:ring-2 focus:ring-ring/15"
              placeholder="Search modules…"
              aria-label="Search permitted modules"
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearch("");
              }}
            />
            {search.trim() ? (
              <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg">
                {searchMatches.length ? (
                  searchMatches.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        type="button"
                        key={item.to}
                        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                        onClick={() => {
                          setSearch("");
                          void navigate({ to: item.to });
                        }}
                      >
                        <Icon className="size-4 text-primary" />
                        {item.label}
                      </button>
                    );
                  })
                ) : (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    No permitted modules found
                  </p>
                )}
              </div>
            ) : null}
          </form>

          <div className="ml-auto flex items-center gap-1 sm:gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh current workspace"
              className="text-foreground"
              onClick={() => {
                void queryClient.invalidateQueries();
                toast.info("Refreshing current workspace data");
              }}
            >
              <RefreshCw className="size-[18px]" strokeWidth={1.8} />
            </Button>

            <div className="hidden h-8 w-px bg-border sm:block" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-md p-1 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/30 sm:gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#342718] text-xs font-semibold text-[#f6ead6] shadow-sm">
                    {initials(fullName)}
                  </span>
                  <span className="hidden min-w-0 sm:block">
                    <span className="block max-w-40 truncate text-xs font-semibold leading-tight">
                      {fullName}
                    </span>
                    <span className="block max-w-40 truncate text-[11px] leading-tight text-muted-foreground">
                      {roleLabel}
                    </span>
                  </span>
                  <ChevronDown className="hidden size-4 text-muted-foreground sm:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <span className="block text-sm font-medium">{fullName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void navigate({ to: "/settings" })}>
                  <UserRound /> Account settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => void signOut()}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main
          id="workspace-main"
          tabIndex={-1}
          className="heritage-grid min-w-0 flex-1 px-3 py-5 sm:px-6 sm:py-7 xl:px-8"
        >
          <div className="mx-auto w-full max-w-[1480px] space-y-5">
            <RouteGuard>{children}</RouteGuard>
          </div>
        </main>
      </div>
    </div>
  );
}
