// POST /api/webhooks/retell
// Receives Retell webhook events, verifies signature, updates call status and stores transcripts.
// Runs Step 6 extraction when transcript is ready.

import { NextRequest, NextResponse } from "next/server";
import Retell from "retell-sdk";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { extractAnswers } from "@/lib/extractAnswers";

// Status progression order (forward-only updates)
const STATUS_ORDER = ["queued", "calling", "connected", "completed", "failed"];

// Voicemail transcript heuristics (case-insensitive)
const VOICEMAIL_PHRASES = [
  "forwarded to voicemail",
  "record your message",
  "at the tone",
  "not available",
];

/**
 * Detects if a call went to voicemail using:
 * 1. Primary: call_analysis.in_voicemail === true
 * 2. Secondary: transcript contains voicemail phrases (case-insensitive)
 *
 * IMPORTANT: We do NOT use call_analysis.call_successful === false here.
 * A call can be "unsuccessful" (e.g., reservation denied) but still have
 * reached a human - that's a completed call, not a failed call.
 */
function detectVoicemailFromAnalysis(
  callAnalysis: { in_voicemail?: boolean; call_successful?: boolean } | undefined | null,
  transcript: string | undefined | null
): boolean {
  // Primary check: explicit voicemail flag from Retell
  if (callAnalysis?.in_voicemail === true) {
    return true;
  }

  // Secondary check: voicemail phrases in transcript
  if (transcript) {
    const lowerTranscript = transcript.toLowerCase();
    if (VOICEMAIL_PHRASES.some((phrase) => lowerTranscript.includes(phrase))) {
      return true;
    }
  }

  return false;
}

/**
 * Detects if disconnection reason indicates no human was reached.
 * Checks for:
 * - "voicemail_reached" (exact match)
 * - Any reason starting with "dial_" (dial_failed, dial_busy, dial_no_answer, etc.)
 */
function isDialFailureDisconnection(disconnectionReason: string | undefined | null): boolean {
  if (!disconnectionReason) return false;
  return (
    disconnectionReason === "voicemail_reached" ||
    disconnectionReason.startsWith("dial_")
  );
}

/**
 * Detects if a human actually answered the call.
 * Signals that strongly imply "human answered":
 * - transcript includes both "Agent:" and "User:" lines with real content
 * - transcript_object has multiple entries with content
 * - duration_ms is non-trivial (> 5000ms)
 */
function detectHumanAnswered(
  transcript: string | undefined | null,
  transcriptObject: unknown,
  durationMs: number | undefined | null
): boolean {
  // Check transcript for dialogue pattern
  if (transcript) {
    const hasAgent = /agent:/i.test(transcript);
    const hasUser = /user:/i.test(transcript);
    // Check for real content (not just empty turns)
    const hasRealContent = transcript.length > 50; // Arbitrary threshold for "real content"
    if (hasAgent && hasUser && hasRealContent) {
      return true;
    }
  }

  // Check transcript_object for multiple entries with content
  if (Array.isArray(transcriptObject) && transcriptObject.length > 1) {
    const entriesWithContent = transcriptObject.filter(
      (entry: { content?: string }) => entry?.content && entry.content.trim().length > 0
    );
    if (entriesWithContent.length > 1) {
      return true;
    }
  }

  // Check duration (> 5000ms suggests a real conversation)
  if (durationMs && durationMs > 5000) {
    return true;
  }

  return false;
}

function canProgressStatus(
  currentStatus: string,
  newStatus: string
): boolean {
  const currentIdx = STATUS_ORDER.indexOf(currentStatus);
  const newIdx = STATUS_ORDER.indexOf(newStatus);
  // Only progress forward (never go backwards)
  // Exception: failed can happen at any point
  if (newStatus === "failed") return true;
  return newIdx > currentIdx;
}

