"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * De navigatie van het beheerportaal.
 *
 * De onderdelen zijn gegroepeerd omdat er met het CRM erbij te veel losse
 * regels onder elkaar zouden komen te staan. Er is bewust niets hernoemd,
 * verplaatst of weggehaald: elk bestaand onderdeel staat nog op precies
 * dezelfde plek en heeft nog precies dezelfde link. Alleen de kopjes zijn
 * nieuw.
 */

interface Item {
  href: string;
  label: string;
  exact?: boolean;
}

interface Groep {
  titel: string;
  items: Item[];
}

const groepen: Groep[] = [
  {
    titel: "Dagelijks",
    items: [
      { href: "/admin", label: "Overzicht", exact: true },
      { href: "/admin/crm", label: "CRM", exact: true },
      { href: "/admin/crm/relaties", label: "Relaties" },
      { href: "/admin/crm/pijplijn", label: "Pijplijn" },
      { href: "/admin/crm/taken", label: "Taken" },
      { href: "/admin/crm/suri", label: "Reisperiodes" },
      { href: "/admin/boekingen", label: "Boekingen" },
      { href: "/admin/facturen", label: "Facturen" },
    ],
  },
  {
    titel: "Klanten",
    items: [
      { href: "/admin/organisaties", label: "Organisaties" },
      { href: "/admin/gebruikers", label: "Gebruikers" },
      { href: "/admin/resultaten", label: "Resultaten" },
    ],
  },
  {
    titel: "SkoolPartner",
    items: [
      { href: "/admin/skoolpoints", label: "SkoolPoints" },
      { href: "/admin/inwisselen", label: "Inwisselen" },
      { href: "/admin/cjp-tegoed", label: "CJP-tegoed" },
    ],
  },
  {
    titel: "Systeem",
    items: [
      { href: "/admin/integraties", label: "Integraties" },
      { href: "/admin/instellingen", label: "Instellingen" },
      { href: "/admin/audit", label: "Audit log" },
    ],
  },
];

const items: Item[] = groepen.flatMap((groep) => groep.items);

function isActief(item: Item, pathname: string): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AdminNav({ variant = "header" }: { variant?: "header" | "sidebar" | "mobile" }) {
  const pathname = usePathname();
  const router = useRouter();
  const current = items.find((item) => isActief(item, pathname))?.href ?? "/admin";

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
        {groepen.map((groep) => (
          <optgroup key={groep.titel} label={groep.titel}>
            {groep.items.map((item) => (
              <option key={item.href} value={item.href}>
                {item.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {variant === "sidebar" ? (
        <div className="flex flex-col gap-5">
          {groepen.map((groep) => (
            <div key={groep.titel}>
              <p className="mb-1 px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-soft">
                {groep.titel}
              </p>
              <ul className="flex flex-col gap-1">
                {groep.items.map((item) => (
                  <NavRegel key={item.href} item={item} pathname={pathname} variant="sidebar" />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className={cn(variant === "mobile" ? "hidden" : "hidden flex-wrap gap-1 md:flex")}>
          {items.map((item) => (
            <NavRegel key={item.href} item={item} pathname={pathname} variant="header" />
          ))}
        </ul>
      )}
    </nav>
  );
}

function NavRegel({
  item,
  pathname,
  variant,
}: {
  item: Item;
  pathname: string;
  variant: "sidebar" | "header";
}) {
  const active = isActief(item, pathname);

  return (
    <li>
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
}
