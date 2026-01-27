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
    const formattedDateTime = formatDateTimeForAgent(params.reservation_datetime_local_iso!);
    lines.push(`I'd like to make a reservation for ${params.reservation_party_size}.`);
    lines.push(`I can only do ${formattedDateTime} — is that exact time available?`);
    lines.push(`Can I book it under the name ${params.reservation_name}?`);
    lines.push(`The callback phone number is ${params.reservation_phone_e164}.`);
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
 * Formats a local ISO datetime string for human-readable speech.
 * Uses relative terms like "today" or "tomorrow" when applicable.
 * e.g., "2026-01-26T19:00:00" -> "tomorrow at 7:00 PM" or "January 26 at 7:00 PM"
 */
function formatDateTimeForAgent(datetimeLocalIso: string): string {
  try {
    // Parse without timezone - treat as local time
    const date = new Date(datetimeLocalIso);
    const now = new Date();
    
    // Get date-only values for comparison (strip time component)
    const targetYear = date.getFullYear();
    const targetMonth = date.getMonth();
    const targetDay = date.getDate();
    
    const todayYear = now.getFullYear();
    const todayMonth = now.getMonth();
    const todayDay = now.getDate();
    
    // Calculate tomorrow
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowYear = tomorrow.getFullYear();
    const tomorrowMonth = tomorrow.getMonth();
    const tomorrowDay = tomorrow.getDate();
    
    // Format time portion
    const timeOptions: Intl.DateTimeFormatOptions = {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    };
    const timeStr = date.toLocaleString("en-US", timeOptions);
    
    // Check if date is today
    if (targetYear === todayYear && targetMonth === todayMonth && targetDay === todayDay) {
      return `today at ${timeStr}`;
    }
    
    // Check if date is tomorrow
    if (targetYear === tomorrowYear && targetMonth === tomorrowMonth && targetDay === tomorrowDay) {
      return `tomorrow at ${timeStr}`;
    }
    
    // For other dates, use "Month Day at Time" (omit year if same year)
    const dateOptions: Intl.DateTimeFormatOptions = {
      month: "long",
      day: "numeric",
    };
    const dateStr = date.toLocaleString("en-US", dateOptions);
    
    return `${dateStr} at ${timeStr}`;
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
