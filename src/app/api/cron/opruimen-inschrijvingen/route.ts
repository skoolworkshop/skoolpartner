import { NextResponse, type NextRequest } from "next/server";

import { requireCronAuth, safeErrorResponse } from "@/lib/api/guards";
import { ruimInschrijvingenOp, vatOpruimingSamen } from "@/lib/inschrijving/opruimen";

export const dynamic = "force-dynamic";

/**
 * Dagelijks opruimen van leerlinggegevens.
 *
 * Van elke cultuurdag waarvan de bewaartermijn voorbij is, gaan de leerlingen
 * weg met alles wat aan hen hangt. De dag zelf blijft staan met zijn rooster
 * en workshops. Standaard is de termijn dertig dagen na de dag; per dag kan er
 * een andere datum staan als een school dat heeft afgesproken.
 *
 * Met ?proef=1 wordt er alleen geteld en niets verwijderd. Handig om eerst te
 * kijken wat er zou gebeuren.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const proef = request.nextUrl.searchParams.get("proef") === "1";
    const rapport = await ruimInschrijvingenOp({ proef });

    return NextResponse.json({
      ok: rapport.fouten.length === 0,
      melding: vatOpruimingSamen(rapport),
      proef: rapport.proef,
      dagen: rapport.dagen.length,
      leerlingen: rapport.leerlingen,
      keuzes: rapport.keuzes,
      toegangen: rapport.toegangen,
      fouten: rapport.fouten,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
