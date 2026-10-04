import { useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Boxes,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Inbox,
  PackageCheck,
  Ruler,
  Scissors,
  ShoppingBag,
  Store,
  UserCheck,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const ROUTE_CONTEXT: Record<string, string[]> = {
  dashboard: ["Overview"],
  inventory: ["Operations"],
  pos: ["Operations"],
  tailoring: ["Operations"],
  customers: ["Operations"],
  ecommerce: ["Commerce"],
  whatsapp: ["Commerce"],
  reports: ["Insights"],
  audit: ["Insights"],
  access: ["System"],
  settings: ["System"],
};

function BreadcrumbTrail({ title }: { title: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const parts = pathname.split("/").filter(Boolean);
  const moduleName = parts[0] ?? "";
  const labels = [...(ROUTE_CONTEXT[moduleName] ?? [])];
  if (parts.length > 1) {
    labels.push(
      moduleName === "inventory"
        ? "Inventory"
        : moduleName
            .replace(/(^|[-_])(\w)/g, (_, __, letter: string) => ` ${letter.toUpperCase()}`)
            .trim(),
    );
  }
  labels.push(moduleName === "dashboard" ? "Dashboard" : title);

  return (
    <nav
      className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
      aria-label="Breadcrumb"
    >
      {labels.map((label, index) => (
        <span key={`${label}-${index}`} className="flex items-center gap-1.5">
          {index ? <ChevronRight className="size-3 text-primary/65" /> : null}
          <span
            className={index === labels.length - 1 ? "font-medium text-foreground/80" : undefined}
          >
            {label}
          </span>
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 pb-1 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <BreadcrumbTrail title={title} />
        <h1 className="text-[1.75rem] font-semibold leading-none tracking-[-0.025em] text-foreground sm:text-[2rem]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-5", className)}>{children}</div>;
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("panel min-w-0 overflow-hidden", className)}>
      {title ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-tight text-foreground">{title}</h2>
            {description ? (
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

function iconForLabel(label: string): LucideIcon {
  const value = label.toLowerCase();
  if (value.includes("staff") || value.includes("customer")) return Users;
  if (value.includes("active")) return UserCheck;
  if (value.includes("role")) return ClipboardList;
  if (value.includes("login")) return UserCheck;
  if (value.includes("sale") || value.includes("value")) return CircleDollarSign;
  if (value.includes("tailor") || value.includes("job")) return Scissors;
  if (value.includes("order") || value.includes("listing")) return ShoppingBag;
  if (value.includes("available") || value.includes("metre")) return Ruler;
  if (value.includes("stock") || value.includes("thaan")) return Boxes;
  if (value.includes("published")) return Store;
  if (value.includes("movement")) return PackageCheck;
  return ClipboardList;
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "warning" | "danger" | "success";
  icon?: LucideIcon;
}) {
  const toneClass =
    tone === "warning"
      ? "text-warning-foreground"
      : tone === "danger"
        ? "text-destructive"
        : tone === "success"
          ? "text-success"
          : "text-foreground";
  const Icon = icon ?? iconForLabel(label);
  return (
    <div className="panel group flex min-h-[104px] min-w-0 items-center gap-4 px-4 py-4 sm:px-5">
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-primary transition-colors group-hover:bg-accent/75",
          tone === "warning" && "bg-warning/10 text-warning",
          tone === "danger" && "bg-destructive/10 text-destructive",
          tone === "success" && "bg-success/10 text-success",
        )}
      >
        <Icon className="size-5" strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={cn("numeric mt-1 text-2xl font-semibold leading-none", toneClass)}>{value}</p>
        {hint ? (
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-success/10 text-success border-success/20",
  committed: "bg-success/10 text-success border-success/20",
  ready: "bg-success/10 text-success border-success/20",
  fulfilled: "bg-success/10 text-success border-success/20",
  delivered: "bg-success/10 text-success border-success/20",
  published: "bg-success/10 text-success border-success/20",
  draft: "bg-warning/10 text-warning-foreground border-warning/25",
  incomplete: "bg-warning/10 text-warning-foreground border-warning/25",
  picking: "bg-warning/10 text-warning-foreground border-warning/25",
  in_progress: "bg-info/10 text-info border-info/20",
  new: "bg-info/10 text-info border-info/20",
  open: "bg-info/10 text-info border-info/20",
  depleted: "bg-destructive/8 text-destructive border-destructive/20",
  cancelled: "bg-destructive/8 text-destructive border-destructive/20",
  archived: "bg-muted text-muted-foreground border-border",
  unpublished: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium capitalize",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground border-border",
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {(label ?? status).replace(/_/g, " ")}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <span className="mb-1 flex size-10 items-center justify-center rounded-xl bg-surface-strong text-muted-foreground">
        <Inbox className="size-5" strokeWidth={1.7} />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

export function DemoNotice({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-dashed border-warning/35 bg-warning/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <span>{children}</span>
    </p>
  );
}
