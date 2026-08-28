"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

const items = [
  { href: "/admin", label: "Overzicht", exact: true },
  { href: "/admin/organisaties", label: "Organisaties" },
  { href: "/admin/gebruikers", label: "Gebruikers" },
  { href: "/admin/boekingen", label: "Boekingen" },
  { href: "/admin/facturen", label: "Facturen" },
  { href: "/admin/resultaten", label: "Resultaten" },
  { href: "/admin/skoolpoints", label: "SkoolPoints" },
  { href: "/admin/inwisselen", label: "Inwisselen" },
  { href: "/admin/cjp-tegoed", label: "CJP-tegoed" },
  { href: "/admin/integraties", label: "Integraties" },
  { href: "/admin/instellingen", label: "Instellingen" },
  { href: "/admin/audit", label: "Audit log" },
];

export function AdminNav({ variant = "header" }: { variant?: "header" | "sidebar" | "mobile" }) {
  const pathname = usePathname();
  const router = useRouter();
  const current =
    items.find((item) =>
      item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
    )?.href ?? "/admin";

  return (
    <nav aria-label="Beheernavigatie" className={cn(variant === "header" && "-mb-px")}>
      <label htmlFor="admin-mobile-nav" className="sr-only">
        Kies een beheeronderdeel
      </label>
      <select
        id="admin-mobile-nav"
        value={current}
        onChange={(event) => router.push(event.target.value)}
        className={cn(
          "h-11 w-full rounded-card border border-line bg-white px-3 text-base font-semibold text-ink",
          variant === "sidebar" ? "hidden" : variant === "mobile" ? "block" : "mb-3 md:hidden"
        )}
      >
        {items.map((item) => (
          <option key={item.href} value={item.href}>
            {item.label}
          </option>
        ))}
      </select>

      <ul
        className={cn(
          variant === "sidebar"
            ? "flex flex-col gap-1"
            : variant === "mobile"
              ? "hidden"
              : "hidden flex-wrap gap-1 md:flex"
        )}
      >
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-sm font-semibold transition-colors",
                  variant === "sidebar"
                    ? "relative flex w-full items-center rounded-card px-4 py-2.5"
                    : "inline-block border-b-2 px-3 py-2.5",
                  variant === "sidebar"
                    ? active
                      ? "bg-accent-wash text-ink before:absolute before:left-0 before:h-6 before:w-1 before:rounded-pill before:bg-accent"
                      : "text-muted hover:bg-surface-2 hover:text-ink"
                    : active
                      ? "border-accent text-white"
                      : "border-transparent text-white/60 hover:text-white"
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
