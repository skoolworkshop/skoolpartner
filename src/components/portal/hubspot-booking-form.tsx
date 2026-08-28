"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Skeleton } from "@/components/ui/feedback";

const TARGET_ID = "hubspot-new-booking-form";

type HubSpotWindow = Window & {
  hbspt?: {
    forms: {
      create(config: {
        region: "eu1";
        portalId: string;
        formId: string;
        target: string;
      }): void;
    };
  };
};

export function HubSpotBookingForm() {
  const created = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

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
        formId: "cf6c7f07-c534-4859-bc01-c79700b78330",
        target: `#${TARGET_ID}`,
      });
      created.current = true;
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!created.current) setStatus("error");
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
