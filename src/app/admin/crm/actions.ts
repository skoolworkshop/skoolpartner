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
    revalidatePath("/admin/crm/relaties");
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
    revalidatePath("/admin/crm/relaties");
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

    await bewaarContact(
      {
        id: optioneel(formData, "contactId") ?? undefined,
        organizationId,
        fullName: tekst(formData, "fullName"),
        email: optioneel(formData, "email"),
        phone: optioneel(formData, "phone"),
        jobTitle: optioneel(formData, "jobTitle"),
        note: optioneel(formData, "note"),
      },
      wie
    );

    if (organizationId) revalidatePath(`/admin/organisaties/${organizationId}`);
    return {
      status: "ok",
      message:
        "De contactpersoon staat in het CRM. Dit geeft nog geen toegang tot e-mail; dat blijft een aparte handeling.",
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
