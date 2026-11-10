import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { CODE_ALFABET, maakCode } from "@/lib/inschrijving/codes";
import { maakSleutels, zoekDeelnemer } from "@/lib/inschrijving/naam";
import {
  beoordeelVerificatie,
  leesGedeeldeCode,
  leesToegangswijze,
  maakGedeeldeCode,
  maakVerificatiecode,
  maskeer,
  pogingSleutel,
  VERIFICATIE_POGINGEN,
  vergelijkGedeeldeCode,
  verificatieSleutel,
} from "@/lib/inschrijving/toegang";

/**
 * De toegang tot de inschrijfpagina.
 *
 * WAT HIER BEWEZEN MOET WORDEN
 *
 *   1. Met de gedeelde code van de dag alleen kom je nergens. Je ziet geen
 *      naam, geen keuze, en je kunt niets wijzigen.
 *   2. Met de gedeelde code plus de naam van een klasgenoot kom je er ook
 *      niet. Dat was precies het gat in de eerste opzet.
 *   3. De cijfercode gaat altijd naar het adres dat de school van die
 *      leerling heeft aangeleverd, nooit naar een adres dat iemand intypt.
 *   4. Raden werkt niet: niet op de gedeelde code, niet op de persoonlijke
 *      code, en niet op de cijfercode.
 *   5. Een code werkt één keer. Daarna niet meer, ook niet binnen de tien
 *      minuten.
 *   6. Alle bestaande regels blijven staan: vol is vol, een klas die niet mag
 *      komt er niet in, en een gesloten dag neemt niets aan.
 *
 * HOE
 *
 *   De rekenregels worden los getest. Daarnaast draait de echte database in
 *   het geheugen, met alle migraties, en worden de stappen van de
 *   inschrijfpagina in dezelfde volgorde doorlopen: code van de dag, naam
 *   opzoeken, cijfercode klaarzetten, cijfercode beoordelen, keuze maken.
 *
 * ALLES VERZONNEN
 *
 *   Verzonnen school, verzonnen namen, verzonnen adressen op .test. Er komt
 *   geen echte klant en geen echte leerling in voor.
 */

// =============================================================================
// Deel 1: de rekenregels, zonder database
// =============================================================================

describe("de gedeelde code lezen", () => {
  it("accepteert wat iemand intypt met streepjes en kleine letters", () => {
    expect(leesGedeeldeCode("km7p-4x2b")).toBe("KM7P4X2B");
    expect(leesGedeeldeCode("  KM7P 4X2B ")).toBe("KM7P4X2B");
  });

  it("zet de klassieke leesfouten recht", () => {
    // O wordt 0, I en L worden 1, U wordt V. Anders belt er een school.
    expect(leesGedeeldeCode("OIlU2345")).toBe("011V2345");
  });

  it("weigert wat geen code kan zijn", () => {
    expect(leesGedeeldeCode("ABC")).toBeNull();
    expect(leesGedeeldeCode("")).toBeNull();
    expect(leesGedeeldeCode("ABCD2345ABCD2345")).toBeNull();
    expect(leesGedeeldeCode("!!!...")).toBeNull();
  });

  it("levert nooit iets op dat niet uit het code-alfabet komt", () => {
    // Leestekens gaan eruit, dus "<script>" wordt "SCR1PT". Dat is geen gat:
    // het wordt letterlijk vergeleken met de code van de dag en komt dus niet
    // verder. Maar wat eruit komt, mag nooit iets anders bevatten dan de
    // tekens waar wij codes van maken.
    for (const rommel of ["<script>", "' or 1=1 --", "AB'CD-23/45"]) {
      const uitkomst = leesGedeeldeCode(rommel);
      if (uitkomst !== null) expect(uitkomst).toMatch(/^[0-9A-HJKMNP-TV-Z]{6,12}$/);
    }
  });
});

describe("een nieuwe gedeelde code", () => {
  it("is acht tekens uit het alfabet zonder I, L, O en U", () => {
    for (let keer = 0; keer < 200; keer += 1) {
      const code = maakGedeeldeCode();
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
      for (const teken of code) expect(CODE_ALFABET).toContain(teken);
    }
  });

  it("levert niet twee keer hetzelfde op", () => {
    const codes = new Set(Array.from({ length: 500 }, () => maakGedeeldeCode()));
    expect(codes.size).toBe(500);
  });
});

