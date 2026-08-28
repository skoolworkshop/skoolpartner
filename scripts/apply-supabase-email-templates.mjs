import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const dryRun = process.argv.includes("--dry-run");

if (!projectRef || !/^[a-z0-9]{10,40}$/.test(projectRef)) {
  console.error("Vul SUPABASE_PROJECT_REF in, bijvoorbeeld wksjlkptnbkupkqtoiqk.");
  process.exit(1);
}
if (!accessToken && !dryRun) {
  console.error("Vul SUPABASE_ACCESS_TOKEN in met een persoonlijk Supabase access token.");
  process.exit(1);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const templateDirectory = path.resolve(scriptDirectory, "..", "supabase", "email-templates");

const definitions = [
  ["confirmation", "confirm-signup"],
  ["invite", "invite-user"],
  ["magic_link", "magic-link"],
  ["recovery", "recovery"],
  ["email_change", "change-email"],
  ["reauthentication", "reauthentication"],
];

const securityDefinitions = [
  ["password_changed", "password-changed-notification"],
  ["email_changed", "email-changed-notification"],
  ["phone_changed", "phone-changed-notification"],
  ["mfa_factor_enrolled", "mfa-enrolled-notification"],
  ["mfa_factor_unenrolled", "mfa-unenrolled-notification"],
  ["identity_linked", "identity-linked-notification"],
  ["identity_unlinked", "identity-unlinked-notification"],
];

const payload = {};
for (const [supabaseName, fileName] of definitions) {
  payload[`mailer_subjects_${supabaseName}`] = (
    await readFile(path.join(templateDirectory, `${fileName}-subject.txt`), "utf8")
  ).trim();
  payload[`mailer_templates_${supabaseName}_content`] = await readFile(
    path.join(templateDirectory, `${fileName}.html`),
    "utf8"
  );
}
for (const [supabaseName, fileName] of securityDefinitions) {
  payload[`mailer_notifications_${supabaseName}_enabled`] = true;
  payload[`mailer_subjects_${supabaseName}_notification`] = (
    await readFile(path.join(templateDirectory, `${fileName}-subject.txt`), "utf8")
  ).trim();
  payload[`mailer_templates_${supabaseName}_notification_content`] = await readFile(
    path.join(templateDirectory, `${fileName}.html`),
    "utf8"
  );
}

if (dryRun) {
  console.log(`Controle geslaagd: ${definitions.length + securityDefinitions.length} templates en ${Object.keys(payload).length} Supabase-instellingen zijn voorbereid.`);
  process.exit(0);
}

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

if (!response.ok) {
  const detail = await response.text();
  console.error(`Supabase weigerde de wijziging (${response.status}).`);
  console.error(detail.slice(0, 1000));
  process.exit(1);
}

console.log(
  `Alle ${definitions.length + securityDefinitions.length} Supabase-authenticatie- en beveiligingsmails zijn bijgewerkt voor ${projectRef}.`
);
console.log("Vraag nu een nieuwe inlogmail aan om de code en vormgeving te controleren.");
