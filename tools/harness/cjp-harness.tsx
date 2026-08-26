/**
 * Visuele controle van de CJP-schermen, los van de database.
 *
 * Hier worden de ECHTE componenten uit de app gerenderd, niet nagebouwde
 * markup. Zou iemand later een klasse in Card of Field aanpassen, dan zie je
 * dat hier meteen terug.
 */
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CjpParkingStatusBadge } from "@/components/portal/status-badges";
import { ActionForm } from "@/components/admin/action-form";
import { Field, Input, Select } from "@/components/ui/form";
import { formatEuroCents, formatShortDate } from "@/lib/format";
import { CREDIT_TYPE_LABELS } from "@/lib/tegoed/regels";
import { ParkingForm } from "@/app/(portal)/skoolpartner/cjp-tegoed/parking-form";
import { ParkingSummary } from "@/app/(portal)/skoolpartner/cjp-tegoed/parking-summary";

const mutaties = [
  { id: "1", type: "spend" as const, omschrijving: "Breakdance", bedrag: -25000, restant: 50000, datum: "2026-08-21", factuur: "2026-00231" },
  { id: "2", type: "parking" as const, omschrijving: "CJP-tegoed toegevoegd", bedrag: 75000, restant: 75000, datum: "2026-08-14", factuur: null },
];

export function Harness() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <h2 className="text-[22px]">Klant: saldo</h2>
      <Card>
        <CardHeader title="Uw tegoed bij Skool Workshop" />
        <CardBody>
          <dl className="grid gap-5 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-muted">Nu beschikbaar</dt>
              <dd className="mt-0.5 font-display text-3xl">{formatEuroCents(50000)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Totaal geparkeerd</dt>
              <dd className="mt-0.5 font-display text-xl text-muted">{formatEuroCents(75000)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Al gebruikt</dt>
              <dd className="mt-0.5 font-display text-xl text-muted">{formatEuroCents(25000)}</dd>
            </div>
          </dl>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted">
            Dit tegoed is een bedrag in euro&apos;s en staat helemaal los van uw SkoolPoints. Wij
            zetten het nooit om naar punten en er zit geen vervaldatum op.
          </p>
        </CardBody>
      </Card>

      <h2 className="text-[22px]">Klant: het formulier</h2>
      <Card>
        <CardHeader title="Tegoed parkeren" description="Vul hieronder in welk bedrag u wilt parkeren." />
        <CardBody>
          <ParkingForm
            prefill={{
              schoolName: "De Goudse Waarden",
              cjpSchoolNumber: "123456",
              holderName: "Sanne de Vries",
              holderEmail: "planning@skoolworkshop.nl",
              holderPhone: "+31 6 12345678",
              amount: "750,00",
            }}
            minimumCents={5000}
            bonusEnabled
            bonusPoints={1000}
            pointsName="SkoolPoints"
            supportEmail="boekingen@skoolworkshop.nl"
          />
        </CardBody>
      </Card>

      <h2 className="text-[22px]">Klant: het samenvattingsscherm</h2>
      <Card>
        <CardHeader title="Tegoed parkeren" description="Stap 2: alles nog een keer op een rij." />
        <CardBody>
          <ParkingSummary
            snapshot={{
              schoolName: "De Goudse Waarden",
              cjpSchoolNumber: "123456",
              holderName: "Sanne de Vries",
              holderEmail: "planning@skoolworkshop.nl",
              holderPhone: "+31 6 12345678",
              amountCents: 75000,
            }}
            bonusEnabled
            bonusPoints={1000}
            pointsName="SkoolPoints"
          />
        </CardBody>
      </Card>

      <h2 className="text-[22px]">Klant: historie</h2>
      <Card>
        <CardHeader title="Tegoedhistorie" description="Elke bij- en afboeking, met het bedrag dat daarna overbleef." />
        <ul className="divide-y divide-line-soft">
          {mutaties.map((rij) => (
            <li key={rij.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{CREDIT_TYPE_LABELS[rij.type]}</p>
                <p className="text-sm text-muted">
                  {formatShortDate(rij.datum)} · {rij.omschrijving}
                  {rij.factuur ? ` · factuur ${rij.factuur}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`font-display text-lg ${rij.bedrag > 0 ? "text-success" : "text-muted"}`}>
                  {rij.bedrag > 0 ? "+" : "−"}
                  {formatEuroCents(Math.abs(rij.bedrag))}
                </p>
                <p className="text-sm text-muted">daarna {formatEuroCents(rij.restant)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <h2 className="text-[22px]">Beheer: een aanvraag</h2>
      <Card>
        <CardHeader
          title={`${formatEuroCents(40000)} · Het Vrije College`}
          description="Aangevraagd op 24 aug. 2026 door planning@skoolworkshop.nl"
          action={<CjpParkingStatusBadge status="requested" />}
        />
        <div className="space-y-4 px-5 py-4">
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {[
              ["Schoolnaam bij aanvraag", "Het Vrije College"],
              ["CJP-schoolnummer", "987654"],
              ["Budgethouder", "Mark Jansen"],
              ["E-mail", "planning@skoolworkshop.nl"],
              ["Telefoon", "niet opgegeven"],
              ["Bonuspunten", "nog niet"],
            ].map(([label, waarde]) => (
              <div key={label} className="flex flex-wrap gap-x-2 gap-y-0.5">
                <dt className="text-muted">{label}</dt>
                <dd className="font-medium">{waarde}</dd>
              </div>
            ))}
          </dl>
          <div className="space-y-5 border-t border-line-soft pt-4">
            <ActionForm action={async () => ({ status: "idle" as const })} submitLabel="Bevestigen en bijschrijven" variant="primary">
              <Field label="Notitie" htmlFor="h-bevestig" hint={`Hiermee schrijft u ${formatEuroCents(40000)} bij op het tegoed van deze organisatie.`} className="max-w-xl">
                <Input id="h-bevestig" placeholder="Bijvoorbeeld: bedrag ontvangen van CJP" />
              </Field>
            </ActionForm>
            <div className="border-t border-line-soft pt-5">
              <ActionForm action={async () => ({ status: "idle" as const })} submitLabel="Status opslaan">
                <div className="flex flex-wrap gap-4">
                  <Field label="Status" htmlFor="h-status" className="w-48">
                    <Select id="h-status" defaultValue="in_review">
                      <option value="in_review">In behandeling</option>
                      <option value="rejected">Afwijzen</option>
                    </Select>
                  </Field>
                  <Field label="Toelichting" htmlFor="h-reden" hint="Verplicht bij afwijzen. De klant ziet dit terug." className="min-w-56 flex-1">
                    <Input id="h-reden" />
                  </Field>
                </div>
              </ActionForm>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