describe("de gedeelde code vergelijken", () => {
  const dag = { shared_code: "KM7P4X2B", shared_code_active: true };

  it("laat de goede code door, ook met streepje en in kleine letters", () => {
    expect(vergelijkGedeeldeCode("KM7P4X2B", dag)).toBe("ok");
    expect(vergelijkGedeeldeCode("km7p-4x2b", dag)).toBe("ok");
  });

  it("houdt een foute code tegen", () => {
    expect(vergelijkGedeeldeCode("KM7P4X2C", dag)).toBe("fout");
    expect(vergelijkGedeeldeCode("", dag)).toBe("fout");
  });

  it("laat niemand door als er geen code is of als hij uit staat", () => {
    expect(vergelijkGedeeldeCode("KM7P4X2B", { shared_code: null, shared_code_active: true })).toBe("uit");
    expect(vergelijkGedeeldeCode("KM7P4X2B", { ...dag, shared_code_active: false })).toBe("uit");
  });
});

describe("een adres maskeren", () => {
  it("laat genoeg zien om te herkennen en te weinig om te oogsten", () => {
    expect(maskeer("lissa.velde@voorbeeld.test")).toBe("li••••••@voorbeeld.test");
    expect(maskeer("ab@voorbeeld.test")).toBe("a•@voorbeeld.test");
    expect(maskeer("a@voorbeeld.test")).toBe("a•@voorbeeld.test");
  });

  it("verraadt de lengte van een lange naam niet", () => {
    const kort = maskeer("jan@voorbeeld.test");
    const lang = maskeer("jan.peter.van.den.broek@voorbeeld.test");
    expect(lang.split("@")[0].length).toBeLessThanOrEqual(8);
    expect(kort.split("@")[0].length).toBeLessThanOrEqual(8);
  });

  it("maakt van iets wat geen adres is geen adres", () => {
    expect(maskeer("geen adres")).toBe("•••");
  });
});

describe("de cijfercode", () => {
  it("is altijd zes cijfers, ook als hij met nullen begint", () => {
    for (let keer = 0; keer < 500; keer += 1) {
      expect(maakVerificatiecode()).toMatch(/^\d{6}$/);
    }
  });

  it("levert per leerling een andere versleutelde vorm op", () => {
    // Zes cijfers zijn maar een miljoen mogelijkheden. Zonder het id van de
    // leerling erin zou één tabel met voorberekende uitkomsten voor alle rijen
    // tegelijk werken.
    const een = verificatieSleutel("deelnemer-1", "123456");
    const twee = verificatieSleutel("deelnemer-2", "123456");
    expect(een).not.toBe(twee);
    expect(verificatieSleutel("deelnemer-1", "123456")).toBe(een);
  });

  it("bewaart de code zelf nergens in de versleutelde vorm", () => {
    expect(verificatieSleutel("deelnemer-1", "123456")).not.toContain("123456");
  });
});

