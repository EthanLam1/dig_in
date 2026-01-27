# Dig In — Design Doc (MVP)

## Goal
Book restaurant reservations for the user via an AI phone agent:

1. User enters a restaurant phone number and chooses either
   a. Book a reservation (time, party size, name, callback phone), or
   b. Ask questions only (no reservation details required)
2. User optionally adds extra questions (wait time, dietary options, hours, etc.)
3. AI places **one** outbound call (Retell), and:
   a. books a reservation (if requested), and/or
   b. asks extra questions one at a time
4. App displays:
   - **Reservation outcome** (confirmed / failed / needs follow-up) + key details
   - **Structured answers** for extra questions
   - Transcript (hidden by default, downloadable)

---

## Non-goals (MVP)
- Full Google Places / nearby search (future work)
- Real-time streaming transcripts (final transcript only)
- Audio recording playback (transcript only)
- Full user authentication (anonymous session history only)
- Heavy scalability/security beyond basic best practices

---

## Product UX

### Routes
Only two routes:
- `/` — Landing + New Reservation Call form
- `/calls` — Call history list + selected call details (no `/calls/[id]` route)

---

### `/` Landing + New Reservation Call Form

**Reservation Inputs (required if “Book a reservation” is enabled)**
If the user chooses ‘Questions only’, these fields are hidden/optional and not required.
- Restaurant phone (**E.164 only**, e.g. `+14165551234`)
- Reservation date/time (next **3 days** for MVP; interpreted as **user local timezone** and clearly indicated in UI)
- Party size (integer)
- Reservation name
- Callback phone (**E.164**; the number the restaurant will associate with the reservation)

**Optional extras**
- Restaurant name (optional label for UI/history)
- Preset extra questions (toggles + inputs):
  1. “What’s the wait time right now?”
  2. “Do you have __ options?” (dietary restriction input)
  3. “What are your hours today?”
  4. “Do you take reservations?” (still useful if booking fails / clarifies policy)
- Custom questions:
  - One text box shown by default
  - Add up to **5** total (one question per box)

**Limits**
- Up to 5 custom questions
- Max total extra questions (presets enabled + custom) = **10**

**Primary CTA**
- Button: **“Make the call!”**

**User-facing errors**
- Malformed input: “Your input could not be parsed because [reason].”
- Call fails: “Call failed”
- No answer: “Your phone call was not answered”
- Transcript missing: “Transcript could not be generated”

On success, create the call and navigate to `/calls` with the newly created call selected.

---

### `/calls` History + Details

**Layout**
- Left panel: history list with infinite scroll (10 initial, load more on scroll)
- Right panel: selected call details

**History item fields**
- Restaurant name (or “Unknown”)
- Restaurant phone
- Created time (local display)
- Status badge (`queued/calling/connected/completed/failed`)
- Reservation outcome badge (when available): Confirmed ✅ / Failed ❌ / Needs follow-up ⚠️
- If call_intent='questions_only', show badge “Questions only”

**Call details**
- Status timeline:
  1. Call starting
  2. Call in progress
  3. Talking to restaurant
  4. Summarizing transcript
  5. Results available

- **Reservation Outcome (prominent section)**
  - Status: confirmed / failed / needs_followup
  - Confirmed details (if any): time, party size, name, callback phone, confirmation number (if provided)
  - Failure reason (if any): fully booked, no reservations, online only, call back later, etc.
  - “If call_intent='questions_only', hide the Reservation Outcome section and show a small label like ‘Questions only call’.”

- **Extra Questions Results**
  - Each question shown with answer + details + confidence

**Transcript**
- Hidden by default
- Button: “Show transcript”
- Button: “Download transcript” (includes timestamps + speaker labels when available)

**Actions**
- “New call” → `/`
- “Retry call” → `/` with reservation details + phone prefilled

**Polling**
- Client polls `GET /api/calls/:id` every **1500ms** while a call is in progress.
- Stop polling when `status in ('completed','failed')` AND `is_extracting = false`.

---

## Architecture

### Components
1. **Web Client (Next.js)**
2. **App Server (Next.js Route Handlers)**
3. **DB (Supabase Postgres)**
4. **Retell** for outbound calling + webhook callbacks
5. **OpenAI API** for transcript → structured extraction (`answers_json` + reservation result)

### End-to-end flow
1. User submits reservation + extra questions on `/`
2. Server validates inputs and stores call row with call_intent, and reservation request fields if booking is requested
3. Server triggers Retell outbound call; stores `provider_call_id`; updates status
4. Retell sends webhook events (started/connected/ended)
5. On call end, server stores final transcript and sets `is_extracting=true`
6. Server calls OpenAI to extract:
   - reservation outcome + details
   - structured answers for extra questions
7. Server stores extraction output, updates reservation result fields, sets `is_extracting=false`
8. UI shows reservation outcome, answers, and transcript

---

## Call Lifecycle and State Model

### DB status enum
- `queued`, `calling`, `connected`, `completed`, `failed`

### Internal processing flag
- `is_extracting` (boolean)

### UI timeline mapping
- Call starting → `queued`
- Call in progress → `calling`
- Talking to restaurant → `connected`
- Summarizing transcript → `completed` + `is_extracting=true`
- Results available → `completed` + `is_extracting=false`

Notes:
- No partial transcript updates in MVP (final transcript only).
- If transcript is missing, call may still be `completed`, but UI surfaces “Transcript could not be generated”.

