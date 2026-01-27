// src/app/api/places/nearby/route.ts
import { NextRequest, NextResponse } from "next/server";

// Simple in-memory rate limiting per session (conservative for nearby)
const sessionRequestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 5; // Only 5 nearby requests per minute

function checkRateLimit(sessionId: string): boolean {
  const now = Date.now();
  const entry = sessionRequestCounts.get(sessionId);

  if (!entry || now > entry.resetAt) {
    sessionRequestCounts.set(sessionId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  entry.count++;
  return true;
}

interface NearbyPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
}

interface NearbyResponse {
  places?: NearbyPlace[];
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

  // Rate limiting
  if (!checkRateLimit(sessionId)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before searching nearby again." },
      { status: 429 }
    );
  }

  // Get query params
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const radiusParam = searchParams.get("radiusMeters");

  if (!lat || !lng) {
    return NextResponse.json(
      { error: "lat and lng query parameters are required" },
      { status: 400 }
    );
  }

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);

  if (isNaN(latitude) || isNaN(longitude)) {
    return NextResponse.json(
      { error: "lat and lng must be valid numbers" },
      { status: 400 }
    );
  }

  const radiusMeters = radiusParam ? parseFloat(radiusParam) : 1500;
  if (isNaN(radiusMeters) || radiusMeters < 0 || radiusMeters > 50000) {
    return NextResponse.json(
      { error: "radiusMeters must be between 0 and 50000" },
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

  // Build request body
  const requestBody = {
    includedTypes: ["restaurant"],
    maxResultCount: 10,
    locationRestriction: {
      circle: {
        center: { latitude, longitude },
        radius: radiusMeters,
      },
    },
  };

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google Places Nearby error:", response.status, errorText);
      return NextResponse.json(
        { error: "Google Places nearby search failed" },
        { status: response.status }
      );
    }

    const data: NearbyResponse = await response.json();

    // Normalize response - extract short address (first part before comma)
    const items = (data.places || [])
      .map((place) => {
        if (!place.id) return null;

        // Extract short address - typically first part before comma
        const fullAddress = place.formattedAddress || "";
        const shortAddress = fullAddress.split(",")[0] || fullAddress;

        return {
          place_id: place.id,
          name: place.displayName?.text || "",
          short_address: shortAddress,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Google Places Nearby fetch error:", error);
    return NextResponse.json(
      { error: "Failed to connect to Google Places" },
      { status: 500 }
    );
  }
}
