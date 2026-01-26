// src/lib/supabaseAdmin.ts
// Server-side only Supabase client with service role key
// DO NOT import this file from client components

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseAdmin: SupabaseClient | null = null;

/**
 * Returns a Supabase client configured with the service role key.
 * This client bypasses RLS and should ONLY be used server-side.
 *
 * Throws if SUPABASE_URL or SUPABASE_SECRET_KEY env vars are missing.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (supabaseAdmin) {
    return supabaseAdmin;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "Missing SUPABASE_URL environment variable. Please set it in your .env file."
    );
  }

  if (!supabaseSecretKey) {
    throw new Error(
      "Missing SUPABASE_SECRET_KEY environment variable. Please set it in your .env file."
    );
  }

  supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseAdmin;
}
