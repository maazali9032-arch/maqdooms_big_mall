import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

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
    <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
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
    <section className={cn("panel overflow-hidden", className)}>
      {title ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "warning" | "danger" | "success";
}) {
  const toneClass =
    tone === "warning"
      ? "text-warning-foreground"
      : tone === "danger"
        ? "text-destructive"
        : tone === "success"
          ? "text-success"
          : "text-foreground";
  return (
    <div className="panel px-4 py-3">
      <p className="label-eyebrow">{label}</p>
      <p className={cn("numeric mt-1.5 text-2xl font-semibold leading-none", toneClass)}>{value}</p>
      {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-success/12 text-success border-success/25",
  committed: "bg-success/12 text-success border-success/25",
  ready: "bg-success/12 text-success border-success/25",
  fulfilled: "bg-success/12 text-success border-success/25",
  delivered: "bg-success/12 text-success border-success/25",
  published: "bg-success/12 text-success border-success/25",
  draft: "bg-warning/15 text-warning-foreground border-warning/35",
  incomplete: "bg-warning/15 text-warning-foreground border-warning/35",
  picking: "bg-warning/15 text-warning-foreground border-warning/35",
  in_progress: "bg-info/12 text-info border-info/25",
  new: "bg-info/12 text-info border-info/25",
  open: "bg-info/12 text-info border-info/25",
  depleted: "bg-destructive/10 text-destructive border-destructive/25",
  cancelled: "bg-destructive/10 text-destructive border-destructive/25",
  archived: "bg-muted text-muted-foreground border-border",
  unpublished: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] font-medium capitalize",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground border-border",
      )}
    >
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
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}

export function DemoNotice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-sm border border-dashed border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
      {children}
    </p>
  );
}
