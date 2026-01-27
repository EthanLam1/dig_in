# PROJECT_CONTEXT.md

Source of truth for implementation.  
**Cursor: do not invent new routes, tables, or JSON shapes. If something is missing, ask rather than guessing.**

## 0) Summary

Dig In is a Next.js web app that books restaurant reservations via a voice agent (Retell). Users provide a restaurant phone and either (a) reservation details (time, party size, name, callback phone) to book a reservation, or (b) optional extra questions only. The agent calls the restaurant, attempts to book the reservation, asks extra questions one at a time, and ends. The app shows call progress, reservation outcome, structured answers, and transcript.

## 1) Stack

- Frontend: Next.js (App Router) + TypeScript
    
- UI: Tailwind + shadcn/ui
    
- DB: Supabase Postgres
    
- Auth: none (MVP). Use anonymous `session_id` cookie for session-scoped history.
    
- Voice provider: Retell (outbound calls + webhooks)
    
- Extraction: OpenAI API (transcript → `answers_json` structured output)
    
- Deployment: Vercel
    

## 2) Routes

Only two routes:

- `/` — New reservation call form
    
- `/calls` — Call history list + details panel for selected call
    

❌ No `/calls/[id]` route in MVP.

## 3) UX Requirements

### 3.1 `/` New Reservation Call

**Always required inputs:**

- `restaurant_phone_e164` (E.164 only, e.g. `+14165551234`)

- UI may collect phone number as {country_code} + {national_number} and MUST compose E.164 (+<country_code><digits>) before sending restaurant_phone_e164 / reservation_phone_e164 to the API.
    
- `call_intent` (`make_reservation` | `questions_only`)
    

**Required only if `call_intent = make_reservation`:**

- `reservation_datetime_local_iso` (local ISO, no Z, e.g. `2026-01-26T19:00:00`)
    
- `reservation_timezone` (IANA, e.g. `America/Toronto`)
    
- `reservation_party_size` (int)
    
- `reservation_name` (string)
    
- `reservation_phone_e164` (E.164 callback phone)
    

Optional inputs:

- `restaurant_name` (string)
    

Extra questions:

- Preset toggles + inputs (optional):
    
    - `wait_time_now`
        
    - `dietary_options` (requires `restriction` if enabled)
    
      - When `dietary_options` is enabled, show a toggle: “Still reserve if they can’t accommodate” → maps to dietary_options.proceed_if_unavailable (default true).
      
      - **Note:** `proceed_if_unavailable` is only relevant when `call_intent='make_reservation'`. When `call_intent='questions_only'`, this toggle should be disabled (grayed out) in the UI and cannot be changed. It does not affect `questions_to_ask` in questions_only mode.
        
    - `hours_today`
        
    - `takes_reservations`
        
- Custom questions:
    
    - 1 textarea shown by default
        
    - user may add up to 5
        
- Limits:
    
    - `custom_questions.length <= 5`
        
    - enabled presets + custom questions <= 10
        

CTA:

- “Make the call!”
    

Errors (API error string displayed):

- “Your input could not be parsed because [reason].”
    
- “Call failed”
    
- “Your phone call was not answered”
    
- “Transcript could not be generated”
    

Success:

- Navigate to `/calls?selected=<call_id>`.
    

### 3.2 `/calls` History + Details

List (left panel):

- initial 10, infinite scroll pagination
    
- each row shows:
    
    - restaurant_name (or “Unknown”)
        
    - restaurant_phone_e164
        
    - created_at (local display)
        
    - status badge (`queued/calling/connected/completed/failed`)
        
    - If `call_intent = make_reservation`, show reservation_status badge: `requested|confirmed|failed|needs_followup`
        
    - If `call_intent = questions_only`, show badge: `Questions only`
        

Details (right panel):

- Status timeline (derived):
    
    1. Call starting (`queued`)
        
    2. Call in progress (`calling`)
        
    3. Talking to restaurant (`connected`)
        
    4. Summarizing transcript (`completed` + `is_extracting=true`)
        
    5. Results available (`completed` + `is_extracting=false`)
        
