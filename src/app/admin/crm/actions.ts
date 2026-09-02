"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { parseMerk } from "@/lib/crm/merk";
import { MERK_COOKIE, MERK_COOKIE_MAX_AGE } from "@/lib/crm/actief-merk";
import {
  bedragNaarCenten,
  isBetalingSoort,
  isLifecycle,
  type BetalingSoort,
} from "@/lib/crm/regels";
import {
  bewaarBetaling,
  bewaarContact,
  bewaarPeriode,
  markeerContact,
  meldDeelnemerAan,
  setRelatieProfiel,
  verplaatsNaarPeriode,
  zetFase,
  type Actor,
} from "@/lib/crm/mutations";
import {
  getDeal,
  maakBoekingVanDeal,
  maakDeal,
  werkDealBij,
} from "@/lib/crm/pijplijn";
import { isContactType, koppelPortalAccount } from "@/lib/crm/contacten";
import {
  isActiviteitSoort,
  legActiviteitVast,
  maakTaak,
  zetTaakAf,
} from "@/lib/crm/tijdlijn";
import type { AdminState } from "@/app/admin/actions";

/**
 * De serveracties van het CRM.
 *
 * Elke actie begint met requireAdmin(). Niet omdat de layout dat niet al doet,
 * maar omdat een serveractie rechtstreeks aanroepbaar is: wie het adres kent,
 * komt langs elke controle die alleen in een pagina staat.
 */

async function actor(): Promise<Actor> {
  const sessie = await requireAdmin();
  return { userId: sessie.userId, email: sessie.email };
}

function tekst(formData: FormData, veld: string): string {
  const waarde = formData.get(veld);
  return typeof waarde === "string" ? waarde.trim() : "";
}

function optioneel(formData: FormData, veld: string): string | null {
  const waarde = tekst(formData, veld);
  return waarde === "" ? null : waarde;
}

/** Eén plek waar een onverwachte fout een nette melding wordt. */
async function veilig(werk: () => Promise<AdminState>): Promise<AdminState> {
  try {
    return await werk();
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Er ging iets mis.",
    };
  }
}

// -----------------------------------------------------------------------------
// Merk
// -----------------------------------------------------------------------------

export async function kiesMerk(formData: FormData): Promise<void> {
  await requireAdmin();

  const merk = parseMerk(formData.get("merk"));
  const store = await cookies();

  store.set(MERK_COOKIE, merk, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MERK_COOKIE_MAX_AGE,
  });

  revalidatePath("/admin", "layout");
}

// -----------------------------------------------------------------------------
// Relaties
// -----------------------------------------------------------------------------

export async function setRelatieProfielAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  return veilig(async () => {
    const wie = await actor();
    const organizationId = tekst(formData, "organizationId");
    const lifecycle = tekst(formData, "lifecycle");

    if (!isLifecycle(lifecycle)) {
      return { status: "error", message: "Kies een geldige levensfase." };
    }

    const eigenaar = tekst(formData, "ownerId");

    await setRelatieProfiel(
      organizationId,
      {
        lifecycle,
        ownerId: eigenaar === "" ? null : eigenaar,
        source: optioneel(formData, "source"),
        nextActionAt: optioneel(formData, "nextActionAt"),
        note: optioneel(formData, "note"),
      },
      wie
    );

    revalidatePath(`/admin/organisaties/${organizationId}`);
    revalidatePath("/admin/crm/organisaties");
    return { status: "ok", message: "De relatiegegevens zijn opgeslagen." };
  });
}

export async function markeerContactAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  return veilig(async () => {
    const wie = await actor();
    const organizationId = tekst(formData, "organizationId");

    await markeerContact(organizationId, wie);

    revalidatePath(`/admin/organisaties/${organizationId}`);
    revalidatePath("/admin/crm/organisaties");
    return { status: "ok", message: "Vastgelegd dat er vandaag contact is geweest." };
  });
}

