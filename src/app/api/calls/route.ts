// src/app/api/calls/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// ─────────────────────────────────────────────────────────────────────────────
// Zod Schemas (lenient input - missing presets are normalized later)
// ─────────────────────────────────────────────────────────────────────────────

// Lenient schemas that accept partial input
const presetBaseInputSchema = z
  .object({
    enabled: z.boolean(),
  })
  .optional();

const dietaryOptionsInputSchema = z
  .object({
    enabled: z.boolean(),
    restriction: z.string().optional(),
  })
  .optional();

const presetsInputSchema = z
  .object({
    wait_time_now: presetBaseInputSchema,
    dietary_options: dietaryOptionsInputSchema,
    hours_today: presetBaseInputSchema,
    takes_reservations: presetBaseInputSchema,
  })
  .optional();

const questionsInputSchema = z.object({
  presets: presetsInputSchema,
  custom_questions: z.array(z.string()).optional(),
});

// call_intent determines which reservation fields are required
const callIntentSchema = z.enum(["make_reservation", "questions_only"]);

const createCallBodySchema = z.object({
  restaurant_name: z.string().optional().nullable(),
  restaurant_phone_e164: z.string(),
  call_intent: callIntentSchema,
  // Reservation fields are optional at schema level; validated conditionally based on call_intent
  reservation_name: z.string().optional().nullable(),
  reservation_phone_e164: z.string().optional().nullable(),
  reservation_datetime_local_iso: z.string().optional().nullable(),
  reservation_timezone: z.string().optional().nullable(),
  reservation_party_size: z.number().optional().nullable(),
  questions: questionsInputSchema,
});

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Types (matching PROJECT_CONTEXT.md section 6)
// ─────────────────────────────────────────────────────────────────────────────

interface CanonicalPresets {
  wait_time_now: { enabled: boolean };
  dietary_options: { enabled: boolean; restriction?: string };
  hours_today: { enabled: boolean };
  takes_reservations: { enabled: boolean };
}

interface CanonicalQuestionsJson {
  presets: CanonicalPresets;
  custom_questions: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates E.164 phone format: starts with '+' then digits only.
 */
function isValidE164(phone: string): boolean {
  return /^\+\d+$/.test(phone);
}

/**
 * Normalizes input presets to canonical shape.
 * Missing presets default to { enabled: false }.
 */
function normalizePresets(
  input: z.infer<typeof presetsInputSchema>
): CanonicalPresets {
  const defaultPreset = { enabled: false };

  return {
    wait_time_now: input?.wait_time_now ?? defaultPreset,
    dietary_options: input?.dietary_options ?? defaultPreset,
    hours_today: input?.hours_today ?? defaultPreset,
    takes_reservations: input?.takes_reservations ?? defaultPreset,
  };
}

/**
 * Counts enabled preset questions.
 */
function countEnabledPresets(presets: CanonicalPresets): number {
  let count = 0;
  if (presets.wait_time_now.enabled) count++;
  if (presets.dietary_options.enabled) count++;
  if (presets.hours_today.enabled) count++;
  if (presets.takes_reservations.enabled) count++;
  return count;
}

/**
 * Validates dietary_options: if enabled, restriction must be non-empty.
 */
function validateDietaryOptions(
  dietary: CanonicalPresets["dietary_options"]
): string | null {
  if (!dietary.enabled) {
    return null;
  }

  if (!dietary.restriction || dietary.restriction.trim() === "") {
    return "dietary restriction is required when dietary_options is enabled";
  }

  return null;
}

/**
 * Validates reservation datetime is within next 3 days inclusive in the provided timezone.
 */
function validateReservationDatetime(
  datetimeLocalIso: string,
  timezone: string
): string | null {
  try {
    // Parse the local datetime string
    const localDatetime = new Date(datetimeLocalIso);
    if (isNaN(localDatetime.getTime())) {
      return "reservation_datetime_local_iso is not a valid datetime";
    }

    // Get current time in the specified timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    // Get today's date at start of day in the timezone
    const nowParts = formatter.formatToParts(now);
    const getPart = (type: string) =>
      nowParts.find((p) => p.type === type)?.value || "0";

    const nowInTz = new Date(
      `${getPart("year")}-${getPart("month")}-${getPart("day")}T${getPart("hour")}:${getPart("minute")}:${getPart("second")}`
    );

    // Start of today in the timezone
    const todayStart = new Date(
      `${getPart("year")}-${getPart("month")}-${getPart("day")}T00:00:00`
    );

    // End of 3 days from now (inclusive)
    const threeDaysLater = new Date(todayStart);
    threeDaysLater.setDate(threeDaysLater.getDate() + 4); // Add 4 to get end of 3rd day

    // The requested datetime should be >= now and < end of 3rd day
    if (localDatetime < nowInTz) {
      return "reservation date/time must be in the future";
    }

    if (localDatetime >= threeDaysLater) {
      return "reservation date/time must be within the next 3 days";
    }
  } catch {
    return "reservation_timezone is not a valid IANA timezone";
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/calls
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Get session_id from cookie
  const sessionId = request.cookies.get("session_id")?.value;
  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing session_id cookie. Please refresh the page." },
      { status: 400 }
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Your input could not be parsed because the request body is not valid JSON." },
      { status: 400 }
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Validate E.164 phone formats FIRST (before full Zod parsing)
  // ─────────────────────────────────────────────────────────────────────────
  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Your input could not be parsed because request body must be an object." },
      { status: 400 }
    );
  }

