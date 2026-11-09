import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * De controle op de Supabase-configuratie.
 *
 * Deze test bestaat om één reden: een .env.local met de voorbeeldregels erin
 * is niet leeg, dus de oude controle zei dat alles in orde was. Het inloggen
 * liep dan stuk op een adres dat niet bestaat, met als enige melding
 * "versturen is niet gelukt". Dat mag niet nog een keer gebeuren.
 *
 * publicEnv leest process.env bij het laden van de module, dus elke test
 * laadt de module opnieuw met zijn eigen omgeving.
 */

const ECHT_ADRES = "https://abcdefghijklmnopqrst.supabase.co";
const ECHTE_SLEUTEL = "sb_publishable_AbCdEfGhIjKlMnOpQr";

async function fout(waarden: Record<string, string | undefined>): Promise<string | null> {
  vi.resetModules();
  const oud = { ...process.env };
  for (const [naam, waarde] of Object.entries(waarden)) {
    if (waarde === undefined) delete process.env[naam];
    else process.env[naam] = waarde;
  }
  const { supabaseConfigFout } = await import("@/lib/env");
  const uitkomst = supabaseConfigFout();
  process.env = oud;
  return uitkomst;
}

afterEach(() => {
  vi.resetModules();
});

describe("supabaseConfigFout", () => {
  it("keurt een echt adres met een publieke sleutel goed", async () => {
    expect(
      await fout({
        NEXT_PUBLIC_SUPABASE_URL: ECHT_ADRES,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ECHTE_SLEUTEL,
      }),
    ).toBeNull();
  });

  it("keurt de oude sleutel in JWT-vorm ook goed", async () => {
    expect(
      await fout({
        NEXT_PUBLIC_SUPABASE_URL: ECHT_ADRES,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.test",
      }),
    ).toBeNull();
  });

  it("keurt een lokale Supabase goed", async () => {
    expect(
      await fout({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ECHTE_SLEUTEL,
      }),
    ).toBeNull();
  });

  it("herkent het voorbeeldadres uit de documentatie", async () => {
    const melding = await fout({
      NEXT_PUBLIC_SUPABASE_URL: "https://jouw-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ECHTE_SLEUTEL,
    });
    expect(melding).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(melding).toContain("voorbeeldwaarde");
  });

  it("herkent een voorbeeldsleutel", async () => {
    const melding = await fout({
      NEXT_PUBLIC_SUPABASE_URL: ECHT_ADRES,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "jouw-publieke-supabase-sleutel",
    });
    expect(melding).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("waarschuwt als de geheime sleutel op de publieke plek staat", async () => {
    const melding = await fout({
      NEXT_PUBLIC_SUPABASE_URL: ECHT_ADRES,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_dit_hoort_hier_niet",
    });
    expect(melding).toContain("geheime sleutel");
  });

  it("meldt een ontbrekend adres en een ontbrekende sleutel apart", async () => {
    expect(
      await fout({ NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: ECHTE_SLEUTEL }),
    ).toContain("NEXT_PUBLIC_SUPABASE_URL ontbreekt");

    expect(
      await fout({ NEXT_PUBLIC_SUPABASE_URL: ECHT_ADRES, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }),
    ).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY ontbreekt");
  });
});

/**
 * De schakelaar voor de leerlingenpagina.
 *
 * Tijdens de eerste weken staat het beheer wel online en de inschrijfpagina
 * nog niet. Deze test legt vast dat de pagina alleen uitgaat als iemand dat
 * ook echt heeft gevraagd, en dat een ontbrekende variabele niets verandert.
 */
describe("publiekeInschrijvingAan", () => {
  async function aan(waarde: string | undefined): Promise<boolean> {
    vi.resetModules();
    const oud = { ...process.env };
    if (waarde === undefined) delete process.env.PUBLIEKE_INSCHRIJVING;
    else process.env.PUBLIEKE_INSCHRIJVING = waarde;
    const { publiekeInschrijvingAan } = await import("@/lib/env");
    const uitkomst = publiekeInschrijvingAan();
    process.env = oud;
    return uitkomst;
  }

  it("staat aan als de variabele niet is ingevuld", async () => {
    expect(await aan(undefined)).toBe(true);
    expect(await aan("")).toBe(true);
    expect(await aan("aan")).toBe(true);
  });

  it("gaat uit bij elke manier waarop iemand dat opschrijft", async () => {
    for (const waarde of ["uit", "UIT", "off", "false", "0", "nee"]) {
      expect(await aan(waarde)).toBe(false);
    }
  });
});
