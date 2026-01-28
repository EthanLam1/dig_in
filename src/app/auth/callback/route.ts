// src/app/auth/callback/route.ts
// Auth callback route handler for Supabase Auth code exchange
// This is a technical route - no UI

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (code) {
    const supabase = await createSupabaseServerClient();
    
    // Exchange the code for a session
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (error) {
      console.error("Auth callback error:", error.message);
      // Redirect to home even on error - user will see logged out state
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  // Redirect to home page after successful auth or if no code
  return NextResponse.redirect(new URL("/", request.url));
}
