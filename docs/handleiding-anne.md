# Een cultuurdag beheren in SkoolPartner

Voor Anne. Geen technische handelingen nodig, alleen de schermen.

Inloggen doe je op **mijn.skoolworkshop.nl** met je e-mailadres. Je krijgt een
code per mail, je vult die in, en je bent binnen. Een wachtwoord is er niet.

---

## Een schoollocatie toevoegen

Dit doe je één keer per locatie, voordat er iets anders kan.

**Organisaties → Nieuwe organisatie.** Vul de naam van de **locatie** in, niet
die van het bestuur. Heeft een stichting drie scholen, dan maak je er drie aan:
"Stichting Zuidwest, locatie Noord", "locatie Zuid", enzovoort.

Dat is geen administratieve haarkloverij. SkoolPoints worden per locatie
opgebouwd. Elke locatie heeft een eigen saldo, een eigen deelname en een eigen
contactpersoon. Twee locaties van hetzelfde bestuur delen dus nooit punten, en
dat is precies de bedoeling: de school die boekt, spaart.

### De contactpersoon

Bij de organisatie voeg je de contactpersoon toe: naam en e-mailadres. Dat is
de persoon die bij ons boekt. Eén contactpersoon hoort bij één locatie.

### De Moneybird-koppeling controleren

Bij de contactpersoon staat een veld voor het **Moneybird-contact**. Zolang dat
leeg is, haalt SkoolPartner geen enkele factuur van deze school binnen. Dat is
met opzet: wij tonen alleen de financiële gegevens van scholen die meedoen.

Zoek het contact op in Moneybird, neem het contact-ID over, en vul het in. Let
op twee dingen:

- **Eén Moneybird-contact hoort bij één locatie.** Probeer je hetzelfde contact
  bij een tweede locatie te zetten, dan weigert het systeem dat. Terecht: anders
  weet niemand bij welke school een factuur hoort.
- **Factureert een bestuur centraal voor meerdere locaties?** Dan kun je dat ene
  contact maar aan één locatie koppelen. Facturen die binnenkomen worden dan
  niet automatisch verdeeld; die komen bij "Facturen ter controle" te staan en
  wijs je zelf toe. Vraag in dat geval of de school per locatie gefactureerd kan
  worden, dat scheelt iedereen werk.

Na het koppelen haalt de volgende synchronisatie alleen de facturen van dát
contact op. Facturen van vóór de deelname leveren geen punten op; de
deelnamedatum bepaalt vanaf wanneer er gespaard wordt.

### Hoe je ziet dat het klopt

Op het dashboard staat **Facturen zonder koppeling**. Dat getal hoort nul te
zijn. Staat er iets, dan is er een factuur binnengekomen waarvan het systeem
niet zeker wist bij welke locatie hij hoort. Klik erop en wijs de juiste locatie
aan.

---

## 1. De dag klaarzetten

**Inschrijvingen → Nieuwe dag.** Kies de school, geef de dag een naam
(bijvoorbeeld Cultuurdag of CKV Dag), vul de datum en de locatie in.

De dag staat nu op **concept**. Dat betekent: alleen jij ziet hem, en de
inschrijflink doet nog niets.

## 2. De rondes

In het blok **Rondes** staat "Rooster in één keer maken". Vul in hoe laat de dag
begint, hoe lang een ronde duurt en hoeveel rondes er zijn. De pauze zet je er
met een vinkje tussen.

Een pauze telt nergens mee: er hoeft niets gekozen te worden en hij komt niet in
de controles terug. Hij staat wel gewoon op het rooster dat de leerling ziet.

Wil je er later nog eentje bij of iets aanpassen, gebruik dan "Losse ronde
toevoegen" of "Aanpassen" achter een ronde.

## 3. De workshops

In het blok **Rooster** klik je op "Workshops kiezen uit ons aanbod". Daar staat
ons hele aanbod in; vink aan wat die dag draait. Elke workshop komt automatisch
in elke ronde te staan, met het standaardmaximum.

Daarna kun je per uitvoering (een workshop in één ronde) aanpassen:

- **Maximum**: hoeveel leerlingen erin passen.
- **Ruimte en docent**: handig voor de lijsten.
- **Draait niet**: zet een uitvoering uit als die ronde niet doorgaat.
- **Alleen voor bepaalde klassen**: vink aan welke klassen erin mogen. Vink je
  niets aan, dan mag iedereen erin.

Draait een workshop twee keer naast elkaar met twee docenten, voeg dan een
tweede uitvoering toe in dezelfde ronde.

**Reken even na.** Tel de maxima van één ronde bij elkaar op. Dat getal moet
groter zijn dan het aantal leerlingen, anders blijft er een groep over zonder
workshop. Het scherm waarschuwt je ook, maar reken het zelf na: dit is het enige
dat echt misgaat op de dag zelf.

## 4. De klassen en de leerlingen

In het blok **Leerlingenlijst** sleep je het bestand van de school naar binnen.
Excel, Word, PDF of CSV, met alle klassen door elkaar of met een tabblad per
klas; het systeem zoekt het uit.

Je krijgt eerst een **voorbeeld** te zien: hoeveel leerlingen, hoeveel klassen,
welke kolommen hij heeft herkend. Klopt er iets niet, wijs de kolommen dan zelf
aan. Pas als je op bevestigen klikt, gaat er iets de database in.

Komt er een nieuwe lijst van de school, dan kun je kiezen: erbij zetten, of
vervangen. Vervangen vraagt eerst om bevestiging als er al keuzes zijn gemaakt.

## 5. Openzetten

