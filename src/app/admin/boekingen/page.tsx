import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { BookingStatusBadge } from "@/components/portal/status-badges";
import { Card, CardHeader } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { listBookings } from "@/lib/admin/queries";
import { formatShortDate } from "@/lib/format";
import { calculateBookingPoints } from "@/lib/loyalty/calc";
import { getSettings, ratesFromSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Boekingen" };

interface BookingWithOrg {
  id: string;
  workshop_name: string;
  workshop_count: number;
  minutes_per_workshop: number;
  scheduled_date: string | null;
  status: "concept" | "confirmed" | "completed" | "cancelled";
  needs_review: boolean;
  points_awarded: boolean;
  organization_id: string;
  organizations: { name: string } | null;
}

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireAdmin();
  const { filter } = await searchParams;
  const [rows, settings] = await Promise.all([
    listBookings(filter === "review" ? "review" : "all"),
    getSettings(),
  ]);
  const rates = ratesFromSettings(settings);
  const bookings = rows as unknown as BookingWithOrg[];

  return (
    <>
      <h1 className="mb-6 text-[30px]">Boekingen</h1>

      <Card>
        <CardHeader
          title={filter === "review" ? "Boekingen die controle nodig hebben" : "Alle boekingen"}
          action={
            <div className="flex gap-2 text-sm">
              <Link
                href="/admin/boekingen"
                className={filter !== "review" ? "font-semibold underline underline-offset-4" : "text-muted"}
              >
                Alles
              </Link>
              <Link
                href="/admin/boekingen?filter=review"
                className={filter === "review" ? "font-semibold underline underline-offset-4" : "text-muted"}
              >
                Controle nodig
              </Link>
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-3xl text-left text-sm">
            <thead className="border-b border-line-soft text-muted">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-semibold">Datum</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Organisatie</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Workshop</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Omvang</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Punten</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {bookings.map((booking) => {
                const points = calculateBookingPoints(
                  {
                    workshopCount: booking.workshop_count,
                    minutesPerWorkshop: booking.minutes_per_workshop,
                  },
                  rates
                );
                return (
                  <tr key={booking.id}>
                    <td className="px-5 py-2.5 whitespace-nowrap">
                      {formatShortDate(booking.scheduled_date)}
                    </td>
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/admin/organisaties/${booking.organization_id}`}
                        className="underline underline-offset-4"
                      >
                        {booking.organizations?.name ?? "—"}
                      </Link>
                    </td>
                    <td className="px-5 py-2.5">{booking.workshop_name}</td>
                    <td className="px-5 py-2.5 whitespace-nowrap text-muted">
                      {booking.workshop_count} × {booking.minutes_per_workshop} min
                    </td>
                    <td className="px-5 py-2.5 whitespace-nowrap">
                      {points.points}
                      {booking.points_awarded ? null : (
                        <span className="ml-1 text-muted">(nog niet toegekend)</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5">
                      <span className="flex gap-1">
                        <BookingStatusBadge status={booking.status} />
                        {booking.needs_review ? <Badge tone="warning">Controle</Badge> : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {bookings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted">
                    Geen boekingen gevonden.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
