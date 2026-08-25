import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "../inloggen/login-form";

export const metadata: Metadata = { title: "Registreren" };

export default function RegisterPage() {
  return (
    <>
      <LoginForm mode="register" next="/aanmelden" />
      <div className="mt-8 space-y-3 text-sm text-muted">
        <p>
          Door te registreren doet u mee aan SkoolPartner. U spaart SkoolPoints vanaf het moment
          van registratie. Boekingen van vóór uw registratie leveren geen punten op.
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
    </>
  );
}
