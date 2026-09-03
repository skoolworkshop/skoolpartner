# CRM-workflows: technische analyse

Deze analyse beschrijft alleen wat technisch aanwezig is en welke vorm veilig
bij het huidige CRM past. Er zijn nog geen workflows, triggers of acties
aangemaakt. De inhoud van HubSpot is daarvoor eerst nodig.

## Wat al aanwezig is

- CRM-objecten voor contacten, organisaties, deals, taken en afspraken.
- Een expliciete dealfasehistorie in `crm_deal_events`.
- Een tijdlijn voor handmatige en systeemactiviteiten.
- Templates en fragmenten met één gedeeld personalisatiesysteem.
- Sequences die stappen klaarzetten, maar nooit zelfstandig e-mail versturen.
- Auditregistratie voor belangrijke beheermutaties.
- Merkgrenzen voor Skool Workshop en Suri Impact.
- Serveractions met admincontrole als enige schrijvende applicatieroute.

Er is nog geen workflowdefinitie, versiebeheer, uitvoeringslog, wachtrij,
idempotentiesleutel of veilige herstartlogica. De bestaande cronroutes zijn voor
andere processen en vormen geen workflow-engine.

## Structuur die logisch aansluit

Een toekomstige workflow hoort uit vier gescheiden delen te bestaan:

1. Een versieerbare definitie met merk, status en beschrijving.
2. Eén trigger met expliciete voorwaarden.
3. Een geordende lijst interne acties.
4. Een uitvoeringslog met brongebeurtenis, uitkomst en idempotentiesleutel.

Concept, test en actief moeten afzonderlijke statussen zijn. Een wijziging aan
een actieve workflow hoort een nieuwe versie te maken, zodat oude uitvoeringen
later uitlegbaar blijven. Een dry-run moet vooraf tonen welke records geraakt
zouden worden.

## Triggers die technisch veilig te ondersteunen zijn

Pas na vergelijking met de HubSpot-export zijn onder meer deze soorten
technisch passend:

- een handmatige start door een beheerder;
- een deal die van fase verandert;
- een taak of afspraak die een expliciete status krijgt;
- een contactveld dat bewust door een beheerder wordt gewijzigd;
- een sequence die handmatig is afgerond of gestopt.

Tijd, herhaling en vrije combinaties van voorwaarden vragen eerst om een echte
uitvoeringswachtrij en bescherming tegen dubbel uitvoeren.

## Acties die veilig begrensd kunnen worden

- een interne taak klaarzetten;
- een interne tijdlijnregel vastleggen;
- een concept of herinnering voor een beheerder klaarzetten;
- na dezelfde toestemmingscontroles een contact aan een sequence toevoegen;
- een template of fragment als concept voorbereiden.

Een workflow mag niet zelfstandig e-mail verzenden, klantportaaltoegang
wijzigen, authenticatie aanpassen, gegevens verwijderen, boekingen bevestigen,
betalingen verwerken of databasecorrecties uitvoeren.

## Nodig vóór ontwerp of migratie

Van iedere HubSpot-workflow zijn minimaal nodig: naam, huidige status, trigger,
filters, acties, wachttijden, laatste wijziging en recent gebruik. Daarna kan per
workflow worden vastgesteld of hij actief, dubbel, verouderd of nuttig is. Pas
na die selectie is duidelijk of überhaupt nieuwe tabellen nodig zijn.
