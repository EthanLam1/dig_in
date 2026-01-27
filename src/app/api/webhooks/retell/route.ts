// POST /api/webhooks/retell
// Receives Retell webhook events, verifies signature, updates call status and stores transcripts.
// Runs Step 6 extraction when transcript is ready.

import { NextRequest, NextResponse } from "next/server";
import Retell from "retell-sdk";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { extractAnswers } from "@/lib/extractAnswers";

// Status progression order (forward-only updates)
const STATUS_ORDER = ["queued", "calling", "connected", "completed", "failed"];

// Disconnection reasons indicating no human was reached
// See Retell docs: https://docs.retellai.com/api-references/list-calls
const NO_HUMAN_REACHED_REASONS = new Set([
  "voicemail_reached",
  "dial_no_answer",
  "dial_busy",
  "dial_failed",
]);

// Voicemail transcript heuristics (case-insensitive)
const VOICEMAIL_PHRASES = [
  "forwarded to voicemail",
  "record your message",
  "at the tone",
  "not available",
];

/**
 * Detects if a call hit voicemail or no answer using:
 * 1. Primary: call_analysis.in_voicemail
 * 2. Secondary: call_analysis.call_successful === false + transcript voicemail phrases
 * 3. Fallback: transcript heuristics if call_analysis is missing
 */
function isVoicemailOrNoAnswer(
  callAnalysis: { in_voicemail?: boolean; call_successful?: boolean } | undefined | null,
  transcript: string | undefined | null
): boolean {
  // Primary check: explicit voicemail flag from Retell
  if (callAnalysis?.in_voicemail === true) {
    return true;
  }

  // Secondary check: call not successful + voicemail phrases in transcript
  if (callAnalysis?.call_successful === false && transcript) {
    const lowerTranscript = transcript.toLowerCase();
    if (VOICEMAIL_PHRASES.some((phrase) => lowerTranscript.includes(phrase))) {
      return true;
    }
  }

  // Fallback: transcript heuristics if call_analysis is missing
  if (!callAnalysis && transcript) {
    const lowerTranscript = transcript.toLowerCase();
    if (VOICEMAIL_PHRASES.some((phrase) => lowerTranscript.includes(phrase))) {
      return true;
    }
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
    .select("id, status, is_extracting")
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

  // 6.5. Extract voicemail detection info early (needed for idempotency check)
  const callAnalysis = call.call_analysis;
  const transcriptText = call.transcript ?? null;
  const detectedVoicemail = isVoicemailOrNoAnswer(callAnalysis, transcriptText);

  // 6.6. Idempotency check: if call is already terminal, short-circuit
  // A call is terminal if status is 'completed' or 'failed' AND is_extracting is false
  // Retell can retry/duplicate webhooks, so we skip processing for already-finished calls
  // EXCEPTION: allow call_analyzed to override completed status if voicemail is detected
  const isTerminal =
    (currentStatus === "completed" || currentStatus === "failed") &&
    !currentIsExtracting;

  const shouldAllowVoicemailOverride =
    event === "call_analyzed" &&
    detectedVoicemail &&
    currentStatus === "completed";

  if (isTerminal && !shouldAllowVoicemailOverride) {
    console.log(
      `[Retell Webhook] Call ${callId} is already terminal (status=${currentStatus}), skipping duplicate event`
    );
    return new NextResponse(null, { status: 200 });
  }

  if (shouldAllowVoicemailOverride) {
    console.log(
      `[Retell Webhook] Call ${callId} was completed but voicemail detected in call_analyzed, overriding to failed`
    );
  }

  // 7. Extract disconnection_reason from payload (for call_ended events)
  const disconnectionReason = call.disconnection_reason;
  const hasTranscript = !!(call.transcript || call.transcript_object);

  // Check if this is a "no human reached" scenario from call_ended disconnection_reason
  const isNoHumanReachedFromDisconnection =
    event === "call_ended" &&
    disconnectionReason &&
    NO_HUMAN_REACHED_REASONS.has(disconnectionReason);

  // Check if this is a voicemail scenario from call_analyzed (using call_analysis + transcript)
  const isVoicemailFromCallAnalyzed =
    event === "call_analyzed" && detectedVoicemail;

  // Combined check: either disconnection reason OR voicemail detection
  const isNoHumanReached =
    isNoHumanReachedFromDisconnection || isVoicemailFromCallAnalyzed;

  // Also check for voicemail on call_ended using transcript heuristics (safety guard)
  const isVoicemailFromCallEnded =
    event === "call_ended" && detectedVoicemail;

  // Log disconnection reason for debugging
  if (event === "call_ended" && disconnectionReason) {
    console.log(
      `[Retell Webhook] Call ${callId} ended with disconnection_reason: ${disconnectionReason}`
    );
  }

  if (isVoicemailFromCallAnalyzed) {
    console.log(
      `[Retell Webhook] Call ${callId} voicemail detected from call_analyzed (in_voicemail=${callAnalysis?.in_voicemail}, call_successful=${callAnalysis?.call_successful})`
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
    return JSON.stringify(details);
  };

  // 9. Handle different scenarios
  if (isNoHumanReached || isVoicemailFromCallEnded) {
    // No human was reached (voicemail, no answer, busy, dial failed)
    // Mark as failed and skip extraction
    callUpdates.status = "failed";
    callUpdates.is_extracting = false;
    callUpdates.failure_reason = "Your phone call was not answered";
    callUpdates.failure_details = buildFailureDetails();

    const reason = isVoicemailFromCallAnalyzed
      ? "voicemail detected in call_analyzed"
      : isVoicemailFromCallEnded
      ? "voicemail detected in call_ended"
      : `disconnection: ${disconnectionReason}`;

    console.log(
      `[Retell Webhook] Call ${callId} marked as failed: no human reached (${reason})`
    );
  } else {
    // Normal status progression
    let newStatus: string | null = null;

    switch (event) {
      case "call_started":
        newStatus = "calling";
        break;
      case "call_ended":
      case "call_analyzed":
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
  // IMPORTANT: Skip extraction for "no human reached" or voicemail scenarios
  const shouldSkipExtraction = isNoHumanReached || isVoicemailFromCallEnded;

  if (shouldSkipExtraction) {
    console.log(
      `[Retell Webhook] Skipping extraction for call ${callId} (no human reached / voicemail)`
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
        `[Retell Webhook] Cleared answers_json for call ${callId} (voicemail)`
      );
    }
  } else if (event === "call_analyzed" && hasTranscript) {
    // Prefer call_analyzed as it has more complete data
    // Extraction runs asynchronously but we await to ensure it completes before responding
    console.log(`[Retell Webhook] Running extraction for call ${callId} (call_analyzed)`);
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
