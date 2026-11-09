/**
 * Stubs voor de inschrijfpagina van een leerling.
 *
 * De harness rendert het echte scherm, maar er is geen server. Deze acties
 * doen dus niets; alleen de opmaak wordt gecontroleerd.
 */
export const codeAction = async () => ({ soort: "niets" as const });
export const zoekAction = async () => ({ soort: "niets" as const });
export const bevestigNaamAction = async () => ({ ok: false as const });
export const standAction = async () => null;
export const kiesAction = async () => ({ ok: false, stand: null });
