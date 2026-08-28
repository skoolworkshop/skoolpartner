"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Skeleton } from "@/components/ui/feedback";

const TARGET_ID = "hubspot-new-booking-form";
const FORM_ID = "cf6c7f07-c534-4859-bc01-c79700b78330";

export type HubSpotBookingPrefill = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  organizationName?: string | null;
  cjpSchoolNumber?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  website?: string | null;
};

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type HubSpotFormHandle =
  | HTMLElement
  | {
      0?: HTMLElement;
      get?(index: number): HTMLElement | undefined;
    };

const HUBSPOT_FIELD_NAMES: Record<keyof HubSpotBookingPrefill, string[]> = {
  firstName: ["firstname", "first_name", "voornaam"],
  lastName: ["lastname", "last_name", "achternaam"],
  email: ["email", "e_mail"],
  phone: ["phone", "mobilephone", "telefoonnummer", "telefoon"],
  jobTitle: ["jobtitle", "job_title", "functie"],
  organizationName: [
    "company",
    "organization_name",
    "organisation_name",
    "naam_organisatie",
    "schoolnaam",
    "school",
  ],
  cjpSchoolNumber: [
    "cjp_schoolnummer",
    "cjp_school_number",
    "cjp_nummer",
    "cjp_number",
  ],
  address: ["address", "street_address", "adres"],
  postalCode: ["zip", "postal_code", "postcode"],
  city: ["city", "plaats"],
  website: ["website", "website_url"],
};

function resolveFormElement(form: HubSpotFormHandle): HTMLElement | null {
  if (form instanceof HTMLElement) return form;
  return form.get?.(0) ?? form[0] ?? null;
}

/**
 * HubSpot gebruikt interne veldnamen. Per gegeven proberen we de gangbare
 * Nederlandse en standaardnamen. De velden blijven gewone, bewerkbare inputs.
 */
function prefillForm(form: HubSpotFormHandle, values: HubSpotBookingPrefill) {
  const root = resolveFormElement(form);
  if (!root) return;

  for (const [key, names] of Object.entries(HUBSPOT_FIELD_NAMES) as [
    keyof HubSpotBookingPrefill,
    string[],
  ][]) {
    const value = values[key]?.trim();
    if (!value) continue;

    for (const name of names) {
      const field = root.querySelector<FormControl>(`[name="${name}"]`);
      if (!field) continue;
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      break;
    }
  }
}

type HubSpotWindow = Window & {
  hbspt?: {
    forms: {
      create(config: {
        region: "eu1";
        portalId: string;
        formId: string;
        target: string;
        locale?: "nl";
        onFormReady?(form: HubSpotFormHandle): void;
        onFormSubmitted?(): void;
      }): void;
    };
  };
};

export function HubSpotBookingForm({ prefill }: { prefill: HubSpotBookingPrefill }) {
  const router = useRouter();
  const created = useRef(false);
  const ready = useRef(false);
  const submitted = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const showThankYouPage = useCallback(() => {
    if (submitted.current) return;
    submitted.current = true;
    router.push("/nieuwe-boeking/bedankt");
  }, [router]);

  const createForm = useCallback(() => {
    const hubspot = (window as HubSpotWindow).hbspt;
    if (!hubspot || created.current) return;

    const target = document.getElementById(TARGET_ID);
    if (!target) return;
    target.replaceChildren();

    try {
      hubspot.forms.create({
        region: "eu1",
        portalId: "144599131",
        formId: FORM_ID,
        target: `#${TARGET_ID}`,
        locale: "nl",
        onFormReady: (form) => {
          prefillForm(form, prefill);
          ready.current = true;
          setStatus("ready");
        },
        onFormSubmitted: showThankYouPage,
      });
      created.current = true;
    } catch {
      setStatus("error");
    }
  }, [prefill, showThankYouPage]);

  useEffect(() => {
    // HubSpot verstuurt dit bericht pas nadat de inzending is opgeslagen.
    // De globale listener is een betrouwbare aanvulling op de embed-callback,
    // onder andere wanneer HubSpot het formulier in een iframe rendert.
    function onHubSpotMessage(event: MessageEvent) {
      const data = event.data as { type?: string; eventName?: string; id?: string } | null;
      if (
        data?.type === "hsFormCallback" &&
        data.eventName === "onFormSubmitted" &&
        data.id === FORM_ID
      ) {
        showThankYouPage();
      }
    }

    window.addEventListener("message", onHubSpotMessage);
    return () => window.removeEventListener("message", onHubSpotMessage);
  }, [showThankYouPage]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!ready.current) setStatus("error");
    }, 12_000);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <>
      <Script
        src="https://js-eu1.hsforms.net/forms/embed/v2.js"
        strategy="afterInteractive"
        onReady={createForm}
        onError={() => setStatus("error")}
      />

      {status === "loading" ? (
        <div className="space-y-3" aria-label="Aanvraagformulier wordt geladen">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : null}

      {status === "error" ? (
        <Alert tone="danger" title="Het aanvraagformulier kon niet worden geladen">
          Controleer uw internetverbinding of probeer het over een paar minuten opnieuw. Schakel
          zo nodig uw advertentie- of trackingblokkering tijdelijk uit voor SkoolPartner.
        </Alert>
      ) : null}

      <div
        id={TARGET_ID}
        className="hubspot-booking-form min-w-0 max-w-full overflow-hidden [&_iframe]:max-w-full"
        aria-live="polite"
      />
    </>
  );
}
