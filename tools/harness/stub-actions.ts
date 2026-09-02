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
