// src/app/api/places/autocomplete/route.ts
import { NextRequest, NextResponse } from "next/server";

// Simple in-memory rate limiting per session
const sessionRequestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per minute per session

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

interface AutocompleteSuggestion {
  placePrediction?: {
    placeId?: string;
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
    text?: { text?: string };
  };
}

interface AutocompleteResponse {
  suggestions?: AutocompleteSuggestion[];
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
      { error: "Too many requests. Please slow down." },
      { status: 429 }
    );
  }

  // Get query params
  const { searchParams } = new URL(request.url);
  const input = searchParams.get("input");
  const sessionToken = searchParams.get("sessionToken");
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (!input || input.trim().length === 0) {
    return NextResponse.json(
      { error: "input query parameter is required" },
      { status: 400 }
    );
  }

  if (!sessionToken) {
    return NextResponse.json(
      { error: "sessionToken query parameter is required" },
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
  const requestBody: Record<string, unknown> = {
    input: input.trim(),
    includedPrimaryTypes: ["restaurant"],
    sessionToken,
  };

  // Add location bias if lat/lng provided
  if (lat && lng) {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (!isNaN(latitude) && !isNaN(longitude)) {
      requestBody.locationBias = {
        circle: {
          center: { latitude, longitude },
          radius: 2000, // 2km radius
        },
      };
    }
  }

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google Places Autocomplete error:", response.status, errorText);
      return NextResponse.json(
        { error: "Google Places search failed" },
        { status: response.status }
      );
    }

    const data: AutocompleteResponse = await response.json();

    // Normalize response
    const items = (data.suggestions || [])
      .map((suggestion) => {
        const prediction = suggestion.placePrediction;
        if (!prediction?.placeId) return null;

        return {
          place_id: prediction.placeId,
          primary_text: prediction.structuredFormat?.mainText?.text || "",
          secondary_text:
            prediction.structuredFormat?.secondaryText?.text ||
            prediction.text?.text ||
            "",
        };
      })
      .filter(Boolean);

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Google Places Autocomplete fetch error:", error);
    return NextResponse.json(
      { error: "Failed to connect to Google Places" },
      { status: 500 }
    );
  }
}