export async function bewaarContactAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  return veilig(async () => {
    const wie = await actor();
    const organizationId = optioneel(formData, "organizationId");

    const soort = tekst(formData, "contactType");
    const fase = tekst(formData, "lifecycle");
    const contactId = optioneel(formData, "contactId") ?? undefined;

    const id = await bewaarContact(
      {
        id: contactId,
        organizationId,
        fullName: tekst(formData, "fullName"),
        email: optioneel(formData, "email"),
        phone: optioneel(formData, "phone"),
        jobTitle: optioneel(formData, "jobTitle"),
        note: optioneel(formData, "note"),
        contactType: isContactType(soort) ? soort : null,
        lifecycle: isLifecycle(fase) ? fase : null,
        city: optioneel(formData, "city"),
      },
      wie
    );

    if (organizationId) revalidatePath(`/admin/organisaties/${organizationId}`);
    revalidatePath("/admin/crm/contacten");
    revalidatePath(`/admin/crm/contacten/${id}`);
    return {
      status: "ok",
      message:
        "Het contact staat in het CRM. Dit maakt geen inlogaccount aan en geeft geen toegang tot het klantportaal of tot e-mail.",
    };
  });
}

// -----------------------------------------------------------------------------
// Reisperiodes
// -----------------------------------------------------------------------------

export async function bewaarPeriodeAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  return veilig(async () => {
    const wie = await actor();

    const prijs = bedragNaarCenten(tekst(formData, "price") || "0");
    if (prijs === null || prijs < 0) {
      return { status: "error", message: "Vul een geldige prijs in, bijvoorbeeld 4250 of 4.250,00." };
    }

    const plaatsen = Number(tekst(formData, "capacity"));
    if (!Number.isInteger(plaatsen)) {
      return { status: "error", message: "Vul een geheel aantal plaatsen in." };
    }

    const id = await bewaarPeriode(
      {
        id: optioneel(formData, "editionId") ?? undefined,
        name: tekst(formData, "name"),
        startsOn: tekst(formData, "startsOn"),
        endsOn: tekst(formData, "endsOn"),
        capacity: plaatsen,
        priceCents: prijs,
        status: tekst(formData, "status"),
        note: optioneel(formData, "note"),
      },
      wie
    );

    revalidatePath("/admin/crm/suri");
    revalidatePath(`/admin/crm/suri/periode/${id}`);
    return { status: "ok", message: "De reisperiode is opgeslagen." };
  });
}

// -----------------------------------------------------------------------------
// Deelnemers
// -----------------------------------------------------------------------------

export async function meldDeelnemerAanAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  return veilig(async () => {
    const wie = await actor();
    const editionId = tekst(formData, "editionId");

    await meldDeelnemerAan(
      {
        editionId,
        fullName: tekst(formData, "fullName"),
        email: optioneel(formData, "email"),
        phone: optioneel(formData, "phone"),
        birthDate: optioneel(formData, "birthDate"),
        guardianName: optioneel(formData, "guardianName"),
        guardianEmail: optioneel(formData, "guardianEmail"),
        guardianPhone: optioneel(formData, "guardianPhone"),
        interest: optioneel(formData, "interest"),
        note: optioneel(formData, "note"),
      },
      wie
    );

    revalidatePath("/admin/crm/suri");
    revalidatePath(`/admin/crm/suri/periode/${editionId}`);
    return { status: "ok", message: "De aanmelding staat erin." };
  });
}

export async function zetFaseAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  return veilig(async () => {
    const wie = await actor();
    const dealId = tekst(formData, "dealId");

    await zetFase(dealId, tekst(formData, "stageId"), wie, optioneel(formData, "note"));

    revalidatePath("/admin/crm/suri");
    revalidatePath(`/admin/crm/suri/deelnemer/${dealId}`);
    return { status: "ok", message: "De fase is bijgewerkt." };
  });
}

