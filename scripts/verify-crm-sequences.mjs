/**
 * Controleert de databasekant van de templates en de sequences.
 *
 * Wat alleen een echte Postgres kan aantonen:
 *
 *   1. Migratie 038 raakt geen bestaande tabel aan.
 *   2. Een template is pas een template met een onderwerp en een tekst.
 *   3. Een naam komt maar een keer voor, ook bij een template voor beide merken.
 *   4. Een stap is compleet: mail heeft een bericht, een taak heeft een titel.
 *   5. Iemand zit maar een keer tegelijk in dezelfde reeks.
 *   6. Stoppen kan niet zonder reden.
 *   7. Een template dat in een reeks wordt gebruikt, kan niet zomaar weg.
 *   8. Het klantportaal kan er niet bij.
 *
 *   node scripts/verify-crm-sequences.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const MIGRATIE = "20260903100000_crm_templates_en_sequences.sql";

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
alter default privileges in schema public grant all on tables to anon, authenticated;
`;

const SCHOOL = "22222222-2222-2222-2222-222222222222";
const CONTACT = "33333333-3333-3333-3333-333333333333";

let fouten = 0;
function check(goed, tekst) {
  console.log(`  ${goed ? "ok  " : "FOUT"} ${tekst}`);
  if (!goed) fouten += 1;
}

async function een(db, sql) {
  return (await db.query(sql)).rows[0];
}

async function moetFalen(db, sql) {
  try {
    await db.exec(sql);
    return null;
  } catch (error) {
    return error.message;
  }
}

async function schemaFoto(db, negeer = []) {
  const uitzondering = negeer.length
    ? `and table_name not in (${negeer.map((t) => `'${t}'`).join(", ")})`
    : "";
  const kolommen = (
    await db.query(
      `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public' ${uitzondering}
       order by table_name, column_name`
    )
  ).rows;
  const policies = (
    await db.query(
      `select tablename, policyname, cmd, qual, with_check
       from pg_policies where schemaname = 'public' order by tablename, policyname`
    )
  ).rows;
  return { kolommen, policies };
}

async function main() {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const alle = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const index = alle.indexOf(MIGRATIE);
  if (index === -1) {
    console.error(`\n  FOUT: ${MIGRATIE} staat niet in supabase/migrations.\n`);
    process.exitCode = 1;
    return;
  }

  for (const file of alle.slice(0, index)) {
    try {
      await db.exec(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      console.error(`\n  FOUT in ${file}\n       ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`\n  ${index} migraties geladen tot aan de sequences\n`);

  await db.exec(`
    insert into public.organizations (id, name, slug) values ('${SCHOOL}', 'Markenhage College', 'markenhage');
    insert into public.crm_contacts (id, organization_id, full_name, email)
      values ('${CONTACT}', '${SCHOOL}', 'Nora Bakker', 'nora@markenhage.nl');
  `);

  const voor = await schemaFoto(db);
  const voorRijen = await een(
    db,
    `select
       (select count(*)::int from public.crm_contacts) as contacten,
       (select count(*)::int from public.crm_snippets) as fragmenten,
       (select count(*)::int from public.crm_deals)    as deals`
  );

  try {
    await db.exec(await readFile(path.join(MIGRATIONS_DIR, MIGRATIE), "utf8"));
  } catch (error) {
    console.error(`\n  FOUT in ${MIGRATIE}\n       ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  console.log("  Migratie 038 geladen\n");

  // ---------------------------------------------------------------------------
  console.log("  Er verandert niets aan wat er al stond");

  const nieuweTabellen = [
    "crm_templates",
    "crm_sequences",
    "crm_sequence_steps",
    "crm_sequence_enrollments",
  ];
  const na = await schemaFoto(db, nieuweTabellen);
  check(
    JSON.stringify(voor.kolommen) === JSON.stringify(na.kolommen),
    "Geen kolom toegevoegd, verwijderd of veranderd buiten de nieuwe tabellen"
  );
  check(
    JSON.stringify(voor.policies) === JSON.stringify(na.policies),
    "Geen enkele bestaande beleidsregel is aangeraakt"
  );

  const naRijen = await een(
    db,
    `select
       (select count(*)::int from public.crm_contacts) as contacten,
       (select count(*)::int from public.crm_snippets) as fragmenten,
       (select count(*)::int from public.crm_deals)    as deals`
  );
  check(
    JSON.stringify(voorRijen) === JSON.stringify(naRijen),
    "Contacten, fragmenten en deals zijn onaangeroerd"
  );

  const leeg = await een(
    db,
    `select
       (select count(*)::int from public.crm_templates) as templates,
       (select count(*)::int from public.crm_sequences) as reeksen`
  );
  check(
    leeg.templates === 0 && leeg.reeksen === 0,
    "De migratie vult niets: wat erin komt, komt uit de export"
  );

  // ---------------------------------------------------------------------------
  console.log("\n  Een template is een heel bericht");

  const zonderOnderwerp = await moetFalen(
    db,
    `insert into public.crm_templates (name, subject, body)
     values ('Zonder onderwerp', '', 'Beste school,')`
  );
  check(Boolean(zonderOnderwerp), "Een template zonder onderwerp wordt geweigerd");

  const zonderTekst = await moetFalen(
    db,
    `insert into public.crm_templates (name, subject, body)
     values ('Zonder tekst', 'Je offerte', '  ')`
  );
  check(Boolean(zonderTekst), "Een template zonder tekst wordt geweigerd");

  const goed = await moetFalen(
    db,
    `insert into public.crm_templates (id, name, subject, body) values
       ('11111111-0000-0000-0000-000000000001', 'Offerte nabellen', 'Je offerte voor {{organisatie}}', 'Beste {{voornaam}},'),
       ('11111111-0000-0000-0000-000000000002', 'Bedankt na de dag', 'Bedankt voor de workshopdag', 'Beste {{voornaam}},')`
  );
  check(!goed, "Twee gewone templates kunnen worden vastgelegd");

  const dubbelBeide = await moetFalen(
    db,
    `insert into public.crm_templates (name, subject, body)
     values ('offerte nabellen', 'Nog een keer', 'Beste,')`
  );
  check(
    Boolean(dubbelBeide),
    "Dezelfde naam voor beide merken kan niet twee keer, ook niet met andere hoofdletters"
  );

  const zelfdeNaamAnderMerk = await moetFalen(
    db,
    `insert into public.crm_templates (brand, name, subject, body)
     values ('suri_impact', 'Offerte nabellen', 'Voor Suri', 'Beste,')`
  );
  check(!zelfdeNaamAnderMerk, "Dezelfde naam mag wel voor een specifiek merk");

  // ---------------------------------------------------------------------------
  console.log("\n  Een stap is compleet of hij bestaat niet");

  await db.exec(
    `insert into public.crm_sequences (id, brand, name)
     values ('22222222-0000-0000-0000-000000000001', 'skool_workshop', 'Offerte opvolgen')`
  );

  const mailZonderBericht = await moetFalen(
    db,
    `insert into public.crm_sequence_steps (sequence_id, position, kind)
     values ('22222222-0000-0000-0000-000000000001', 1, 'email')`
  );
  check(Boolean(mailZonderBericht), "Een e-mailstap zonder template wordt geweigerd");

  const taakZonderTitel = await moetFalen(
    db,
    `insert into public.crm_sequence_steps (sequence_id, position, kind)
     values ('22222222-0000-0000-0000-000000000001', 2, 'taak')`
  );
  check(Boolean(taakZonderTitel), "Een taakstap zonder omschrijving wordt geweigerd");

  const stappen = await moetFalen(
    db,
    `insert into public.crm_sequence_steps (sequence_id, position, wait_days, kind, template_id, title) values
       ('22222222-0000-0000-0000-000000000001', 1, 0, 'email', '11111111-0000-0000-0000-000000000001', null),
       ('22222222-0000-0000-0000-000000000001', 2, 5, 'bellen', null, 'Nabellen over de offerte')`
  );
  check(!stappen, "Een reeks van een mail en een belafspraak kan worden vastgelegd");

  const dubbelePositie = await moetFalen(
    db,
    `insert into public.crm_sequence_steps (sequence_id, position, kind, title)
     values ('22222222-0000-0000-0000-000000000001', 2, 'taak', 'Nog een tweede stap')`
  );
  check(Boolean(dubbelePositie), "Twee stappen op dezelfde plek in de reeks worden geweigerd");

  const teLangWachten = await moetFalen(
    db,
    `insert into public.crm_sequence_steps (sequence_id, position, wait_days, kind, title)
     values ('22222222-0000-0000-0000-000000000001', 3, 400, 'taak', 'Over een jaar nog eens')`
  );
  check(Boolean(teLangWachten), "Meer dan een jaar wachten wordt geweigerd, dat is een typefout");

  const templateWeg = await moetFalen(
    db,
    `delete from public.crm_templates where id = '11111111-0000-0000-0000-000000000001'`
  );
  check(
    Boolean(templateWeg),
    "Een template dat in een reeks wordt gebruikt, kan niet worden verwijderd"
  );

  // ---------------------------------------------------------------------------
  console.log("\n  Niemand zit twee keer in dezelfde reeks");

  const eerste = await moetFalen(
    db,
    `insert into public.crm_sequence_enrollments (sequence_id, contact_id)
     values ('22222222-0000-0000-0000-000000000001', '${CONTACT}')`
  );
  check(!eerste, "Een contact kan in een reeks worden gezet");

  const tweede = await moetFalen(
    db,
    `insert into public.crm_sequence_enrollments (sequence_id, contact_id)
     values ('22222222-0000-0000-0000-000000000001', '${CONTACT}')`
  );
  check(Boolean(tweede), "Hetzelfde contact er een tweede keer bij zetten wordt geweigerd");

  const stopZonderReden = await moetFalen(
    db,
    `update public.crm_sequence_enrollments
     set status = 'gestopt', finished_at = now()
     where contact_id = '${CONTACT}'`
  );
  check(Boolean(stopZonderReden), "Stoppen zonder reden wordt geweigerd");

  const stopMetReden = await moetFalen(
    db,
    `update public.crm_sequence_enrollments
     set status = 'gestopt', stop_reason = 'School heeft telefonisch afgezegd', finished_at = now()
     where contact_id = '${CONTACT}'`
  );
  check(!stopMetReden, "Stoppen met een reden kan wel");

  const opnieuw = await moetFalen(
    db,
    `insert into public.crm_sequence_enrollments (sequence_id, contact_id)
     values ('22222222-0000-0000-0000-000000000001', '${CONTACT}')`
  );
  check(!opnieuw, "Na afloop kan iemand later opnieuw in dezelfde reeks");

  // ---------------------------------------------------------------------------
  console.log("\n  Opruimen laat niets zweven");

  await db.exec(`delete from public.crm_contacts where id = '${CONTACT}'`);
  const naVerwijderen = await een(
    db,
    `select count(*)::int as n from public.crm_sequence_enrollments`
  );
  check(naVerwijderen.n === 0, "Een verwijderd contact laat geen deelname achter");

  // ---------------------------------------------------------------------------
  console.log("\n  Het klantportaal kan er niet bij");

  for (const tabel of nieuweTabellen) {
    const rechten = await een(
      db,
      `select count(*)::int as n from information_schema.role_table_grants
       where table_schema = 'public' and table_name = '${tabel}'
         and grantee in ('anon', 'authenticated')`
    );
    check(rechten.n === 0, `anon en authenticated hebben geen enkel recht op ${tabel}`);

    const rls = await een(
      db,
      `select relrowsecurity, relforcerowsecurity from pg_class where relname = '${tabel}'`
    );
    check(
      rls.relrowsecurity === true && rls.relforcerowsecurity === true,
      `${tabel} heeft RLS aan en afgedwongen`
    );

    const policies = await een(
      db,
      `select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = '${tabel}'`
    );
    check(policies.n === 0, `${tabel} heeft geen enkele beleidsregel, dus ook geen achterdeur`);
  }

  console.log(
    fouten === 0
      ? "\n  Alles in orde. De tabellen liggen klaar.\n"
      : `\n  ${fouten} punt(en) niet in orde.\n`
  );
  process.exitCode = fouten === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