  const bodyObj = body as Record<string, unknown>;

  // Validate restaurant_phone_e164 (always required)
  if (!("restaurant_phone_e164" in bodyObj)) {
    return NextResponse.json(
      { error: "Your input could not be parsed because restaurant_phone_e164 is required." },
      { status: 400 }
    );
  }
  if (typeof bodyObj.restaurant_phone_e164 !== "string") {
    return NextResponse.json(
      { error: "Your input could not be parsed because restaurant_phone_e164 must be a string." },
      { status: 400 }
    );
  }
  if (!isValidE164(bodyObj.restaurant_phone_e164)) {
    return NextResponse.json(
      {
        error:
          "Your input could not be parsed because restaurant_phone_e164 must be E.164 format (starts with + followed by digits only, e.g. +14165551234).",
      },
      { status: 400 }
    );
  }

  // Validate call_intent is present and valid before checking reservation fields
  const callIntent = bodyObj.call_intent;
  if (!callIntent) {
    return NextResponse.json(
      { error: "Your input could not be parsed because call_intent is required." },
      { status: 400 }
    );
  }
  if (callIntent !== "make_reservation" && callIntent !== "questions_only") {
    return NextResponse.json(
      { error: "Your input could not be parsed because call_intent must be 'make_reservation' or 'questions_only'." },
      { status: 400 }
    );
  }

