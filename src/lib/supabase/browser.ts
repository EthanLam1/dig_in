// src/lib/supabase/browser.ts
// Browser/client Supabase client for auth operations
// Use this in client components for auth flows

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseBrowser: SupabaseClient | null = null;

/**
 * Returns a Supabase client configured for browser/client-side usage.
 * Uses the public anon key - safe to use in client components.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  if (supabaseBrowser) {
    return supabaseBrowser;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL environment variable. Please set it in your .env file."
    );
  }

  if (!supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable. Please set it in your .env file."
    );
  }

  supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });

  return supabaseBrowser;
}
