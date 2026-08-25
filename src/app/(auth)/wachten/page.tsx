import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Aanvraag in behandeling" };

export default async function WaitingPage() {
  const session = await requireUser();
  if (session.memberships.length > 0) redirect("/dashboard");
  if (session.pendingMemberships.length === 0) redirect("/aanmelden");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px]">Uw aanvraag is ontvangen</h1>
        <p className="mt-2 text-[15px] text-muted">
          We controleren of u bij{" "}
          <strong className="text-ink">{session.pendingMemberships[0].organizationName}</strong>{" "}
          hoort. Zodra dat rond is, krijgt u toegang tot Mijn Skool. Meestal is dat binnen één
          werkdag geregeld.
        </p>
      </div>

      <div className="rounded-card border border-line-soft bg-surface-2 px-4 py-3 text-sm text-muted">
        Klopt er iets niet, of gaat het te lang duren? Mail ons op{" "}
        <a
          className="font-semibold text-ink underline underline-offset-4"
          href="mailto:boekingen@skoolworkshop.nl"
        >
          boekingen@skoolworkshop.nl
        </a>
        .
      </div>

      <form action="/auth/uitloggen" method="post">
        <Button type="submit" variant="secondary">
          Uitloggen
        </Button>
      </form>
    </div>
  );
}
