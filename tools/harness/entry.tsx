import { renderToStaticMarkup } from "react-dom/server";
import "@/app/globals.css";

import { Harness as Diagnose } from "./diagnose-harness";
import { Harness as Crm } from "./crm-harness";
import { Harness as CrmSuri } from "./crm-suri-harness";

/**
 * Welke harness gerenderd wordt, kies je met de omgevingsvariabele HARNESS.
 * Zonder die variabele blijft het de diagnoseharness, precies zoals eerst.
 *
 *   npm run visueel               de diagnose
 *   npm run visueel:crm           het CRM-fundament
 *   npm run visueel:suri          de reisperiodes en het relatieblok
 */
const harnessen = { diagnose: Diagnose, crm: Crm, suri: CrmSuri };
const gekozen = (process.env.HARNESS ?? "diagnose") as keyof typeof harnessen;
const Harness = harnessen[gekozen] ?? Diagnose;

export const html = renderToStaticMarkup(<Harness />);
