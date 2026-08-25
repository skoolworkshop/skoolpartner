"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import type { AdminState } from "@/app/admin/actions";

const initial: AdminState = { status: "idle" };

function SubmitButton({
  label,
  variant,
  size,
}: {
  label: string;
  variant?: "primary" | "ink" | "secondary" | "ghost" | "danger" | "accent";
  size?: "sm" | "md" | "lg";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending}>
      {pending ? "Bezig…" : label}
    </Button>
  );
}

/**
 * Generieke wrapper rond een server action met nette laad- en foutstates.
 * Server actions worden als prop doorgegeven; de daadwerkelijke logica en
 * autorisatie blijven volledig server-side.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  variant = "ink",
  size = "sm",
  className,
  inline = false,
}: {
  action: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  children?: React.ReactNode;
  submitLabel: string;
  variant?: "primary" | "ink" | "secondary" | "ghost" | "danger" | "accent";
  size?: "sm" | "md" | "lg";
  className?: string;
  inline?: boolean;
}) {
  const [state, formAction] = useActionState(action, initial);

  return (
    <form action={formAction} className={cn(inline ? "flex flex-wrap items-end gap-2" : "space-y-3", className)}>
      {children}
      <SubmitButton label={submitLabel} variant={variant} size={size} />
      {state.status === "ok" ? (
        <Alert tone="success" className={inline ? "w-full" : undefined}>
          {state.message}
          {state.inviteUrl ? (
            <code className="mt-2 block break-all rounded bg-white px-2 py-1 text-xs">
              {state.inviteUrl}
            </code>
          ) : null}
        </Alert>
      ) : null}
      {state.status === "error" ? (
        <Alert tone="danger" className={inline ? "w-full" : undefined}>
          {state.message}
        </Alert>
      ) : null}
    </form>
  );
}
