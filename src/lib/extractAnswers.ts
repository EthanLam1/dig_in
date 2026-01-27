// src/lib/extractAnswers.ts
// Extracts structured answers from call transcripts using OpenAI
// Step 6 implementation - called by webhook after transcript is ready

import OpenAI from "openai";
import { getSupabaseAdmin } from "./supabaseAdmin";

// ─────────────────────────────────────────────────────────────────────────────
// Types matching PROJECT_CONTEXT.md section 6.2
// ─────────────────────────────────────────────────────────────────────────────

interface ReservationResult {
  status: "confirmed" | "failed" | "needs_followup";
  details: string;
  confirmed_datetime_local_iso: string | null;
  timezone: string | null;
  party_size: number | null;
  name: string | null;
  callback_phone_e164: string | null;
  confirmation_number: string | null;
  failure_reason: string | null;
  failure_category: string | null;
}

interface AnswerItem {
  question: string;
  answer: string;
  details: string | null;
  confidence: number;
  needs_followup: boolean;
  source_snippet: string | null;
}

interface ExtractionOutput {
  reservation?: ReservationResult;
  answers: AnswerItem[];
  overall_notes: string;
}

interface CallData {
  id: string;
  call_intent: string;
  reservation_name: string | null;
  reservation_phone_e164: string | null;
  reservation_datetime_local_iso: string | null;
  reservation_timezone: string | null;
  reservation_party_size: number | null;
  questions_json: {
    presets: {
      wait_time_now: { enabled: boolean };
      dietary_options: { enabled: boolean; restriction?: string };
      hours_today: { enabled: boolean };
      takes_reservations: { enabled: boolean };
    };
    custom_questions: string[];
  };
}

