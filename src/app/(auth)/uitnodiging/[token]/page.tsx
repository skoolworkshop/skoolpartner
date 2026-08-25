import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { acceptInvite } from "@/lib/organizations/service";
import { Alert } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Uitnodiging" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await requireUser();

  const result = await acceptInvite({
    token,
    userId: session.userId,
    userEmail: session.email,
  });

  if (result.ok) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <h1 className="text-[28px]">Uitnodiging niet verwerkt</h1>
      <Alert tone="danger">{result.message}</Alert>
      <ButtonLink href="/aanmelden" variant="secondary">
        Zelf een organisatie kiezen
      </ButtonLink>
    </div>
  );
}