export async function POST(request: NextRequest) {
  // 1. Get the webhook API key (prefer RETELL_WEBHOOK_API_KEY, fall back to RETELL_API_KEY)
  let webhookKey = process.env.RETELL_WEBHOOK_API_KEY;
  if (!webhookKey) {
    webhookKey = process.env.RETELL_API_KEY;
    if (webhookKey) {
      console.warn(
        "[Retell Webhook] RETELL_WEBHOOK_API_KEY not set, falling back to RETELL_API_KEY"
      );
    } else {
      console.error("[Retell Webhook] No webhook API key configured");
      return new NextResponse("Server configuration error", { status: 500 });
    }
  }

  // 2. Read raw body for signature verification
  const rawBody = await request.text();

  // 3. Get signature from headers
  const signature = request.headers.get("x-retell-signature");
  if (!signature) {
    console.warn("[Retell Webhook] Missing x-retell-signature header");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 4. Verify signature using retell-sdk
  const isValid = Retell.verify(rawBody, webhookKey, signature);
  if (!isValid) {
    console.warn("[Retell Webhook] Invalid signature");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 5. Parse payload AFTER verification
  let payload: {
    event: string;
    call?: {
      call_id?: string;
      transcript?: string;
      transcript_object?: unknown;
      disconnection_reason?: string;
      duration_ms?: number;
      call_analysis?: {
        in_voicemail?: boolean;
        call_successful?: boolean;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };
  };

  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error("[Retell Webhook] Failed to parse JSON payload:", err);
    return new NextResponse("Bad Request", { status: 400 });
  }

  const event = payload.event;
  const call = payload.call;

  if (!call || !call.call_id) {
    console.warn("[Retell Webhook] Missing call or call_id in payload");
    // Acknowledge but don't process
    return new NextResponse(null, { status: 200 });
  }

  const providerCallId = call.call_id;

  // 6. Find matching call row by provider_call_id
  const supabase = getSupabaseAdmin();
  const { data: callRow, error: fetchError } = await supabase
    .from("calls")
    .select("id, status, is_extracting, call_intent, reservation_status")
    .eq("provider_call_id", providerCallId)
    .single();

  if (fetchError || !callRow) {
    console.warn(
      `[Retell Webhook] No matching call found for provider_call_id=${providerCallId}`
    );
    // Acknowledge to prevent retries
    return new NextResponse(null, { status: 200 });
  }

  const callId = callRow.id;
  const currentStatus = callRow.status;
  const currentIsExtracting = callRow.is_extracting;
  const callIntent = callRow.call_intent;
  const currentReservationStatus = callRow.reservation_status;

  // 6.5. Extract voicemail/human detection info early (needed for idempotency check)
  const callAnalysis = call.call_analysis;
  const transcriptText = call.transcript ?? null;
  const transcriptObject = call.transcript_object;
  const durationMs = call.duration_ms;
  const disconnectionReason = call.disconnection_reason;

  // Detect voicemail from call_analysis or transcript phrases
  const detectedVoicemail = detectVoicemailFromAnalysis(callAnalysis, transcriptText);
  
  // Detect dial failures (dial_*, voicemail_reached)
  const isDialFailure = isDialFailureDisconnection(disconnectionReason);
  
  // Detect if a human actually answered
  const humanAnswered = detectHumanAnswered(transcriptText, transcriptObject, durationMs);

  // Determine if no human was reached:
  // noHumanReached = voicemail OR dial failure
  // BUT if humanAnswered signals are strong, don't mark as noHumanReached
  // This handles edge cases where voicemail detection might be wrong but we have clear conversation
  const noHumanReached = (detectedVoicemail || isDialFailure) && !humanAnswered;

  // 6.6. Idempotency check with call_analyzed override capability
  // A call is terminal if status is 'completed' or 'failed' AND is_extracting is false
  // EXCEPTION: call_analyzed can override earlier call_ended mistakes:
  //   - If noHumanReached true → force failed
  //   - If noHumanReached false and current is failed → force completed and run extraction
  const isTerminal =
    (currentStatus === "completed" || currentStatus === "failed") &&
    !currentIsExtracting;

  // Allow call_analyzed to correct call_ended mistakes
  const shouldAllowCallAnalyzedOverride =
    event === "call_analyzed" &&
    (
      // Case 1: Voicemail detected but status is completed → correct to failed
      (noHumanReached && currentStatus === "completed") ||
      // Case 2: Human answered but status is failed → correct to completed
      (!noHumanReached && currentStatus === "failed")
    );

  if (isTerminal && !shouldAllowCallAnalyzedOverride) {
    console.log(
      `[Retell Webhook] Call ${callId} is already terminal (status=${currentStatus}), skipping duplicate event`
    );
    return new NextResponse(null, { status: 200 });
  }

  if (shouldAllowCallAnalyzedOverride) {
    if (noHumanReached && currentStatus === "completed") {
      console.log(
        `[Retell Webhook] Call ${callId} was completed but voicemail detected in call_analyzed, correcting to failed`
      );
    } else if (!noHumanReached && currentStatus === "failed") {
      console.log(
        `[Retell Webhook] Call ${callId} was failed but human answered in call_analyzed, correcting to completed`
      );
    }
  }

  // 7. Prepare detection results for logging and decision-making
  const hasTranscript = !!(call.transcript || call.transcript_object);

  // Log detection results for debugging
  if (event === "call_ended" || event === "call_analyzed") {
    console.log(
      `[Retell Webhook] Call ${callId} detection results:`,
      JSON.stringify({
        event,
        disconnectionReason,
        detectedVoicemail,
        isDialFailure,
        humanAnswered,
        noHumanReached,
        hasTranscript,
        durationMs,
        inVoicemail: callAnalysis?.in_voicemail,
        callSuccessful: callAnalysis?.call_successful,
      })
    );
  }

  // 8. Prepare updates for calls table
  const callUpdates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  // Build failure_details for voicemail/no-answer scenarios
  const buildFailureDetails = () => {
    const details: Record<string, unknown> = {};
    if (disconnectionReason) {
      details.disconnection_reason = disconnectionReason;
    }
    if (callAnalysis?.in_voicemail !== undefined) {
      details.in_voicemail = callAnalysis.in_voicemail;
    }
    if (callAnalysis?.call_successful !== undefined) {
      details.call_successful = callAnalysis.call_successful;
    }
    if (durationMs !== undefined) {
      details.duration_ms = durationMs;
    }
    details.human_answered_detection = humanAnswered;
    return JSON.stringify(details);
  };

  // 9. Handle different scenarios based on noHumanReached vs humanAnswered
  //
  // KEY DISTINCTION:
  // - noHumanReached = true → calls.status = 'failed', skip extraction
  // - noHumanReached = false (human answered) → calls.status = 'completed', run extraction
  //
  // We do NOT use call_analysis.call_successful to determine failed vs completed.
  // A call where a human answered but the reservation was denied is still 'completed'.
  
  if (noHumanReached) {
    // No human was reached (voicemail, dial failure)
    // Mark as failed and skip extraction
    callUpdates.status = "failed";
    callUpdates.is_extracting = false;
    
    // Set appropriate failure message
    if (detectedVoicemail) {
      callUpdates.failure_reason = "The call went to voicemail.";
    } else {
      callUpdates.failure_reason = "Your phone call was not answered";
    }
    callUpdates.failure_details = buildFailureDetails();

    // For make_reservation calls, update reservation_status so it doesn't stay stuck at 'requested'
    if (callIntent === "make_reservation" && currentReservationStatus === "requested") {
      callUpdates.reservation_status = "needs_followup";
      callUpdates.reservation_result_json = {
        failure_category: "call_back_later",
        failure_reason: detectedVoicemail 
          ? "Call went to voicemail"
          : "Call was not answered",
      };
      console.log(
        `[Retell Webhook] Call ${callId} reservation_status updated to needs_followup (voicemail/no answer)`
      );
    }

    const reason = detectedVoicemail
      ? `voicemail detected (in_voicemail=${callAnalysis?.in_voicemail}, transcript_phrases=${detectedVoicemail && !callAnalysis?.in_voicemail})`
      : `dial failure: ${disconnectionReason}`;

    console.log(
      `[Retell Webhook] Call ${callId} marked as failed: no human reached (${reason})`
    );
  } else {
    // Human answered OR conversation happened
    // Mark as completed and proceed with extraction
    let newStatus: string | null = null;

    switch (event) {
      case "call_started":
        newStatus = "calling";
        break;
      case "call_ended":
      case "call_analyzed":
        // Human answered = completed, regardless of call_successful
        newStatus = "completed";
        break;
      default:
        // Unknown event - just log and acknowledge
        console.log(`[Retell Webhook] Unknown event: ${event}`);
    }

    if (newStatus && canProgressStatus(currentStatus, newStatus)) {
      callUpdates.status = newStatus;
    }

    // Handle is_extracting behavior on call_ended or call_analyzed
    if (event === "call_ended" || event === "call_analyzed") {
      if (hasTranscript) {
        // Set is_extracting=true to signal that extraction should happen
        callUpdates.is_extracting = true;
        console.log(
          `[Retell Webhook] Call ${callId} marked as completed (human answered), will run extraction`
        );
      } else {
        // No transcript available - mark as not extracting with failure reason
        callUpdates.is_extracting = false;
        callUpdates.failure_reason = "transcript_missing";
      }
    }
  }

  // 10. Update calls table
  const { error: updateError } = await supabase
    .from("calls")
    .update(callUpdates)
    .eq("id", callId);

  if (updateError) {
    console.error(
      `[Retell Webhook] Failed to update call ${callId}:`,
      updateError
    );
    // Still return 200 to prevent webhook retries
  }

  // 11. Store artifacts (upsert into call_artifacts)
  // Always store the raw payload; optionally store transcript for debugging even on failed calls
  const artifactData: Record<string, unknown> = {
    call_id: callId,
    raw_provider_payload_json: payload,
    updated_at: new Date().toISOString(),
  };

  if (call.transcript) {
    artifactData.transcript_text = call.transcript;
  }

  if (call.transcript_object) {
    artifactData.transcript_json = call.transcript_object;
  }

  // Upsert: if row exists, update; otherwise insert
  const { error: upsertError } = await supabase
    .from("call_artifacts")
    .upsert(artifactData, { onConflict: "call_id" });

  if (upsertError) {
    console.error(
      `[Retell Webhook] Failed to upsert call_artifacts for ${callId}:`,
      upsertError
    );
  }

  // 12. Run extraction on call_analyzed (preferred) or call_ended if transcript exists
  // IMPORTANT: Skip extraction for "no human reached" scenarios
  
  if (noHumanReached) {
    console.log(
      `[Retell Webhook] Skipping extraction for call ${callId} (no human reached)`
    );

    // Clear answers_json if it was already written (idempotency: voicemail detected after extraction ran)
    const { error: clearAnswersError } = await supabase
      .from("call_artifacts")
      .update({ answers_json: null, updated_at: new Date().toISOString() })
      .eq("call_id", callId);

    if (clearAnswersError) {
      console.error(
        `[Retell Webhook] Failed to clear answers_json for ${callId}:`,
        clearAnswersError
      );
    } else {
      console.log(
        `[Retell Webhook] Cleared answers_json for call ${callId} (no human reached)`
      );
    }
  } else if (event === "call_analyzed" && hasTranscript) {
    // Prefer call_analyzed as it has more complete data
    // Extraction runs asynchronously but we await to ensure it completes before responding
    //
    // IMPORTANT: Also run extraction if call_analyzed is correcting a call_ended mistake
    // (e.g., call_ended wrongly set status to failed, but human actually answered)
    //
    // Check if we need to run extraction (first time or corrective run)
    const { data: artifacts } = await supabase
      .from("call_artifacts")
      .select("answers_json")
      .eq("call_id", callId)
      .single();

    const needsExtraction = !artifacts?.answers_json || shouldAllowCallAnalyzedOverride;

    if (needsExtraction) {
      console.log(
        `[Retell Webhook] Running extraction for call ${callId} (call_analyzed, corrective=${shouldAllowCallAnalyzedOverride})`
      );
      try {
        await extractAnswers(
          callId,
          call.transcript_object as Parameters<typeof extractAnswers>[1],
          call.transcript ?? null
        );
      } catch (err) {
        console.error(`[Retell Webhook] Extraction failed for ${callId}:`, err);
        // Extraction failure is handled inside extractAnswers - no need to update here
      }
    } else {
      console.log(
        `[Retell Webhook] Skipping extraction for call ${callId} (already extracted)`
      );
    }
  } else if (event === "call_ended" && hasTranscript) {
    // For call_ended, we set is_extracting=true above but don't run extraction yet
    // We wait for call_analyzed which has more complete data
    // However, if call_analyzed never comes (edge case), we'd need a background job
    // For MVP, we'll also trigger extraction on call_ended as a fallback
    // To avoid double extraction, only run if this is the final event we expect
    // Since Retell typically sends call_analyzed after call_ended, we'll skip extraction here
    // and rely on call_analyzed. The is_extracting=true flag signals UI to wait.
    console.log(`[Retell Webhook] Waiting for call_analyzed for extraction (call ${callId})`);
  }

  // 13. Return quickly to acknowledge webhook
  return new NextResponse(null, { status: 204 });
}