describe("een cijfercode beoordelen", () => {
  const id = "deelnemer-1";
  const goed = "123456";

  function regel(extra: Partial<Parameters<typeof beoordeelVerificatie>[0]["regel"]> = {}) {
    return {
      code_hash: verificatieSleutel(id, goed),
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      attempts: 0,
      used_at: null,
      ...extra,
    };
  }

  it("laat de goede code door", () => {
    expect(beoordeelVerificatie({ regel: regel(), deelnemerId: id, code: goed })).toEqual({ ok: true });
  });

  it("houdt een foute code tegen", () => {
    expect(beoordeelVerificatie({ regel: regel(), deelnemerId: id, code: "654321" })).toEqual({
      ok: false,
      reden: "fout",
    });
  });

  it("houdt een code tegen die bij een andere leerling hoort", () => {
    // Dezelfde cijfers, maar aangevraagd door iemand anders.
    expect(beoordeelVerificatie({ regel: regel(), deelnemerId: "deelnemer-2", code: goed })).toEqual({
      ok: false,
      reden: "fout",
    });
  });

  it("weigert als er niets klaarstaat", () => {
    expect(beoordeelVerificatie({ regel: null, deelnemerId: id, code: goed })).toEqual({
      ok: false,
      reden: "geen",
    });
  });

  it("weigert een verlopen code", () => {
    const oud = regel({ expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(beoordeelVerificatie({ regel: oud, deelnemerId: id, code: goed })).toEqual({
      ok: false,
      reden: "verlopen",
    });
  });

  it("weigert een code die al gebruikt is", () => {
    const gebruikt = regel({ used_at: new Date().toISOString() });
    expect(beoordeelVerificatie({ regel: gebruikt, deelnemerId: id, code: goed })).toEqual({
      ok: false,
      reden: "gebruikt",
    });
  });

  it("stopt na vijf pogingen, ook als de zesde goed is", () => {
    const opgebruikt = regel({ attempts: VERIFICATIE_POGINGEN });
    expect(beoordeelVerificatie({ regel: opgebruikt, deelnemerId: id, code: goed })).toEqual({
      ok: false,
      reden: "tevaak",
    });
  });

  it("zegt bij de laatste poging dat het op is", () => {
    const bijnaOp = regel({ attempts: VERIFICATIE_POGINGEN - 1 });
    expect(beoordeelVerificatie({ regel: bijnaOp, deelnemerId: id, code: "000000" })).toEqual({
      ok: false,
      reden: "tevaak",
    });
  });

  it("trapt niet in een code van de verkeerde lengte of met letters", () => {
    for (const poging of ["", "12345", "1234567", "abcdef", "12345a"]) {
      expect(beoordeelVerificatie({ regel: regel(), deelnemerId: id, code: poging }).ok).toBe(false);
    }
  });

  it("accepteert de goede cijfers wel met een spatie ertussen", () => {
    // Wie de code uit de mail kopieert, krijgt er soms een spatie bij.
    expect(beoordeelVerificatie({ regel: regel(), deelnemerId: id, code: "123 456" })).toEqual({ ok: true });
  });
});

describe("de toegangswijze lezen", () => {
  it("valt altijd terug op de veilige stand", () => {
    expect(leesToegangswijze("code")).toBe("code");
    expect(leesToegangswijze("schoolmail")).toBe("schoolmail");
    expect(leesToegangswijze("naam")).toBe("naam");
    // Een onbekende of ontbrekende waarde mag nooit de lichtste manier worden.
    expect(leesToegangswijze("open")).toBe("code");
    expect(leesToegangswijze(null)).toBe("code");
    expect(leesToegangswijze(undefined)).toBe("code");
  });
});

describe("de pogingenteller", () => {
  it("telt op een versleuteld kenmerk en nooit op het adres zelf", () => {
    const sleutel = pogingSleutel("gedeeld", "198.51.100.7");
    expect(sleutel).not.toContain("198.51.100.7");
    expect(sleutel.startsWith("gedeeld:")).toBe(true);
    expect(sleutel).toBe(pogingSleutel("gedeeld", "198.51.100.7"));
    expect(sleutel).not.toBe(pogingSleutel("gedeeld", "198.51.100.8"));
    expect(sleutel).not.toBe(pogingSleutel("code", "198.51.100.7"));
  });
});

// =============================================================================
// Deel 2: de hele weg naar binnen, met de echte database
// =============================================================================

const SUPABASE_STUBS = `
create role anon;
create role authenticated;
create role service_role;

create schema if not exists auth;
create schema if not exists extensions;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function auth.role() returns text
language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
`;

interface DeelnemerRij {
  id: string;
  display_name: string;
  search_key: string;
  flat_key: string;
  email: string | null;
  exempt: boolean;
  claim_token: string;
  access_code: string;
  claim_email: string | null;
}

let db: PGlite;
let dagId: string;
let gedeeld: string;
let klas1: string;
let klas2: string;
let ronde1: string;
let ronde2: string;
let drumsRonde1: string;
let drumsRonde2: string;
let hiphopRonde1: string;

async function rijen<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function een<T>(sql: string, params: unknown[] = []): Promise<T> {
  const lijst = await rijen<T>(sql, params);
  expect(lijst.length).toBeGreaterThan(0);
  return lijst[0];
}

/** De dag ophalen zoals getPubliekeDag dat doet. */
async function dagRij(): Promise<{ shared_code: string | null; shared_code_active: boolean; access_mode: string }> {
  return een("select shared_code, shared_code_active, access_mode from public.enrollment_events where id = $1", [
    dagId,
  ]);
}

/** De poort: de gedeelde code van de dag controleren. */
async function poort(ingetypt: string): Promise<"ok" | "fout" | "uit"> {
  return vergelijkGedeeldeCode(ingetypt, await dagRij());
}

/** Eén poging tellen, zoals de serveractie dat doet. */
async function poging(soort: Parameters<typeof pogingSleutel>[0], vanaf: string, max = 10): Promise<boolean> {
  const rij = await een<{ mag: boolean }>("select public.enrollment_poging($1::uuid, $2, $3, $4) as mag", [
    dagId,
    pogingSleutel(soort, vanaf),
    max,
    600,
  ]);
  return rij.mag;
}

/** Inloggen met de persoonlijke code, zoals zoekViaCode dat doet. */
async function viaPersoonlijkeCode(code: string): Promise<DeelnemerRij | null> {
  const lijst = await rijen<DeelnemerRij>(
    `select id, display_name, search_key, flat_key, email, exempt, claim_token, access_code, claim_email
     from public.enrollment_participants where event_id = $1 and access_code = $2`,
    [dagId, leesGedeeldeCode(code) ?? ""],
  );
  return lijst[0] ?? null;
}

/** De naam opzoeken binnen een klas, zoals vindInGroep dat doet. */
async function zoekInKlas(groepId: string, naam: string) {
  const lijst = await rijen<DeelnemerRij>(
    `select id, display_name, search_key, flat_key, email, exempt, claim_token, access_code, claim_email
     from public.enrollment_participants where event_id = $1 and group_id = $2`,
    [dagId, groepId],
  );

  const uitkomst = zoekDeelnemer(
    naam,
    lijst.map((rij) => ({
      id: rij.id,
      naam: rij.display_name,
      sleutel: rij.search_key,
      platteSleutel: rij.flat_key,
    })),
  );

  return {
    uitkomst,
    rij: uitkomst.soort === "gevonden" ? lijst.find((kandidaat) => kandidaat.id === uitkomst.kandidaat.id)! : null,
  };
}

/** Een cijfercode klaarzetten, zoals stuurVerificatie dat doet. */
async function zetCodeKlaar(deelnemer: DeelnemerRij, minuten = 10): Promise<{ code: string; naar: string }> {
  const code = maakVerificatiecode();

  await db.query(
    "update public.enrollment_verifications set used_at = now() where participant_id = $1 and used_at is null",
    [deelnemer.id],
  );

  // Het adres komt uit de lijst van de school, nooit uit het verzoek.
  const naar = deelnemer.email!;
  await db.query(
    `insert into public.enrollment_verifications (participant_id, code_hash, sent_to, expires_at)
     values ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [deelnemer.id, verificatieSleutel(deelnemer.id, code), naar, String(minuten)],
  );

  return { code, naar };
}

/** De cijfercode beoordelen, zoals bevestigVerificatie dat doet. */
async function probeerCode(
  deelnemerId: string,
  code: string,
): Promise<{ ok: boolean; reden?: string; claim?: string }> {
  const lijst = await rijen<{
    id: string;
    code_hash: string;
    expires_at: string;
    attempts: number;
    used_at: string | null;
    sent_to: string;
  }>(
    `select id, code_hash, expires_at, attempts, used_at, sent_to
     from public.enrollment_verifications
     where participant_id = $1 and used_at is null
     order by created_at desc limit 1`,
    [deelnemerId],
  );

  const regel = lijst[0] ?? null;
  const oordeel = beoordeelVerificatie({ regel, deelnemerId, code });

  if (!oordeel.ok) {
    if (regel) {
      await db.query("update public.enrollment_verifications set attempts = attempts + 1 where id = $1", [regel.id]);
    }
    return { ok: false, reden: oordeel.reden };
  }

  await db.query("update public.enrollment_verifications set used_at = now() where id = $1", [regel!.id]);
  await db.query(
    "update public.enrollment_participants set claim_email = $2, claimed_at = now() where id = $1",
    [deelnemerId, regel!.sent_to],
  );

  const deelnemer = await een<{ claim_token: string }>(
    "select claim_token from public.enrollment_participants where id = $1",
    [deelnemerId],
  );
  return { ok: true, claim: deelnemer.claim_token };
}

/** Een keuze maken, met het bewijs erbij. Zoals maakKeuze dat doet. */
async function kies(
  deelnemerId: string,
  claim: string,
  sessieId: string,
): Promise<{ ok: boolean; fout?: string }> {
  const lijst = await rijen<{ claim_token: string; exempt: boolean }>(
    "select claim_token, exempt from public.enrollment_participants where id = $1 and event_id = $2",
    [deelnemerId, dagId],
  );
  // Zonder geldig bewijs komt het verzoek niet eens bij de database.
  if (!lijst[0] || lijst[0].exempt || lijst[0].claim_token !== claim) return { ok: false, fout: "geen bewijs" };

  try {
    await db.query("select public.enrollment_choose($1::uuid, $2::uuid, 'deelnemer')", [deelnemerId, sessieId]);
    return { ok: true };
  } catch (fout) {
    const tekst = String((fout as Error).message);
    return { ok: false, fout: tekst.match(/enrollment_[a-z_]+/)?.[0] ?? tekst };
  }
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const map = path.join(process.cwd(), "supabase", "migrations");
  for (const bestand of (await readdir(map)).filter((naam) => naam.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(map, bestand), "utf8"));
  }

  const organisatie = await een<{ id: string }>(
    "insert into public.organizations (name, slug) values ($1, $2) returning id",
    ["Scholengemeenschap De Rotonde", "de-rotonde-toegang"],
  );

  gedeeld = maakGedeeldeCode();
  const dag = await een<{ id: string }>(
    `insert into public.enrollment_events
       (organization_id, name, event_date, status, slug, access_mode, shared_code, shared_code_active)
     values ($1, 'Cultuurdag', current_date + 21, 'open', 'cultuurdag-toegang-test', 'schoolmail', $2, true)
     returning id`,
    [organisatie.id, gedeeld],
  );
  dagId = dag.id;

  klas1 = (
    await een<{ id: string }>(
      "insert into public.enrollment_groups (event_id, name, position) values ($1, '1A', 1) returning id",
      [dagId],
    )
  ).id;
  klas2 = (
    await een<{ id: string }>(
      "insert into public.enrollment_groups (event_id, name, position) values ($1, '1B', 2) returning id",
      [dagId],
    )
  ).id;

  ronde1 = (
    await een<{ id: string }>(
      `insert into public.enrollment_rounds (event_id, position, label, starts_at, ends_at)
       values ($1, 1, 'Workshopronde 1', '09:15', '10:15') returning id`,
      [dagId],
    )
  ).id;
  ronde2 = (
    await een<{ id: string }>(
      `insert into public.enrollment_rounds (event_id, position, label, starts_at, ends_at)
       values ($1, 2, 'Workshopronde 2', '10:45', '11:45') returning id`,
      [dagId],
    )
  ).id;

  const drums = await een<{ id: string }>(
    "insert into public.enrollment_workshops (event_id, name, position) values ($1, 'Workshop Ghetto Drums', 1) returning id",
    [dagId],
  );
  const hiphop = await een<{ id: string }>(
    "insert into public.enrollment_workshops (event_id, name, position) values ($1, 'Workshop Hiphop', 2) returning id",
    [dagId],
  );

  // Drums ronde 1 heeft één plek en is alleen voor 1A: zo zijn vol en de
  // klasbeperking allebei echt te toetsen.
  drumsRonde1 = (
    await een<{ id: string }>(
      `insert into public.enrollment_sessions (event_id, workshop_id, round_id, capacity, position)
       values ($1, $2, $3, 1, 1) returning id`,
      [dagId, drums.id, ronde1],
    )
  ).id;
  drumsRonde2 = (
    await een<{ id: string }>(
      `insert into public.enrollment_sessions (event_id, workshop_id, round_id, capacity, position)
       values ($1, $2, $3, 25, 1) returning id`,
      [dagId, drums.id, ronde2],
    )
  ).id;
  hiphopRonde1 = (
    await een<{ id: string }>(
      `insert into public.enrollment_sessions (event_id, workshop_id, round_id, capacity, position)
       values ($1, $2, $3, 25, 2) returning id`,
      [dagId, hiphop.id, ronde1],
    )
  ).id;

  await db.query(
    "insert into public.enrollment_session_groups (session_id, group_id, event_id) values ($1, $2, $3)",
    [drumsRonde1, klas1, dagId],
  );

  const mensen = [
    { naam: "Lissa van der Velde", klas: klas1, email: "lissa.velde@voorbeeld.test" },
    { naam: "Jan-Peter Bakker", klas: klas1, email: "jp.bakker@voorbeeld.test" },
    { naam: "Ilse Mooren", klas: klas2, email: "i.mooren@voorbeeld.test" },
    { naam: "Youssef El Amrani", klas: klas2, email: null },
  ];

  for (const mens of mensen) {
    const sleutels = maakSleutels(mens.naam);
    await db.query(
      `insert into public.enrollment_participants
         (event_id, group_id, display_name, search_key, flat_key, email, claim_token, access_code)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        dagId,
        mens.klas,
        mens.naam,
        sleutels.sleutel,
        sleutels.platteSleutel,
        mens.email,
        maakCode(24),
        maakCode(8),
      ],
    );
  }
});