---

## Data Model (Supabase)

### `calls`
Existing fields:
- `id` (uuid, PK)
- `session_id` (text, NOT NULL) — anonymous session
- `user_id` (uuid, NULL) — reserved for future Supabase Auth
- `restaurant_name` (text, NULL)
- `restaurant_phone_e164` (text, NOT NULL)
- `call_intent` (text) — make_reservation|questions_only
- `questions_json` (jsonb, NOT NULL) — extra questions (presets + custom)
- `status` (text, NOT NULL)
- `is_extracting` (boolean, default false)
- `provider` (text, default `retell`)
- `provider_call_id` (text, NULL)
- `failure_reason` (text, NULL)
- `failure_details` (text, NULL)
- `created_at`, `updated_at`

New reservation request fields (P0):
- `reservation_name` (text, nullable; required only when call_intent='make_reservation')
- `reservation_phone_e164` (text, nullable; required only when call_intent='make_reservation')
- `reservation_datetime_local_iso` (text, nullable; required only when call_intent='make_reservation') — local ISO string (no Z)
- `reservation_timezone` (text, nullable; required only when call_intent='make_reservation') — IANA timezone (e.g., America/Toronto)
- `reservation_party_size` (int, nullable; required only when call_intent='make_reservation')

New reservation result fields (P0):
- `reservation_status` (text, NULL) — set to requested|confirmed|failed|needs_followup only when call_intent='make_reservation'
- `reservation_result_json` (jsonb, NULL) — confirmation number, confirmed time, notes, failure reason/category

### `call_artifacts`
- `call_id` (uuid, PK/FK)
- `transcript_text` (text, NULL)
- `transcript_json` (jsonb, NULL) — timestamps + speaker labels when available
- `answers_json` (jsonb, NULL) — structured extraction output (includes reservation outcome + extra Q&A)
- `raw_provider_payload_json` (jsonb, NULL)
- `created_at`, `updated_at`

---

## API Surface

### `POST /api/calls`
- Accepts call_intent = make_reservation or questions_only
- If questions_only, reservation fields are not required and reservation_status remains null
- Validates required reservation inputs:
  - restaurant phone (E.164)
  - reservation datetime (next 3 days for MVP, user local timezone)
  - party size
  - reservation name
  - reservation callback phone (E.164)
- Validates extra question limits
- Inserts DB call row + triggers Retell outbound call
- Returns `{ call_id }`

### `GET /api/calls`
- Lists calls for current `session_id`
- Supports pagination for infinite scroll

### `GET /api/calls/:id`
- Returns call status + artifacts for selected call (must match session)
- Includes reservation request/result fields for display

### `POST /api/webhooks/retell`
- Receives Retell events; idempotent
- Updates status
- On call end:
  - stores transcript
  - sets `is_extracting=true`
  - runs OpenAI extraction
  - stores `answers_json`
  - updates reservation_status / reservation_result_json
  - sets `is_extracting=false`

---

## JSON Contracts

### Extra questions (`calls.questions_json`)
This contains optional “extra questions” beyond the reservation booking. Example:

```json
{
  "presets": {
    "takes_reservations": { "enabled": true },
    "wait_time_now": { "enabled": true },
    "dietary_options": { "enabled": true, "restriction": "vegan" },
    "hours_today": { "enabled": false }
  },
  "custom_questions": [
    "Do you have outdoor seating?",
    "Is there a corkage fee?"
  ]
}
```

### Extracted answers (`call_artifacts.answers_json`)

```json
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
```

`failure_category` suggested values:
- `no_reservations`
- `fully_booked`
- `online_only`
- `needs_credit_card`
- `call_back_later`
- `unclear`
- `other`

---

## Session and History (No Auth)

- App sets an anonymous `session_id` cookie on first use.
    
- All call history is scoped to that session.
    
- Schema keeps a nullable `user_id` so Supabase Auth can be added later without rewriting tables.
    

---

## Basic Security/Operational Notes

- Keep provider keys server-side only.
    
- Verify Retell webhooks using `x-retell-signature` header + webhook API key (via retell-sdk).
    
- Store raw provider payloads only in DB (not returned to client).

- Reservation name and callback phone are PII; avoid logging them.
    

---

## Future Work

- Replace manual entry with Google Places (nearby restaurant search + place metadata)

- Allow flexible reservation windows (time range + best available)

- Add Supabase Auth and migrate session calls to users across devices

- Realtime updates (websockets or Supabase realtime)

- Improved calling policies/compliance UX text and call scripting


## Extensibility Notes (Nice-to-Haves)

This MVP is intentionally structured so future scope is additive:

- **Nearby restaurants (Google Places):** the app’s “restaurant selection” currently produces `restaurant_name` + `restaurant_phone_e164`. A Places integration can simply populate these same fields and optionally add new nullable metadata fields (e.g., place_id/address/lat/lng) without changing the core call flow.
- **Flexible reservation window:** reservation requests are stored in dedicated `reservation_*` fields, and outcomes are stored in `reservation_result_json`. Adding a time range later can be done by introducing optional window fields while keeping the same extraction + dashboard flow (the agent books the best available time and the chosen time is reflected in `reservation_result_json` and `answers_json.reservation`).
- **Full auth:** the schema already includes `user_id` alongside `session_id`. Supabase Auth can be added by scoping reads to `user_id` and migrating existing session calls to a user upon login.