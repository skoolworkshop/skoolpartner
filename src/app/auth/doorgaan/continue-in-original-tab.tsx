"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export function ContinueInOriginalTab({ next, channel }: { next: string; channel: string }) {
  const router = useRouter();

  useEffect(() => {
    if (channel) {
      const payload = { type: "skoolpartner-auth-complete", channel, next };
      try {
        const broadcast = new BroadcastChannel(`skoolpartner-auth-${channel}`);
        broadcast.postMessage(payload);
        broadcast.close();
      } catch {
        // localStorage hieronder is de fallback voor oudere browsers.
      }
      try {
        localStorage.setItem("skoolpartner-auth-complete", JSON.stringify(payload));
        localStorage.removeItem("skoolpartner-auth-complete");
      } catch {
        // In privémodus kan opslag geblokkeerd zijn; deze tab gaat dan zelf verder.
      }
    }

    const timer = window.setTimeout(() => {
      window.close();
      router.replace(next);
      router.refresh();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [channel, next, router]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-2 px-5 py-10">
      <div className="w-full max-w-md rounded-card border border-line-soft bg-white p-6 text-center shadow-sm sm:p-8">
        <Logo height={34} className="mx-auto" />
        <CheckCircle2 aria-hidden className="mx-auto mt-8 size-12 text-success" />
        <h1 className="mt-4 text-[28px]">E-mailadres bevestigd</h1>
        <p className="mt-2 text-muted">
          U gaat verder in het tabblad waarin u uw e-mailadres heeft ingevuld. U kunt ook hier
          doorgaan als dat tabblad niet meer openstaat.
        </p>
        <Button className="mt-6 w-full" onClick={() => router.replace(next)}>
          Hier doorgaan
        </Button>
      </div>
    </main>
  );
}
