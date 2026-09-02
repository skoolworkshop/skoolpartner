import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit";
import { contactStilte, type ContactStilte, type Lifecycle } from "@/lib/crm/regels";
import { vertaalFout, type Actor } from "@/lib/crm/mutations";
import type {
  CrmContactRow,
  CrmContactType,
  CrmDealRow,
  CrmTaskRow,
} from "@/lib/types/database";

/**
 * Contacten.
 *
 * DE BELANGRIJKSTE REGEL VAN DIT BESTAND
 *
 *   Een contact is een persoon die wij kennen. Een SkoolPartner-gebruiker is
 *   iemand met toegang tot het klantportaal. Dat zijn twee verschillende
 *   dingen, en de meeste contacten zijn geen gebruiker.
 *
 *   Een docent die ooit een keer heeft gebeld, een decaan die we op een beurs
 *   spraken, een ouder van een deelnemer: allemaal contacten, geen van allen
 *   een account. Andersom kan ook: een school kan klant zijn terwijl maar een
 *   van de vier contactpersonen kan inloggen.
 *
 *   Deze module leest de accountstatus alleen. Hij maakt nooit een account
 *   aan, koppelt nooit automatisch, en verandert nooit iets aan profiles,
 *   auth of organization_members.
 */

export const CONTACT_TYPE_LABELS: Record<CrmContactType, string> = {
  docent: "Docent",
  cultuurcoordinator: "Cultuurcoördinator",
  decaan: "Decaan",
  administratie: "Administratie",
  directie: "Directie",
  ouder: "Ouder of verzorger",
  deelnemer: "Deelnemer",
  opdrachtgever: "Opdrachtgever",
  leverancier: "Leverancier",
  overig: "Overig",
};

export function isContactType(waarde: unknown): waarde is CrmContactType {
  return typeof waarde === "string" && waarde in CONTACT_TYPE_LABELS;
}

/**
 * Wat wij weten over de klantportaaltoegang van een contact.
 *
 * Drie standen, en het verschil ertussen is precies waar het om gaat:
 *
 *   gekoppeld  Er is een bewuste koppeling gelegd naar een account.
 *   gevonden   Er bestaat een account met dit e-mailadres. Waarschijnlijk
 *              dezelfde persoon, maar dat is niet vastgelegd.
 *   geen       Geen account. Dat is de normale situatie.
 */
export type PortalStatus =
  | { stand: "gekoppeld"; userId: string; naam: string | null; email: string }
  | { stand: "gevonden"; userId: string; naam: string | null; email: string }
  | { stand: "geen" };

export interface ContactRegel {
  contact: CrmContactRow;
  organisatieNaam: string | null;
  ownerNaam: string | null;
  portal: PortalStatus;
  stilte: ContactStilte;
  aantalDeals: number;
}

