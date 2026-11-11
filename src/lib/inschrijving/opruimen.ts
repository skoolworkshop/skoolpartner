import "server-only";

import { recordAudit } from "@/lib/audit";
import { bewaartTot, isVerlopen } from "@/lib/inschrijving/bewaartermijn";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * De leerlinggegevens van afgelopen cultuurdagen opruimen.
 *
 * WAT ER WEGGAAT
 *
 *   De leerlingen van een dag waarvan de bewaartermijn voorbij is, en alles
 *   wat aan een leerling hangt: zijn keuzes, zijn persoonlijke code, zijn
 *   bewijs, zijn e-mailadres en zijn openstaande verificatiecodes. Ook de
 *   toegangslinks van de school gaan dicht, want daarachter staat de indeling
 *   met namen, en de pogingenteller van die dag wordt geleegd.
 *
 * WAT ER BLIJFT
 *
 *   De dag zelf, met zijn rooster, workshops, uitvoeringen en klassen. Daar
 *   staat geen kind in: dat is ons eigen werk, en we hebben het nodig om te
 *   weten wat we die dag gedaan hebben en wat we gefactureerd hebben.
 *
 * HOE VOORZICHTIG
 *
 *   Er wordt nooit op datum verwijderd. Eerst wordt per dag opgehaald welke
 *   leerlingen erbij horen, en daarna gaat het verwijderen op die id's. Zo kan
 *   een verkeerd gezette datum nooit leerlingen van een andere dag meenemen.
 *
 *   En er is een proefstand. Die telt alleen en raakt niets aan. Zo kun je
 *   altijd eerst kijken wat er zou gebeuren.
 */

export interface OpruimDag {
  id: string;
  naam: string;
  datum: string;
  bewaartTot: string;
  leerlingen: number;
  keuzes: number;
  toegangen: number;
}

export interface OpruimRapport {
  /** Dagen waarvan de termijn voorbij is en waar nog leerlingen stonden. */
  dagen: OpruimDag[];
  leerlingen: number;
  keuzes: number;
  toegangen: number;
  /** Alleen geteld, niets verwijderd. */
  proef: boolean;
  fouten: string[];
}

/** Rijen ophalen in stukken, zodat een grote dag niet in één keer hoeft. */
async function idsVan(
  tabel: "enrollment_participants",
  dagId: string,
): Promise<string[]> {
  const supabase = createServiceSupabase();
  const ids: string[] = [];
  let vanaf = 0;
  const stap = 1000;

  for (;;) {
    const { data, error } = await supabase
      .from(tabel)
      .select("id")
      // Zonder vaste volgorde mag de database elke pagina anders teruggeven,
      // en dan sla je bij een grote dag zomaar rijen over.
      .order("id")
      .eq("event_id", dagId)
      .range(vanaf, vanaf + stap - 1);
    if (error) throw new Error(`${tabel}: ${error.message}`);
    ids.push(...(data ?? []).map((rij) => rij.id as string));
    if (!data || data.length < stap) break;
    vanaf += stap;
  }

  return ids;
}

/**
 * Opruimen.
 *
 * @param proef  Alleen tellen, niets verwijderen.
 * @param vandaag Voor de tests, zodat de klok niet uitmaakt.
 */