export async function bewaarBetalingAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  return veilig(async () => {
    const wie = await actor();
    const dealId = tekst(formData, "dealId");
    const soort = tekst(formData, "kind");

    if (!isBetalingSoort(soort)) {
      return { status: "error", message: "Kies een geldige soort betaling." };
    }

    const bedrag = bedragNaarCenten(tekst(formData, "amount"));
    if (bedrag === null) {
      return { status: "error", message: "Vul een geldig bedrag in, bijvoorbeeld 500 of 1.250,00." };
    }

    await bewaarBetaling(
      {
        dealId,
        kind: soort as BetalingSoort,
        amountCents: bedrag,
        receivedOn: tekst(formData, "receivedOn") || new Date().toISOString().slice(0, 10),
        note: optioneel(formData, "note"),
        externalReference: optioneel(formData, "externalReference"),
      },
      wie
    );

    revalidatePath(`/admin/crm/suri/deelnemer/${dealId}`);
    revalidatePath("/admin/crm/suri");
    return { status: "ok", message: "De betaling is vastgelegd." };
  });
}

export async function verplaatsNaarPeriodeAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  return veilig(async () => {
    const wie = await actor();
    const dealId = tekst(formData, "dealId");

    await verplaatsNaarPeriode(dealId, tekst(formData, "editionId"), wie);

    revalidatePath("/admin/crm/suri");
    revalidatePath(`/admin/crm/suri/deelnemer/${dealId}`);
    return { status: "ok", message: "De deelnemer staat nu in de andere reisperiode." };
  });
}

// -----------------------------------------------------------------------------
// Tijdlijn en taken
// -----------------------------------------------------------------------------

/** De drie mogelijke onderwerpen uit een formulier halen. */
function onderwerpUit(formData: FormData) {
  return {
    organizationId: optioneel(formData, "organizationId"),
    contactId: optioneel(formData, "contactId"),
    dealId: optioneel(formData, "dealId"),
  };
}

/** Alles vernieuwen wat dit onderwerp kan tonen. */
function vernieuw(onderwerp: ReturnType<typeof onderwerpUit>) {
  if (onderwerp.organizationId) revalidatePath(`/admin/organisaties/${onderwerp.organizationId}`);
  if (onderwerp.dealId) {
    revalidatePath(`/admin/crm/deal/${onderwerp.dealId}`);
    revalidatePath(`/admin/crm/suri/deelnemer/${onderwerp.dealId}`);
  }
  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/pijplijn");
}

export async function legActiviteitVastAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  return veilig(async () => {
    const wie = await actor();
    const onderwerp = onderwerpUit(formData);
    const soort = tekst(formData, "kind");

    if (!isActiviteitSoort(soort) || soort === "systeem") {
      return { status: "error", message: "Kies een geldige soort." };
    }

    await legActiviteitVast(
      {
        ...onderwerp,
        kind: soort,
        summary: tekst(formData, "summary"),
        body: optioneel(formData, "body"),
        occurredAt: optioneel(formData, "occurredAt"),
      },
      wie
    );

    vernieuw(onderwerp);
    return { status: "ok", message: "Vastgelegd op de tijdlijn." };
  });
}

export async function maakTaakAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  return veilig(async () => {
    const wie = await actor();
    const onderwerp = onderwerpUit(formData);

    await maakTaak(
      {
        ...onderwerp,
        title: tekst(formData, "title"),
        note: optioneel(formData, "note"),
        dueOn: optioneel(formData, "dueOn"),
        ownerId: optioneel(formData, "ownerId"),
      },
      wie
    );

    vernieuw(onderwerp);
    revalidatePath("/admin/crm/taken");
    return { status: "ok", message: "De taak staat erin." };
  });
}

export async function zetTaakAfAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  return veilig(async () => {
    const wie = await actor();
    const af = tekst(formData, "af") !== "nee";

    await zetTaakAf(tekst(formData, "taskId"), af, wie);

    vernieuw(onderwerpUit(formData));
    revalidatePath("/admin/crm/taken");
    return { status: "ok", message: af ? "Afgevinkt." : "Weer opengezet." };
  });
}

// -----------------------------------------------------------------------------
// Pijplijn Skool Workshop
// -----------------------------------------------------------------------------

