import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-pill font-display font-semibold " +
  "transition-colors disabled:pointer-events-none disabled:opacity-50 select-none";

const variants: Record<Variant, string> = {
  // Donker en rustig: het portaal is functioneel, niet promotioneel.
  primary: "bg-ink text-white hover:bg-ink-soft",
  // Accent voor de belangrijkste commerciële actie (nieuwe workshop aanvragen).
  accent: "bg-accent text-ink hover:bg-accent-strong hover:text-white",
  secondary: "bg-white text-ink border border-line hover:bg-surface-2",
  ghost: "bg-transparent text-ink hover:bg-surface-3",
  danger: "bg-danger text-white hover:opacity-90",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-[15px]",
  lg: "h-12 px-7 text-base",
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
  variant = "accent",
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
