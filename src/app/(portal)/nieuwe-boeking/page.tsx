import type { Metadata } from "next";

import { HubSpotBookingForm } from "@/components/portal/hubspot-booking-form";
import { PageHeader } from "@/components/portal/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/session";
import { createServiceSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nieuwe workshop aanvragen" };

export default async function NewBookingPage() {
  const session = await requireMember();
  const service = createServiceSupabase();
  const { data: organization } = await service
    .from("organizations")
    .select(
      "name, website, address_line, street, house_number, house_number_addition, postal_code, city, cjp_school_number"
    )
    .eq("id", session.activeOrganizationId)
    .maybeSingle();

  const streetAddress = [
    organization?.street,
    [organization?.house_number, organization?.house_number_addition].filter(Boolean).join(""),
  ]
    .filter(Boolean)
    .join(" ");

  const prefill = {
    firstName: session.profile?.first_name,
    lastName: session.profile?.last_name,
    email: session.profile?.email ?? session.email,
    phone: session.profile?.phone,
    jobTitle: session.profile?.job_title,
    organizationName: organization?.name ?? session.activeMembership.organization.name,
    cjpSchoolNumber:
      session.profile?.cjp_school_number ?? organization?.cjp_school_number ?? null,
    address: organization?.address_line ?? streetAddress,
    postalCode: organization?.postal_code,
    city: organization?.city,
    website: organization?.website,
  };

  return (
    <>
      <PageHeader
        backHref="/boekingen"
        backLabel="Terug naar boekingen"
        eyebrow="Nieuwe aanvraag"
        title="Workshop aanvragen"
        description="Vul het formulier hieronder in. U blijft binnen SkoolPartner en ontvangt na verzending de gebruikelijke bevestiging."
      />

      <Card>
        <CardHeader
          title="Uw aanvraag"
          description="Velden met een sterretje zijn verplicht. Controleer uw gegevens voordat u het formulier verstuurt."
        />
        <CardBody>
          <HubSpotBookingForm prefill={prefill} />
        </CardBody>
      </Card>
    </>
  );
}