function vandaag(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Zoekt per e-mailadres of er een klantportaalaccount bestaat.
 *
 * Uitsluitend lezen. Het resultaat is een aanwijzing die het scherm als zodanig
 * toont; er wordt niets op grond hiervan gekoppeld of gewijzigd.
 */
async function portalStatussen(
  contacten: CrmContactRow[]
): Promise<Map<string, PortalStatus>> {
  const supabase = createServiceSupabase();
  const resultaat = new Map<string, PortalStatus>();

  const gekoppeldeIds = [
    ...new Set(contacten.map((c) => c.portal_user_id).filter((id): id is string => Boolean(id))),
  ];
  const adressen = [
    ...new Set(
      contacten
        .filter((c) => !c.portal_user_id)
        .map((c) => c.email?.trim().toLowerCase())
        .filter((e): e is string => Boolean(e))
    ),
  ];

  const [{ data: gekoppeld }, { data: gevonden }] = await Promise.all([
    gekoppeldeIds.length
      ? supabase.from("profiles").select("id, email, full_name").in("id", gekoppeldeIds)
      : Promise.resolve({ data: [] }),
    adressen.length
      ? supabase.from("profiles").select("id, email, full_name").in("email", adressen)
      : Promise.resolve({ data: [] }),
  ]);

  const perId = new Map((gekoppeld ?? []).map((p) => [p.id, p]));
  const perEmail = new Map((gevonden ?? []).map((p) => [p.email.toLowerCase(), p]));

  for (const contact of contacten) {
    if (contact.portal_user_id) {
      const profiel = perId.get(contact.portal_user_id);
      resultaat.set(
        contact.id,
        profiel
          ? {
              stand: "gekoppeld",
              userId: profiel.id,
              naam: profiel.full_name,
              email: profiel.email,
            }
          : { stand: "geen" }
      );
      continue;
    }

    const adres = contact.email?.trim().toLowerCase();
    const profiel = adres ? perEmail.get(adres) : undefined;
    resultaat.set(
      contact.id,
      profiel
        ? { stand: "gevonden", userId: profiel.id, naam: profiel.full_name, email: profiel.email }
        : { stand: "geen" }
    );
  }

  return resultaat;
}

export interface ContactFilter {
  zoek?: string;
  type?: CrmContactType | "alles";
  lifecycle?: Lifecycle | "alles";
  /** Alleen contacten zonder organisatie, of juist alleen die met. */
  organisatie?: "met" | "zonder" | "alles";
  /** Alleen contacten met of zonder klantportaalaccount. */
  portal?: "met" | "zonder" | "alles";
}

export async function getContacten(filter: ContactFilter = {}): Promise<ContactRegel[]> {
  const supabase = createServiceSupabase();

  let query = supabase.from("crm_contacts").select("*").order("full_name", { ascending: true });

  if (filter.type && filter.type !== "alles") query = query.eq("contact_type", filter.type);
  if (filter.lifecycle && filter.lifecycle !== "alles") query = query.eq("lifecycle", filter.lifecycle);
  if (filter.organisatie === "zonder") query = query.is("organization_id", null);
  if (filter.organisatie === "met") query = query.not("organization_id", "is", null);

  const zoek = filter.zoek?.trim();
  if (zoek) {
    const veilig = zoek.replace(/[%,()]/g, " ");
    query = query.or(
      `full_name.ilike.%${veilig}%,email.ilike.%${veilig}%,phone.ilike.%${veilig}%,city.ilike.%${veilig}%`
    );
  }

  const { data, error } = await query.limit(500);
  if (error) throw new Error(`Contacten ophalen mislukt: ${error.message}`);

  const contacten = data ?? [];
  if (contacten.length === 0) return [];

  const orgIds = [
    ...new Set(contacten.map((c) => c.organization_id).filter((id): id is string => Boolean(id))),
  ];
  const ownerIds = [
    ...new Set(contacten.map((c) => c.owner_id).filter((id): id is string => Boolean(id))),
  ];
  const ids = contacten.map((c) => c.id);

  const [{ data: organisaties }, { data: eigenaren }, { data: deals }, portal] = await Promise.all([
    orgIds.length ? supabase.from("organizations").select("id, name").in("id", orgIds) : Promise.resolve({ data: [] }),
    ownerIds.length
      ? supabase.from("profiles").select("id, full_name, email").in("id", ownerIds)
      : Promise.resolve({ data: [] }),
    supabase.from("crm_deals").select("contact_id").in("contact_id", ids),
    portalStatussen(contacten),
  ]);

  const orgPerId = new Map((organisaties ?? []).map((o) => [o.id, o.name]));
  const ownerPerId = new Map((eigenaren ?? []).map((p) => [p.id, p.full_name ?? p.email]));
  const dealsPerContact = new Map<string, number>();
  for (const d of deals ?? []) {
    if (d.contact_id) dealsPerContact.set(d.contact_id, (dealsPerContact.get(d.contact_id) ?? 0) + 1);
  }

  const nu = vandaag();
  const regels = contacten.map((contact) => ({
    contact,
    organisatieNaam: contact.organization_id ? (orgPerId.get(contact.organization_id) ?? null) : null,
    ownerNaam: contact.owner_id ? (ownerPerId.get(contact.owner_id) ?? null) : null,
    portal: portal.get(contact.id) ?? ({ stand: "geen" } as PortalStatus),
    stilte: contactStilte(contact.last_contact_at, nu),
    aantalDeals: dealsPerContact.get(contact.id) ?? 0,
  }));

  if (filter.portal === "met") return regels.filter((r) => r.portal.stand !== "geen");
  if (filter.portal === "zonder") return regels.filter((r) => r.portal.stand === "geen");
  return regels;
}

export interface ContactDetail extends ContactRegel {
  deals: (CrmDealRow & { faseLabel: string | null })[];
  taken: CrmTaskRow[];
  /** De boekingen van de organisatie waar dit contact bij hoort. */
  boekingen: {
    id: string;
    reference: string | null;
    workshop_name: string;
    scheduled_date: string | null;
    status: string;
  }[];
  /** Is dit contact ook een geverifieerde e-mailcontactpersoon? */
  geverifieerdeMail: boolean;
}

export async function getContact(contactId: string): Promise<ContactDetail | null> {
  const supabase = createServiceSupabase();

  const { data: contact } = await supabase
    .from("crm_contacts")
    .select("*")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return null;

  const [regels, { data: deals }, { data: taken }, { data: fases }] = await Promise.all([
    Promise.resolve(null),
    supabase
      .from("crm_deals")
      .select("*")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false }),
    supabase
      .from("crm_tasks")
      .select("*")
      .eq("contact_id", contactId)
      .order("due_on", { ascending: true, nullsFirst: false }),
    supabase.from("crm_pipeline_stages").select("id, label"),
  ]);
  void regels;

  const [portal, { data: organisatie }, { data: eigenaar }, { data: geverifieerd }] =
    await Promise.all([
      portalStatussen([contact]),
      contact.organization_id
        ? supabase.from("organizations").select("id, name").eq("id", contact.organization_id).maybeSingle()
        : Promise.resolve({ data: null }),
      contact.owner_id
        ? supabase.from("profiles").select("id, full_name, email").eq("id", contact.owner_id).maybeSingle()
        : Promise.resolve({ data: null }),
      contact.linked_contact_id
        ? supabase
            .from("organization_contacts")
            .select("is_verified")
            .eq("id", contact.linked_contact_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  // Boekingen van de organisatie. Bewust van de organisatie en niet van de
  // persoon: een boeking hoort bij de school, niet bij wie hem aanvroeg.
  const { data: boekingen } = contact.organization_id
    ? await supabase
        .from("bookings")
        .select("id, reference, workshop_name, scheduled_date, status")
        .eq("organization_id", contact.organization_id)
        .order("scheduled_date", { ascending: false })
        .limit(10)
    : { data: [] };

  const labelPerFase = new Map((fases ?? []).map((f) => [f.id, f.label]));

  return {
    contact,
    organisatieNaam: organisatie?.name ?? null,
    ownerNaam: eigenaar ? (eigenaar.full_name ?? eigenaar.email) : null,
    portal: portal.get(contact.id) ?? { stand: "geen" },
    stilte: contactStilte(contact.last_contact_at, vandaag()),
    aantalDeals: (deals ?? []).length,
    deals: (deals ?? []).map((d) => ({ ...d, faseLabel: labelPerFase.get(d.stage_id) ?? null })),
    taken: taken ?? [],
    boekingen: boekingen ?? [],
    geverifieerdeMail: Boolean(geverifieerd?.is_verified),
  };
}

/**
 * Een contact aan een klantportaalaccount koppelen, of die koppeling weghalen.
 *
 * Dit legt alleen vast wat al waar is. Er wordt geen account aangemaakt, geen
 * toegang verleend en geen lidmaatschap gewijzigd. Iemand toegang geven blijft
 * gaan zoals het ging: via Admin en Gebruikers.
 */
export async function koppelPortalAccount(
  contactId: string,
  userId: string | null,
  actor: Actor
): Promise<void> {
  const supabase = createServiceSupabase();

  const { data: contact } = await supabase
    .from("crm_contacts")
    .select("id, organization_id, portal_user_id")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) throw new Error("Dit contact bestaat niet.");

  if (userId) {
    const { data: profiel } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (!profiel) throw new Error("Deze gebruiker bestaat niet.");
  }

  const { error } = await supabase
    .from("crm_contacts")
    .update({ portal_user_id: userId })
    .eq("id", contactId);
  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: userId ? "crm.contact.account_gekoppeld" : "crm.contact.account_ontkoppeld",
    entityType: "crm_contact",
    entityId: contactId,
    organizationId: contact.organization_id,
    before: { portal_user_id: contact.portal_user_id },
    after: { portal_user_id: userId },
  });
}
