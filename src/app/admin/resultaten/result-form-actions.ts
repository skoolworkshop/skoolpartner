"use server";

import { requireAdmin } from "@/lib/auth/session";
import { createServiceSupabase } from "@/lib/supabase/server";

export interface ResultBookingOption {
  id: string;
  reference: string | null;
  workshopName: string;
  scheduledDate: string | null;
  contactEmail: string | null;
}

/**
 * Laadt uitsluitend boekingen van de gekozen organisatie. De organisatie-ID
 * uit de browser is onbetrouwbare invoer; daarom autoriseren en filteren we
 * opnieuw op de server.
 */
export async function loadResultBookingsAction(
  organizationId: string
): Promise<{ bookings: ResultBookingOption[]; error?: string }> {
  await requireAdmin();

  if (!organizationId) return { bookings: [] };

  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("bookings")
    .select("id, reference, workshop_name, scheduled_date, contact_email")
    .eq("organization_id", organizationId)
    .order("scheduled_date", { ascending: false, nullsFirst: false })
    .limit(150);

  if (error) {
    return { bookings: [], error: "De boekingen konden niet worden geladen." };
  }

  return {
    bookings: (data ?? []).map((booking) => ({
      id: booking.id,
      reference: booking.reference,
      workshopName: booking.workshop_name,
      scheduledDate: booking.scheduled_date,
      contactEmail: booking.contact_email,
    })),
  };
}
