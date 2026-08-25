import Link from "next/link";

import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
      {/* Merkzijde. Op mobiel alleen een compacte balk bovenaan. */}
      <aside className="relative hidden overflow-hidden bg-ink px-12 py-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 top-1/4 size-96 rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, #f49700 0%, transparent 70%)" }}
        />
        <span aria-hidden className="absolute inset-x-0 top-0 h-1.5 bg-accent" />

        <Logo tone="light" height={34} />
        <div className="relative max-w-md">
          <p className="eyebrow mb-4 text-accent-soft">Mijn Skool</p>
          <h1 className="font-display text-[46px] font-bold leading-[1] tracking-[-0.04em] text-white">
            Uw workshops, facturen en berichten op één plek.
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-white/70">
            Mijn Skool is de klantomgeving van Skool Workshop. Bekijk uw aankomende workshops,
            vind uw facturen terug, houd contact met ons team en spaar SkoolPoints via
            SkoolPartner.
          </p>
        </div>
        <p className="relative text-[13px] text-white/50">
          Vragen? Mail{" "}
          <a className="underline hover:text-white" href="mailto:boekingen@skoolworkshop.nl">
            boekingen@skoolworkshop.nl
          </a>
        </p>
      </aside>

      <main id="hoofdinhoud" className="flex flex-col justify-center bg-white px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-10 inline-block lg:hidden">
            <Logo />
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}
