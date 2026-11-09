import { renderToStaticMarkup } from "react-dom/server";
import "@/app/globals.css";

import { Harness as Diagnose } from "./diagnose-harness";
import { Harness as Inschrijving } from "./inschrijving-harness";
import { Harness as Klant } from "./klant-harness";
import { Harness as Leerling } from "./leerling-harness";

/**
 * Welke harness gerenderd wordt, kies je met de omgevingsvariabele HARNESS.
 * Zonder die variabele blijft het de diagnoseharness.
 *
 *   npm run visueel               de diagnose
 *   npm run visueel:inschrijving  het scherm van een inschrijfdag
 *   npm run visueel:leerling      de inschrijfpagina voor een leerling
 *   npm run visueel:klant         de online indeling voor de school
 *
 * De CRM-harnessen zijn weg omdat de CRM zelf weg is. Nieuwe schermen krijgen
 * hier hun eigen harness, zodat je ze op 1280 en 390 pixels kunt bekijken
 * zonder de hele app te starten.
 */
const harnessen = {
  diagnose: Diagnose,
  inschrijving: Inschrijving,
  leerling: Leerling,
  klant: Klant,
};
const gekozen = (process.env.HARNESS ?? "diagnose") as keyof typeof harnessen;
const Harness = harnessen[gekozen] ?? Diagnose;

export const html = renderToStaticMarkup(<Harness />);
