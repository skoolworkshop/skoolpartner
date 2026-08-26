import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";

import { PageHeader } from "@/components/portal/page-header";
import { BookingStatusBadge } from "@/components/portal/status-badges";
import { WorkshopThumb } from "@/components/portal/workshop-photo";
import { ExternalButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { requireMember } from "@/lib/auth/session";
import { formatDate, formatDuration, formatTime, relativeDay } from "@/lib/format";
import { getPastBookings, getUpcomingBookings } from "@/lib/portal/queries";
import { getSettings } from "@/lib/settings";
import { parseWorkshopImages, type WorkshopImageMap } from "@/lib/workshop-images";
import type { BookingRow } from "@/lib/types/database";

export const metadata: Metadata = { title: "Boekingen" };

function BookingRowItem({
  booking,
  ctaUrl,
  images,
}: {
  booking: BookingRow;
  ctaUrl: string;
  images: WorkshopImageMap;
}) {
  const timeRange =
    booking.start_time && booking.end_time
      ? `${formatTime(booking.start_time)}–${formatTime(booking.end_time)}`
      : null;

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <WorkshopThumb workshopName={booking.workshop_name} images={images} />
        <div className="min-w-0">
        <p className="font-display text-[17px] leading-snug">{booking.workshop_name}</p>
        <p className="mt-1 text-sm text-muted">
          {formatDate(booking.scheduled_date)}
          {timeRange ? ` · ${timeRange}` : ""}
          {booking.location ? ` · ${booking.location}` : ""}
        </p>
        <p className="mt-0.5 text-sm text-muted">
          {booking.workshop_count > 1 ? `${booking.workshop_count} workshops · ` : ""}
          {formatDuration(booking.minutes_per_workshop)}
          {booking.participants ? ` · ${booking.participants} deelnemers` : ""}
        </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-sm text-muted sm:hidden">{relativeDay(booking.scheduled_date)}</span>
        <BookingStatusBadge status={booking.status} />
        {booking.status === "completed" || booking.status === "confirmed" ? (
          <ExternalButtonLink
            href={ctaUrl}
            target="_blank"
            variant="secondary"
            size="sm"
            className="hidden sm:inline-flex"
          >
            Opnieuw aanvragen
          </ExternalButtonLink>
        ) : null}
      </div>
    </li>
  );
}

export default async function BookingsPage() {
  const session = await requireMember();
  const settings = await getSettings();
  const workshopImages = parseWorkshopImages(settings.workshop_images);
  const [upcoming, past] = await Promise.all([
    getUpcomingBookings(session.activeOrganizationId, 25),
    getPastBookings(session.activeOrganizationId, 50),
  ]);

  return (
    <>
      <PageHeader
        backHref="/dashboard"
        backLabel="Terug naar dashboard"
        eyebrow="Uw workshops"
        title="Boekingen"
        description="Alle workshops van uw organisatie, van aankomend tot afgerond."
        action={
          <ExternalButtonLink href={settings.new_booking_cta_url} target="_blank">
            {settings.new_booking_cta_label}
          </ExternalButtonLink>
        }
      />

      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Aankomende workshops"
            description="Alleen workshops waarvan de datum definitief is bevestigd."
          />
          {upcoming.length > 0 ? (
            <ul className="divide-y divide-line-soft">
              {upcoming.map((booking) => (
                <BookingRowItem
                  key={booking.id}
                  booking={booking}
                  ctaUrl={settings.new_booking_cta_url}
                  images={workshopImages}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="Geen aankomende workshops"
              description="Zodra een nieuwe boeking definitief is bevestigd, verschijnt die hier automatisch."
              action={
                <ExternalButtonLink href={settings.new_booking_cta_url} target="_blank">
                  {settings.new_booking_cta_label}
                </ExternalButtonLink>
              }
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Eerdere boekingen" />
          {past.length > 0 ? (
            <ul className="divide-y divide-line-soft">
              {past.map((booking) => (
                <BookingRowItem
                  key={booking.id}
                  booking={booking}
                  ctaUrl={settings.new_booking_cta_url}
                  images={workshopImages}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="Nog geen eerdere boekingen"
              description="SkoolPartner toont boekingen vanaf de start van het portaal. Oudere workshops staan hier niet automatisch bij."
            />
          )}
        </Card>
      </div>
    </>
  );
}
