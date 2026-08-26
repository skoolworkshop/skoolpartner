"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const items = [
  { href: "/admin", label: "Overzicht", exact: true },
  { href: "/admin/controle", label: "Controle nodig" },
  { href: "/admin/organisaties", label: "Organisaties" },
  { href: "/admin/gebruikers", label: "Gebruikers" },
  { href: "/admin/boekingen", label: "Boekingen" },
  { href: "/admin/facturen", label: "Facturen" },
  { href: "/admin/berichten", label: "Berichten" },
  { href: "/admin/resultaten", label: "Resultaten" },
  { href: "/admin/skoolpoints", label: "SkoolPoints" },
  { href: "/admin/inwisselen", label: "Inwisselen" },
  { href: "/admin/cjp-tegoed", label: "CJP-tegoed" },
  { href: "/admin/integraties", label: "Integraties" },
  { href: "/admin/instellingen", label: "Instellingen" },
  { href: "/admin/audit", label: "Audit log" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Beheernavigatie" className="-mb-px overflow-x-auto">
      <ul className="flex min-w-max gap-1">
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
                  "inline-block border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors",
                  active
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
