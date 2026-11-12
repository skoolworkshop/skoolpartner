import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * SkoolPoints horen bij de schoollocatie.
 *
 * WAT HIER VASTLIGT
 *
 *   Eén saldo per locatie. Alle contactpersonen van die locatie sparen ervoor,
 *   zien het, en kunnen er een inwisselverzoek op indienen. Twee locaties van
 *   hetzelfde bestuur delen niets. Wie vertrekt neemt niets mee en kan er niet
 *   meer bij. De geschiedenis blijft staan, met de betrokken contactpersoon.
 *
 * DE OPZET
 *
 *   Stichting Zuidwest met twee locaties. Op Noord werken Anna en Bram, op Zuid
 *   werkt Carla. Dirk hoort nergens bij. Later komt Eva op Noord erbij.
 *
 * HOE DE RECHTEN WORDEN GETOETST
 *
 *   Met `set role authenticated` en de gebruiker in de JWT-instelling, precies
 *   zoals Supabase een ingelogde klant aanbiedt. Row Level Security doet dan
 *   echt mee; zonder die rol is de test een beheerder die alles mag.
 */

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
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;

async function nieuweDatabase(totEnMet?: string): Promise<PGlite> {
  const database = await PGlite.create();
  await database.exec(SUPABASE_STUBS);
  const map = path.join(process.cwd(), "supabase", "migrations");
  const bestanden = (await readdir(map)).filter((naam) => naam.endsWith(".sql")).sort();
  for (const bestand of bestanden) {
    if (totEnMet && bestand > totEnMet) break;
    await database.exec(await readFile(path.join(map, bestand), "utf8"));
  }
  return database;
}

let db: PGlite;
let noord: string;
let zuid: string;
let anna: string;
let bram: string;
let carla: string;
let dirk: string;
let eva: string;
let beheerder: string;

async function rijen<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function een<T>(sql: string, params: unknown[] = []): Promise<T> {
  const lijst = await rijen<T>(sql, params);
  expect(lijst.length).toBeGreaterThan(0);
  return lijst[0];
}