export async function ruimInschrijvingenOp(opties: {
  proef?: boolean;
  vandaag?: string;
  doorId?: string;
  doorEmail?: string;
} = {}): Promise<OpruimRapport> {
  const proef = opties.proef ?? false;
  const vandaag = opties.vandaag ?? new Date().toISOString().slice(0, 10);
  const supabase = createServiceSupabase();

  const rapport: OpruimRapport = {
    dagen: [],
    leerlingen: 0,
    keuzes: 0,
    toegangen: 0,
    proef,
    fouten: [],
  };

  const { data: dagen, error } = await supabase
    .from("enrollment_events")
    .select("id, name, event_date, purge_after")
    .order("event_date");

  if (error) {
    rapport.fouten.push(`dagen ophalen: ${error.message}`);
    return rapport;
  }

  for (const dag of (dagen ?? []) as unknown as {
    id: string;
    name: string;
    event_date: string;
    purge_after: string | null;
  }[]) {
    if (!isVerlopen(dag, vandaag)) continue;

    try {
      const deelnemerIds = await idsVan("enrollment_participants", dag.id);

      // Keuzes tellen en weghalen gaat altijd via de leerlingen van deze dag.
      let keuzes = 0;
      for (let i = 0; i < deelnemerIds.length; i += 200) {
        const stuk = deelnemerIds.slice(i, i + 200);
        const { count, error: telFout } = await supabase
          .from("enrollment_choices")
          .select("id", { count: "exact", head: true })
          .in("participant_id", stuk);
        if (telFout) throw new Error(`keuzes tellen: ${telFout.message}`);
        keuzes += count ?? 0;
      }

      const { count: toegangen } = await supabase
        .from("enrollment_access")
        .select("id", { count: "exact", head: true })
        .eq("event_id", dag.id)
        .is("revoked_at", null);

      const regel: OpruimDag = {
        id: dag.id,
        naam: dag.name,
        datum: dag.event_date,
        bewaartTot: bewaartTot(dag),
        leerlingen: deelnemerIds.length,
        keuzes,
        toegangen: toegangen ?? 0,
      };

      // Niets te doen? Dan ook niet melden. Anders staat er elke nacht een
      // regel over een dag van vorig jaar waar allang niemand meer in staat.
      if (regel.leerlingen === 0 && regel.toegangen === 0) continue;

      rapport.dagen.push(regel);
      rapport.leerlingen += regel.leerlingen;
      rapport.keuzes += regel.keuzes;
      rapport.toegangen += regel.toegangen;

      if (proef) continue;

      // 1. De keuzes. Op leerling-id, nooit op iets van de dag zelf.
      for (let i = 0; i < deelnemerIds.length; i += 200) {
        const { error: keuzeFout } = await supabase
          .from("enrollment_choices")
          .delete()
          .in("participant_id", deelnemerIds.slice(i, i + 200));
        if (keuzeFout) throw new Error(`keuzes verwijderen: ${keuzeFout.message}`);
      }

      // 2. De leerlingen. Verificatiecodes gaan automatisch mee.
      for (let i = 0; i < deelnemerIds.length; i += 200) {
        const { error: wegFout } = await supabase
          .from("enrollment_participants")
          .delete()
          .in("id", deelnemerIds.slice(i, i + 200));
        if (wegFout) throw new Error(`leerlingen verwijderen: ${wegFout.message}`);
      }

      // 3. De toegangslinks van de school. Daarachter staat de indeling met
      //    namen, dus die horen op hetzelfde moment dicht te gaan.
      await supabase
        .from("enrollment_access")
        .update({ revoked_at: new Date().toISOString() })
        .eq("event_id", dag.id)
        .is("revoked_at", null);

      // 4. De gedeelde toegangscode uitzetten, zodat een oude link niets meer
      //    opent.
      await supabase
        .from("enrollment_events")
        .update({ shared_code_active: false })
        .eq("id", dag.id);

      // 5. De pogingenteller van deze dag. Daar staat niets persoonlijks in,
      //    maar het hoort bij het opruimen.
      await supabase.from("enrollment_attempts").delete().eq("event_id", dag.id);

      // 6. En vastleggen dat het gebeurd is, zonder één naam.
      await recordAudit({
        actorId: opties.doorId,
        actorEmail: opties.doorEmail,
        actorRole: opties.doorId ? undefined : "systeem",
        action: "enrollment_participants_purged",
        entityType: "enrollment_event",
        entityId: dag.id,
        after: {
          bewaard_tot: regel.bewaartTot,
          leerlingen: regel.leerlingen,
          keuzes: regel.keuzes,
          toegangen_ingetrokken: regel.toegangen,
        },
      });
    } catch (fout) {
      rapport.fouten.push(`${dag.name} (${dag.event_date}): ${(fout as Error).message}`);
    }
  }

  return rapport;
}

/** Eén zin voor in de melding of het logboek. */
export function vatOpruimingSamen(rapport: OpruimRapport): string {
  if (rapport.dagen.length === 0) {
    return rapport.proef
      ? "Er staat niets klaar om op te ruimen."
      : "Er was niets om op te ruimen.";
  }

  const stuk = `${rapport.leerlingen} ${rapport.leerlingen === 1 ? "leerling" : "leerlingen"} van ${
    rapport.dagen.length
  } ${rapport.dagen.length === 1 ? "dag" : "dagen"}`;

  return rapport.proef
    ? `Klaar om op te ruimen: ${stuk}.`
    : `Opgeruimd: ${stuk}, met ${rapport.keuzes} keuzes.`;
}