interface TranscriptUtterance {
  role?: string;
  speaker?: string;
  content?: string;
  words?: Array<{ word: string; start?: number; end?: number }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats transcript_json into readable text with timestamps and speakers.
 */
function formatTranscriptJson(
  transcriptJson: TranscriptUtterance[]
): string {
  if (!Array.isArray(transcriptJson) || transcriptJson.length === 0) {
    return "";
  }

  return transcriptJson
    .map((utterance) => {
      const role = utterance.role || utterance.speaker || "Unknown";
      const content = utterance.content || "";
      // Try to get timestamp from first word if available
      const timestamp = utterance.words?.[0]?.start;
      const timeStr =
        timestamp !== undefined
          ? `[${formatTimestamp(timestamp)}]`
          : "";
      return `${timeStr} ${role}: ${content}`.trim();
    })
    .join("\n");
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Builds the list of questions that were asked based on call data.
 */
function buildQuestionsAskedList(callData: CallData): string[] {
  const questions: string[] = [];
  const presets = callData.questions_json?.presets;

  if (presets?.wait_time_now?.enabled) {
    questions.push("What's the wait time right now?");
  }
  if (presets?.dietary_options?.enabled && presets.dietary_options.restriction) {
    questions.push(
      `Do you have ${presets.dietary_options.restriction} options?`
    );
  }
  if (presets?.hours_today?.enabled) {
    questions.push("What are your hours today?");
  }
  if (presets?.takes_reservations?.enabled) {
    questions.push("Do you take reservations?");
  }

  const customQuestions = callData.questions_json?.custom_questions || [];
  questions.push(...customQuestions.filter((q) => q && q.trim()));

  return questions;
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calls OpenAI to extract structured answers from transcript.
 */
async function callOpenAI(
  callData: CallData,
  transcript: string
): Promise<ExtractionOutput> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const openai = new OpenAI({ apiKey });

  const questionsAsked = buildQuestionsAskedList(callData);
  const isReservation = callData.call_intent === "make_reservation";

  // Build system prompt
  const systemPrompt = `You extract structured data from restaurant phone call transcripts. Output ONLY valid JSON matching the schema, no prose.`;

  // Build user prompt
  let userPrompt = `Extract information from this restaurant call transcript.\n\n`;

  if (isReservation) {
    userPrompt += `CALL INTENT: Make a reservation\n`;
    userPrompt += `RESERVATION REQUEST:\n`;
    userPrompt += `- Name: ${callData.reservation_name || "unknown"}\n`;
    userPrompt += `- Party size: ${callData.reservation_party_size || "unknown"}\n`;
    userPrompt += `- Requested time: ${callData.reservation_datetime_local_iso || "unknown"}\n`;
    userPrompt += `- Timezone: ${callData.reservation_timezone || "unknown"}\n`;
    userPrompt += `- Callback: ${callData.reservation_phone_e164 || "unknown"}\n\n`;
  } else {
    userPrompt += `CALL INTENT: Questions only (no reservation)\n\n`;
  }

  if (questionsAsked.length > 0) {
    userPrompt += `EXTRA QUESTIONS ASKED:\n${questionsAsked.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\n`;
  }

  userPrompt += `TRANSCRIPT:\n${transcript}\n\n`;

  // Define JSON schema for response
  if (isReservation) {
    userPrompt += `OUTPUT JSON SCHEMA:
{
  "reservation": {
    "status": "confirmed" | "failed" | "needs_followup",
    "details": "summary string",
    "confirmed_datetime_local_iso": "ISO string or null",
    "timezone": "IANA timezone or null",
    "party_size": number or null,
    "name": "string or null",
    "callback_phone_e164": "E.164 string or null",
    "confirmation_number": "string or null",
    "failure_reason": "string or null (why reservation failed)",
    "failure_category": "no_reservations|fully_booked|online_only|needs_credit_card|call_back_later|unclear|other or null"
  },
  "answers": [{"question": "...", "answer": "...", "details": "...", "confidence": 0.0-1.0, "needs_followup": bool, "source_snippet": "..."}],
  "overall_notes": "string"
}`;
  } else {
    userPrompt += `OUTPUT JSON SCHEMA (no reservation object since this is questions-only):
{
  "answers": [{"question": "...", "answer": "...", "details": "...", "confidence": 0.0-1.0, "needs_followup": bool, "source_snippet": "..."}],
  "overall_notes": "string"
}`;
  }

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 1500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty response");
  }

  const parsed = JSON.parse(content) as ExtractionOutput;

  // Ensure answers array exists
  if (!parsed.answers) {
    parsed.answers = [];
  }
  if (!parsed.overall_notes) {
    parsed.overall_notes = "";
  }

  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Extraction Function
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractAnswersResult {
  success: boolean;
  error?: string;
}

/**
 * Extracts answers from a call's transcript and updates the database.
 * Called after webhook indicates transcript is ready.
 *
 * @param callId - The call UUID
 * @param transcriptJson - Parsed transcript_object from webhook (preferred)
 * @param transcriptText - Fallback plain text transcript
 */
export async function extractAnswers(
  callId: string,
  transcriptJson: TranscriptUtterance[] | null,
  transcriptText: string | null
): Promise<ExtractAnswersResult> {
  const supabase = getSupabaseAdmin();

  // 1. Get transcript as readable text
  let transcript: string;
  if (transcriptJson && Array.isArray(transcriptJson) && transcriptJson.length > 0) {
    transcript = formatTranscriptJson(transcriptJson);
  } else if (transcriptText && transcriptText.trim()) {
    transcript = transcriptText.trim();
  } else {
    // No transcript - update call and return
    await supabase
      .from("calls")
      .update({
        is_extracting: false,
        failure_reason: "transcript_missing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", callId);

    return { success: false, error: "transcript_missing" };
  }

  // 2. Fetch call data for context
  const { data: callData, error: fetchError } = await supabase
    .from("calls")
    .select(
      "id, call_intent, reservation_name, reservation_phone_e164, reservation_datetime_local_iso, reservation_timezone, reservation_party_size, questions_json"
    )
    .eq("id", callId)
    .single();

  if (fetchError || !callData) {
    console.error(`[extractAnswers] Failed to fetch call ${callId}:`, fetchError);
    return { success: false, error: "call_not_found" };
  }

  // 3. Call OpenAI for extraction
  let extractedData: ExtractionOutput;
  try {
    extractedData = await callOpenAI(callData as CallData, transcript);
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown extraction error";
    console.error(`[extractAnswers] OpenAI extraction failed for ${callId}:`, err);

    // Update call with failure
    await supabase
      .from("calls")
      .update({
        is_extracting: false,
        failure_reason: "extraction_failed",
        failure_details: errorMessage.slice(0, 1000), // Truncate if needed
        updated_at: new Date().toISOString(),
      })
      .eq("id", callId);

    return { success: false, error: errorMessage };
  }

  // 4. Upsert answers_json into call_artifacts
  const { error: artifactError } = await supabase
    .from("call_artifacts")
    .upsert(
      {
        call_id: callId,
        answers_json: extractedData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "call_id" }
    );

  if (artifactError) {
    console.error(
      `[extractAnswers] Failed to upsert call_artifacts for ${callId}:`,
      artifactError
    );
  }

  // 5. Update calls table
  const callUpdates: Record<string, unknown> = {
    is_extracting: false,
    updated_at: new Date().toISOString(),
  };

  // For make_reservation, update reservation_status and reservation_result_json
  if (callData.call_intent === "make_reservation" && extractedData.reservation) {
    callUpdates.reservation_status = extractedData.reservation.status;
    callUpdates.reservation_result_json = extractedData.reservation;
  }
  // For questions_only, reservation_status remains null (no update needed)

  const { error: updateError } = await supabase
    .from("calls")
    .update(callUpdates)
    .eq("id", callId);

  if (updateError) {
    console.error(
      `[extractAnswers] Failed to update call ${callId}:`,
      updateError
    );
  }

  console.log(`[extractAnswers] Successfully extracted answers for call ${callId}`);
  return { success: true };
}