  // Validate reservation_phone_e164 only for make_reservation
  if (callIntent === "make_reservation") {
    if (!bodyObj.reservation_phone_e164) {
      return NextResponse.json(
        { error: "Your input could not be parsed because reservation_phone_e164 is required for reservations." },
        { status: 400 }
      );
    }
    if (typeof bodyObj.reservation_phone_e164 !== "string") {
      return NextResponse.json(
        { error: "Your input could not be parsed because reservation_phone_e164 must be a string." },
        { status: 400 }
      );
    }
    if (!isValidE164(bodyObj.reservation_phone_e164)) {
      return NextResponse.json(
        {
          error:
            "Your input could not be parsed because reservation_phone_e164 must be E.164 format (starts with + followed by digits only, e.g. +14165551234).",
        },
        { status: 400 }
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Validate rest of body with Zod
  // ─────────────────────────────────────────────────────────────────────────
  const parseResult = createCallBodySchema.safeParse(body);
  if (!parseResult.success) {
    const issue = parseResult.error.issues[0];
    // Provide human-friendly error messages
    const path = issue.path.join(".");
    let message = issue.message;

    // Make common errors more readable
    if (message.includes("Required")) {
      message = `${path} is required`;
    } else if (message.includes("Expected")) {
      message = `${path} has an invalid type`;
    }

    return NextResponse.json(
      { error: `Your input could not be parsed because ${message}.` },
      { status: 400 }
    );
  }

  const {
    restaurant_name,
    restaurant_phone_e164,
    call_intent,
    reservation_name,
    reservation_phone_e164,
    reservation_datetime_local_iso,
    reservation_timezone,
    reservation_party_size,
    questions,
  } = parseResult.data;

  // ─────────────────────────────────────────────────────────────────────────
  // Validate reservation fields only when call_intent = 'make_reservation'
  // ─────────────────────────────────────────────────────────────────────────
  if (call_intent === "make_reservation") {
    // Validate reservation_name is non-empty
    if (!reservation_name || reservation_name.trim() === "") {
      return NextResponse.json(
        { error: "Your input could not be parsed because reservation_name must be non-empty." },
        { status: 400 }
      );
    }

    // Validate reservation_party_size is integer in [1..20]
    if (
      reservation_party_size === null ||
      reservation_party_size === undefined ||
      !Number.isInteger(reservation_party_size) ||
      reservation_party_size < 1 ||
      reservation_party_size > 20
    ) {
      return NextResponse.json(
        { error: "Your input could not be parsed because reservation_party_size must be a whole number between 1 and 20." },
        { status: 400 }
      );
    }

    // Validate reservation_datetime_local_iso is provided
    if (!reservation_datetime_local_iso) {
      return NextResponse.json(
        { error: "Your input could not be parsed because reservation_datetime_local_iso is required for reservations." },
        { status: 400 }
      );
    }

    // Validate reservation_timezone is provided
    if (!reservation_timezone) {
      return NextResponse.json(
        { error: "Your input could not be parsed because reservation_timezone is required for reservations." },
        { status: 400 }
      );
    }

    // Validate reservation datetime is within next 3 days inclusive
    const datetimeError = validateReservationDatetime(
      reservation_datetime_local_iso,
      reservation_timezone
    );
    if (datetimeError) {
      return NextResponse.json(
        { error: `Your input could not be parsed because ${datetimeError}.` },
        { status: 400 }
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Normalize presets to canonical shape (default missing to { enabled: false })
  // ─────────────────────────────────────────────────────────────────────────
  const normalizedPresets = normalizePresets(questions.presets);

  // ─────────────────────────────────────────────────────────────────────────
  // Process custom questions: trim, filter empty, validate max 5
  // ─────────────────────────────────────────────────────────────────────────
  const rawCustomQuestions = questions.custom_questions ?? [];
  const trimmedCustomQuestions = rawCustomQuestions
    .map((q) => q.trim())
    .filter((q) => q !== "");

  if (trimmedCustomQuestions.length > 5) {
    return NextResponse.json(
      { error: "Your input could not be parsed because you can have at most 5 custom questions." },
      { status: 400 }
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Validate total questions <= 10
  // ─────────────────────────────────────────────────────────────────────────
  const enabledPresetsCount = countEnabledPresets(normalizedPresets);
  if (enabledPresetsCount + trimmedCustomQuestions.length > 10) {
    return NextResponse.json(
      {
        error:
          "Your input could not be parsed because the total number of questions (enabled presets + custom) cannot exceed 10.",
      },
      { status: 400 }
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Validate dietary_options: if enabled, restriction must be non-empty
  // ─────────────────────────────────────────────────────────────────────────
  const dietaryError = validateDietaryOptions(normalizedPresets.dietary_options);
  if (dietaryError) {
    return NextResponse.json(
      { error: `Your input could not be parsed because ${dietaryError}.` },
      { status: 400 }
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Build canonical questions_json for storage (extra questions only)
  // ─────────────────────────────────────────────────────────────────────────
  const questionsJson: CanonicalQuestionsJson = {
    presets: normalizedPresets,
    custom_questions: trimmedCustomQuestions,
  };

  // Generate stub provider_call_id (no Retell call yet)
  const providerCallId = `stub_${crypto.randomUUID()}`;

  // Insert into database
  const supabase = getSupabaseAdmin();

  // Build insert object based on call_intent
  const insertData: Record<string, unknown> = {
    session_id: sessionId,
    user_id: null,
    restaurant_name: restaurant_name || null,
    restaurant_phone_e164,
    call_intent,
    questions_json: questionsJson,
    status: "calling",
    is_extracting: false,
    provider: "retell",
    provider_call_id: providerCallId,
  };

  if (call_intent === "make_reservation") {
    // Store reservation fields and set status to 'requested'
    insertData.reservation_name = reservation_name!.trim();
    insertData.reservation_phone_e164 = reservation_phone_e164;
    insertData.reservation_datetime_local_iso = reservation_datetime_local_iso;
    insertData.reservation_timezone = reservation_timezone;
    insertData.reservation_party_size = reservation_party_size;
    insertData.reservation_status = "requested";
  } else {
    // questions_only: reservation fields are null
    insertData.reservation_name = null;
    insertData.reservation_phone_e164 = null;
    insertData.reservation_datetime_local_iso = null;
    insertData.reservation_timezone = null;
    insertData.reservation_party_size = null;
    insertData.reservation_status = null;
  }

  const { data: callData, error: insertError } = await supabase
    .from("calls")
    .insert(insertData)
    .select("id")
    .single();

  if (insertError || !callData) {
    console.error("Failed to insert call:", insertError);
    return NextResponse.json(
      { error: "Failed to create call. Please try again." },
      { status: 500 }
    );
  }

  // Upsert call_artifacts row so GET /api/calls/:id always has an artifacts object
  const { error: artifactsError } = await supabase.from("call_artifacts").upsert(
    {
      call_id: callData.id,
      transcript_text: null,
      transcript_json: null,
      answers_json: null,
      raw_provider_payload_json: null,
    },
    { onConflict: "call_id" }
  );

  if (artifactsError) {
    console.error("Failed to create call_artifacts:", artifactsError);
    // Non-fatal - the call was still created
  }

  return NextResponse.json({ call_id: callData.id }, { status: 201 });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/calls
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Get session_id from cookie
  const sessionId = request.cookies.get("session_id")?.value;
  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing session_id cookie. Please refresh the page." },
      { status: 400 }
    );
  }

  // Parse query params
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const cursor = searchParams.get("cursor");

  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 100) : 10;

  const supabase = getSupabaseAdmin();

  // Build query - include call_intent per PROJECT_CONTEXT.md section 7.2
  let query = supabase
    .from("calls")
    .select("id, restaurant_name, restaurant_phone_e164, status, is_extracting, call_intent, reservation_status, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit + 1); // Fetch one extra to determine if there's a next page

  // Apply cursor if provided
  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data: calls, error } = await query;

  if (error) {
    console.error("Failed to fetch calls:", error);
    return NextResponse.json(
      { error: "Failed to fetch calls. Please try again." },
      { status: 500 }
    );
  }

  // Determine if there are more items
  const hasMore = calls && calls.length > limit;
  const items = hasMore ? calls.slice(0, limit) : calls || [];

  // next_cursor is the created_at of the last item if there are more
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].created_at : null;

  return NextResponse.json({
    items,
    next_cursor: nextCursor,
  });
}
