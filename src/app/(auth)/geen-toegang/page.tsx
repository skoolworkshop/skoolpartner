import type { Metadata } from "next";

import { Button, ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Geen toegang" };

export default function NoAccessPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px]">U heeft geen toegang tot deze pagina</h1>
        <p className="mt-2 text-[15px] text-muted">
          Uw account heeft niet de rechten die voor deze pagina nodig zijn. Klopt dit niet? Neem
          dan contact op met Skool Workshop.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/dashboard">Naar het dashboard</ButtonLink>
        <form action="/auth/uitloggen" method="post">
          <Button type="submit" variant="secondary">
            Uitloggen
          </Button>
        </form>
      </div>
    </div>
  );
}
