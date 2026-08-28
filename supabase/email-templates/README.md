# Alle SkoolPartner-authenticatiemails instellen

Deze templates worden door Supabase verstuurd. Daarom moeten ze één keer in het
Supabase-dashboard worden geplaatst; alleen deployen naar Vercel verandert de
hosted e-mailtemplates niet.

## In één keer instellen

Maak in Supabase via **Account → Access Tokens** tijdelijk een persoonlijk
access token aan. Voer daarna in PowerShell uit:

```powershell
$env:SUPABASE_PROJECT_REF='wksjlkptnbkupkqtoiqk'
$env:SUPABASE_ACCESS_TOKEN='plak-hier-het-tijdelijke-token'
npm run auth:email-templates
Remove-Item Env:SUPABASE_ACCESS_TOKEN
```

Het token wordt niet in bestanden opgeslagen. Trek het na gebruik desgewenst
weer in via Supabase. Het script stelt alle dertien templates in, zet de
e-mail-OTP-lengte vast op **6 cijfers** en schakelt de zeven
beveiligingsmeldingen in.

| Supabase-template | Onderwerp | Bericht |
|---|---|---|
| Confirm signup | `confirm-signup-subject.txt` | `confirm-signup.html` |
| Invite user | `invite-user-subject.txt` | `invite-user.html` |
| Magic Link | `magic-link-subject.txt` | `magic-link.html` |
| Reset password | `recovery-subject.txt` | `recovery.html` |
| Change email address | `change-email-subject.txt` | `change-email.html` |
| Reauthentication | `reauthentication-subject.txt` | `reauthentication.html` |

| Beveiligingsmelding | Onderwerp | Bericht |
|---|---|---|
| Password changed | `password-changed-notification-subject.txt` | `password-changed-notification.html` |
| Email address changed | `email-changed-notification-subject.txt` | `email-changed-notification.html` |
| Phone number changed | `phone-changed-notification-subject.txt` | `phone-changed-notification.html` |
| Verification method added | `mfa-enrolled-notification-subject.txt` | `mfa-enrolled-notification.html` |
| Verification method removed | `mfa-unenrolled-notification-subject.txt` | `mfa-unenrolled-notification.html` |
| Sign-in method linked | `identity-linked-notification-subject.txt` | `identity-linked-notification.html` |
| Sign-in method removed | `identity-unlinked-notification-subject.txt` | `identity-unlinked-notification.html` |

## Handmatig instellen

Open **Supabase → Authentication → Email Templates**, kies elke rij uit de
tabel hierboven, plak onderwerp en HTML en sla iedere template afzonderlijk op.

Controleer daarna bij **URL Configuration** dat `https://mijn.skoolworkshop.nl/**`
   als toegestane redirect-URL staat.
Zet bij de SMTP-provider linktracking uit; herschreven verificatielinks
   kunnen een eenmalige link onbruikbaar maken.

De Magic Link-mail bevat bewust zowel `{{ .Token }}` als
`{{ .ConfirmationURL }}`: de code is het hoofdpad, de link is een alternatief.
De huidige SkoolPartner-app gebruikt deze template voor zowel inloggen als het
aanmaken van een account. De Change Email Address-template wordt gebruikt als
een bestaande gebruiker zijn e-mailadres wijzigt.

Na het wijzigen van de OTP-lengte moet altijd een nieuwe code worden
aangevraagd. Een eerder verstuurde code houdt zijn oude lengte.
