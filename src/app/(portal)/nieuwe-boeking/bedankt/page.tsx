import type { Metadata } from "next";

import { BookingThankYou } from "@/components/portal/booking-thank-you";
import { requireMember } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Bedankt voor uw aanvraag" };

export default async function BookingThankYouPage() {
  const session = await requireMember();

  return (
    <BookingThankYou organizationName={session.activeMembership.organization.name} />
  );
}
