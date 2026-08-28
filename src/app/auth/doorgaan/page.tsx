import type { Metadata } from "next";

import { ContinueInOriginalTab } from "./continue-in-original-tab";

export const metadata: Metadata = { title: "E-mailadres bevestigd" };

export default async function ContinuePage({
  searchParams,
}: {
  searchParams: Promise<{ volgende?: string; kanaal?: string }>;
}) {
  const params = await searchParams;
  const next = params.volgende?.startsWith("/") && !params.volgende.startsWith("//")
    ? params.volgende
    : "/dashboard";
  const channel = /^[a-zA-Z0-9-]{8,80}$/.test(params.kanaal ?? "") ? params.kanaal! : "";

  return <ContinueInOriginalTab next={next} channel={channel} />;
}
