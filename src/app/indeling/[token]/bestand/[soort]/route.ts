import { NextResponse } from "next/server";

import { maakBestand, type Soort } from "@/lib/inschrijving/afronden";
import { huidigeToegang } from "@/lib/inschrijving/toegang-cookie";

export const dynamic = "force-dynamic";

const SOORTEN: Soort[] = ["klassen-xlsx", "workshops-xlsx", "klassen-pdf", "workshops-pdf"];

/**
 * Hetzelfde bestand als de beheerder downloadt, maar voor de school.
 *
 * De toegang wordt hier opnieuw gecontroleerd. Een link naar een bestand is
 * dus net zo goed beveiligd als de pagina zelf, en werkt niet meer zodra de
 * toegang is ingetrokken of verlopen.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; soort: string }> },
) {
  const { token, soort } = await context.params;

  const toegang = await huidigeToegang(token);
  if (!toegang) return NextResponse.json({ error: "Geen toegang" }, { status: 403 });

  if (!SOORTEN.includes(soort as Soort)) {
    return NextResponse.json({ error: "Onbekende lijst" }, { status: 404 });
  }

  const bestand = await maakBestand(toegang.dagId, soort as Soort);
  if (!bestand) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });

  return new NextResponse(new Uint8Array(bestand.data), {
    headers: {
      "Content-Type": bestand.type,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(bestand.naam)}"`,
      "Cache-Control": "no-store",
    },
  });
}
