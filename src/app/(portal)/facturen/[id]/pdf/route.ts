import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { MoneybirdClient } from "@/lib/integrations/moneybird/client";
import { integrationMode } from "@/lib/env";
import { safeErrorResponse } from "@/lib/api/guards";

export const dynamic = "force-dynamic";

/**
 * Levert de factuur-pdf uit Moneybird.
 *
 * De pdf wordt niet permanent in Supabase gedupliceerd (dataminimalisatie);
 * hij wordt server-side opgehaald en direct doorgegeven. De klant krijgt nooit
 * een Moneybird-token of een directe Moneybird-link te zien.
 *
 * Autorisatie loopt via de gebruikerssessie: de query hieronder draait onder
 * Row Level Security, dus een factuur-ID van een andere organisatie levert
 * simpelweg niets op.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  try {
    const supabase = await createServerSupabase();
    const { data: invoice } = await supabase
      .from("invoices")
      .select("id, moneybird_invoice_id, invoice_number, organization_id")
      .eq("id", id)
      .maybeSingle();

    if (!invoice) {
      return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
    }

    if (integrationMode("moneybird") === "mock") {
      return NextResponse.json(
        {
          error:
            "De Moneybird-koppeling draait in testmodus. Voeg MONEYBIRD_API_TOKEN toe om echte facturen te tonen.",
        },
        { status: 503 }
      );
    }

    const client = MoneybirdClient.fromEnv();
    if (!client) {
      return NextResponse.json({ error: "Moneybird is niet geconfigureerd" }, { status: 503 });
    }

    const pdf = await client.downloadInvoicePdf(invoice.moneybird_invoice_id);

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="factuur-${invoice.invoice_number ?? invoice.id}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
