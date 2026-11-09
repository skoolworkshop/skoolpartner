/**
 * Stubs voor de visuele controle: geen server, alleen de beginstand.
 *
 * De harness bundelt de echte componenten, en die importeren serveracties.
 * Die kunnen hier niet draaien, dus ze worden vervangen door iets wat niets
 * doet. De opmaak blijft daarmee wel de echte.
 */
const niets = async () => ({ status: "idle" as const });

export const submitParkingRequest = niets;
export const kiesMerk = async () => {};

export const setRelatieProfielAction = niets;
export const markeerContactAction = niets;
export const bewaarContactAction = niets;
export const bewaarPeriodeAction = niets;
export const meldDeelnemerAanAction = niets;
export const zetFaseAction = niets;
export const bewaarBetalingAction = niets;
export const verplaatsNaarPeriodeAction = niets;

export const legActiviteitVastAction = niets;
export const maakTaakAction = niets;
export const zetTaakAfAction = niets;
export const maakDealAction = niets;
export const werkDealBijAction = niets;
export const maakBoekingVanDealAction = niets;
export const bewaarFragmentAction = niets;
export const archiveerFragmentAction = niets;
export const legFragmentGebruikVastAction = async () => {};
export const bewaarAfspraakAction = niets;
export const zetAfspraakStandAction = niets;
export const bewaarBoekingsLinkAction = niets;
export const zetBoekingsLinkAanAction = niets;

// Slepen in de pijplijn. In de visuele controle draait er geen server, dus dit
// zegt altijd dat het goed ging; de kaart blijft liggen waar je hem laat vallen.
export const verplaatsDealAction = async () => ({ ok: true as const });

// De serveracties van het inschrijfbeheer.
export const maakDagAction = niets;
export const bewaarDagAction = niets;
export const zetStatusAction = niets;
export const voegRondeToeAction = niets;
export const verwijderRondeAction = niets;
export const voegWorkshopToeAction = niets;
export const bewaarWorkshopAction = niets;
export const verwijderWorkshopAction = niets;
export const voegGroepenToeAction = niets;
export const verwijderGroepAction = niets;
export const bewaarLijstAction = niets;
export const bewaarRondeAction = niets;
export const kopieerRondeAction = niets;
export const bewaarUitvoeringAction = niets;
export const zetUitvoeringAction = niets;
export const voegUitvoeringToeAction = niets;
export const verwijderUitvoeringAction = niets;
export const zetKlassenAction = niets;

// Het inschrijfsysteem: één deelnemer opzoeken en bijwerken.
export const zoekDeelnemersAction = async () => [];
export const zetVrijstellingAction = niets;
export const nieuweCodeAction = niets;
export const verwijderDeelnemerAction = niets;

// Afronden: indelen, lijsten, toegang en bevestigingen.
export const bewaarAppInfoAction = niets;
export const bekijkIndelingAction = async () => null;
export const bevestigIndelingAction = niets;
export const bekijkMailAction = async () => null;
export const verstuurLijstenAction = niets;
export const maakToegangAction = niets;
export const trekToegangInAction = niets;
export const verstuurBevestigingenAction = niets;

// Het rooster in één keer aanmaken.
export const genereerRondesAction = niets;
export const voegWorkshopsToeAction = niets;
export const nieuweLinkAction = niets;