- Reservation Outcome section (prominent):
    
    - status + key details + failure reason/category + confirmation number if any
        
- Extra questions results:
    
    - render `answers_json.answers[]`
        
- Transcript:
    
    - hidden by default
        
    - Show transcript (accordion)
        
    - Download transcript (.txt) with timestamps + speaker labels when available
        
- Buttons:
    
    - New call → `/`
        
    - Retry call → `/` with all reservation details prefilled (and optionally extras)
        

Polling:

- Poll `GET /api/calls/:id` every 1500ms while not terminal
    
- Stop when `status in ('completed','failed') AND is_extracting=false`
    

## 4) Call Lifecycle

DB status enum:

- `queued`, `calling`, `connected`, `completed`, `failed`
    

Processing flag:

- `is_extracting` boolean
    

Reservation result status:

- `requested`, `confirmed`, `failed`, `needs_followup` (nullable until extracted)

Call_intent:

- make_reservation → set reservation_status='requested' on creation

- questions_only → reservation_status remains NULL
    

Terminal definition for polling:

- terminal when `status in ('completed','failed') AND is_extracting=false`
    

## 5) Database Schema

### 5.1 `calls` (existing + new columns)

Existing:

- `id` uuid PK
    
- `session_id` text NOT NULL
    
- `user_id` uuid NULL (future auth)
    
- `restaurant_name` text NULL
    
- `restaurant_phone_e164` text NOT NULL

- `call_intent` text NOT NULL default make_reservation
    
- `questions_json` jsonb NOT NULL (extra questions only)
    
- `status` text NOT NULL
    
- `is_extracting` boolean NOT NULL default false
    
- `provider` text NOT NULL default 'retell'
    
- `provider_call_id` text NULL
    
- `failure_reason` text NULL
    
- `failure_details` text NULL
    
- `created_at` timestamptz default now()
    
- `updated_at` timestamptz default now()
    

Reservation request fields (nullable; required only when call_intent = make_reservation):

- `reservation_name` text NULL
    
- `reservation_phone_e164` text NULL
    
- `reservation_datetime_local_iso` text NULL
    
- `reservation_timezone` text NULL
    
- `reservation_party_size` int NULL
    

New reservation result fields (P0):

- `reservation_status` text NULL (requested|confirmed|failed|needs_followup)
    
- `reservation_result_json` jsonb NULL
    

Indexes:

- `(session_id, created_at desc)`
    
- `(provider_call_id)`
    

### 5.2 `call_artifacts`

- `call_id` uuid PK/FK → calls.id ON DELETE CASCADE
    
- `transcript_text` text NULL
    
- `transcript_json` jsonb NULL
    
- `answers_json` jsonb NULL
    
- `raw_provider_payload_json` jsonb NULL
    
- `created_at`, `updated_at`
    

## 6) Canonical JSON Contracts

### 6.1 Extra questions (`calls.questions_json`)

This contains only optional extra questions beyond booking the reservation.

Example:

{

  "presets": {

    "wait_time_now": { "enabled": true },

    "dietary_options": { "enabled": true, "restriction": "vegan", "proceed_if_unavailable": true },

    "hours_today": { "enabled": false },

    "takes_reservations": { "enabled": true }

  },

  "custom_questions": [

    "Do you have outdoor seating?",

    "Is there a corkage fee?"

  ]

}

Rules:

- missing preset keys may be accepted in requests, but server MUST normalize to include all keys (default `enabled:false`)
    
- if `dietary_options.enabled=true`, `restriction` must be non-empty
    
- ignore empty/whitespace-only custom questions
    
- custom_questions <= 5
    
- enabled preset count + custom_questions count <= 10

- If dietary_options.enabled=true, proceed_if_unavailable defaults to true if missing.
    

### 6.2 Extraction output (`call_artifacts.answers_json`)

