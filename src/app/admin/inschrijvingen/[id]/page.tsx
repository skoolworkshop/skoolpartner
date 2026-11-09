import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import {
  getOntbrekend,
  getToegangen,
  getVerzendingen,
  getVoorgesteldeOntvanger,
} from "@/lib/inschrijving/afronden";
import { getInschrijfdag } from "@/lib/inschrijving/dagen";
import { resolveSiteUrl } from "@/lib/site-url";
import { DagScherm } from "./dag-scherm";

export const metadata: Metadata = { title: "Inschrijfdag" };

export default async function InschrijfdagPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const [detail, ontbrekend, toegangen, verzendingen, ontvanger] = await Promise.all([
    getInschrijfdag(id),
    getOntbrekend(id),
    getToegangen(id),
    getVerzendingen(id),
    getVoorgesteldeOntvanger(id),
  ]);

  if (!detail || !ontbrekend) notFound();

  const inschrijflink = `${await resolveSiteUrl()}/inschrijven/${detail.dag.slug}`;

  return (
    <DagScherm
      detail={detail}
      extra={{ inschrijflink, ontbrekend, ontvanger, toegangen, verzendingen }}
    />
  );
}
