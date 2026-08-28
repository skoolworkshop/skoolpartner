import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

type Variant = "primary" | "accent" | "ink" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

/**
 * Knopstijl overgenomen van skoolworkshop.nl: pilvorm, Titillium Web semibold
 * en de accentkleur #F49700 als hoofdknop.
 *
 * Eén afwijking: de website zet witte tekst op oranje, wat een contrast van
 * 2,3:1 geeft. In een portaal met formulieren en bedragen is dat te weinig,
 * dus staat er donkere tekst op het oranje. Dat haalt 8,6:1 en blijft
 * herkenbaar Skool Workshop.
 */
const base =
  "inline-flex items-center justify-center gap-2 rounded-pill font-display font-semibold " +
  "tracking-[-0.01em] transition-colors select-none " +
  "disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-ink hover:bg-accent-strong hover:text-white",
  accent: "bg-accent text-ink hover:bg-accent-strong hover:text-white",
  ink: "bg-ink text-white hover:bg-ink-soft",
  secondary: "bg-white text-ink border border-line hover:border-ink",
  ghost: "bg-transparent text-ink hover:bg-surface-3",
  danger: "bg-danger text-white hover:opacity-90",
};

const sizes: Record<Size, string> = {
  sm: "min-h-11 px-4 py-2 text-sm",
  md: "h-12 px-7 text-base",
  lg: "h-13 px-8 text-[17px]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ className, variant = "primary", size = "md", ...props }: ButtonProps) {
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}

export interface ButtonLinkProps extends React.ComponentProps<typeof Link> {
  variant?: Variant;
  size?: Size;
}

export function ButtonLink({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonLinkProps) {
  return <Link className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}

export function ExternalButtonLink({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }) {
  return (
    <a
      className={cn(base, variants[variant], sizes[size], className)}
      rel="noopener noreferrer"
      {...props}
    />
  );
}