This includes reservation outcome + extra question answers.


If call_intent = questions_only, reservation may be omitted or present with status=null. Prefer omitting the reservation object entirely.

Example:

{

  "reservation": {

    "status": "confirmed",

    "details": "Booked for 7:00 PM for 2 under Ethan. Callback: +14165551234.",

    "confirmed_datetime_local_iso": "2026-01-26T19:00:00",

    "timezone": "America/Toronto",

    "party_size": 2,

    "name": "Ethan",

    "callback_phone_e164": "+14165551234",

    "confirmation_number": "A1B2C3",

    "failure_reason": null,

    "failure_category": null

  },

  "answers": [

    {

      "question": "What’s the wait time right now?",

      "answer": "About 20 minutes",

      "details": "They said it’s moderately busy.",

      "confidence": 0.74,

      "needs_followup": false,

      "source_snippet": "[01:10] Restaurant: Probably around a 20 minute wait..."

    }

  ],

  "overall_notes": "Host mentioned weekends fill up quickly."

}

`failure_category` suggested values:

- `no_reservations`
    
- `fully_booked`
    
- `online_only`
    
- `needs_credit_card`
    
- `call_back_later`
    
- `unclear`
    
- `other`
    

## 7) API Endpoints (exact)

### 7.1 POST /api/calls

Purpose:

- validate inputs
    
- insert `calls` row with status `queued`
    
- create Retell outbound call (real)
    
- update `provider_call_id`
    
- return `{ call_id }`
    

Request body example:

{

  "restaurant_name": "Sushi Place",

  "restaurant_phone_e164": "+14165551234",

  "reservation_name": "Ethan",

  "reservation_phone_e164": "+14165550000",

  "call_intent": "make_reservation",

  "reservation_datetime_local_iso": "2026-01-26T19:00:00",

  "reservation_timezone": "America/Toronto",

  "reservation_party_size": 2,

  "questions": { "...": "calls.questions_json per section 6.1" }

}

Response:

{ "call_id": "uuid" }

Validation rules:

- `restaurant_phone_e164` must be E.164 (starts with `+` then digits only)
    
- `call_intent` must be one of: `make_reservation` | `questions_only`
    
- If `call_intent = make_reservation`:
    
    - `reservation_phone_e164` must be E.164 (starts with `+` then digits only)
        
    - `reservation_party_size` integer in [1..20]
        
    - `reservation_datetime_local_iso` + `reservation_timezone` must be within next 3 days inclusive in the provided timezone
        
    - `reservation_name` non-empty
        
- If `call_intent = questions_only`:
    
    - reservation fields (`reservation_*`) MUST be omitted or allowed to be null, and no reservation validation should run
        
- `questions` normalized + limits enforced (section 6.1)
    
- `session_id` cookie must exist (else 400)
    

Behavior:

- Insert call with:
    
    - status = `queued` (or `calling` immediately after Retell returns; either is OK but be consistent)
        
    - reservation_status = `requested`

- If make_reservation: set reservation_status = requested

- If questions_only: set reservation_status = NULL
        
- Create Retell call using dynamic variables (see section 9)
    
- Store returned `provider_call_id`
    
- Do not expose secret keys to client
    

### 7.2 GET /api/calls

Purpose:

- list calls for this session_id with pagination
    

Query params:

- `limit` default 10
    
- `cursor` optional (created_at ISO string)
    

Response example:

(reservation_status may be null for call_intent = questions_only.)

{

  "items": [

    {

      "id": "uuid",

      "restaurant_name": "Sushi Place",

      "restaurant_phone_e164": "+14165551234",

      "call_intent": "make_reservation",

      "status": "calling",

      "is_extracting": false,

      "reservation_status": "requested",

      "created_at": "2026-01-26T00:07:37.631598+00:00"

    }

  ],

  "next_cursor": "2026-01-26T00:07:37.631598+00:00"

}

Rules:

