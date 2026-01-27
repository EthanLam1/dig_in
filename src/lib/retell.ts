// src/lib/retell.ts
// Retell API client for creating outbound phone calls

const RETELL_API_URL = "https://api.retellai.com/v2/create-phone-call";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RetellDynamicVariables {
  call_intent: string;
  questions_to_ask: string;
  reservation_name?: string;
  reservation_phone_e164?: string;
  reservation_datetime_local_iso?: string;
  reservation_timezone?: string;
  reservation_party_size?: string;
}

export interface CreatePhoneCallRequest {
  from_number: string;
  to_number: string;
  override_agent_id: string;
  retell_llm_dynamic_variables: RetellDynamicVariables;
}

export interface CreatePhoneCallResponse {
  call_id: string;
  call_status: string;
  agent_id: string;
  from_number: string;
  to_number: string;
}

export interface RetellError {
  message: string;
  status: number;
}

export type CreatePhoneCallResult =
  | { success: true; data: CreatePhoneCallResponse }
  | { success: false; error: RetellError };

// ─────────────────────────────────────────────────────────────────────────────
// Preset question builders
// ─────────────────────────────────────────────────────────────────────────────

interface CanonicalPresets {
  wait_time_now: { enabled: boolean };
  dietary_options: { enabled: boolean; restriction?: string; proceed_if_unavailable?: boolean };
  hours_today: { enabled: boolean };
  takes_reservations: { enabled: boolean };
}

/**
 * Builds the questions_to_ask string for Retell dynamic variables.
 * 
 * Format: One question per line.
 * 
 * If call_intent='make_reservation', construct in this order:
 *   1) Gatekeepers BEFORE booking:
 *      - If takes_reservations.enabled: "Do you take reservations?"
 *      - If dietary_options.enabled:
 *        - "Do you have {restriction} options?"
 *        - "If yes, could you accommodate that for this reservation?"
 *        - If proceed_if_unavailable=false: "If you can't accommodate that restriction, please let me know — in that case we won't book the reservation."
 *   2) Booking sequence (4 lines)
 *   3) Remaining questions: wait_time_now, hours_today, custom_questions
 * 
 * If call_intent='questions_only':
 *   - No booking lines
 *   - Include enabled presets + custom questions
 */
