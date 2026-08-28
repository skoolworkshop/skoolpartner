# SkoolPartner verificatiemail instellen

Deze template wordt door Supabase verstuurd. Daarom moet hij één keer in het
Supabase-dashboard worden geplakt; alleen deployen naar Vercel verandert de
hosted e-mailtemplate niet.

1. Open **Supabase → Authentication → Email Templates → Magic Link**.
2. Gebruik als onderwerp de inhoud van `magic-link-subject.txt`.
3. Plak `magic-link.html` als berichtinhoud en sla op.
4. Controleer bij **URL Configuration** dat `https://mijn.skoolworkshop.nl/**`
   als toegestane redirect-URL staat.
5. Zet bij de SMTP-provider linktracking uit; herschreven verificatielinks
   kunnen een eenmalige link onbruikbaar maken.

Dezelfde mail bevat bewust zowel `{{ .Token }}` als `{{ .ConfirmationURL }}`:
de code is het hoofdpad, de link is een alternatief.
