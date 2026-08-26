"use client";

import { useTransition } from "react";
import { ChevronDown } from "lucide-react";

import { OrgLogo } from "@/components/portal/org-logo";
import { switchOrganization } from "@/app/(portal)/actions";

export interface OrgOption {
  id: string;
  name: string;
  logoUrl: string | null;
}

export function OrgSwitcher({
  organizations,
  activeId,
}: {
  organizations: OrgOption[];
  activeId: string;
}) {
  const [pending, startTransition] = useTransition();
  const active = organizations.find((o) => o.id === activeId);

  if (organizations.length <= 1) {
    return (
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <OrgLogo name={active?.name ?? "Organisatie"} logoUrl={active?.logoUrl} size={24} />
        <span className="truncate">{active?.name ?? "Onbekende organisatie"}</span>
      </p>
    );
  }

  return (
    <div className="relative">
      <label htmlFor="org-switcher" className="sr-only">
        Actieve organisatie
      </label>

      {/* Het logo van de organisatie die nu actief is. Het staat boven het
          keuzemenu, want een select kan zelf geen afbeelding tonen. */}
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
        <OrgLogo name={active?.name ?? "Organisatie"} logoUrl={active?.logoUrl} size={22} />
      </span>

      <select
        id="org-switcher"
        defaultValue={activeId}
        disabled={pending}
        onChange={(event) => {
          const value = event.target.value;
          startTransition(() => {
            void switchOrganization(value);
          });
        }}
        className="w-full appearance-none rounded-card border border-line bg-white py-2 pl-10 pr-8 text-sm font-semibold text-ink"
      >
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>

      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
      />
    </div>
  );
}