- items are newest → oldest
    
- if cursor provided, return created_at < cursor
    
- next_cursor = created_at of last item if more items exist
    

### 7.3 GET /api/calls/:id

Purpose:

- return call + artifacts for selected call (must match session_id)
    

Response example:

(If call_intent=questions_only, reservation_* fields will be null and reservation_status/result_json null.)

{

  "id": "uuid",

  "restaurant_name": "Sushi Place",

  "restaurant_phone_e164": "+14165551234",

  "call_intent": "make_reservation",

  "reservation_name": "Ethan",

  "reservation_phone_e164": "+14165550000",

  "reservation_datetime_local_iso": "2026-01-26T19:00:00",

  "reservation_timezone": "America/Toronto",

  "reservation_party_size": 2,

  "reservation_status": "confirmed",

  "reservation_result_json": { "...": "optional summary for dashboard" },

  "questions_json": { "...": "extra questions" },

  "status": "completed",

  "is_extracting": false,

  "failure_reason": null,

  "failure_details": null,
  
  "artifacts": {

    "answers_json": { "...": "section 6.2" },

    "transcript_text": "string or null",

    "transcript_json": { "...": "timestamped speaker-labeled transcript if available" }

  }

}

### 7.4 POST /api/webhooks/retell

Purpose:

- ingest Retell events
    
- update call status
    
- store transcript on end
    
- run extraction and update reservation fields
    
- idempotent
    

Security (MVP):

- Verify Retell webhooks using header `x-retell-signature` and `Retell.verify(rawBody, RETELL_WEBHOOK_API_KEY, signature)` from retell-sdk.
    
- If `RETELL_WEBHOOK_API_KEY` is not set, fall back to `RETELL_API_KEY` but log a warning.
    
- Reject with 401 if signature is missing or invalid.
    

Event behavior (MVP mapping):

- call started → calls.status = `calling`
    
- call connected → calls.status = `connected`
    
- call ended:
    
    - calls.status = `completed`
        
    - store transcript in call_artifacts
        
    - calls.is_extracting = true
        
    - run OpenAI extraction:
        
        - write call_artifacts.answers_json
            
        - set calls.reservation_status + calls.reservation_result_json from extracted reservation object
            
    - calls.is_extracting = false
        

If transcript missing:

- still mark completed, set failure_reason or show “Transcript could not be generated”
    

Idempotency:

- webhook handler must safely handle duplicate events without duplicating work
    
- use provider_call_id + event type + timestamps as a guard (store raw payload and short-circuit if already processed)
    

## 8) Session Handling

- Middleware sets `session_id` cookie on first request
    
- All list/detail endpoints must filter by session_id
    
- Keep `user_id` nullable for future Supabase Auth
    

## 9) Retell Call Creation Contract (server-only)

Environment variables:

- `RETELL_API_KEY`
    
- `RETELL_AGENT_ID`
    
- `RETELL_WEBHOOK_API_KEY` (optional; falls back to `RETELL_API_KEY` if not set)
    
- `OPENAI_API_KEY`
    
- `OPENAI_MODEL` (default `gpt-4o-mini`)
    

**Always include:**

- `call_intent`
    
- `questions_to_ask`
    

**Include only when `call_intent = make_reservation`:**

- `reservation_name`
    
- `reservation_phone_e164`
    
- `reservation_datetime_local_iso`
    
- `reservation_timezone`
    
- `reservation_party_size`
    

`questions_to_ask` format example (one per line):

- “Please book a reservation for {party_size} at {datetime} under {name}, callback {phone}.”
    
- “What’s the wait time right now?”
    
- “Do you have vegan options?”
    

`questions_to_ask` rules:

- `questions_to_ask` is a multi-line string (one question/instruction per line). The agent asks/handles each line one at a time.