export function buildQuestionsToAsk(params: {
  call_intent: "make_reservation" | "questions_only";
  presets: CanonicalPresets;
  custom_questions: string[];
  // Only provided for make_reservation
  reservation_party_size?: number;
  reservation_datetime_local_iso?: string;
  reservation_timezone?: string;
  reservation_name?: string;
  reservation_phone_e164?: string;
}): string {
  const lines: string[] = [];

  if (params.call_intent === "make_reservation") {
    // ─────────────────────────────────────────────────────────────────────────
    // A) Gatekeepers BEFORE booking
    // ─────────────────────────────────────────────────────────────────────────
    
    // takes_reservations gatekeeper
    if (params.presets.takes_reservations.enabled) {
      lines.push("Do you take reservations?");
    }
    
    // dietary_options gatekeeper
    if (params.presets.dietary_options.enabled && params.presets.dietary_options.restriction) {
      lines.push(`Do you have ${params.presets.dietary_options.restriction} options?`);
      lines.push("If yes, could you accommodate that for this reservation?");
      // Only add "won't book" line when proceed_if_unavailable is explicitly false
      if (params.presets.dietary_options.proceed_if_unavailable === false) {
        lines.push("If you can't accommodate that restriction, please let me know — in that case we won't book the reservation.");
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // B) Booking sequence (always after gatekeepers)
    // ─────────────────────────────────────────────────────────────────────────
    const formattedDateTime = formatDateTimeForAgent(params.reservation_datetime_local_iso!, params.reservation_timezone!);
    lines.push(`I'd like to make a reservation for ${params.reservation_party_size}.`);
    lines.push(`I can only do ${formattedDateTime} — is that exact time available?`);
    lines.push(`Can I book it under the name ${params.reservation_name}?`);
    // Format phone for TTS: grouped digits with pauses, no "+" or country code for +1
    const spokenCallbackPhone = formatPhoneForTTS(params.reservation_phone_e164!);
    lines.push(`The callback phone number is ${spokenCallbackPhone}.`);
    lines.push("Could you confirm the reservation details back to me?");

    // ─────────────────────────────────────────────────────────────────────────
    // C) Remaining questions AFTER booking
    // ─────────────────────────────────────────────────────────────────────────
    if (params.presets.wait_time_now.enabled) {
      lines.push("What's the wait time right now?");
    }
    if (params.presets.hours_today.enabled) {
      lines.push("What are your hours today?");
    }
    
    // Add custom questions
    for (const question of params.custom_questions) {
      if (question.trim()) {
        lines.push(question.trim());
      }
    }
  } else {
    // ─────────────────────────────────────────────────────────────────────────
    // questions_only: No booking lines, just enabled presets + custom questions
    // ─────────────────────────────────────────────────────────────────────────
    if (params.presets.takes_reservations.enabled) {
      lines.push("Do you take reservations?");
    }
    if (params.presets.dietary_options.enabled && params.presets.dietary_options.restriction) {
      lines.push(`Do you have ${params.presets.dietary_options.restriction} options?`);
    }
    if (params.presets.wait_time_now.enabled) {
      lines.push("What's the wait time right now?");
    }
    if (params.presets.hours_today.enabled) {
      lines.push("What are your hours today?");
    }
    
    // Add custom questions
    for (const question of params.custom_questions) {
      if (question.trim()) {
        lines.push(question.trim());
      }
    }
  }

  return lines.join("\n");
}

/**
 * Formats an E.164 phone number for human-friendly TTS (text-to-speech).
 * 
 * Speaks digits individually with spaces between them to prevent TTS from
 * reading chunks as numbers (e.g., "six hundred forty-seven").
 * 
 * - For +1 (US/Canada) numbers: omit "+" and country code, format as "X X X, X X X, X X X X"
 *   with commas between groups for pauses.
 * - For other numbers: remove leading "+", speak digit-by-digit with commas every 3-4 digits.
 * 
 * Examples:
 *   "+16475550000" -> "6 4 7, 5 5 5, 0 0 0 0"
 *   "+442079460018" -> "4 4, 2 0 7 9, 4 6 0 0, 1 8"
 */
function formatPhoneForTTS(phoneE164: string): string {
  // Remove the leading "+"
  const digits = phoneE164.replace(/^\+/, "");
  
  // Helper to convert a string of digits to spaced individual digits
  const spaceDigits = (str: string): string => str.split("").join(" ");
  
  // Check if it's a +1 (US/Canada) number: +1 followed by exactly 10 digits
  if (/^1\d{10}$/.test(digits)) {
    // Extract the 10 national digits (skip the country code "1")
    const national = digits.slice(1);
    const areaCode = national.slice(0, 3);
    const exchange = national.slice(3, 6);
    const subscriber = national.slice(6, 10);
    // Format as "X X X, X X X, X X X X" with commas for pauses
    return `${spaceDigits(areaCode)}, ${spaceDigits(exchange)}, ${spaceDigits(subscriber)}`;
  }
  
  // For other international numbers, speak digit-by-digit with commas every 4 digits
  if (digits.length <= 4) {
    return spaceDigits(digits);
  }
  
  // Group digits in chunks of 4 (or 2 for first group if country code), separated by commas
  const groups: string[] = [];
  let remaining = digits;
  
  // First group: assume 2 digits as country code
  groups.push(spaceDigits(remaining.slice(0, 2)));
  remaining = remaining.slice(2);
  
  // Then group remaining in chunks of 4, with last chunk being whatever's left
  while (remaining.length > 0) {
    const chunkSize = remaining.length > 4 ? 4 : remaining.length;
    groups.push(spaceDigits(remaining.slice(0, chunkSize)));
    remaining = remaining.slice(chunkSize);
  }
  
  return groups.join(", ");
}

/**
 * Formats a local ISO datetime string for human-readable speech.
 * Always uses explicit calendar date + time (no relative terms like "today" or "tomorrow").
 * e.g., "2026-01-27T19:00:00" -> "Tue, Jan 27 at 7:00 PM"
 */
function formatDateTimeForAgent(datetimeLocalIso: string, timezone: string): string {
  try {
    // Parse the datetime and format it in the specified timezone
    const date = new Date(datetimeLocalIso);
    
    // Format with explicit weekday, month, and day - never use relative terms
    const dateTimeOptions: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    };
    
    // Format as "Tue, Jan 27, 7:00 PM" then adjust to "Tue, Jan 27 at 7:00 PM"
    const parts = new Intl.DateTimeFormat("en-US", dateTimeOptions).formatToParts(date);
    
    const weekday = parts.find((p) => p.type === "weekday")?.value || "";
    const month = parts.find((p) => p.type === "month")?.value || "";
    const day = parts.find((p) => p.type === "day")?.value || "";
    const hour = parts.find((p) => p.type === "hour")?.value || "";
    const minute = parts.find((p) => p.type === "minute")?.value || "";
    const dayPeriod = parts.find((p) => p.type === "dayPeriod")?.value || "";
    
    // Build: "Tue, Jan 27 at 7:00 PM"
    return `${weekday}, ${month} ${day} at ${hour}:${minute} ${dayPeriod}`;
  } catch {
    // Fallback to raw string if parsing fails
    return datetimeLocalIso;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Retell API Client
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an outbound phone call via Retell API.
 */
export async function createRetellPhoneCall(
  request: CreatePhoneCallRequest
): Promise<CreatePhoneCallResult> {
  const apiKey = process.env.RETELL_API_KEY;
  
  if (!apiKey) {
    return {
      success: false,
      error: {
        message: "RETELL_API_KEY environment variable is not configured",
        status: 500,
      },
    };
  }

  try {
    const response = await fetch(RETELL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request),
    });

    const responseData = await response.json();

    if (!response.ok) {
      // Extract error message from Retell's response
      const errorMessage =
        responseData?.message ||
        responseData?.error ||
        `Retell API error: ${response.status} ${response.statusText}`;
      
      return {
        success: false,
        error: {
          message: errorMessage,
          status: response.status,
        },
      };
    }

    return {
      success: true,
      data: responseData as CreatePhoneCallResponse,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error calling Retell API";
    return {
      success: false,
      error: {
        message: errorMessage,
        status: 500,
      },
    };
  }
}
