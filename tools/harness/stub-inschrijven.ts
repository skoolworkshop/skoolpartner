/**
 * Stubs voor de inschrijfpagina van een leerling.
 *
 * De harness rendert het echte scherm, maar er is geen server. Deze acties
 * doen dus niets; alleen de opmaak wordt gecontroleerd.
 */
export const poortAction = async () => ({ ok: false as const, reden: "fout" as const });
export const codeAction = async () => ({ soort: "niets" as const });
export const mailZoekAction = async () => ({ soort: "niets" as const });
export const vraagCodeAction = async () => ({ ok: false as const, reden: "Geen server." });
export const bevestigCodeAction = async () => ({ ok: false as const, reden: "Geen server." });
export const zoekAction = async () => ({ soort: "niets" as const });
export const bevestigNaamAction = async () => ({ ok: false as const });
export const standAction = async () => null;
export const kiesAction = async () => ({ ok: false, stand: null });
