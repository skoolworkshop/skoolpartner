import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "../inloggen/login-form";

export const metadata: Metadata = { title: "Registreren" };

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-lg">
      <LoginForm mode="register" next="/aanmelden" />
      <div className="mt-8 space-y-3 text-sm text-muted">
        <p>
          SkoolPartner is een programma waar u zelf voor kiest. U spaart SkoolPoints op nieuwe
          workshopboekingen vanaf het moment dat uw registratie is afgerond. Boekingen en facturen
          van vóór uw deelname tellen niet mee.
        </p>
        <p>
          Heeft u al een account?{" "}
          <Link
            href="/inloggen"
            className="font-semibold text-ink underline underline-offset-4 hover:text-accent-strong"
          >
            Inloggen
          </Link>
        </p>
      </div>
    </div>
  );
}
