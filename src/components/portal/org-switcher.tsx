"use client";

import { useTransition } from "react";
import { Building2, ChevronDown } from "lucide-react";

import { switchOrganization } from "@/app/(portal)/actions";

export function OrgSwitcher({
  organizations,
  activeId,
}: {
  organizations: { id: string; name: string }[];
  activeId: string;
}) {
  const [pending, startTransition] = useTransition();
  const active = organizations.find((o) => o.id === activeId);

  if (organizations.length <= 1) {
    return (
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Building2 aria-hidden className="size-4 text-muted" />
        <span className="truncate">{active?.name ?? "Onbekende organisatie"}</span>
      </p>
    );
  }

  return (
    <div className="relative">
      <label htmlFor="org-switcher" className="sr-only">
        Actieve organisatie
      </label>
      <Building2
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
      />
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
        className="w-full appearance-none rounded-card border border-line bg-white py-2 pl-9 pr-8 text-sm font-semibold text-ink"
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
