// GET /api/restaurants/signals
// Returns the latest non-expired shared signals for a restaurant phone number.
// Public/shared across sessions - no session_id filtering.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Validates E.164 phone number format.
 * Must start with + followed by digits only (10-15 digits typically).
 */
function isValidE164(phone: string): boolean {
  // E.164: starts with +, followed by 1-15 digits
  return /^\+\d{1,15}$/.test(phone);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const restaurantPhoneE164 = searchParams.get("restaurant_phone_e164");

  // Validate required parameter
  if (!restaurantPhoneE164) {
    return NextResponse.json(
      { error: "Missing required parameter: restaurant_phone_e164" },
      { status: 400 }
    );
  }

  // Validate E.164 format
  if (!isValidE164(restaurantPhoneE164)) {
    return NextResponse.json(
      {
        error:
          "Invalid restaurant_phone_e164 format. Must be E.164 (starts with + followed by digits only).",
      },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();

  // Query non-expired signals for this restaurant
  // expires_at IS NULL OR expires_at > now()
  const { data, error } = await supabase
    .from("restaurant_signals")
    .select(
      "signal_type, signal_value_text, confidence, observed_at, expires_at"
    )
    .eq("restaurant_phone_e164", restaurantPhoneE164)
    .or("expires_at.is.null,expires_at.gt.now()")
    .order("observed_at", { ascending: false });

  if (error) {
    console.error(
      `[GET /api/restaurants/signals] Query error for ${restaurantPhoneE164}:`,
      error
    );
    return NextResponse.json(
      { error: "Failed to fetch signals" },
      { status: 500 }
    );
  }

  // Return response matching PROJECT_CONTEXT.md section 7.8
  return NextResponse.json({
    items: data.map((row) => ({
      signal_type: row.signal_type,
      signal_value_text: row.signal_value_text,
      confidence: row.confidence,
      observed_at: row.observed_at,
      expires_at: row.expires_at,
    })),
  });
}