Druk op **Inschrijving openen** in het blok Status. Het systeem controleert
eerst of het rooster klopt en of er een werkende toegangscode is. Is er nog geen
code, dan maakt hij er zelf een.

Daarna deel je twee dingen met de school, en je kunt ze in één keer kopiëren met
de knop **"Link en code kopiëren"**:

1. De **inschrijflink** van de dag.
2. De **toegangscode van de dag**, die voor de hele school hetzelfde is.

En daarbij de **persoonlijke codes** voor de mentoren: download
"Inschrijfcodes (PDF)" of "(Excel)". Dat is een lijst per klas. Die gaat naar de
mentor en verder nergens heen: op de klassenlijst met de indeling staan geen
codes.

Een leerling vult dus eerst de toegangscode van de dag in en daarna zijn eigen
code. Zo kan niemand de inschrijving van een klasgenoot doen.

**Heeft de school e-mailadressen aangeleverd?** Dan kun je bij "Gegevens van de
dag" kiezen voor "Met een cijfercode op het schooladres". De leerling kiest dan
zijn klas en naam, en krijgt een code van zes cijfers op het adres dat de school
van hem heeft. Komt hij niet bij zijn mail, dan kan hij alsnog zijn persoonlijke
code gebruiken via "Ik kan niet bij mijn schoolmail".

## 6. Terwijl de inschrijving loopt

Bovenin zie je hoeveel leerlingen helemaal klaar zijn en hoeveel er nog niets
gekozen hebben.

Belt er iemand, zoek de leerling dan op bij **Leerling zoeken**. Op naam of op
de code die iemand voorleest. Daar kun je:

- **Nieuwe code** geven aan wie de zijne kwijt is. De oude vervalt meteen.
- **Vrijstellen** wie niet meedoet. Die telt dan nergens meer mee.
- **Inschrijving vrijgeven** als iemand zich voor een ander heeft ingeschreven.
  De gemaakte keuzes blijven dan staan; die haal je apart weg als dat ook nodig
  is.
- **Verwijderen** wie helemaal niet op de lijst hoort.

Gaat er iets echt mis, bijvoorbeeld een link die op internet is beland, dan zet
je de **toegangscode uit**. Er komt dan niemand meer binnen, ook niet wie het
scherm nog open heeft staan. Alle keuzes blijven bewaard.

## 7. Afronden

Druk op **Inschrijving sluiten**. Leerlingen kunnen nu niets meer wijzigen.

1. **Automatisch indelen.** Je krijgt eerst een voorstel te zien van wie waar
   terechtkomt. Pas als je bevestigt, wordt het uitgevoerd. Wie zelf gekozen
   heeft, blijft staan waar hij staat.
2. **Lijsten versturen.** Vul de contactpersoon van de school in en klik "Mail
   bekijken". Je ziet precies wat er verstuurd wordt, met de vier bestanden als
   bijlage. Daarna versturen.
3. **Online inzage voor de school.** Maak een toegang aan voor de
   contactpersoon. Die krijgt een link en een losse code, allebei nodig. Je kunt
   hem op elk moment intrekken.
4. **Definitieve planning naar leerlingen.** Alleen als de school adressen heeft
   aangeleverd. Vooral bedoeld voor wie automatisch is ingedeeld, want die weet
   nog van niets.

## 8. Na de dag

Je hoeft niets te doen. Dertig dagen na de cultuurdag verdwijnen de namen, de
adressen, de codes en de keuzes vanzelf. De dag zelf blijft staan met zijn
rooster en workshops, zodat je altijd kunt terugkijken wat er die dag gedraaid
heeft.

Heeft een school een andere afspraak, zet dan bij "Gegevens van de dag" een
eigen datum bij **Leerlinggegevens bewaren tot**. In het scherm staat altijd in
gewone taal wanneer het gaat gebeuren.

---

## Als iets niet lukt

| Wat je ziet | Wat er aan de hand is |
| --- | --- |
| "Zet eerst minstens één ronde klaar" | De dag heeft nog geen rondes, of alleen pauzes. |
| "Het rooster klopt nog niet" | Er is een ronde waarin een klas niets kan kiezen. Het scherm zegt welke. |
| "De toegangscode van deze dag staat uit" | Zet hem weer aan bij de inschrijflink. |
| Een leerling zegt: mijn code werkt niet | Zoek hem op bij Leerling zoeken. Staat hij er niet, dan ontbreekt hij op de lijst van de school. |
| "Even wachten, er zijn te veel pogingen gedaan" | Iemand heeft te vaak een foute code ingetypt. Na tien minuten mag het weer. |
| Een leerling krijgt geen mail | Kijk of er een adres bij hem staat. Zo niet, geef hem zijn persoonlijke code. |
| Een factuur wordt niet herkend | Kijk of de contactpersoon van die locatie een Moneybird-contact heeft. Zonder koppeling halen we niets op. |
| Een factuur staat bij de verkeerde school | Dat kan niet automatisch gebeuren: we koppelen alleen op het Moneybird-contact-ID. Staat hij er toch, dan is het contact bij de verkeerde locatie ingevuld. |
| Punten worden niet toegekend | Drie gebruikelijke redenen: de contactpersoon heeft nog geen account, de boeking dateert van vóór de deelname, of de factuur is nog niet volledig betaald. |
| Een klant kan niet inloggen | Kijk of hij een actieve uitnodiging heeft en of zijn e-mailadres klopt. Een uitnodiging verloopt na veertien dagen. |

Kom je er niet uit, bel Clinten. Er gaat niets stuk: alles wat ingrijpend is
vraagt eerst om een bevestiging, en gemaakte keuzes worden nooit zomaar
weggegooid.
