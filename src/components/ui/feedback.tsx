import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

type AlertTone = "info" | "success" | "warning" | "danger";

const alertTones: Record<AlertTone, { wrapper: string; Icon: typeof Info }> = {
  info: { wrapper: "bg-info-wash text-info border-info/20", Icon: Info },
  success: { wrapper: "bg-success-wash text-success border-success/20", Icon: CheckCircle2 },
  warning: { wrapper: "bg-warning-wash text-warning border-warning/20", Icon: AlertTriangle },
  danger: { wrapper: "bg-danger-wash text-danger border-danger/20", Icon: XCircle },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: AlertTone; title?: string }) {
  const { wrapper, Icon } = alertTones[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-card border px-4 py-3 text-sm", wrapper, className)}
      {...props}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5")}>{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {Icon ? (
        <span className="mb-4 flex size-12 items-center justify-center rounded-pill bg-surface-3">
          <Icon aria-hidden className="size-6 text-muted-soft" />
        </span>
      ) : null}
      <p className="font-display text-lg font-bold">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-card bg-surface-3", className)} aria-hidden />;
}

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Gegevens worden geladen</span>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}
