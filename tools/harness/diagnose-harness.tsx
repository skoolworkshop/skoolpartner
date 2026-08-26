import { GmailDiagnose } from "@/components/admin/gmail-diagnose";
import type { Diagnose } from "@/lib/integrations/gmail/diagnose";

const alles_mis: Diagnose = {
  kanKoppelen: false,
  regels: [
    { label: "APP_ENCRYPTION_KEY", uitkomst: "fout", waarde: "17 bytes, moeten er 32 zijn", oplossing: "Dit is geen geldige sleutel. Maak een nieuwe met: openssl rand -base64 32. Dat geeft 44 tekens die eindigen op een isgelijkteken." },
    { label: "SUPABASE_SERVICE_ROLE_KEY", uitkomst: "fout", waarde: "rol in de sleutel: anon", oplossing: "Hier hoort de service role key te staan, niet de anon of publishable key. Die vind je in Supabase, Project Settings, API keys." },
    { label: "Schrijfrechten op de database", uitkomst: "fout", waarde: "de database weigert deze sleutel", oplossing: "Dit bevestigt dat de sleutel hierboven niet de service role key is. Dezelfde oorzaak blokkeert ook de facturensync." },
    { label: "GOOGLE_CLIENT_ID", uitkomst: "goed", waarde: "aanwezig" },
    { label: "GOOGLE_CLIENT_SECRET", uitkomst: "goed", waarde: "aanwezig" },
    { label: "GOOGLE_REDIRECT_URI", uitkomst: "fout", waarde: "staat op https://skoolpartner.vercel.app/api/integrations/google/callback/", oplossing: "Verwacht wordt https://skoolpartner.vercel.app/api/integrations/google/callback. Een tekentje verschil is al genoeg om het te laten mislukken." },
    { label: "GMAIL_MAILBOX", uitkomst: "goed", waarde: "boekingen@skoolworkshop.nl" },
  ],
};

const alles_goed: Diagnose = {
  kanKoppelen: true,
  regels: [
    { label: "APP_ENCRYPTION_KEY", uitkomst: "goed", waarde: "32 bytes, geldig" },
    { label: "SUPABASE_SERVICE_ROLE_KEY", uitkomst: "goed", waarde: "rol in de sleutel: service_role" },
    { label: "Schrijfrechten op de database", uitkomst: "goed", waarde: "de server kan bij de koppelingstabel" },
    { label: "GOOGLE_CLIENT_ID", uitkomst: "goed", waarde: "aanwezig" },
    { label: "GOOGLE_CLIENT_SECRET", uitkomst: "goed", waarde: "aanwezig" },
    { label: "GOOGLE_REDIRECT_URI", uitkomst: "goed", waarde: "https://skoolpartner.vercel.app/api/integrations/google/callback" },
    { label: "GMAIL_MAILBOX", uitkomst: "goed", waarde: "boekingen@skoolworkshop.nl" },
  ],
};

export function Harness() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <h2 className="text-[22px]">Er is iets mis</h2>
      <GmailDiagnose diagnose={alles_mis} />
      <h2 className="text-[22px]">Alles klaar om te koppelen</h2>
      <GmailDiagnose diagnose={alles_goed} />
    </div>
  );
}
