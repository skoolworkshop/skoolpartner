"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { createClient } from "@/lib/supabase/client";
import { RESULTS_BUCKET } from "@/lib/results/constants";
import { confirmUpload, requestUploadTarget } from "./upload-actions";

type Regel = { naam: string; status: "bezig" | "klaar" | "fout"; melding?: string };

/**
 * Uploadt bestanden rechtstreeks naar Supabase Storage, één voor één, met een
 * tijdelijke link die de server per bestand aanmaakt. De voortgang blijft
 * zichtbaar, ook als er iets misgaat bij één bestand.
 */
export function ResultUploader({
  resultId,
  maxMb,
}: {
  resultId: string;
  maxMb: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [regels, setRegels] = useState<Regel[]>([]);
  const [bezig, setBezig] = useState(false);
  const [, startTransition] = useTransition();

  async function uploadEen(file: File): Promise<Regel> {
    const doel = await requestUploadTarget(resultId, file.name, file.size);
    if ("error" in doel) {
      return { naam: file.name, status: "fout", melding: doel.error };
    }

    const supabase = createClient();
    const { error } = await supabase.storage
      .from(RESULTS_BUCKET)
      .uploadToSignedUrl(doel.path, doel.token, file);

    if (error) {
      return { naam: file.name, status: "fout", melding: error.message };
    }

    const bevestigd = await confirmUpload({
      resultId,
      path: doel.path,
      fileName: file.name,
      mimeType: file.type || null,
      sizeBytes: file.size,
    });

    if (!bevestigd.ok) {
      return { naam: file.name, status: "fout", melding: bevestigd.error };
    }
    return { naam: file.name, status: "klaar" };
  }

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    setBezig(true);
    setRegels(files.map((f) => ({ naam: f.name, status: "bezig" as const })));

    const resultaten: Regel[] = [];
    for (const file of files) {
      const regel = await uploadEen(file);
      resultaten.push(regel);
      setRegels((vorige) => vorige.map((r) => (r.naam === regel.naam ? regel : r)));
    }

    setBezig(false);
    if (input.current) input.current.value = "";
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-3">
      <input
        ref={input}
        id={`upload-${resultId}`}
        type="file"
        multiple
        className="sr-only"
        onChange={onChange}
        disabled={bezig}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={bezig}
        onClick={() => input.current?.click()}
      >
        <Upload aria-hidden className="size-4" />
        {bezig ? "Bezig met uploaden…" : "Bestanden kiezen"}
      </Button>

      <p className="text-sm text-muted">
        Maximaal {maxMb} MB per bestand. Is een video groter, voeg dan hieronder een
        WeTransfer-link toe.
      </p>

      {regels.length > 0 ? (
        <ul className="space-y-1 text-sm" aria-live="polite">
          {regels.map((regel) => (
            <li key={regel.naam} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{regel.naam}</span>
              {regel.status === "bezig" ? <span className="text-muted">bezig…</span> : null}
              {regel.status === "klaar" ? <span className="text-muted">geüpload</span> : null}
              {regel.status === "fout" ? (
                <Alert tone="danger" className="w-full">
                  {regel.melding ?? "Uploaden is niet gelukt."}
                </Alert>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
