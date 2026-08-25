"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { portalNav } from "./nav-items";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Verticale navigatie voor tablet en desktop. */
export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Hoofdnavigatie" className="space-y-1">
      {portalNav.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-3 rounded-card py-2.5 pl-4 pr-3 text-[15px] transition-colors",
              active
                ? "bg-accent-wash font-semibold text-ink"
                : "font-medium text-muted hover:bg-surface-2 hover:text-ink"
            )}
          >
            {active ? (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-pill bg-accent"
              />
            ) : null}
            <Icon
              aria-hidden
              className={cn("size-[18px] shrink-0", active && "text-accent-strong")}
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Horizontale navigatie voor smartphones, onderaan het scherm. */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Hoofdnavigatie"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line-soft bg-white/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-6">
        {portalNav.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 px-1 pb-2.5 pt-2 text-[11px] font-medium",
                  active ? "text-ink" : "text-muted"
                )}
              >
                <span
                  aria-hidden
                  className={cn("h-0.5 w-8 rounded-pill", active ? "bg-accent" : "bg-transparent")}
                />
                <Icon aria-hidden className={cn("size-5", active && "text-accent-strong")} />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