describe("de poort: de gedeelde code van de dag", () => {
  it("laat de goede code door, hoe iemand hem ook intypt", async () => {
    expect(await poort(gedeeld)).toBe("ok");
    expect(await poort(gedeeld.toLowerCase())).toBe("ok");
    expect(await poort(`${gedeeld.slice(0, 4)}-${gedeeld.slice(4)}`)).toBe("ok");
  });

  it("houdt een foute code tegen", async () => {
    expect(await poort("ZZZZ9999")).toBe("fout");
    expect(await poort("")).toBe("fout");
  });

  it("sluit iedereen buiten zodra de code uit staat", async () => {
    await db.query("update public.enrollment_events set shared_code_active = false where id = $1", [dagId]);
    expect(await poort(gedeeld)).toBe("uit");
    await db.query("update public.enrollment_events set shared_code_active = true where id = $1", [dagId]);
    expect(await poort(gedeeld)).toBe("ok");
  });

  it("geeft met de goede code nog geen enkele naam weg", async () => {
    // De poort levert alleen "ok" op. Wie er in de klas zitten komt pas aan de
    // orde na de tweede stap, en die vraagt om iets wat alleen die leerling
    // heeft.
    expect(await poort(gedeeld)).toBe("ok");
    const rij = await dagRij();
    expect(Object.keys(rij)).toEqual(["shared_code", "shared_code_active", "access_mode"]);
  });

  it("remt het raden van de gedeelde code af", async () => {
    let door = 0;
    for (let keer = 0; keer < 15; keer += 1) {
      if (await poging("gedeeld", "203.0.113.9")) door += 1;
    }
    expect(door).toBe(10);
    // Een andere bezoeker merkt daar niets van.
    expect(await poging("gedeeld", "203.0.113.10")).toBe(true);
  });
});

