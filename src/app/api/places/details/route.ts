// src/app/api/places/details/route.ts
import { NextRequest, NextResponse } from "next/server";

interface PlaceDetailsResponse {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
}

/**
 * Normalize phone to E.164 format.
 * Strips spaces, (), -, and keeps + and digits.
 * Returns null if the result doesn't look like E.164.
 */
function normalizeToE164(phone: string | undefined): string | null {
  if (!phone) return null;

  // Strip common formatting characters
  const cleaned = phone.replace(/[\s()\-]/g, "");

  // E.164 should start with + followed by digits
  if (/^\+\d+$/.test(cleaned)) {
    return cleaned;
  }

  // If it's just digits and reasonably long, we can't reliably add country code
  // Return null to indicate manual entry is needed
  return null;
}

export async function GET(request: NextRequest) {
  // Require session_id cookie
  const sessionId = request.cookies.get("session_id")?.value;
  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing session_id cookie. Please refresh the page." },
      { status: 401 }
    );
  }

  // Get query params
  const { searchParams } = new URL(request.url);
  const placeId = searchParams.get("placeId");
  // sessionToken is optional - passed for autocomplete session billing optimization
  // but Google's Place Details (New) API may not use it the same way

  if (!placeId || placeId.trim().length === 0) {
    return NextResponse.json(
      { error: "placeId query parameter is required" },
      { status: 400 }
    );
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error("GOOGLE_PLACES_API_KEY is not set");
    return NextResponse.json(
      { error: "Google Places is not configured" },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "id,displayName,formattedAddress,internationalPhoneNumber,nationalPhoneNumber",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google Places Details error:", response.status, errorText);
      return NextResponse.json(
        { error: "Google Places details lookup failed" },
        { status: response.status }
      );
    }

    const data: PlaceDetailsResponse = await response.json();

    // Normalize phone - prefer international, fallback to national
    const phoneE164 = normalizeToE164(data.internationalPhoneNumber) ||
      normalizeToE164(data.nationalPhoneNumber);

    return NextResponse.json({
      place_id: data.id || placeId,
      restaurant_name: data.displayName?.text || "",
      restaurant_phone_e164: phoneE164,
      restaurant_address: data.formattedAddress || "",
    });
  } catch (error) {
    console.error("Google Places Details fetch error:", error);
    return NextResponse.json(
      { error: "Failed to connect to Google Places" },
      { status: 500 }
    );
  }
}
