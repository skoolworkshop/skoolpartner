import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Inloggen" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ volgende?: string }>;
}) {
  const params = await searchParams;
  const next = params.volgende?.startsWith("/") ? params.volgende : "/";

  return (
    <div className="mx-auto max-w-md">
      <LoginForm mode="login" next={next} />
      <p className="mt-8 text-sm text-muted">
        Nog geen account?{" "}
        <Link
          href="/registreren"
          className="font-semibold text-ink underline underline-offset-4 hover:text-accent-strong"
        >
          Account aanmaken
        </Link>
      </p>
    </div>
  );
}
