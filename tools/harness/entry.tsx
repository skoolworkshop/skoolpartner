import { renderToStaticMarkup } from "react-dom/server";
import "@/app/globals.css";

import { Harness as Diagnose } from "./diagnose-harness";
import { Harness as Crm } from "./crm-harness";
import { Harness as CrmSuri } from "./crm-suri-harness";
import { Harness as CrmPijplijn } from "./crm-pijplijn-harness";
import { Harness as CrmContacten } from "./crm-contacten-harness";
import { Harness as CrmDashboard } from "./crm-dashboard-harness";
import { Harness as CrmFragmenten } from "./crm-fragmenten-harness";
import { Harness as CrmAfspraken } from "./crm-afspraken-harness";
import { Harness as CrmBoeking } from "./crm-boeking-harness";
import { Harness as CrmContact } from "./crm-contact-harness";
import { Harness as CrmOrganisatie } from "./crm-organisatie-harness";

/**
 * Welke harness gerenderd wordt, kies je met de omgevingsvariabele HARNESS.
 * Zonder die variabele blijft het de diagnoseharness, precies zoals eerst.
 *
 *   npm run visueel               de diagnose
 *   npm run visueel:crm           het CRM-fundament
 *   npm run visueel:suri          de reisperiodes en het relatieblok
 *   npm run visueel:pijplijn      de pijplijn, de taken en de tijdlijn
 *   npm run visueel:contacten     de contacten en de dealkaarten
 *   npm run visueel:dashboard     het commerciele dashboard
 *   npm run visueel:fragmenten    de fragmenten en de keuzelijst
 *   npm run visueel:afspraken     de afspraken
 *   npm run visueel:boeking       de openbare boekingspagina
 *   npm run visueel:contact      de indeling van een contactpagina
 *   npm run visueel:organisatie  de CRM-pagina van een organisatie
 */
const harnessen = {
  diagnose: Diagnose,
  crm: Crm,
  suri: CrmSuri,
  pijplijn: CrmPijplijn,
  contacten: CrmContacten,
  dashboard: CrmDashboard,
  fragmenten: CrmFragmenten,
  afspraken: CrmAfspraken,
  boeking: CrmBoeking,
  contact: CrmContact,
  organisatie: CrmOrganisatie,
};
const gekozen = (process.env.HARNESS ?? "diagnose") as keyof typeof harnessen;
const Harness = harnessen[gekozen] ?? Diagnose;

export const html = renderToStaticMarkup(<Harness />);