/** Voert werk uit als ingelogde klant, met Row Level Security aan. */
async function als<T>(gebruiker: string | null, werk: () => Promise<T>, rol = "authenticated"): Promise<T> {
  await db.exec(`set role ${rol}; select set_config('request.jwt.claim.sub', '${gebruiker ?? ""}', false);`);
  try {
    return await werk();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

/** Het saldo van een locatie, rechtstreeks uit het grootboek. */
async function grootboek(organisatie: string): Promise<number> {
  const rij = await een<{ punten: number }>(
    `select coalesce(sum(points), 0)::int as punten
       from public.loyalty_transactions
      where organization_id = $1
        and status in ('available', 'reserved', 'redeemed', 'expired')`,
    [organisatie],
  );
  return rij.punten;
}

async function maakGebruiker(mail: string, naam: string, organisatie: string | null): Promise<string> {
  const gebruiker = await een<{ id: string }>("insert into auth.users (email) values ($1) returning id", [mail]);
  await db.query(
    "insert into public.profiles (id, email, full_name) values ($1, $2, $3) on conflict (id) do nothing",
    [gebruiker.id, mail, naam],
  );
  if (organisatie) {
    await db.query(
      "insert into public.organization_members (organization_id, user_id, role, status, source) values ($1, $2, 'beheerder', 'active', 'admin_manual')",
      [organisatie, gebruiker.id],
    );
    await db.query(
      "insert into public.organization_contacts (organization_id, email, full_name, user_id, is_verified, verified_at) values ($1, $2, $3, $4, true, now())",
      [organisatie, mail, naam, gebruiker.id],
    );
    // Zoals approveMembership dat doet: de collega krijgt een eigen regel, die
    // vastlegt wie hij is. Het saldo hangt daar niet aan.
    await db.query("select public.ensure_loyalty_account($1::uuid, $2::uuid)", [organisatie, gebruiker.id]);
  }
  return gebruiker.id;
}

async function maakBoeking(opties: {
  organisatie: string;
  contactEmail: string;
  contactNaam: string;
  workshop: string;
  status?: "confirmed" | "completed";
  dagenVanaf?: number;
}): Promise<string> {
  const rij = await een<{ id: string }>(
    `insert into public.bookings
       (organization_id, workshop_name, workshop_count, minutes_per_workshop, scheduled_date,
        status, origin, contact_email, contact_name)
     values ($1, $2, 2, 90, current_date + $5::int, $6, 'admin_manual', $3, $4)
     returning id`,
    [
      opties.organisatie,
      opties.workshop,
      opties.contactEmail,
      opties.contactNaam,
      opties.dagenVanaf ?? -7,
      opties.status ?? "completed",
    ],
  );
  return rij.id;
}

/**
 * Punten vastleggen zoals de applicatie dat doet: een upsert op
 * (organization_id, type, external_reference) die een dubbele stilzwijgend
 * overslaat. Geeft terug of er echt een regel bij kwam.
 */
async function kenToe(opties: {
  organisatie: string;
  gebruiker: string;
  type: "earn_workshop" | "welcome_bonus";
  punten: number;
  omschrijving: string;
  verwijzing: string;
  boekingId?: string | null;
  verlooptOverDagen?: number | null;
}): Promise<boolean> {
  const account = await een<{ id: string }>(
    "select id from public.loyalty_accounts where organization_id = $1 and user_id = $2",
    [opties.organisatie, opties.gebruiker],
  );
  const resultaat = await rijen<{ id: string }>(
    `insert into public.loyalty_transactions
       (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100,
        description, external_reference, booking_id, available_at, expires_at)
     values ($1, $2, $3, $4, 'available', $5, 250, $6, $7, $8, now(),
             case when $9::int is null then null else now() + ($9::int || ' days')::interval end)
     on conflict (organization_id, type, external_reference) do nothing
     returning id`,
    [
      opties.organisatie,
      opties.gebruiker,
      account.id,
      opties.type,
      opties.punten,
      opties.omschrijving,
      opties.verwijzing,
      opties.boekingId ?? null,
      opties.verlooptOverDagen ?? null,
    ],
  );
  return resultaat.length === 1;
}

async function vraagAan(gebruiker: string, organisatie: string, punten: number, boekingId: string | null = null) {
  return als(gebruiker, () =>
    een<{ id: string; status: string; points: number; requested_by: string; reserve_transaction_id: string }>(
      "select * from public.request_redemption($1::uuid, $2::int, $3::uuid, null, null)",
      [organisatie, punten, boekingId],
    ),
  );
}

beforeAll(async () => {
  db = await nieuweDatabase();

  noord = (
    await een<{ id: string }>(
      "insert into public.organizations (name, slug) values ('Stichting Zuidwest, locatie Noord', 'zw-noord') returning id",
    )
  ).id;
  zuid = (
    await een<{ id: string }>(
      "insert into public.organizations (name, slug) values ('Stichting Zuidwest, locatie Zuid', 'zw-zuid') returning id",
    )
  ).id;

  anna = await maakGebruiker("anna@zw-noord.test", "Anna de Vries", noord);
  bram = await maakGebruiker("bram@zw-noord.test", "Bram Jansen", noord);
  carla = await maakGebruiker("carla@zw-zuid.test", "Carla Smit", zuid);
  dirk = await maakGebruiker("dirk@elders.test", "Dirk Bos", null);
  beheerder = await maakGebruiker("beheer@skoolworkshop.test", "Beheer", null);
  await db.query("update public.profiles set is_admin = true where id = $1", [beheerder]);
}, 120_000);

describe("twee contactpersonen sparen voor één locatie", () => {
  it("krijgt de locatie de welkomstbonus één keer, niet per collega", async () => {
    const eerste = await kenToe({
      organisatie: noord,
      gebruiker: anna,
      type: "welcome_bonus",
      punten: 100,
      omschrijving: "Welkomstbonus SkoolPartner",
      verwijzing: "welcome",
    });
    const tweede = await kenToe({
      organisatie: noord,
      gebruiker: bram,
      type: "welcome_bonus",
      punten: 100,
      omschrijving: "Welkomstbonus SkoolPartner",
      verwijzing: "welcome",
    });

    expect(eerste).toBe(true);
    expect(tweede).toBe(false);
    expect(await grootboek(noord)).toBe(100);
  });

  it("geeft de zusterlocatie haar eigen welkomstbonus", async () => {
    const bonus = await kenToe({
      organisatie: zuid,
      gebruiker: carla,
      type: "welcome_bonus",
      punten: 100,
      omschrijving: "Welkomstbonus SkoolPartner",
      verwijzing: "welcome",
    });
    expect(bonus).toBe(true);
    expect(await grootboek(zuid)).toBe(100);
  });

  it("tellen de boekingen van beide collega's op bij hetzelfde saldo", async () => {
    const boekingAnna = await maakBoeking({
      organisatie: noord,
      contactEmail: "anna@zw-noord.test",
      contactNaam: "Anna de Vries",
      workshop: "Workshop Hiphop",
    });
    const boekingBram = await maakBoeking({
      organisatie: noord,
      contactEmail: "bram@zw-noord.test",
      contactNaam: "Bram Jansen",
      workshop: "Workshop Graffiti",
    });

    expect(
      await kenToe({
        organisatie: noord,
        gebruiker: anna,
        type: "earn_workshop",
        punten: 600,
        omschrijving: "Workshop Hiphop",
        verwijzing: `booking:${boekingAnna}`,
        boekingId: boekingAnna,
      }),
    ).toBe(true);
    expect(
      await kenToe({
        organisatie: noord,
        gebruiker: bram,
        type: "earn_workshop",
        punten: 400,
        omschrijving: "Workshop Graffiti",
        verwijzing: `booking:${boekingBram}`,
        boekingId: boekingBram,
      }),
    ).toBe(true);

    expect(await grootboek(noord)).toBe(1100);
  });

  it("levert dezelfde boeking geen tweede keer punten op, ook niet via een collega", async () => {
    const boeking = await een<{ id: string }>(
      "select id from public.bookings where workshop_name = 'Workshop Hiphop'",
    );
    const dubbel = await kenToe({
      organisatie: noord,
      gebruiker: bram,
      type: "earn_workshop",
      punten: 600,
      omschrijving: "Workshop Hiphop",
      verwijzing: `booking:${boeking.id}`,
      boekingId: boeking.id,
    });
    expect(dubbel).toBe(false);
    expect(await grootboek(noord)).toBe(1100);
  });

  it("toont de weergave één regel per locatie, met het totaal", async () => {
    const regels = await rijen<{ organization_id: string; available_points: number; lifetime_earned_points: number }>(
      "select organization_id, available_points, lifetime_earned_points from public.loyalty_balances order by available_points desc",
    );

    expect(regels).toHaveLength(2);
    expect(regels.find((r) => r.organization_id === noord)?.available_points).toBe(1100);
    expect(regels.find((r) => r.organization_id === zuid)?.available_points).toBe(100);
    expect(regels.find((r) => r.organization_id === noord)?.lifetime_earned_points).toBe(1100);
  });

  it("blijft bij elke regel staan welke contactpersoon en welke boeking het was", async () => {
    const regels = await rijen<{ description: string; user_id: string; booking_id: string | null }>(
      "select description, user_id, booking_id from public.loyalty_transactions where organization_id = $1 and type = 'earn_workshop' order by points desc",
      [noord],
    );
    expect(regels.map((r) => r.user_id)).toEqual([anna, bram]);
    expect(regels.every((r) => r.booking_id !== null)).toBe(true);
  });
});

describe("wie het saldo mag zien", () => {
  it("ziet Anna het hele saldo van haar locatie, ook wat Bram spaarde", async () => {
    const beeld = await als(anna, async () => ({
      saldo: await rijen<{ organization_id: string; available_points: number }>(
        "select organization_id, available_points from public.loyalty_balances",
      ),
      regels: await rijen<{ user_id: string }>("select user_id from public.loyalty_transactions"),
      functie: await een<{ punten: number }>("select public.loyalty_available_points($1::uuid) as punten", [noord]),
    }));

    expect(beeld.saldo).toEqual([{ organization_id: noord, available_points: 1100 }]);
    expect(new Set(beeld.regels.map((r) => r.user_id))).toEqual(new Set([anna, bram]));
    expect(beeld.functie.punten).toBe(1100);
  });

  it("ziet Bram precies hetzelfde saldo", async () => {
    const saldo = await als(bram, () =>
      rijen<{ available_points: number }>("select available_points from public.loyalty_balances"),
    );
    expect(saldo).toEqual([{ available_points: 1100 }]);
  });

  it("ziet Carla van de zusterlocatie alleen haar eigen locatie", async () => {
    const beeld = await als(carla, async () => ({
      saldo: await rijen<{ organization_id: string; available_points: number }>(
        "select organization_id, available_points from public.loyalty_balances",
      ),
      vanNoord: await rijen("select id from public.loyalty_transactions where organization_id = $1", [noord]),
      functie: await een<{ punten: number }>("select public.loyalty_available_points($1::uuid) as punten", [noord]),
    }));

    expect(beeld.saldo).toEqual([{ organization_id: zuid, available_points: 100 }]);
    expect(beeld.vanNoord).toHaveLength(0);
    // Ook wie het ID van een andere locatie kent, krijgt het saldo niet te zien.
    expect(beeld.functie.punten).toBe(0);
  });

  it("ziet Dirk, die nergens bij hoort, helemaal niets", async () => {
    const beeld = await als(dirk, async () => ({
      saldo: await rijen("select * from public.loyalty_balances"),
      regels: await rijen("select id from public.loyalty_transactions"),
      functie: await een<{ punten: number }>("select public.loyalty_available_points($1::uuid) as punten", [noord]),
    }));
    expect(beeld.saldo).toHaveLength(0);
    expect(beeld.regels).toHaveLength(0);
    expect(beeld.functie.punten).toBe(0);
  });

  it("komt een niet-ingelogde bezoeker er niet bij", async () => {
    await expect(
      als(null, () => rijen("select public.loyalty_available_points($1::uuid)", [noord]), "anon"),
    ).rejects.toThrow(/permission denied/i);
    await expect(als(null, () => rijen("select * from public.loyalty_balances"), "anon")).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("ziet een beheerder van Skool Workshop alle locaties", async () => {
    const saldo = await als(beheerder, () => rijen("select organization_id from public.loyalty_balances"));
    expect(saldo).toHaveLength(2);
  });

  it("is het interne saldo niet aanroepbaar door een klant", async () => {
    await expect(
      als(anna, () => rijen("select public.loyalty_location_points($1::uuid)", [noord])),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("inwisselen op het saldo van de locatie", () => {
  let verzoekAnna: string;

  it("mag Anna meer aanvragen dan zij zelf spaarde, want het saldo is van de school", async () => {
    // Anna spaarde zelf 600 plus de bonus. Zij vraagt 800 aan.
    const verzoek = await vraagAan(anna, noord, 800);
    verzoekAnna = verzoek.id;

    expect(verzoek.status).toBe("requested");
    expect(verzoek.requested_by).toBe(anna);
    expect(verzoek.reserve_transaction_id).not.toBeNull();
    // Gereserveerd is nog niet weg: het is een aanvraag.
    expect(await grootboek(noord)).toBe(300);
  });

  it("legt de reservering vast op naam van de aanvrager", async () => {
    const reservering = await een<{ user_id: string; status: string; points: number; organization_id: string }>(
      "select user_id, status, points, organization_id from public.loyalty_transactions where type = 'redemption_reserve' and organization_id = $1",
      [noord],
    );
    expect(reservering).toEqual({ user_id: anna, status: "reserved", points: -800, organization_id: noord });
  });

  it("kan Bram daarna niet nog eens hetzelfde saldo aanvragen", async () => {
    await expect(vraagAan(bram, noord, 500)).rejects.toThrow(/Onvoldoende saldo: 300 beschikbaar, 500 gevraagd/);
    expect(await grootboek(noord)).toBe(300);
  });

  it("gebruikt een slot op de locatie tegen twee verzoeken tegelijk", async () => {
    // Echte gelijktijdigheid is in deze testdatabase niet na te bootsen: er is
    // maar één verbinding. Wel staat vast dat de functie de locatie vergrendelt
    // voordat hij het saldo leest, en dat het saldo de reservering van een
    // eerder verzoek al meetelt (de test hierboven).
    const functie = await een<{ bron: string }>(
      "select pg_get_functiondef('public.request_redemption(uuid,integer,uuid,text,text)'::regprocedure) as bron",
    );
    const slot = functie.bron.indexOf("from public.organizations where id = p_org for update");
    const saldo = functie.bron.indexOf("public.loyalty_location_points(p_org)");
    expect(slot).toBeGreaterThan(-1);
    expect(saldo).toBeGreaterThan(slot);
  });

  it("ziet Bram het verzoek van Anna, zodat het gereserveerde bedrag te verklaren is", async () => {
    const beeld = await als(bram, async () => ({
      verzoeken: await rijen<{ id: string; points: number }>("select id, points from public.redemption_requests"),
      saldo: await een<{ available_points: number; reserved_points: number }>(
        "select available_points, reserved_points from public.loyalty_balances",
      ),
    }));
    expect(beeld.verzoeken).toEqual([{ id: verzoekAnna, points: 800 }]);
    expect(beeld.saldo).toEqual({ available_points: 300, reserved_points: 800 });
  });

  it("kan niemand van een andere locatie een verzoek op dit saldo indienen", async () => {
    await expect(vraagAan(carla, noord, 500)).rejects.toThrow(/Geen toegang/);
    await expect(vraagAan(dirk, noord, 500)).rejects.toThrow(/Geen toegang/);
  });

  it("kan een klant geen los verzoek in de tabel zetten, buiten de reservering om", async () => {
    await expect(
      als(anna, () =>
        rijen(
          `insert into public.redemption_requests (organization_id, requested_by, points, value_cents, point_value_cents_per_100, status)
           values ($1, $2, 5000, 12500, 250, 'requested') returning id`,
          [noord, anna],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("kan een klant een verzoek ook niet zelf op goedgekeurd zetten", async () => {
    await expect(
      als(anna, () =>
        rijen("update public.redemption_requests set status = 'applied' where id = $1 returning id", [verzoekAnna]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("blijven de voorwaarden gelden: minimum en alleen een eigen, komende workshop", async () => {
    await expect(vraagAan(bram, noord, 100)).rejects.toThrow(/Minimaal 500 SkoolPoints/);

    const vanZuid = await maakBoeking({
      organisatie: zuid,
      contactEmail: "carla@zw-zuid.test",
      contactNaam: "Carla Smit",
      workshop: "Workshop Dans",
      status: "confirmed",
      dagenVanaf: 30,
    });
    // Een collega mag het verzoek intrekken: het is een verzoek van de locatie.
    await als(bram, () => rijen("select public.cancel_redemption($1::uuid, 'Ingetrokken door collega')", [verzoekAnna]));
    expect(await grootboek(noord)).toBe(1100);

    await expect(vraagAan(bram, noord, 500, vanZuid)).rejects.toThrow(/hoort niet bij uw organisatie/);

    const geweest = await een<{ id: string }>("select id from public.bookings where workshop_name = 'Workshop Graffiti'");
    await expect(vraagAan(bram, noord, 500, geweest.id)).rejects.toThrow(/bevestigde workshop/);
  });

  it("verwerkt Skool Workshop een goedgekeurd verzoek, en pas dan zijn de punten gebruikt", async () => {
    const komend = await maakBoeking({
      organisatie: noord,
      contactEmail: "bram@zw-noord.test",
      contactNaam: "Bram Jansen",
      workshop: "Workshop Percussie",
      status: "confirmed",
      dagenVanaf: 21,
    });
    const verzoek = await vraagAan(bram, noord, 500, komend);

    // Zoals decideRedemptionAction dat doet, onder de beheerrol.
    await db.query(
      "update public.redemption_requests set status = 'applied', applied_at = now(), applied_by = $2, invoice_number = '2026-0999' where id = $1",
      [verzoek.id, beheerder],
    );
    await db.query("update public.loyalty_transactions set status = 'redeemed' where id = $1", [
      verzoek.reserve_transaction_id,
    ]);

    const saldo = await een<{ available_points: number; reserved_points: number; redeemed_points: number }>(
      "select available_points, reserved_points, redeemed_points from public.loyalty_balances where organization_id = $1",
      [noord],
    );
    expect(saldo).toEqual({ available_points: 600, reserved_points: 0, redeemed_points: 500 });
  });

  it("raakt het saldo van de zusterlocatie door dit alles niet", async () => {
    expect(await grootboek(zuid)).toBe(100);
  });
});

describe("een correctie door Skool Workshop", () => {
  it("telt op het saldo van de locatie, ook zonder betrokken contactpersoon", async () => {
    const account = await een<{ id: string }>(
      "select id from public.loyalty_accounts where organization_id = $1 order by enrolled_at, id limit 1",
      [noord],
    );
    await db.query(
      `insert into public.loyalty_transactions
         (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100, description, source, reason, created_by, available_at)
       values ($1, null, $2, 'manual_adjustment', 'available', 150, 250, 'Handmatige correctie', 'admin', 'Extra workshop niet meegeteld', $3, now())`,
      [noord, account.id, beheerder],
    );
    expect(await grootboek(noord)).toBe(750);
    const saldo = await als(anna, () =>
      een<{ available_points: number }>("select available_points from public.loyalty_balances"),
    );
    expect(saldo.available_points).toBe(750);
  });
});

describe("een contactpersoon vertrekt", () => {
  it("kan Bram er niet meer bij zodra zijn lidmaatschap is beëindigd", async () => {
    await db.query(
      "update public.organization_members set status = 'removed' where organization_id = $1 and user_id = $2",
      [noord, bram],
    );

    const beeld = await als(bram, async () => ({
      saldo: await rijen("select * from public.loyalty_balances"),
      regels: await rijen("select id from public.loyalty_transactions"),
      verzoeken: await rijen("select id from public.redemption_requests"),
      functie: await een<{ punten: number }>("select public.loyalty_available_points($1::uuid) as punten", [noord]),
    }));
    expect(beeld.saldo).toHaveLength(0);
    expect(beeld.regels).toHaveLength(0);
    expect(beeld.verzoeken).toHaveLength(0);
    expect(beeld.functie.punten).toBe(0);

    await expect(vraagAan(bram, noord, 500)).rejects.toThrow(/Geen toegang/);
  });

  it("blijven zijn gespaarde punten bij de school", async () => {
    expect(await grootboek(noord)).toBe(750);
    const saldo = await als(anna, () =>
      een<{ available_points: number }>("select available_points from public.loyalty_balances"),
    );
    expect(saldo.available_points).toBe(750);
  });

  it("blijven de punten staan als zijn account helemaal wordt verwijderd", async () => {
    await db.query("delete from public.profiles where id = $1", [bram]);
    await db.query("delete from auth.users where id = $1", [bram]);

    expect(await grootboek(noord)).toBe(750);
    const vanBram = await een<{ user_id: string | null; organization_id: string; points: number }>(
      "select user_id, organization_id, points from public.loyalty_transactions where description = 'Workshop Graffiti'",
    );
    expect(vanBram).toEqual({ user_id: null, organization_id: noord, points: 400 });
  });

  it("weet de boeking nog steeds wie hem had aangevraagd", async () => {
    const boeking = await een<{ contact_email: string; contact_name: string }>(
      "select contact_email, contact_name from public.bookings where workshop_name = 'Workshop Graffiti'",
    );
    expect(boeking).toEqual({ contact_email: "bram@zw-noord.test", contact_name: "Bram Jansen" });
  });

  it("neemt een nieuwe collega het saldo gewoon over", async () => {
    eva = await maakGebruiker("eva@zw-noord.test", "Eva Bakker", noord);
    const saldo = await als(eva, () =>
      een<{ available_points: number }>("select available_points from public.loyalty_balances"),
    );
    expect(saldo.available_points).toBe(750);
  });

  it("kan ook de tweede collega van dezelfde locatie vertrekken", async () => {
    // Dit liep eerder vast: er mocht per locatie maar één account zonder
    // eigenaar bestaan, dus de tweede vertrekker kon niet worden verwijderd.
    await db.query("delete from public.profiles where id = $1", [anna]);
    await db.query("delete from auth.users where id = $1", [anna]);

    expect(await grootboek(noord)).toBe(750);
    const saldo = await als(eva, () =>
      een<{ available_points: number; enrolled_at: string }>(
        "select available_points, enrolled_at from public.loyalty_balances",
      ),
    );
    expect(saldo.available_points).toBe(750);
  });

  it("blijft het startmoment van de locatie dat van de eerste collega", async () => {
    const start = await een<{ gelijk: boolean }>(
      `select (select enrolled_at from public.loyalty_balances where organization_id = $1)
            = (select min(enrolled_at) from public.loyalty_accounts where organization_id = $1) as gelijk`,
      [noord],
    );
    expect(start.gelijk).toBe(true);
    const zonderEigenaar = await een<{ aantal: number }>(
      "select count(*)::int as aantal from public.loyalty_accounts where organization_id = $1 and user_id is null",
      [noord],
    );
    expect(zonderEigenaar.aantal).toBe(2);
  });

  it("kan Eva een verzoek doen op punten die haar voorgangers spaarden", async () => {
    const verzoek = await vraagAan(eva, noord, 500);
    expect(verzoek.status).toBe("requested");
    expect(await grootboek(noord)).toBe(250);
    await als(eva, () => rijen("select public.cancel_redemption($1::uuid, 'Toch niet')", [verzoek.id]));
    expect(await grootboek(noord)).toBe(750);
  });
});

describe("de CJP-bonus op een locatie met meerdere contactpersonen", () => {
  it("geeft de locatie één bonus, niet één per collega", async () => {
    // Op Zuid komt een tweede collega bij. Eerder liep het bevestigen dan vast,
    // omdat de bonus voor elk account van de locatie apart werd geboekt.
    await maakGebruiker("frank@zw-zuid.test", "Frank Mulder", zuid);
    const voor = await grootboek(zuid);

    const aanvraag = await een<{ id: string }>(
      `insert into public.cjp_parking_requests
         (organization_id, school_name, cjp_school_number, holder_name, holder_email, amount_cents, requested_by)
       values ($1, 'Stichting Zuidwest, locatie Zuid', '123456', 'Carla Smit', 'carla@zw-zuid.test', 150000, $2)
       returning id`,
      [zuid, carla],
    );
    await db.query("select public.confirm_cjp_parking($1::uuid, $2::uuid, 'Bedrag ontvangen')", [
      aanvraag.id,
      beheerder,
    ]);

    const bonussen = await rijen<{ points: number }>(
      "select points from public.loyalty_transactions where organization_id = $1 and type = 'cjp_bonus'",
      [zuid],
    );
    expect(bonussen).toEqual([{ points: 1000 }]);
    expect(await grootboek(zuid)).toBe(voor + 1000);

    // Terugzetten, zodat de tests hierna met hetzelfde saldo rekenen.
    await db.query("update public.loyalty_transactions set status = 'cancelled' where organization_id = $1 and type = 'cjp_bonus'", [zuid]);
    expect(await grootboek(zuid)).toBe(voor);
  });
});

describe("verval per locatie", () => {
  it("laat verlopen punten van het locatiesaldo af gaan", async () => {
    // Op Zuid spaart Carla 300 punten die gisteren zijn verlopen.
    const boeking = await maakBoeking({
      organisatie: zuid,
      contactEmail: "carla@zw-zuid.test",
      contactNaam: "Carla Smit",
      workshop: "Workshop Rap",
    });
    await kenToe({
      organisatie: zuid,
      gebruiker: carla,
      type: "earn_workshop",
      punten: 300,
      omschrijving: "Workshop Rap",
      verwijzing: `booking:${boeking}`,
      boekingId: boeking,
      verlooptOverDagen: -1,
    });
    expect(await grootboek(zuid)).toBe(400);

    const verwerkt = await een<{ aantal: number }>("select public.expire_loyalty_points() as aantal");
    expect(verwerkt.aantal).toBe(1);
    expect(await grootboek(zuid)).toBe(100);

    const saldo = await een<{ available_points: number; expired_points: number }>(
      "select available_points, expired_points from public.loyalty_balances where organization_id = $1",
      [zuid],
    );
    expect(saldo).toEqual({ available_points: 100, expired_points: 300 });
  });

  it("doet een tweede ronde op dezelfde dag niets extra", async () => {
    await db.query("select public.expire_loyalty_points()");
    expect(await grootboek(zuid)).toBe(100);
  });

  it("laat de andere locatie met rust", async () => {
    expect(await grootboek(noord)).toBe(750);
  });

  it("bewaart de oorspronkelijke toekenning in de geschiedenis", async () => {
    const regels = await rijen<{ type: string; status: string; points: number }>(
      "select type, status, points from public.loyalty_transactions where organization_id = $1 and description in ('Workshop Rap', 'SkoolPoints verlopen') order by points desc",
      [zuid],
    );
    expect(regels).toEqual([
      { type: "earn_workshop", status: "expired", points: 300 },
      { type: "expiry", status: "expired", points: -300 },
    ]);
  });
});

describe("de migratie zelf", () => {
  it("weigert als dezelfde toekenning al twee keer bij één locatie staat, en wijzigt dan niets", async () => {
    const oud = await nieuweDatabase("20261112120000_moneybird_contact_per_locatie.sql");
    const q = async <T>(sql: string, params: unknown[] = []) => (await oud.query<T>(sql, params)).rows;

    const locatie = (
      await q<{ id: string }>(
        "insert into public.organizations (name, slug) values ('Locatie met dubbele bonus', 'dubbel') returning id",
      )
    )[0].id;
    for (const mail of ["een@dubbel.test", "twee@dubbel.test"]) {
      const gebruiker = (await q<{ id: string }>("insert into auth.users (email) values ($1) returning id", [mail]))[0].id;
      await q("insert into public.profiles (id, email, full_name) values ($1, $2, $2) on conflict (id) do nothing", [
        gebruiker,
        mail,
      ]);
      const account = (
        await q<{ id: string }>("select public.ensure_loyalty_account($1::uuid, $2::uuid) as id", [locatie, gebruiker])
      )[0].id;
      await q(
        `insert into public.loyalty_transactions (organization_id, user_id, account_id, type, status, points, description, external_reference)
         values ($1, $2, $3, 'welcome_bonus', 'available', 100, 'Welkomstbonus', 'welcome')`,
        [locatie, gebruiker, account],
      );
    }

    const migratie = await readFile(
      path.join(process.cwd(), "supabase", "migrations", "20261112130000_punten_per_schoollocatie.sql"),
      "utf8",
    );
    await expect(oud.exec(migratie)).rejects.toThrow(/Migratie 045 gestopt: 1 toekenning/);
    await oud.exec("rollback");

    // Niets gewijzigd: de weergave rekent nog per persoon en de beide regels staan er nog.
    const kolommen = await q<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'loyalty_balances'",
    );
    expect(kolommen.map((k) => k.column_name)).toContain("user_id");
    const regels = await q("select id from public.loyalty_transactions where organization_id = $1", [locatie]);
    expect(regels).toHaveLength(2);
    await oud.close();
  }, 120_000);

  it("is terug te draaien, en daarna opnieuw uit te voeren", async () => {
    const schoon = await nieuweDatabase();
    const kolommen = async () =>
      (
        await schoon.query<{ column_name: string }>(
          "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'loyalty_balances'",
        )
      ).rows.map((rij) => rij.column_name);
    const index = async (naam: string) =>
      (await schoon.query<{ indexdef: string }>("select indexdef from pg_indexes where indexname = $1", [naam])).rows;

    expect(await kolommen()).not.toContain("user_id");

    await schoon.exec(await readFile(path.join(process.cwd(), "supabase", "terugdraaien-044-045.sql"), "utf8"));
    expect(await kolommen()).toContain("user_id");
    expect(await index("organization_contacts_moneybird_uniek")).toHaveLength(0);
    expect((await index("loyalty_transactions_external_key"))[0].indexdef).toMatch(/user_id/);
    expect(
      (await schoon.query("select 1 from pg_proc where proname = 'loyalty_location_points'")).rows,
    ).toHaveLength(0);

    for (const bestand of [
      "20261112120000_moneybird_contact_per_locatie.sql",
      "20261112130000_punten_per_schoollocatie.sql",
    ]) {
      await schoon.exec(await readFile(path.join(process.cwd(), "supabase", "migrations", bestand), "utf8"));
    }
    expect(await kolommen()).not.toContain("user_id");
    expect(await index("organization_contacts_moneybird_uniek")).toHaveLength(1);
    await schoon.close();
  }, 120_000);

  it("kan zonder bezwaar twee keer worden gedraaid", async () => {
    const migratie = await readFile(
      path.join(process.cwd(), "supabase", "migrations", "20261112130000_punten_per_schoollocatie.sql"),
      "utf8",
    );
    await db.exec(migratie);
    expect(await grootboek(noord)).toBe(750);
    const regels = await rijen("select organization_id from public.loyalty_balances");
    expect(regels).toHaveLength(2);
  });
});
