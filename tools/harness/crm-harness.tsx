import { AdminNav } from "@/components/admin/admin-nav";
import { CrmOverzicht } from "@/app/admin/crm/crm-overzicht";
import { sorteerFases, type Fase, type Merk } from "@/lib/crm/merk";
import type { CrmCijfers } from "@/lib/crm/queries";

/**
 * De visuele controle van het CRM-fundament.
 *
 * Beide merken naast elkaar, plus de zijbalk, zodat in een oogopslag te zien
 * is of de merkscheiding werkt en of er niets buiten het scherm valt. De
 * gegevens hieronder zijn verzonnen testwaarden voor de opmaak, geen echte
 * cijfers.
 */

function fase(
  brand: Merk,
  key: string,
  label: string,
  description: string,
  position: number,
  extra: { is_won?: boolean; is_lost?: boolean } = {}
): Fase {
  return {
    id: `${brand}-${key}`,
    brand,
    key,
    label,
    description,
    position,
    is_won: extra.is_won ?? false,
    is_lost: extra.is_lost ?? false,
  };
}

const SKOOL: Fase[] = [
  fase("skool_workshop", "nieuwe_aanvraag", "Nieuwe aanvraag", "Binnengekomen via het formulier, de mail of de telefoon. Nog geen contact gehad.", 10),
  fase("skool_workshop", "contact_gelegd", "Contact gelegd", "Gesproken of gemaild, wensen bekend.", 20),
  fase("skool_workshop", "offerte_verstuurd", "Offerte verstuurd", "Prijs en datum liggen bij de school.", 30),
  fase("skool_workshop", "akkoord", "Akkoord", "De school gaat akkoord. Nog niet ingepland.", 40),
  fase("skool_workshop", "ingepland", "Ingepland", "Er staat een boeking.", 50, { is_won: true }),
  fase("skool_workshop", "verloren", "Niet doorgegaan", "Afgehaakt of naar een ander gegaan.", 90, { is_lost: true }),
];

const SURI: Fase[] = [
  fase("suri_impact", "aanmelding", "Aanmelding", "Aanmeldformulier binnen. Nog geen gesprek geweest.", 10),
  fase("suri_impact", "gesprek_gepland", "Kennismakingsgesprek gepland", "Er staat een afspraak in de agenda.", 20),
  fase("suri_impact", "gesprek_gehad", "Gesprek gehad", "Kennismaking geweest, beslissing volgt.", 30),
  fase("suri_impact", "plaats_toegezegd", "Plaats toegezegd", "Er is een plaats gereserveerd in een reisperiode.", 40),
  fase("suri_impact", "aanbetaling", "Aanbetaling ontvangen", "De plaats is definitief.", 50),
  fase("suri_impact", "volledig_betaald", "Volledig betaald", "Alles voldaan, klaar voor vertrek.", 60, { is_won: true }),
  fase("suri_impact", "afgehaakt", "Afgehaakt", "Teruggetrokken of niet doorgegaan.", 90, { is_lost: true }),
];

const CIJFERS_SKOOL: CrmCijfers = { personen: 148, zonderOrganisatie: 12, metProfiel: 31, zonderProfiel: 64 };
const CIJFERS_SURI: CrmCijfers = { personen: 12, zonderOrganisatie: 12, metProfiel: 31, zonderProfiel: 64 };

function Scherm({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <p className="mb-3 font-mono text-xs uppercase tracking-widest text-muted">{titel}</p>
      <div className="rounded-card border border-line bg-surface-2 p-4 sm:p-6">{children}</div>
    </section>
  );
}

export function Harness() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Scherm titel="CRM, merk staat op Skool Workshop">
        <CrmOverzicht merk="skool_workshop" fases={sorteerFases(SKOOL)} cijfers={CIJFERS_SKOOL} />
      </Scherm>

      <Scherm titel="CRM, merk staat op Suri Impact">
        <CrmOverzicht merk="suri_impact" fases={sorteerFases(SURI)} cijfers={CIJFERS_SURI} />
      </Scherm>

      <Scherm titel="De zijbalk, nu gegroepeerd">
        <div className="max-w-[268px] rounded-card bg-white p-4">
          <AdminNav variant="sidebar" />
        </div>
      </Scherm>
    </div>
  );
}
