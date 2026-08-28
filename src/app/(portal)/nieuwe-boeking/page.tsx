import type { Metadata } from "next";

import { HubSpotBookingForm } from "@/components/portal/hubspot-booking-form";
import { PageHeader } from "@/components/portal/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Nieuwe workshop aanvragen" };

export default async function NewBookingPage() {
  await requireMember();

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
          <HubSpotBookingForm />
        </CardBody>
      </Card>
    </>
  );
}
