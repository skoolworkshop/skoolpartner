import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Verwerkt de inloglink uit de e-mail.
 * Ondersteunt zowel de PKCE-code als de oudere token_hash-variant.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const rawNext = searchParams.get("volgende") ?? searchParams.get("next") ?? "/dashboard";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";
  const rawChannel = searchParams.get("kanaal") ?? "";
  const channel = /^[a-zA-Z0-9-]{8,80}$/.test(rawChannel) ? rawChannel : "";
  const continuation = `${origin}/auth/doorgaan?volgende=${encodeURIComponent(next)}&kanaal=${encodeURIComponent(channel)}`;

  const supabase = await createServerSupabase();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(continuation);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as "email" | "magiclink" | "recovery" | "invite",
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(continuation);
  }

  return NextResponse.redirect(`${origin}/inloggen?fout=link-verlopen`);
}
