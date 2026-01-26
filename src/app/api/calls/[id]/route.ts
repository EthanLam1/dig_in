// src/app/api/calls/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/calls/:id
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Get session_id from cookie
  const sessionId = request.cookies.get("session_id")?.value;
  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing session_id cookie. Please refresh the page." },
      { status: 400 }
    );
  }

  // Validate UUID format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return NextResponse.json({ error: "Invalid call ID format." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Fetch call from calls table - include call_intent per PROJECT_CONTEXT.md section 7.3
  const { data: call, error: callError } = await supabase
    .from("calls")
    .select(
      `id, restaurant_name, restaurant_phone_e164, call_intent,
       reservation_name, reservation_phone_e164, reservation_datetime_local_iso,
       reservation_timezone, reservation_party_size, reservation_status, reservation_result_json,
       questions_json, status, is_extracting, failure_reason, failure_details`
    )
    .eq("id", id)
    .eq("session_id", sessionId) // Verify ownership
    .single();

  if (callError || !call) {
    // Could be not found or not owned by this session
    return NextResponse.json({ error: "Call not found." }, { status: 404 });
  }

  // Fetch artifacts from call_artifacts table
  const { data: artifacts } = await supabase
    .from("call_artifacts")
    .select("answers_json, transcript_text, transcript_json")
    .eq("call_id", id)
    .single();

  // Return shape matching PROJECT_CONTEXT.md section 7.3
  // If call_intent=questions_only, reservation_* fields will be null
  return NextResponse.json({
    id: call.id,
    restaurant_name: call.restaurant_name,
    restaurant_phone_e164: call.restaurant_phone_e164,
    call_intent: call.call_intent,

    reservation_name: call.reservation_name,
    reservation_phone_e164: call.reservation_phone_e164,
    reservation_datetime_local_iso: call.reservation_datetime_local_iso,
    reservation_timezone: call.reservation_timezone,
    reservation_party_size: call.reservation_party_size,

    reservation_status: call.reservation_status,
    reservation_result_json: call.reservation_result_json,

    questions_json: call.questions_json,

    status: call.status,
    is_extracting: call.is_extracting,
    failure_reason: call.failure_reason,
    failure_details: call.failure_details,

    artifacts: {
      answers_json: artifacts?.answers_json ?? null,
      transcript_text: artifacts?.transcript_text ?? null,
      transcript_json: artifacts?.transcript_json ?? null,
    },
  });
}
