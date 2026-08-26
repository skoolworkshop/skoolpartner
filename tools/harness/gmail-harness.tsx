/**
 * Visuele controle van het Gmail-blok in Admin > Integraties, in de drie
 * situaties die kunnen voorkomen. Dit rendert de echte componenten uit de app.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  GmailApartAdresUitleg,
  GmailIdentityRows,
  GmailSendAsNotice,
} from "@/components/admin/gmail-details";
import type { GmailStatus } from "@/lib/integrations/health";

const ACCOUNT = "clinten@skoolworkshop.nl";
const MAILBOX = "boekingen@skoolworkshop.nl";

const gereed: GmailStatus = {
  connected: true,
  accountEmail: ACCOUNT,
  mailbox: MAILBOX,
  apartAdres: true,
  connectedAt: "2026-08-26T20:00:00Z",
  sendAs: {
    state: "gereed",
    ready: true,
    message: `Er kan worden verzonden als ${MAILBOX}.`,
    entry: { sendAsEmail: MAILBOX, displayName: "Skool Workshop" },
  },
};

const configuratie: GmailStatus = {
  ...gereed,
  sendAs: {
    state: "ontbreekt",
    ready: false,
    message: `${MAILBOX} staat niet als verzendadres in dit Google-account.`,
    entry: null,
  },
};

const nietGekoppeld: GmailStatus = {
  connected: false,
  accountEmail: null,
  mailbox: MAILBOX,
  apartAdres: false,
  connectedAt: null,
  sendAs: null,
};

function GmailKaart({ status, titel }: { status: GmailStatus; titel: string }) {
  return (
    <Card>
      <CardHeader
        title="Gmail"
        description="Leest en verstuurt de klantcommunicatie van het boekingenadres."
        action={<Badge tone={status.connected ? "success" : "danger"}>{titel}</Badge>}
      />
      <CardBody className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted">Status</dt>
            <dd className="font-medium">{status.connected ? "ok" : "onbekend"}</dd>
          </div>
          <div>
            <dt className="text-muted">Laatst gesynchroniseerd</dt>
            <dd className="font-medium">26 aug. 2026 21:04</dd>
          </div>
          <GmailIdentityRows status={status} />
          <div>
            <dt className="text-muted">Verwerkt</dt>
            <dd className="font-medium">12</dd>
          </div>
          <div>
            <dt className="text-muted">Mislukte pogingen</dt>
            <dd className="font-medium">0</dd>
          </div>
        </dl>
        <GmailSendAsNotice status={status} />
        <GmailApartAdresUitleg status={status} />
      </CardBody>
    </Card>
  );
}

export function Harness() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <h2 className="text-[22px]">Gekoppeld, verzenden gereed</h2>
      <GmailKaart status={gereed} titel="Verbonden" />

      <h2 className="text-[22px]">Gekoppeld, maar send-as nog niet ingesteld</h2>
      <GmailKaart status={configuratie} titel="Verbonden" />

      <h2 className="text-[22px]">Nog niet gekoppeld</h2>
      <GmailKaart status={nietGekoppeld} titel="Niet verbonden" />
    </div>
  );
}
