import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/session";

/**
 * Waar komt iemand terecht na het inloggen?
 *
 *  1. beheerders zonder organisatie gaan naar de beheeromgeving. Zij hoeven
 *     niet te kiezen bij welke school ze horen.
 *  2. iedereen met een organisatie gaat naar het dashboard
 *  3. wie een aanvraag heeft lopen, ziet de wachtpagina
 *  4. en pas als er echt niets is, komt de vraag bij welke organisatie je hoort
 */
export default async function HomePage() {
  const session = await getSessionContext();
  if (!session) redirect("/inloggen");

  if (session.isAdmin) redirect("/admin");
  if (session.memberships.length > 0) redirect("/dashboard");
  if (session.pendingMemberships.length > 0) redirect("/wachten");
  redirect("/aanmelden");
}