- If `call_intent='make_reservation'`, construct `questions_to_ask` in this order:

  1) Gatekeepers BEFORE booking:
     - If preset `takes_reservations.enabled=true`, include:
       - “Do you take reservations?”
     - If preset `dietary_options.enabled=true`, include:
       - “Do you have {restriction} options?”
       - “If yes, could you accommodate that for this reservation?”
       - If `dietary_options.proceed_if_unavailable=false`, also include:
         - “If you can’t accommodate that restriction, please let me know — in that case we won’t book the reservation.”

  2) Booking sequence (always after gatekeepers):
     - “I’d like to make a reservation for {party_size}.”
     - “I can only do {formatted_datetime_local} — is that exact time available?”
     - “Can I book it under the name {reservation_name}?”
     - “The callback phone number is {reservation_phone_e164}.”
     - “Could you confirm the reservation details back to me?”

  3) Remaining questions AFTER booking:
     - Append any other enabled preset questions (`wait_time_now`, `hours_today`) and all custom questions, one per line.

- If `call_intent='questions_only'`:
  - Do NOT include the booking sequence.
  - Include only enabled preset questions and custom questions, one per line.

- The agent MUST ask one at a time, skip irrelevant steps when earlier answers make later steps impossible (e.g., do not attempt booking if they do not take reservations), and end politely.

- **`formatted_datetime_local` format:** `formatted_datetime_local` must always be an explicit calendar date + time (e.g., "Tue, Jan 27 at 7:00 PM"). Do NOT use relative words like "today" or "tomorrow". This is formatted from `reservation_datetime_local_iso` + `reservation_timezone`.

- **Callback phone formatting for TTS:** Callback phone must be spoken digit-by-digit with pauses (e.g., "6 4 7, 5 5 5, 0 0 0 0") to prevent TTS reading chunks as "six hundred...". For +1 (US/Canada) numbers, omit "+" and country code, then space each digit with commas between groups (area code, prefix, line number). For other international numbers, remove "+" and speak digit-by-digit with commas every 3-4 digits.


## 10) Extensibility for Nice-to-Haves

The MVP is designed so these are additive changes:

- **Nearby restaurants (Google Places):**
  - Keep restaurant selection normalized to the existing fields: `restaurant_name` + `restaurant_phone_e164`.
  - Future optional DB columns (nullable) may be added without breaking current flows:
    - `restaurant_place_id`, `restaurant_address`, `restaurant_lat`, `restaurant_lng`
  - UI should treat “manual entry” and “Places selection” as two inputs that produce the same canonical restaurant fields.
  - Places selection should populate restaurant_name, restaurant_phone_e164, and optionally restaurant_place_id later.

- **Flexible reservation window:**
  - Keep current exact-time fields as the canonical request.
  - Future optional fields (nullable) can be added:
    - `reservation_window_start_local_iso`, `reservation_window_end_local_iso`
  - Agent behavior becomes: “book any available slot in the window,” and the chosen slot is stored in `reservation_result_json` + `answers_json.reservation.confirmed_datetime_local_iso`.

- **Full auth (Supabase Auth):**
  - `calls.user_id` remains nullable and can be populated after login.
  - Future behavior: scope history by `user_id` (cross-device), and migrate existing `session_id` calls to `user_id` upon login.
  - During migration period, reads may be `(user_id == authed_user) OR (session_id == current_session)`.

- **Webhook security hardening:**
  - MVP uses Retell's official `x-retell-signature` header verification via retell-sdk.
  - Future improvement: additional rate limiting or IP allowlisting without changing endpoint paths or payload storage.


## 11) Cursor Rules (critical)

- Do NOT add new routes beyond `/` and `/calls`
    
- Do NOT add new API endpoints beyond those listed
    
- Do NOT change DB table names
    
- Do NOT change JSON contracts (section 6) without updating this file first
    
- Keep naming consistent:
    
    - `restaurant_phone_e164`
        
    - `reservation_*` fields as specified
        
    - `questions_json` for extras only
        
    - `answers_json` includes `reservation` + `answers[]`
        
- Ask if any behavior is unclear; do not guess