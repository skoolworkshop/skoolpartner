import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/session";

export default async function HomePage() {
  const session = await getSessionContext();
  if (!session) redirect("/inloggen");
  if (session.memberships.length === 0) {
    redirect(session.pendingMemberships.length > 0 ? "/wachten" : "/aanmelden");
  }
  redirect("/dashboard");
}
