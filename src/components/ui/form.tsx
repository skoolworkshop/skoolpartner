import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Invoervelden in de stijl van skoolworkshop.nl: gevuld met de lichtgrijze
 * achtergrond #F7F7F7, randloos in rust en wit zodra het veld focus krijgt.
 * Enkelregelige velden zijn afgerond zoals op de site; meerregelige velden
 * krijgen een rustiger radius, omdat een volledige pilvorm daar niet werkt.
 */
const controlBase =
  "w-full border bg-surface-2 border-surface-2 px-4 text-[15px] text-ink " +
  "placeholder:text-muted-soft transition-colors " +
  "focus:bg-white focus:border-accent " +
  "disabled:opacity-60 disabled:text-muted";

const singleLine = "h-12 rounded-pill";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  showOptional = true,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  /** Verberg alleen het woord 'optioneel'; het veld blijft technisch optioneel. */
  showOptional?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block break-words text-sm font-semibold text-ink">
        {label}
        {required ? (
          <span className="ml-1 text-accent-strong" aria-hidden>
            *
          </span>
        ) : showOptional ? (
          <span className="ml-1 font-normal text-muted-soft">(optioneel)</span>
        ) : null}
      </label>
      {hint ? (
        <p id={`${htmlFor}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlBase, singleLine, "min-w-0 max-w-full", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(controlBase, "min-h-28 resize-y rounded-card py-3", className)} {...props} />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(controlBase, singleLine, "pr-9", className)} {...props} />;
}

export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn("size-4 rounded border-line accent-[#f49700]", className)}
      {...props}
    />
  );
}