describe("de schoolmailmanier", () => {
  it("vindt de naam en stuurt de code naar het adres van de school", async () => {
    const { rij } = await zoekInKlas(klas1, "lissa van der velde");
    expect(rij?.display_name).toBe("Lissa van der Velde");

    const { code, naar } = await zetCodeKlaar(rij!);
    expect(naar).toBe("lissa.velde@voorbeeld.test");

    const uitkomst = await probeerCode(rij!.id, code);
    expect(uitkomst.ok).toBe(true);
    expect(uitkomst.claim).toBe(rij!.claim_token);
  });

  it("legt vast met welk adres er bevestigd is", async () => {
    const rij = await een<{ claim_email: string | null; claimed_at: string | null }>(
      "select claim_email, claimed_at from public.enrollment_participants where display_name = 'Lissa van der Velde'",
    );
    expect(rij.claim_email).toBe("lissa.velde@voorbeeld.test");
    expect(rij.claimed_at).not.toBeNull();
  });

  it("stuurt nooit naar een adres dat iemand zelf intypt", async () => {
    // Dit is de aanval die de eerste opzet mogelijk maakte: de naam van een
    // klasgenoot kiezen en je eigen adres invullen. Het adres komt hier uit de
    // lijst van de school, dus zo'n adres bestaat in deze weg niet.
    const { rij } = await zoekInKlas(klas1, "jan-peter bakker");
    const { naar } = await zetCodeKlaar(rij!);
    expect(naar).toBe("jp.bakker@voorbeeld.test");
    expect(naar).not.toContain("aanvaller");

    const verzonden = await rijen<{ sent_to: string }>(
      "select sent_to from public.enrollment_verifications where participant_id = $1",
      [rij!.id],
    );
    expect(verzonden.every((regel) => regel.sent_to === "jp.bakker@voorbeeld.test")).toBe(true);
  });

  it("geeft een klasgenoot niets in handen zonder de code uit de mail", async () => {
    const { rij } = await zoekInKlas(klas1, "jan-peter bakker");
    await zetCodeKlaar(rij!);

    // De klasgenoot weet de naam, en verder niets.
    const mis = await probeerCode(rij!.id, "000000");
    expect(mis.ok).toBe(false);
    expect(mis.claim).toBeUndefined();

    // En hij kan dus ook niets kiezen.
    const keuze = await kies(rij!.id, "verzonnen-bewijs", hiphopRonde1);
    expect(keuze.ok).toBe(false);
  });

  it("stopt na vijf keer raden, ook als de zesde goed is", async () => {
    const { rij } = await zoekInKlas(klas2, "ilse mooren");
    const { code } = await zetCodeKlaar(rij!);

    for (let keer = 0; keer < VERIFICATIE_POGINGEN; keer += 1) {
      const poging = await probeerCode(rij!.id, "111111");
      expect(poging.ok).toBe(false);
    }

    const metDeGoede = await probeerCode(rij!.id, code);
    expect(metDeGoede.ok).toBe(false);
    expect(metDeGoede.reden).toBe("tevaak");
  });

  it("laat een nieuwe code wel weer werken, en de oude niet meer", async () => {
    const { rij } = await zoekInKlas(klas2, "ilse mooren");
    const { code: oud } = await zetCodeKlaar(rij!);
    const { code: nieuw } = await zetCodeKlaar(rij!);

    // De vorige code is vervallen op het moment dat er een nieuwe kwam.
    expect((await probeerCode(rij!.id, oud)).ok).toBe(false);
    expect((await probeerCode(rij!.id, nieuw)).ok).toBe(true);
  });

  it("laat dezelfde code geen tweede keer werken", async () => {
    const { rij } = await zoekInKlas(klas1, "lissa van der velde");
    const { code } = await zetCodeKlaar(rij!);

    expect((await probeerCode(rij!.id, code)).ok).toBe(true);
    const tweede = await probeerCode(rij!.id, code);
    expect(tweede.ok).toBe(false);
    expect(tweede.reden).toBe("geen");
  });

  it("laat een verlopen code niet werken", async () => {
    const { rij } = await zoekInKlas(klas1, "jan-peter bakker");
    const { code } = await zetCodeKlaar(rij!, 10);
    await db.query(
      "update public.enrollment_verifications set expires_at = now() - interval '1 minute' where participant_id = $1 and used_at is null",
      [rij!.id],
    );

    const uitkomst = await probeerCode(rij!.id, code);
    expect(uitkomst.ok).toBe(false);
    expect(uitkomst.reden).toBe("verlopen");
  });

  it("zegt het eerlijk als van iemand geen adres bekend is", async () => {
    const { rij } = await zoekInKlas(klas2, "youssef el amrani");
    expect(rij?.display_name).toBe("Youssef El Amrani");
    expect(rij?.email).toBeNull();
    // Deze leerling kan niet via de mail. Hij heeft wel een persoonlijke code,
    // en die is de achtervang.
    expect(rij?.access_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  it("geeft bij een typefout hooguit een paar namen uit de eigen klas", async () => {
    const { uitkomst } = await zoekInKlas(klas1, "jan peter bakkers");
    if (uitkomst.soort === "bijna" || uitkomst.soort === "meerdere") {
      expect(uitkomst.kandidaten.length).toBeLessThanOrEqual(5);
      // Nooit iemand uit een andere klas.
      expect(uitkomst.kandidaten.every((kandidaat) => kandidaat.naam !== "Ilse Mooren")).toBe(true);
    } else {
      expect(uitkomst.soort).toBe("gevonden");
    }
  });
});

describe("de persoonlijke code", () => {
  it("hoort bij precies één leerling en geeft geen klas weg", async () => {
    const lissa = await een<DeelnemerRij>(
      "select * from public.enrollment_participants where display_name = 'Lissa van der Velde'",
    );
    const gevonden = await viaPersoonlijkeCode(lissa.access_code);
    expect(gevonden?.id).toBe(lissa.id);

    // Met streepje en in kleine letters werkt hij ook.
    const metStreepje = `${lissa.access_code.slice(0, 4)}-${lissa.access_code.slice(4)}`.toLowerCase();
    expect((await viaPersoonlijkeCode(metStreepje))?.id).toBe(lissa.id);
  });

  it("levert bij een onbekende code niets op", async () => {
    expect(await viaPersoonlijkeCode("ZZZZ9999")).toBeNull();
    expect(await viaPersoonlijkeCode("rommel")).toBeNull();
  });

  it("is per leerling verschillend", async () => {
    const codes = await rijen<{ access_code: string }>(
      "select access_code from public.enrollment_participants where event_id = $1",
      [dagId],
    );
    expect(new Set(codes.map((rij) => rij.access_code)).size).toBe(codes.length);
  });

  it("wordt ook afgeremd bij raden", async () => {
    let door = 0;
    for (let keer = 0; keer < 15; keer += 1) {
      if (await poging("code", "203.0.113.20")) door += 1;
    }
    expect(door).toBe(10);
  });
});

describe("de bestaande inschrijfregels blijven staan", () => {
  it("laat kiezen met een geldig bewijs, en weigert het zonder", async () => {
    const lissa = await een<DeelnemerRij>(
      "select * from public.enrollment_participants where display_name = 'Lissa van der Velde'",
    );

    expect(await kies(lissa.id, "fout-bewijs", drumsRonde1)).toEqual({ ok: false, fout: "geen bewijs" });
    expect(await kies(lissa.id, lissa.claim_token, drumsRonde1)).toEqual({ ok: true });
  });

  it("houdt vol is vol vol", async () => {
    const jp = await een<DeelnemerRij>(
      "select * from public.enrollment_participants where display_name = 'Jan-Peter Bakker'",
    );
    const uitkomst = await kies(jp.id, jp.claim_token, drumsRonde1);
    expect(uitkomst.fout).toBe("enrollment_full");
  });

  it("houdt een klas buiten die niet is aangevinkt", async () => {
    const ilse = await een<DeelnemerRij>(
      "select * from public.enrollment_participants where display_name = 'Ilse Mooren'",
    );
    const uitkomst = await kies(ilse.id, ilse.claim_token, drumsRonde1);
    expect(uitkomst.fout).toBe("enrollment_not_allowed");
  });

  it("weigert dezelfde workshop in een tweede ronde", async () => {
    const lissa = await een<DeelnemerRij>(
      "select * from public.enrollment_participants where display_name = 'Lissa van der Velde'",
    );
    const uitkomst = await kies(lissa.id, lissa.claim_token, drumsRonde2);
    expect(uitkomst.fout).toBe("enrollment_repeat");
  });

  it("neemt niets meer aan zodra de dag gesloten is", async () => {
    const ilse = await een<DeelnemerRij>(
      "select * from public.enrollment_participants where display_name = 'Ilse Mooren'",
    );
    await db.query("update public.enrollment_events set status = 'gesloten' where id = $1", [dagId]);
    const uitkomst = await kies(ilse.id, ilse.claim_token, hiphopRonde1);
    expect(uitkomst.fout).toBe("enrollment_closed");
    await db.query("update public.enrollment_events set status = 'open' where id = $1", [dagId]);
  });
});

describe("een verkeerd geclaimde naam vrijgeven", () => {
  it("haalt de bevestiging eraf, maakt het oude bewijs ongeldig en laat de keuzes staan", async () => {
    const lissa = await een<DeelnemerRij>(
      "select * from public.enrollment_participants where display_name = 'Lissa van der Velde'",
    );
    const keuzesVoor = await een<{ n: number }>(
      "select count(*)::int as n from public.enrollment_choices where participant_id = $1",
      [lissa.id],
    );
    expect(keuzesVoor.n).toBeGreaterThan(0);

    // Dit is wat maakClaimVrij doet.
    await db.query(
      `update public.enrollment_participants
         set claim_email = null, claimed_at = null, claim_token = $2
       where id = $1`,
      [lissa.id, maakCode(24)],
    );
    await db.query(
      "update public.enrollment_verifications set used_at = now() where participant_id = $1 and used_at is null",
      [lissa.id],
    );

    const na = await een<DeelnemerRij>("select * from public.enrollment_participants where id = $1", [lissa.id]);
    expect(na.claim_email).toBeNull();
    expect(na.claim_token).not.toBe(lissa.claim_token);

    // De keuzes staan er nog: die worden nooit stil weggegooid.
    const keuzesNa = await een<{ n: number }>(
      "select count(*)::int as n from public.enrollment_choices where participant_id = $1",
      [lissa.id],
    );
    expect(keuzesNa.n).toBe(keuzesVoor.n);

    // En met het oude bewijs kan er niets meer gewijzigd worden.
    expect(await kies(lissa.id, lissa.claim_token, hiphopRonde1)).toEqual({ ok: false, fout: "geen bewijs" });
    expect((await kies(lissa.id, na.claim_token, hiphopRonde1)).ok).toBe(true);
  });
});
