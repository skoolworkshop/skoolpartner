import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();

  const response = NextResponse.redirect(new URL("/inloggen", request.nextUrl.origin), {
    status: 303,
  });
  response.cookies.delete(ACTIVE_ORGANIZATION_COOKIE);
  return response;
}
