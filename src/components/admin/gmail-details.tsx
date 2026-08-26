import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/feedback";
import type { GmailStatus } from "@/lib/integrations/health";

/**
 * Het Gmail-blok in Admin > Integraties.
 *
 * Bewust een eigen component: het Google-account en het boekingenadres zijn
 * twee verschillende dingen, en dat onderscheid moet op één plek worden
 * opgeschreven. Zo kan het ook los visueel worden gecontroleerd.
 */

export function GmailIdentityRows({ status }: { status: GmailStatus }) {
  if (!status.connected) return null;

  return (
    <>
      <div className="col-span-2 sm:col-span-1">
        <dt className="text-muted">OAuth-account</dt>
        <dd className="font-medium break-words">{status.accountEmail ?? "onbekend"}</dd>
        <dd className="text-xs text-muted">Hiermee is bij Google ingelogd.</dd>
      </div>
      <div className="col-span-2 sm:col-span-1">
        <dt className="text-muted">Boekingenadres</dt>
        <dd className="font-medium break-words">{status.mailbox || "niet ingesteld"}</dd>
        <dd className="text-xs text-muted">Hiermee mailen wij met klanten.</dd>
      </div>
      <div className="col-span-2">
        <dt className="text-muted">Verzenden als {status.mailbox || "het boekingenadres"}</dt>
        <dd className="mt-0.5">
          {status.sendAs ? (
            <Badge tone={status.sendAs.ready ? "success" : "warning"}>
              {status.sendAs.ready ? "Gereed" : "Configuratie vereist"}
            </Badge>
          ) : (
            <Badge tone="neutral">Nog niet gecontroleerd</Badge>
          )}
        </dd>
        {status.sendAs && !status.sendAs.ready ? (
          <dd className="mt-1 text-xs text-muted">{status.sendAs.message}</dd>
        ) : null}
      </div>
    </>
  );
}

export function GmailSendAsNotice({ status }: { status: GmailStatus }) {
  if (!status.connected || !status.sendAs || status.sendAs.ready) return null;

  return (
    <Alert tone="warning" title="Verzenden staat nog uit">
      Zolang dit niet is opgelost verstuurt SkoolPartner geen enkel bericht. Dat is bewust: liever
      niets versturen dan post die bij de klant aankomt vanaf{" "}
      {status.accountEmail ?? "het persoonlijke account"} in plaats van {status.mailbox}. Klik op
      Verbinding testen voor de stappen in Gmail.
    </Alert>
  );
}

export function GmailApartAdresUitleg({ status }: { status: GmailStatus }) {
  if (!status.apartAdres) return null;

  return (
    <p className="text-xs text-muted">
      Het Google-account en het boekingenadres zijn hier bewust verschillend. Er wordt ingelogd met
      een persoonlijk account, terwijl klantpost via het boekingenadres loopt. SkoolPartner
      verwerkt daarbij uitsluitend berichten waarin het boekingenadres voorkomt.
    </p>
  );
}
