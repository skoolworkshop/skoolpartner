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
              "flex items-center gap-3 rounded-card px-3 py-2.5 text-[15px] font-medium transition-colors",
              active ? "bg-ink text-white" : "text-ink hover:bg-surface-3"
            )}
          >
            <Icon aria-hidden className="size-[18px] shrink-0" />
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
                  "flex flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium",
                  active ? "text-ink" : "text-muted"
                )}
              >
                <Icon aria-hidden className={cn("size-5", active && "text-accent")} />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