export async function maakDealAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  return veilig(async () => {
    const wie = await actor();

    const waarde = bedragNaarCenten(tekst(formData, "value") || "0");
    if (waarde === null || waarde < 0) {
      return { status: "error", message: "Vul een geldig bedrag in, bijvoorbeeld 1450 of 1.450,00." };
    }

    await maakDeal(
      {
        organizationId: tekst(formData, "organizationId"),
        contactId: optioneel(formData, "contactId"),
        title: tekst(formData, "title"),
        valueCents: waarde,
        expectedDate: optioneel(formData, "expectedDate"),
        source: optioneel(formData, "source"),
        note: optioneel(formData, "note"),
      },
      wie
    );

    revalidatePath("/admin/crm/pijplijn");
    return { status: "ok", message: "De aanvraag staat in de pijplijn." };
  });
}

export async function werkDealBijAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  return veilig(async () => {
    const wie = await actor();
    const dealId = tekst(formData, "dealId");

    const waarde = bedragNaarCenten(tekst(formData, "value") || "0");
    if (waarde === null || waarde < 0) {
      return { status: "error", message: "Vul een geldig bedrag in." };
    }

    const eigenaar = tekst(formData, "ownerId");

    await werkDealBij(
      dealId,
      {
        title: tekst(formData, "title"),
        valueCents: waarde,
        expectedDate: optioneel(formData, "expectedDate"),
        ownerId: eigenaar === "" ? null : eigenaar,
        contactId: optioneel(formData, "contactId"),
        source: optioneel(formData, "source"),
        note: optioneel(formData, "note"),
      },
      wie
    );

    revalidatePath(`/admin/crm/deal/${dealId}`);
    revalidatePath("/admin/crm/pijplijn");
    return { status: "ok", message: "De aanvraag is bijgewerkt." };
  });
}

/**
 * Van een gewonnen aanvraag een boeking maken.
 *
 * De boeking wordt bewust als concept aangemaakt. Die telt niet mee als
 * aankomende workshop bij de klant en levert geen punten op, zodat bevestigen
 * een aparte handeling blijft.
 */
export async function maakBoekingVanDealAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  return veilig(async () => {
    const wie = await actor();
    const dealId = tekst(formData, "dealId");

    const aantal = Number(tekst(formData, "workshopCount"));
    const minuten = Number(tekst(formData, "minutesPerWorkshop"));

    const bookingId = await maakBoekingVanDeal(
      dealId,
      {
        workshopName: tekst(formData, "workshopName"),
        workshopCount: aantal,
        minutesPerWorkshop: minuten,
        scheduledDate: optioneel(formData, "scheduledDate"),
        location: optioneel(formData, "location"),
        reference: optioneel(formData, "reference"),
      },
      wie
    );

    const detail = await getDeal(dealId);
    if (detail?.deal.organization_id) {
      revalidatePath(`/admin/organisaties/${detail.deal.organization_id}`);
    }
    revalidatePath(`/admin/crm/deal/${dealId}`);
    revalidatePath("/admin/boekingen");

    return {
      status: "ok",
      message:
        `De boeking staat klaar als concept (${bookingId.slice(0, 8)}). ` +
        "Hij telt nog niet mee voor de klant en levert nog geen punten op. " +
        "Bevestig hem in Admin > Boekingen zodra de afspraak vaststaat.",
    };
  });
}

/**
 * Een contact koppelen aan een bestaand klantportaalaccount, of die koppeling
 * weghalen.
 *
 * Legt alleen vast wat al waar is. Er wordt geen account aangemaakt en geen
 * toegang verleend; dat blijft gaan via Admin en Gebruikers.
 */
export async function koppelPortalAccountAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  return veilig(async () => {
    const wie = await actor();
    const contactId = tekst(formData, "contactId");
    const userId = optioneel(formData, "userId");

    await koppelPortalAccount(contactId, userId, wie);

    revalidatePath(`/admin/crm/contacten/${contactId}`);
    revalidatePath("/admin/crm/contacten");
    return {
      status: "ok",
      message: userId
        ? "Vastgelegd dat dit contact bij dat klantportaalaccount hoort."
        : "De koppeling met het klantportaalaccount is weggehaald. De toegang zelf verandert hier niet door.",
    };
  });
}
