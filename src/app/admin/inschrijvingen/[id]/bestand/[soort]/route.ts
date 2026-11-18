import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { ALLE_SOORTEN, maakBestand, type Soort } from "@/lib/inschrijving/afronden";

export const dynamic = "force-dynamic";

/*
  De beheerder mag alle lijsten ophalen, ook de codelijsten voor de mentoren.
  Hier stond eerst een eigen lijstje zonder die twee, waardoor de knoppen
  "Inschrijfcodes (PDF)" en "(Excel)" een 404 gaven. Daarom nu de lijst uit
  afronden.ts, waar ook de knoppen op het scherm vandaan komen.
*/
const SOORTEN: Soort[] = ALLE_SOORTEN;

/**
 * De lijsten als bestand, voor de beheerder.
 *
 * Ze worden op het moment van downloaden gemaakt. Er staat dus nooit een oude
 * versie klaar die niet meer klopt, en er hoeft niets opgeslagen te worden.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string; soort: string }> }) {
  await requireAdmin();
  const { id, soort } = await context.params;

  if (!SOORTEN.includes(soort as Soort)) {
    return NextResponse.json({ error: "Onbekende lijst" }, { status: 404 });
  }

  const bestand = await maakBestand(id, soort as Soort);
  if (!bestand) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });

  return new NextResponse(new Uint8Array(bestand.data), {
    headers: {
      "Content-Type": bestand.type,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(bestand.naam)}"`,
      "Cache-Control": "no-store",
    },
  });
}
