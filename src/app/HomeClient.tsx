"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Phone,
  UtensilsCrossed,
  CalendarCheck,
  Clock,
  Salad,
  Plus,
  Trash2,
  MessageSquare,
  Loader2,
  HelpCircle,
  CheckCircle2,
  Circle,
  CalendarIcon,
  History,
  Search,
  MapPin,
  X,
  Info,
} from "lucide-react";
import Link from "next/link";
import { EmojiBackground } from "@/components/EmojiBackground";

// ─────────────────────────────────────────────────────────────────────────────
// Google Places Types
// ─────────────────────────────────────────────────────────────────────────────

interface PlaceAutocompleteItem {
  place_id: string;
  primary_text: string;
  secondary_text: string;
}

interface PlaceNearbyItem {
  place_id: string;
  name: string;
  short_address: string;
}

interface PlaceDetails {
  place_id: string;
  restaurant_name: string;
  restaurant_phone_e164: string | null;
  restaurant_address: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Restaurant Signals Types
// ─────────────────────────────────────────────────────────────────────────────

interface SignalItem {
  signal_type: "hours_today" | "takes_reservations";
  signal_value_text: string;
  confidence: number | null;
  observed_at: string; // ISO
  expires_at: string | null; // ISO
}

interface SignalsResponse {
  items: SignalItem[];
}

/**
 * Validates E.164 phone number format.
 * Must start with + followed by digits only.
 */
function isValidE164Phone(phone: string): boolean {
  return /^\+\d{1,15}$/.test(phone);
}

/**
 * Formats relative time from an ISO date string.
 * Returns strings like "5 min ago", "2 hours ago", "3 days ago".
 */
function formatRelativeTime(isoDateString: string): string {
  const then = new Date(isoDateString).getTime();
  const now = Date.now();
  const diffMs = now - then;
  
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  if (hours > 0) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (minutes > 0) {
    return `${minutes} min ago`;
  }
  return "just now";
}

/**
 * Fetches shared signals for a restaurant phone number.
 * Returns an array of SignalItem or empty array on error.
 */
async function fetchSignals(restaurantPhoneE164: string): Promise<SignalItem[]> {
  try {
    const params = new URLSearchParams({ restaurant_phone_e164: restaurantPhoneE164 });
    const response = await fetch(`/api/restaurants/signals?${params}`, {
      cache: "no-store",
    });
    
    if (!response.ok) {
      // Treat non-200 as no signals
      return [];
    }
    
    const data: SignalsResponse = await response.json();
    return data.items || [];
  } catch {
    // Network error - treat as no signals
    return [];
  }
}

// Generate a random session token for Google Places billing optimization
function generateSessionToken(): string {
  return crypto.randomUUID();
}

interface PresetState {
  takes_reservations: boolean;
  wait_time_now: boolean;
  dietary_options: { enabled: boolean; restriction: string; proceed_if_unavailable: boolean };
  hours_today: boolean;
}

// Common country codes for the dropdown
const COUNTRY_CODES = [
  { value: "+1", label: "+1 (US/CA)" },
  { value: "+44", label: "+44 (UK)" },
  { value: "+61", label: "+61 (AU)" },
  { value: "+33", label: "+33 (FR)" },
  { value: "+49", label: "+49 (DE)" },
  { value: "+81", label: "+81 (JP)" },
  { value: "+86", label: "+86 (CN)" },
  { value: "+91", label: "+91 (IN)" },
  { value: "+52", label: "+52 (MX)" },
];

// Strip all non-digits from a string
function normalizeToDigits(input: string): string {
  return input.replace(/\D/g, "");
}

// Compose E.164 from country code and national number
function composeE164(countryCode: string, nationalNumber: string): string {
  const digits = normalizeToDigits(nationalNumber);
  return `${countryCode}${digits}`;
}

// Validate phone number length for a given country code
function getPhoneValidationError(countryCode: string, nationalNumber: string): string | null {
  const digits = normalizeToDigits(nationalNumber);
  if (!digits) return null; // Don't show error for empty input
  
  // Validation rules by country code
  if (countryCode === "+1") {
    if (digits.length !== 10) {
      return `US/CA numbers must be 10 digits (currently ${digits.length})`;
    }
  }
  // Add more country-specific validation as needed
  return null;
}

// Check if phone is valid for form submission
function isPhoneValid(countryCode: string, nationalNumber: string): boolean {
  const digits = normalizeToDigits(nationalNumber);
  if (!digits) return false;
  
  if (countryCode === "+1") {
    return digits.length === 10;
  }
  // For other countries, just require some digits (server validates)
  return digits.length >= 5;
}

// Generate time options in 15-minute increments
function generateTimeOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const h = hour.toString().padStart(2, "0");
      const m = minute.toString().padStart(2, "0");
      const value = `${h}:${m}`;
      const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const ampm = hour < 12 ? "AM" : "PM";
      const label = `${hour12}:${m} ${ampm}`;
      options.push({ value, label });
    }
  }
  return options;
}

const TIME_OPTIONS = generateTimeOptions();

export default function HomeClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Form state
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantCountryCode, setRestaurantCountryCode] = useState("+1");
  const [restaurantNationalNumber, setRestaurantNationalNumber] = useState("");
  const [callIntent, setCallIntent] = useState<"make_reservation" | "questions_only">("make_reservation");
  const [presets, setPresets] = useState<PresetState>({
    takes_reservations: false,
    wait_time_now: false,
    dietary_options: { enabled: false, restriction: "", proceed_if_unavailable: true },
    hours_today: false,
  });
  
  // Reservation fields (required only when callIntent = 'make_reservation')
  const [reservationDate, setReservationDate] = useState<Date | undefined>(undefined);
  const [reservationTime, setReservationTime] = useState("19:00"); // Default to 7:00 PM
  const [reservationPartySize, setReservationPartySize] = useState(2);
  const [reservationName, setReservationName] = useState("");
  const [reservationCountryCode, setReservationCountryCode] = useState("+1");
  const [reservationNationalNumber, setReservationNationalNumber] = useState("");
  const [customQuestions, setCustomQuestions] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Form interaction state for validation UX
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Refs for scroll-to-section functionality
  const restaurantCardRef = useRef<HTMLDivElement>(null);
  const questionsCardRef = useRef<HTMLDivElement>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Google Places state
  const [placesSearch, setPlacesSearch] = useState("");
  const [placesSessionToken, setPlacesSessionToken] = useState(() => generateSessionToken());
  const [autocompleteResults, setAutocompleteResults] = useState<PlaceAutocompleteItem[]>([]);
  const [nearbyResults, setNearbyResults] = useState<PlaceNearbyItem[]>([]);
  const [isSearchingPlaces, setIsSearchingPlaces] = useState(false);
  const [isLoadingNearby, setIsLoadingNearby] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [showPlacesDropdown, setShowPlacesDropdown] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [phoneMissingMessage, setPhoneMissingMessage] = useState<string | null>(null);
  const placesSearchRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // Restaurant Signals State
  // ─────────────────────────────────────────────────────────────────────────
  const [signalsItems, setSignalsItems] = useState<SignalItem[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [userDecisionSkipHours, setUserDecisionSkipHours] = useState<boolean | null>(null);
  const signalsDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchedPhoneRef = useRef<string | null>(null);

  // Helper to mark a field as touched
  const markTouched = (fieldName: string) => {
    setTouched((prev) => ({ ...prev, [fieldName]: true }));
  };

  // Check if a field should show its error
  const shouldShowError = (fieldName: string) => {
    return touched[fieldName] || submitAttempted;
  };

  // Prefill from query params (for retry)
  useEffect(() => {
    const name = searchParams.get("restaurant_name");
    const phone = searchParams.get("restaurant_phone_e164");
    if (name) setRestaurantName(name);
    if (phone) {
      // Parse E.164 back to country code + national number
      // Try to match known country codes (longest first)
      const sortedCodes = [...COUNTRY_CODES].sort((a, b) => b.value.length - a.value.length);
      let matched = false;
      for (const code of sortedCodes) {
        if (phone.startsWith(code.value)) {
          setRestaurantCountryCode(code.value);
          setRestaurantNationalNumber(phone.slice(code.value.length));
          matched = true;
          break;
        }
      }
      if (!matched && phone.startsWith("+")) {
        // Default to +1 and put the rest as national number
        setRestaurantCountryCode("+1");
        setRestaurantNationalNumber(phone.slice(1));
      }
    }
  }, [searchParams]);

  // Get user timezone
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // ─────────────────────────────────────────────────────────────────────────
  // Fetch Signals When Phone Becomes Valid
  // ─────────────────────────────────────────────────────────────────────────
  
  // Compose current E.164 phone for signal fetching
  const currentPhoneE164 = composeE164(restaurantCountryCode, restaurantNationalNumber);
  const isPhoneE164Valid = isValidE164Phone(currentPhoneE164);

  useEffect(() => {
    // Clear existing debounce timer
    if (signalsDebounceRef.current) {
      clearTimeout(signalsDebounceRef.current);
    }

    // If phone is invalid or empty, reset signals state
    if (!isPhoneE164Valid) {
      setSignalsItems([]);
      setSignalsLoading(false);
      setUserDecisionSkipHours(null);
      lastFetchedPhoneRef.current = null;
      return;
    }

    // If phone hasn't changed, don't refetch
    if (lastFetchedPhoneRef.current === currentPhoneE164) {
      return;
    }

    // Reset user decision when phone changes
    setUserDecisionSkipHours(null);

    // Debounce the fetch
    signalsDebounceRef.current = setTimeout(async () => {
      setSignalsLoading(true);
      
      const items = await fetchSignals(currentPhoneE164);
      
      setSignalsItems(items);
      setSignalsLoading(false);
      lastFetchedPhoneRef.current = currentPhoneE164;
    }, 250);

    return () => {
      if (signalsDebounceRef.current) {
        clearTimeout(signalsDebounceRef.current);
      }
    };
  }, [currentPhoneE164, isPhoneE164Valid]);

  // ─────────────────────────────────────────────────────────────────────────
  // Google Places Functions
  // ─────────────────────────────────────────────────────────────────────────

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (placesSearchRef.current && !placesSearchRef.current.contains(event.target as Node)) {
        setShowPlacesDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Autocomplete search with debounce
  const searchAutocomplete = useCallback(async (input: string) => {
    if (input.trim().length < 2) {
      setAutocompleteResults([]);
      return;
    }

    setIsSearchingPlaces(true);
    setPlacesError(null);

    try {
      const params = new URLSearchParams({
        input: input.trim(),
        sessionToken: placesSessionToken,
      });
      if (userLocation) {
        params.append("lat", userLocation.lat.toString());
        params.append("lng", userLocation.lng.toString());
      }

      const response = await fetch(`/api/places/autocomplete?${params}`);
      const data = await response.json();

      if (!response.ok) {
        setPlacesError("Google search is unavailable right now — enter restaurant manually.");
        setAutocompleteResults([]);
        return;
      }

      setAutocompleteResults(data.items || []);
      setNearbyResults([]); // Clear nearby when doing autocomplete
      setShowPlacesDropdown(true);
    } catch {
      setPlacesError("Google search is unavailable right now — enter restaurant manually.");
      setAutocompleteResults([]);
    } finally {
      setIsSearchingPlaces(false);
    }
  }, [placesSessionToken, userLocation]);

  // Handle search input change with debounce
  const handlePlacesSearchChange = (value: string) => {
    setPlacesSearch(value);
    setPhoneMissingMessage(null);

    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounce timer
    debounceTimerRef.current = setTimeout(() => {
      searchAutocomplete(value);
    }, 300);
  };

  // Fetch place details and fill form
  const selectPlace = async (placeId: string, placeName?: string) => {
    setIsLoadingDetails(true);
    setPlacesError(null);
    setPhoneMissingMessage(null);

    try {
      const params = new URLSearchParams({ placeId });
      const response = await fetch(`/api/places/details?${params}`);
      const data: PlaceDetails = await response.json();

      if (!response.ok) {
        setPlacesError("Couldn't get restaurant details — enter manually.");
        return;
      }

      // Fill restaurant name
      setRestaurantName(data.restaurant_name || placeName || "");

      // Fill phone if available
      if (data.restaurant_phone_e164) {
        // Parse E.164 back to country code + national number
        const phone = data.restaurant_phone_e164;
        const sortedCodes = [...COUNTRY_CODES].sort((a, b) => b.value.length - a.value.length);
        let matched = false;
        for (const code of sortedCodes) {
          if (phone.startsWith(code.value)) {
            setRestaurantCountryCode(code.value);
            setRestaurantNationalNumber(phone.slice(code.value.length));
            matched = true;
            break;
          }
        }
        if (!matched && phone.startsWith("+")) {
          // Default to +1 and put the rest as national number
          setRestaurantCountryCode("+1");
          setRestaurantNationalNumber(phone.slice(2));
        }
      } else {
        // Phone not available from Google
        setPhoneMissingMessage(
          "Google didn't provide a phone number for this place — please enter it manually."
        );
      }

      // Reset session token after selection (per Google Places billing best practice)
      setPlacesSessionToken(generateSessionToken());

      // Clear search and results
      setPlacesSearch("");
      setAutocompleteResults([]);
      setNearbyResults([]);
      setShowPlacesDropdown(false);
    } catch {
      setPlacesError("Couldn't get restaurant details — enter manually.");
    } finally {
      setIsLoadingDetails(false);
    }
  };

  // Nearby search
  const searchNearby = async () => {
    setIsLoadingNearby(true);
    setPlacesError(null);
    setPhoneMissingMessage(null);

    // Request location if not already available
    if (!userLocation) {
      if (!navigator.geolocation) {
        setPlacesError("Location is not supported by your browser — use search or enter manually.");
        setIsLoadingNearby(false);
        return;
      }

      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 300000, // Cache for 5 minutes
          });
        });

        const { latitude, longitude } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude });

        // Now fetch nearby
        await fetchNearby(latitude, longitude);
      } catch (err) {
        const geoError = err as GeolocationPositionError;
        if (geoError.code === geoError.PERMISSION_DENIED) {
          setPlacesError("Location denied — use search or enter manually.");
        } else {
          setPlacesError("Couldn't get your location — use search or enter manually.");
        }
        setIsLoadingNearby(false);
      }
    } else {
      await fetchNearby(userLocation.lat, userLocation.lng);
    }
  };

  const fetchNearby = async (lat: number, lng: number) => {
    try {
      const params = new URLSearchParams({
        lat: lat.toString(),
        lng: lng.toString(),
      });

      const response = await fetch(`/api/places/nearby?${params}`);
      const data = await response.json();

      if (!response.ok) {
        setPlacesError("Google search is unavailable right now — enter restaurant manually.");
        setNearbyResults([]);
        return;
      }

      setNearbyResults(data.items || []);
      setAutocompleteResults([]); // Clear autocomplete when doing nearby
      setShowPlacesDropdown(true);
    } catch {
      setPlacesError("Google search is unavailable right now — enter restaurant manually.");
      setNearbyResults([]);
    } finally {
      setIsLoadingNearby(false);
    }
  };

  // Clear places search
  const clearPlacesSearch = () => {
    setPlacesSearch("");
    setAutocompleteResults([]);
    setNearbyResults([]);
    setShowPlacesDropdown(false);
    setPlacesError(null);
    setPhoneMissingMessage(null);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
  };

  // Calculate min/max date for reservation (today to today+3 days inclusive)
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  
  const maxDate = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 3);
    return d;
  }, [today]);

  // Helper to build local ISO string from date + time
  const buildDatetimeLocalIso = (date: Date | undefined, time: string): string => {
    if (!date) return "";
    const [hours, minutes] = time.split(":").map(Number);
    const combined = new Date(date);
    combined.setHours(hours, minutes, 0, 0);
    // Format as YYYY-MM-DDTHH:mm (no Z)
    const year = combined.getFullYear();
    const month = String(combined.getMonth() + 1).padStart(2, "0");
    const day = String(combined.getDate()).padStart(2, "0");
    const h = String(combined.getHours()).padStart(2, "0");
    const m = String(combined.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${h}:${m}`;
  };

  // Count enabled presets
  const enabledPresetsCount = [
    presets.takes_reservations,
    presets.wait_time_now,
    presets.dietary_options.enabled,
    presets.hours_today,
  ].filter(Boolean).length;

  // Count non-empty custom questions
  const nonEmptyCustomQuestions = customQuestions.filter(
    (q) => q.trim() !== ""
  );
  const totalQuestions = enabledPresetsCount + nonEmptyCustomQuestions.length;

  const canAddMoreQuestions =
    customQuestions.length < 5 && totalQuestions < 10;

  const addCustomQuestion = () => {
    if (canAddMoreQuestions) {
      setCustomQuestions([...customQuestions, ""]);
    }
  };

  const removeCustomQuestion = (index: number) => {
    if (customQuestions.length > 1) {
      setCustomQuestions(customQuestions.filter((_, i) => i !== index));
    }
  };

  const updateCustomQuestion = (index: number, value: string) => {
    const updated = [...customQuestions];
    updated[index] = value;
    setCustomQuestions(updated);
  };

  // Build live question list for preview
  const liveQuestions = useMemo(() => {
    const questions: string[] = [];

    if (presets.takes_reservations) {
      questions.push("Do you take reservations?");
    }
    if (presets.wait_time_now) {
      questions.push("What's the wait time right now?");
    }
    if (presets.dietary_options.enabled) {
      const restriction = presets.dietary_options.restriction.trim();
      if (restriction) {
        questions.push(`Do you have ${restriction} options?`);
      } else {
        questions.push("Do you have dietary options?");
      }
    }
    if (presets.hours_today) {
      questions.push("What are your hours today?");
    }

    nonEmptyCustomQuestions.forEach((q) => {
      questions.push(q.trim());
    });

    return questions;
  }, [presets, nonEmptyCustomQuestions]);

  const handleSubmit = async () => {
    setError(null);
    setSubmitAttempted(true);

    // Compose E.164 phone numbers
    const restaurantPhoneE164 = composeE164(restaurantCountryCode, restaurantNationalNumber);
    const reservationPhoneE164 = composeE164(reservationCountryCode, reservationNationalNumber);

    // Basic client-side validation - restaurant phone
    if (!isPhoneValid(restaurantCountryCode, restaurantNationalNumber)) {
      setError("Please enter a valid restaurant phone number.");
      return;
    }

    // Validate reservation fields only when booking a reservation
    if (callIntent === "make_reservation") {
      if (!reservationDate) {
        setError("Please select a reservation date.");
        return;
      }

      if (!reservationTime) {
        setError("Please select a reservation time.");
        return;
      }

      if (!reservationPartySize || reservationPartySize < 1 || reservationPartySize > 20) {
        setError("Party size must be between 1 and 20.");
        return;
      }

      if (!reservationName.trim()) {
        setError("Reservation name is required.");
        return;
      }

      if (!isPhoneValid(reservationCountryCode, reservationNationalNumber)) {
        setError("Please enter a valid callback phone number.");
        return;
      }
    }

    // Build questions object (extra questions only)
    const questions = {
      presets: {
        takes_reservations: { enabled: presets.takes_reservations },
        wait_time_now: { enabled: presets.wait_time_now },
        dietary_options: {
          enabled: presets.dietary_options.enabled,
          ...(presets.dietary_options.enabled &&
          presets.dietary_options.restriction.trim()
            ? { restriction: presets.dietary_options.restriction.trim() }
            : {}),
          ...(presets.dietary_options.enabled
            ? { proceed_if_unavailable: presets.dietary_options.proceed_if_unavailable }
            : {}),
        },
        hours_today: { enabled: presets.hours_today },
      },
      custom_questions: nonEmptyCustomQuestions,
    };

    setIsSubmitting(true);

    // Build request body conditionally based on call intent
    const requestBody: Record<string, unknown> = {
      restaurant_name: restaurantName.trim() || undefined,
      restaurant_phone_e164: restaurantPhoneE164,
      call_intent: callIntent,
      questions,
    };

    // Only include reservation fields when booking
    if (callIntent === "make_reservation") {
      requestBody.reservation_name = reservationName.trim();
      requestBody.reservation_phone_e164 = reservationPhoneE164;
      requestBody.reservation_datetime_local_iso = buildDatetimeLocalIso(reservationDate!, reservationTime);
      requestBody.reservation_timezone = userTimezone;
      requestBody.reservation_party_size = reservationPartySize;
    }

    try {
      const response = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to create call.");
        return;
      }

      // Mark as submitted for immediate UI feedback before navigation
      setSubmitted(true);

      // Navigate to /calls with the new call selected
      router.push(`/calls?selected=${data.call_id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Validation errors for inline display
  const restaurantPhoneError = getPhoneValidationError(restaurantCountryCode, restaurantNationalNumber);
  const reservationPhoneError = getPhoneValidationError(reservationCountryCode, reservationNationalNumber);

  // Build disabledReasons array with human-readable messages for each failing requirement
  const disabledReasons = useMemo(() => {
    const reasons: string[] = [];

    // Always required: restaurant phone
    if (!isPhoneValid(restaurantCountryCode, restaurantNationalNumber)) {
      const digits = normalizeToDigits(restaurantNationalNumber);
      if (!digits) {
        reasons.push("Restaurant phone number is required");
      } else {
        reasons.push("Restaurant phone number is invalid" + (restaurantPhoneError ? ` (${restaurantPhoneError})` : ""));
      }
    }

    // At least 1 question OR call_intent is make_reservation
    if (callIntent === "questions_only" && totalQuestions === 0) {
      reasons.push("At least 1 question is required when not booking a reservation");
    }

    // If call_intent='make_reservation', also require reservation fields
    if (callIntent === "make_reservation") {
      if (!reservationDate) {
        reasons.push("Reservation date is required");
      }
      if (!reservationTime) {
        reasons.push("Reservation time is required");
      }
      if (!reservationPartySize || reservationPartySize < 1 || reservationPartySize > 20) {
        if (!reservationPartySize || reservationPartySize < 1) {
          reasons.push("Party size must be at least 1");
        } else {
          reasons.push("Party size must be 20 or less");
        }
      }
      if (!reservationName.trim()) {
        reasons.push("Reservation name is required");
      }
      if (!isPhoneValid(reservationCountryCode, reservationNationalNumber)) {
        const digits = normalizeToDigits(reservationNationalNumber);
        if (!digits) {
          reasons.push("Callback phone number is required");
        } else {
          reasons.push("Callback phone number is invalid" + (reservationPhoneError ? ` (${reservationPhoneError})` : ""));
        }
      }
    }

    // If dietary preset enabled, restriction must be non-empty
    if (presets.dietary_options.enabled && !presets.dietary_options.restriction.trim()) {
      reasons.push("Dietary restriction is required when dietary options is enabled");
    }

    return reasons;
  }, [
    restaurantCountryCode,
    restaurantNationalNumber,
    restaurantPhoneError,
    callIntent,
    totalQuestions,
    reservationDate,
    reservationTime,
    reservationPartySize,
    reservationName,
    reservationCountryCode,
    reservationNationalNumber,
    reservationPhoneError,
    presets.dietary_options.enabled,
    presets.dietary_options.restriction,
  ]);

  // Form is valid when there are no disabled reasons
  const isFormValid = disabledReasons.length === 0;

  // ─────────────────────────────────────────────────────────────────────────────
  // Stepper State Computation
  // ─────────────────────────────────────────────────────────────────────────────
  
  // Step 1: Restaurant is complete when phone is valid
  const restaurantComplete = useMemo(() => {
    return isPhoneValid(restaurantCountryCode, restaurantNationalNumber);
  }, [restaurantCountryCode, restaurantNationalNumber]);

  // Step 2: Questions are complete when:
  // - All required reservation fields are valid (if call_intent=make_reservation)
  // - questions_json passes validation (dietary restriction present if enabled)
  const questionsComplete = useMemo(() => {
    // Check reservation fields if making a reservation
    if (callIntent === "make_reservation") {
      if (!reservationDate) return false;
      if (!reservationTime) return false;
      if (!reservationPartySize || reservationPartySize < 1 || reservationPartySize > 20) return false;
      if (!reservationName.trim()) return false;
      if (!isPhoneValid(reservationCountryCode, reservationNationalNumber)) return false;
    } else {
      // For questions_only, need at least 1 question
      if (totalQuestions === 0) return false;
    }
    
    // Check dietary restriction is filled if enabled
    if (presets.dietary_options.enabled && !presets.dietary_options.restriction.trim()) {
      return false;
    }
    
    return true;
  }, [
    callIntent,
    reservationDate,
    reservationTime,
    reservationPartySize,
    reservationName,
    reservationCountryCode,
    reservationNationalNumber,
    totalQuestions,
    presets.dietary_options.enabled,
    presets.dietary_options.restriction,
  ]);

  // Derive active step index: 0 = Restaurant, 1 = Questions, 2 = Results
  const activeStepIndex = useMemo(() => {
    if (!restaurantComplete) return 0;
    if (!questionsComplete) return 1;
    return 2; // Ready to submit
  }, [restaurantComplete, questionsComplete]);

  // Scroll to section handlers
  const scrollToRestaurant = useCallback(() => {
    restaurantCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const scrollToQuestions = useCallback(() => {
    questionsCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <>
      <EmojiBackground />
      {/* Main content wrapper - positioned above emoji background (z-10 > z-0) */}
      <div className="min-h-screen relative z-10">
      {/* Header */}
      <header className="pt-12 pb-8">
        <div className="container mx-auto max-w-6xl px-4">
          <div className="flex items-start justify-between">
            {/* Left spacer for balance */}
            <div className="w-[130px] hidden sm:block" />
            
            {/* Center content */}
            <div className="flex-1 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <UtensilsCrossed className="size-8 text-primary" />
                <h1 className="text-4xl font-bold tracking-tight text-foreground">
                  Dig In
                </h1>
              </div>
              <p className="text-xl text-muted-foreground font-medium">
                Skip the hold music.
              </p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                Your assistant calls restaurants and summarizes what you need.
              </p>
            </div>
            
            {/* Call history button */}
            <Button
              variant="outline"
              asChild
              className="shrink-0"
            >
              <Link href="/calls">
                <History className="size-4 mr-2" />
                Call history
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Stepper */}
      <div className="flex justify-center mb-8">
        <div className="flex items-center gap-3">
          {/* Step 1: Restaurant */}
          <button
            type="button"
            onClick={scrollToRestaurant}
            className="flex items-center gap-2 group cursor-pointer"
          >
            <div
              className={`flex items-center justify-center size-8 rounded-full transition-colors ${
                restaurantComplete
                  ? "bg-primary text-primary-foreground"
                  : activeStepIndex === 0
                    ? "bg-primary text-primary-foreground"
                    : "border-2 border-border bg-background text-muted-foreground"
              }`}
            >
              {restaurantComplete ? (
                <CheckCircle2 className="size-5" />
              ) : activeStepIndex === 0 ? (
                <span className="text-sm font-semibold">1</span>
              ) : (
                <Circle className="size-4" />
              )}
            </div>
            <span
              className={`text-sm font-medium transition-colors group-hover:text-primary ${
                restaurantComplete || activeStepIndex === 0
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              Restaurant
            </span>
          </button>
          
          <div
            className={`w-8 h-0.5 transition-colors ${
              restaurantComplete ? "bg-primary" : "bg-border"
            }`}
          />
          
          {/* Step 2: Questions */}
          <button
            type="button"
            onClick={scrollToQuestions}
            className="flex items-center gap-2 group cursor-pointer"
          >
            <div
              className={`flex items-center justify-center size-8 rounded-full transition-colors ${
                questionsComplete
                  ? "bg-primary text-primary-foreground"
                  : activeStepIndex === 1
                    ? "bg-primary text-primary-foreground"
                    : "border-2 border-border bg-background text-muted-foreground"
              }`}
            >
              {questionsComplete ? (
                <CheckCircle2 className="size-5" />
              ) : activeStepIndex === 1 ? (
                <span className="text-sm font-semibold">2</span>
              ) : (
                <Circle className="size-4" />
              )}
            </div>
            <span
              className={`text-sm font-medium transition-colors group-hover:text-primary ${
                questionsComplete || activeStepIndex === 1
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              Questions
            </span>
          </button>
          
          <div
            className={`w-8 h-0.5 transition-colors ${
              questionsComplete ? "bg-primary" : "bg-border"
            }`}
          />
          
          {/* Step 3: Results */}
          <div className="flex items-center gap-2">
            <div
              className={`flex items-center justify-center size-8 rounded-full transition-colors ${
                submitted
                  ? "bg-primary text-primary-foreground"
                  : activeStepIndex === 2
                    ? "bg-primary text-primary-foreground"
                    : "border-2 border-border bg-background text-muted-foreground"
              }`}
            >
              {submitted ? (
                <CheckCircle2 className="size-5" />
              ) : activeStepIndex === 2 ? (
                <span className="text-sm font-semibold">3</span>
              ) : (
                <Circle className="size-4" />
              )}
            </div>
            <span
              className={`text-sm font-medium ${
                submitted || activeStepIndex === 2
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              Results
            </span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto max-w-6xl px-4 pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,380px] gap-6">
          {/* Left Column - Form */}
          <div className="space-y-6">
            {/* Restaurant Card */}
            <Card ref={restaurantCardRef} className="shadow-md scroll-mt-6">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Phone className="size-5 text-primary" />
                  <h2 className="text-lg font-semibold">Restaurant</h2>
                </div>
                <div className="space-y-4">
                  {/* Google Places Search Section */}
                  <div ref={placesSearchRef} className="relative">
                    <label className="mb-2 block text-sm font-medium">
                      Find restaurant
                      <span className="text-muted-foreground ml-1">(optional)</span>
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="Search by name..."
                          value={placesSearch}
                          onChange={(e) => handlePlacesSearchChange(e.target.value)}
                          onFocus={() => {
                            if (autocompleteResults.length > 0 || nearbyResults.length > 0) {
                              setShowPlacesDropdown(true);
                            }
                          }}
                          className="pl-9 pr-8 focus-visible:ring-primary"
                          disabled={isLoadingDetails}
                        />
                        {placesSearch && (
                          <button
                            type="button"
                            onClick={clearPlacesSearch}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                          >
                            <X className="size-4" />
                          </button>
                        )}
                        {isSearchingPlaces && (
                          <Loader2 className="absolute right-8 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={searchNearby}
                        disabled={isLoadingNearby || isLoadingDetails}
                        className="shrink-0"
                      >
                        {isLoadingNearby ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <>
                            <MapPin className="size-4 mr-1.5" />
                            Near me
                          </>
                        )}
                      </Button>
                    </div>

                    {/* Dropdown for autocomplete/nearby results */}
                    {showPlacesDropdown && (autocompleteResults.length > 0 || nearbyResults.length > 0) && (
                      <div className="absolute z-20 mt-1 w-full bg-background border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                        {autocompleteResults.length > 0 && (
                          <ul className="py-1">
                            {autocompleteResults.map((item) => (
                              <li key={item.place_id}>
                                <button
                                  type="button"
                                  onClick={() => selectPlace(item.place_id, item.primary_text)}
                                  className="w-full px-3 py-2 text-left hover:bg-muted transition-colors"
                                  disabled={isLoadingDetails}
                                >
                                  <span className="font-medium">{item.primary_text}</span>
                                  {item.secondary_text && (
                                    <span className="text-sm text-muted-foreground ml-1">
                                      {item.secondary_text}
                                    </span>
                                  )}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {nearbyResults.length > 0 && (
                          <>
                            <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50 border-b">
                              Nearby restaurants
                            </div>
                            <ul className="py-1">
                              {nearbyResults.map((item) => (
                                <li key={item.place_id}>
                                  <button
                                    type="button"
                                    onClick={() => selectPlace(item.place_id, item.name)}
                                    className="w-full px-3 py-2 text-left hover:bg-muted transition-colors"
                                    disabled={isLoadingDetails}
                                  >
                                    <span className="font-medium">{item.name}</span>
                                    {item.short_address && (
                                      <span className="text-sm text-muted-foreground ml-1">
                                        {item.short_address}
                                      </span>
                                    )}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    )}

                    {/* Places error message */}
                    {placesError && (
                      <p className="mt-1.5 text-xs text-amber-600">
                        {placesError}
                      </p>
                    )}

                    {/* Loading details indicator */}
                    {isLoadingDetails && (
                      <p className="mt-1.5 text-xs text-muted-foreground flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin" />
                        Getting restaurant details...
                      </p>
                    )}
                  </div>

                  {/* Separator */}
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">or enter manually</span>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="restaurant-name"
                      className="mb-2 block text-sm font-medium"
                    >
                      Restaurant Name
                      <span className="text-muted-foreground ml-1">(optional)</span>
                    </label>
                    <Input
                      id="restaurant-name"
                      type="text"
                      placeholder="e.g., Joe's Pizza"
                      value={restaurantName}
                      onChange={(e) => {
                        setRestaurantName(e.target.value);
                        setPhoneMissingMessage(null);
                      }}
                      className="focus-visible:ring-primary"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="restaurant-phone"
                      className="mb-2 block text-sm font-medium"
                    >
                      Phone Number <span className="text-destructive">*</span>
                    </label>
                    <div className="flex gap-2">
                      <Select
                        value={restaurantCountryCode}
                        onValueChange={setRestaurantCountryCode}
                      >
                        <SelectTrigger className="w-[130px] shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COUNTRY_CODES.map((code) => (
                            <SelectItem key={code.value} value={code.value}>
                              {code.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        id="restaurant-phone"
                        type="tel"
                        placeholder="(416) 555-1234"
                        value={restaurantNationalNumber}
                        onChange={(e) => setRestaurantNationalNumber(e.target.value)}
                        onBlur={() => markTouched("restaurantPhone")}
                        className={`focus-visible:ring-primary flex-1 ${
                          !isPhoneValid(restaurantCountryCode, restaurantNationalNumber) && shouldShowError("restaurantPhone")
                            ? "border-destructive/50"
                            : ""
                        }`}
                      />
                    </div>
                    {restaurantPhoneError && shouldShowError("restaurantPhone") && (
                      <p className="mt-1.5 text-xs text-destructive">
                        {restaurantPhoneError}
                      </p>
                    )}
                    {!normalizeToDigits(restaurantNationalNumber) && shouldShowError("restaurantPhone") && (
                      <p className="mt-1.5 text-xs text-destructive">Required</p>
                    )}
                    {/* Phone missing from Google Places message */}
                    {phoneMissingMessage && (
                      <p className="mt-1.5 text-xs text-amber-600">
                        {phoneMissingMessage}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Call Intent Toggle */}
            <Card ref={questionsCardRef} className={`shadow-md transition-all duration-200 scroll-mt-6 ${
              callIntent === "make_reservation" ? "ring-2 ring-primary/20" : ""
            }`}>
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-lg transition-colors ${
                        callIntent === "make_reservation"
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <CalendarCheck className="size-5" />
                    </div>
                    <div>
                      <h3 className="font-medium">Book a reservation</h3>
                      <p className="text-sm text-muted-foreground">
                        {callIntent === "make_reservation"
                          ? "We'll book a table for you"
                          : "Only asking questions, no booking"}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={callIntent === "make_reservation"}
                    onCheckedChange={(checked) =>
                      setCallIntent(checked ? "make_reservation" : "questions_only")
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {/* Reservation Details Card - Only shown when booking */}
            {callIntent === "make_reservation" && (
            <Card className="shadow-md">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <CalendarCheck className="size-5 text-primary" />
                  <h2 className="text-lg font-semibold">Reservation Details</h2>
                  <span className="text-destructive">*</span>
                </div>
                <div className="space-y-4">
                  {/* Date and Time Row */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium">
                        Date <span className="text-destructive">*</span>
                      </label>
                      <Popover onOpenChange={(open) => { if (!open) markTouched("reservationDate"); }}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={`w-full justify-start text-left font-normal ${
                              !reservationDate && "text-muted-foreground"
                            } ${!reservationDate && shouldShowError("reservationDate") ? "border-destructive/50" : ""}`}
                          >
                            <CalendarIcon className="mr-2 size-4" />
                            {reservationDate ? (
                              format(reservationDate, "EEE, MMM d")
                            ) : (
                              <span>Pick a date</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={reservationDate}
                            onSelect={(date) => {
                              setReservationDate(date);
                              markTouched("reservationDate");
                            }}
                            disabled={(date) =>
                              date < today || date > maxDate
                            }
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      {!reservationDate && shouldShowError("reservationDate") && (
                        <p className="mt-1.5 text-xs text-destructive">Required</p>
                      )}
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium">
                        Time <span className="text-destructive">*</span>
                      </label>
                      <Select
                        value={reservationTime}
                        onValueChange={setReservationTime}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select time" />
                        </SelectTrigger>
                        <SelectContent>
                          {TIME_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Party Size */}
                  <div>
                    <label
                      htmlFor="party-size"
                      className="mb-2 block text-sm font-medium"
                    >
                      Party Size <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="party-size"
                      type="number"
                      min={1}
                      max={20}
                      value={reservationPartySize}
                      onChange={(e) =>
                        setReservationPartySize(parseInt(e.target.value) || 2)
                      }
                      onBlur={() => markTouched("partySize")}
                      className={`focus-visible:ring-primary ${
                        (reservationPartySize < 1 || reservationPartySize > 20) && shouldShowError("partySize")
                          ? "border-destructive/50"
                          : ""
                      }`}
                    />
                    {(reservationPartySize < 1 || reservationPartySize > 20) && shouldShowError("partySize") && (
                      <p className="mt-1.5 text-xs text-destructive">
                        Must be between 1 and 20
                      </p>
                    )}
                  </div>

                  {/* Reservation Name */}
                  <div>
                    <label
                      htmlFor="reservation-name"
                      className="mb-2 block text-sm font-medium"
                    >
                      Name for Reservation <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="reservation-name"
                      type="text"
                      placeholder="e.g., John Smith"
                      value={reservationName}
                      onChange={(e) => setReservationName(e.target.value)}
                      onBlur={() => markTouched("reservationName")}
                      className={`focus-visible:ring-primary ${
                        !reservationName.trim() && shouldShowError("reservationName") ? "border-destructive/50" : ""
                      }`}
                    />
                    {!reservationName.trim() && shouldShowError("reservationName") && (
                      <p className="mt-1.5 text-xs text-destructive">Required</p>
                    )}
                  </div>

                  {/* Callback Phone */}
                  <div>
                    <label
                      htmlFor="callback-phone"
                      className="mb-2 block text-sm font-medium"
                    >
                      Callback Phone <span className="text-destructive">*</span>
                    </label>
                    <div className="flex gap-2">
                      <Select
                        value={reservationCountryCode}
                        onValueChange={setReservationCountryCode}
                      >
                        <SelectTrigger className="w-[130px] shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COUNTRY_CODES.map((code) => (
                            <SelectItem key={code.value} value={code.value}>
                              {code.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        id="callback-phone"
                        type="tel"
                        placeholder="(416) 555-0000"
                        value={reservationNationalNumber}
                        onChange={(e) => setReservationNationalNumber(e.target.value)}
                        onBlur={() => markTouched("callbackPhone")}
                        className={`focus-visible:ring-primary flex-1 ${
                          !isPhoneValid(reservationCountryCode, reservationNationalNumber) && shouldShowError("callbackPhone")
                            ? "border-destructive/50"
                            : ""
                        }`}
                      />
                    </div>
                    {reservationPhoneError && shouldShowError("callbackPhone") && (
                      <p className="mt-1.5 text-xs text-destructive">
                        {reservationPhoneError}
                      </p>
                    )}
                    {!normalizeToDigits(reservationNationalNumber) && shouldShowError("callbackPhone") && !reservationPhoneError && (
                      <p className="mt-1.5 text-xs text-destructive">Required</p>
                    )}
                    <div className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <HelpCircle className="size-3.5 mt-0.5 shrink-0" />
                      <span>Your phone for the restaurant to confirm</span>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Times are in your local timezone ({userTimezone}).
                  </p>
                </div>
              </CardContent>
            </Card>
            )}

            {/* Recent Info from Dig In - Signals Card */}
            {(signalsLoading || signalsItems.length > 0) && (
              <Card className="shadow-md border-primary/20 bg-primary/5">
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Info className="size-4 text-primary" />
                    <h3 className="text-sm font-semibold text-primary">Recent info from Dig In</h3>
                  </div>
                  
                  {signalsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      <span>Loading recent info...</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {signalsItems.map((signal, index) => {
                        const isHoursToday = signal.signal_type === "hours_today";
                        const isTakesReservations = signal.signal_type === "takes_reservations";
                        
                        return (
                          <div key={index} className="space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="text-sm font-medium">
                                  {isHoursToday ? "Hours today" : isTakesReservations ? "Takes reservations" : signal.signal_type}
                                </span>
                                <p className="text-sm text-foreground">
                                  {signal.signal_value_text}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Last updated {formatRelativeTime(signal.observed_at)}
                                </p>
                              </div>
                            </div>
                            
                            {/* Skip asking prompt for hours_today */}
                            {isHoursToday && userDecisionSkipHours === null && (
                              <div className="mt-2 p-2 bg-background rounded-md border border-border">
                                <p className="text-sm text-muted-foreground mb-2">
                                  We already have recent hours — skip asking?
                                </p>
                                <div className="flex gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setUserDecisionSkipHours(true);
                                      setPresets((prev) => ({ ...prev, hours_today: false }));
                                    }}
                                  >
                                    Skip
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setUserDecisionSkipHours(false);
                                    }}
                                  >
                                    Ask anyway
                                  </Button>
                                </div>
                              </div>
                            )}
                            
                            {/* Show decision feedback */}
                            {isHoursToday && userDecisionSkipHours === true && (
                              <p className="text-xs text-muted-foreground mt-1 italic">
                                Skipped — won&apos;t ask about hours
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Preset Questions Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <MessageSquare className="size-5 text-primary" />
                <h2 className="text-lg font-semibold">Extra Questions</h2>
                <span className="text-sm text-muted-foreground">(optional)</span>
              </div>

              {/* Reservation Card */}
              <PresetCard
                icon={<CalendarCheck className="size-5" />}
                title="Reservations"
                description="Ask if they accept reservations."
                enabled={presets.takes_reservations}
                onToggle={(enabled) =>
                  setPresets({ ...presets, takes_reservations: enabled })
                }
              />

              {/* Wait Time Card */}
              <PresetCard
                icon={<Clock className="size-5" />}
                title="Wait time"
                description="Get an estimate for right now."
                enabled={presets.wait_time_now}
                onToggle={(enabled) =>
                  setPresets({ ...presets, wait_time_now: enabled })
                }
              />

              {/* Dietary Options Card */}
              <Card
                className={`shadow-md transition-all duration-200 ${
                  presets.dietary_options.enabled
                    ? "ring-2 ring-primary/20"
                    : "hover:shadow-lg"
                }`}
              >
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-lg transition-colors ${
                          presets.dietary_options.enabled
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <Salad className="size-5" />
                      </div>
                      <div>
                        <h3 className="font-medium">Dietary options</h3>
                        <p className="text-sm text-muted-foreground">
                          Check if they can accommodate you.
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={presets.dietary_options.enabled}
                      onCheckedChange={(enabled) =>
                        setPresets({
                          ...presets,
                          dietary_options: {
                            ...presets.dietary_options,
                            enabled,
                          },
                        })
                      }
                    />
                  </div>
                  <div
                    className={`overflow-hidden transition-all duration-200 ${
                      presets.dietary_options.enabled
                        ? "max-h-40 mt-4 opacity-100"
                        : "max-h-0 mt-0 opacity-0"
                    }`}
                  >
                    <label
                      htmlFor="dietary-restriction"
                      className="block text-sm font-medium mb-1.5"
                    >
                      Dietary restriction <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="dietary-restriction"
                      type="text"
                      placeholder="e.g., vegan, gluten-free"
                      value={presets.dietary_options.restriction}
                      onChange={(e) =>
                        setPresets({
                          ...presets,
                          dietary_options: {
                            ...presets.dietary_options,
                            restriction: e.target.value,
                          },
                        })
                      }
                      onBlur={() => markTouched("dietaryRestriction")}
                      className={`focus-visible:ring-primary ${
                        presets.dietary_options.enabled && !presets.dietary_options.restriction.trim() && shouldShowError("dietaryRestriction")
                          ? "border-destructive/50"
                          : ""
                      }`}
                    />
                    {presets.dietary_options.enabled && !presets.dietary_options.restriction.trim() && shouldShowError("dietaryRestriction") && (
                      <p className="mt-1.5 text-xs text-destructive">
                        Required when dietary options is enabled
                      </p>
                    )}
                    <div className={`flex items-center justify-between mt-3 pt-3 border-t border-border ${
                      callIntent === "questions_only" ? "opacity-50" : ""
                    }`}>
                      <div className="flex flex-col">
                        <label
                          htmlFor="proceed-if-unavailable"
                          className={`text-sm text-muted-foreground ${
                            callIntent === "questions_only" ? "cursor-not-allowed" : "cursor-pointer"
                          }`}
                        >
                          Still reserve if they can&apos;t accommodate
                        </label>
                        {callIntent === "questions_only" && (
                          <span className="text-xs text-muted-foreground/70 mt-0.5">
                            Only applies when booking a reservation.
                          </span>
                        )}
                      </div>
                      <Switch
                        id="proceed-if-unavailable"
                        checked={presets.dietary_options.proceed_if_unavailable}
                        disabled={callIntent === "questions_only"}
                        onCheckedChange={(checked) =>
                          setPresets({
                            ...presets,
                            dietary_options: {
                              ...presets.dietary_options,
                              proceed_if_unavailable: checked,
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Hours Today Card */}
              <PresetCard
                icon={<Clock className="size-5" />}
                title="Hours"
                description="Confirm hours for today."
                enabled={presets.hours_today}
                onToggle={(enabled) =>
                  setPresets({ ...presets, hours_today: enabled })
                }
              />
            </div>

            {/* Custom Questions Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <MessageSquare className="size-5 text-primary" />
                  <h2 className="text-lg font-semibold">Custom Questions</h2>
                </div>
                <span className="text-sm text-muted-foreground">
                  {nonEmptyCustomQuestions.length}/5 questions
                </span>
              </div>

              {customQuestions.map((question, index) => (
                <Card key={index} className="shadow-md">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex gap-3">
                      <Textarea
                        placeholder="Ask any question..."
                        value={question}
                        onChange={(e) => updateCustomQuestion(index, e.target.value)}
                        className="min-h-[60px] focus-visible:ring-primary resize-none"
                        aria-label={`Custom question ${index + 1}`}
                      />
                      {customQuestions.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeCustomQuestion(index)}
                          className="text-muted-foreground hover:text-destructive shrink-0"
                          aria-label="Remove question"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}

              {canAddMoreQuestions && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={addCustomQuestion}
                  className="w-full border-dashed hover:border-primary hover:text-primary"
                >
                  <Plus className="size-4 mr-2" />
                  Add question
                </Button>
              )}
            </div>
          </div>

          {/* Right Column - Call Plan Preview (Desktop) */}
          <div className="hidden lg:block">
            <div className="sticky top-6">
              <CallPlanCard
                callIntent={callIntent}
                restaurantName={restaurantName}
                restaurantPhone={composeE164(restaurantCountryCode, restaurantNationalNumber)}
                reservationDate={reservationDate}
                reservationTime={reservationTime}
                reservationPartySize={reservationPartySize}
                reservationName={reservationName}
                reservationPhone={composeE164(reservationCountryCode, reservationNationalNumber)}
                totalQuestions={totalQuestions}
                liveQuestions={liveQuestions}
              />
            </div>
          </div>
        </div>

        {/* Mobile Call Plan Preview */}
        <div className="lg:hidden mt-6">
          <CallPlanCard
            callIntent={callIntent}
            restaurantName={restaurantName}
            restaurantPhone={composeE164(restaurantCountryCode, restaurantNationalNumber)}
            reservationDate={reservationDate}
            reservationTime={reservationTime}
            reservationPartySize={reservationPartySize}
            reservationName={reservationName}
            reservationPhone={composeE164(reservationCountryCode, reservationNationalNumber)}
            totalQuestions={totalQuestions}
            liveQuestions={liveQuestions}
          />
        </div>
      </main>

      {/* Sticky Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-md border-t border-border shadow-lg">
        <div className="container mx-auto max-w-6xl px-4 py-4">
          {/* Validation Errors Panel - Only show after submit attempted */}
          {submitAttempted && disabledReasons.length > 0 && !isSubmitting && (
            <div className="mb-3 p-3 bg-destructive/5 border border-destructive/20 rounded-lg animate-in fade-in slide-in-from-bottom-1 duration-200">
              <p className="text-sm font-medium text-destructive mb-1.5">
                To make the call, please fix:
              </p>
              <ul className="space-y-0.5">
                {disabledReasons.map((reason, index) => (
                  <li key={index} className="text-sm text-destructive/90 flex items-start gap-1.5">
                    <span className="mt-0.5 shrink-0">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          <div className="flex items-center justify-between gap-4">
            {/* Question Count */}
            <div className="flex items-center gap-2">
              <Badge
                variant={totalQuestions > 0 ? "default" : "secondary"}
                className={`text-sm px-3 py-1 ${totalQuestions > 0 ? "bg-primary" : ""}`}
              >
                {totalQuestions} / 10
              </Badge>
              <span className="text-sm text-muted-foreground hidden sm:inline">
                questions
              </span>
            </div>

            {/* Error Message */}
            <div className="flex-1 text-center">
              {error && (
                <p className="text-sm text-destructive font-medium animate-in fade-in slide-in-from-bottom-1 duration-200">
                  {error}
                </p>
              )}
            </div>

            {/* CTA Button */}
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !isFormValid}
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-md px-6 transition-all duration-200 hover:shadow-lg"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Calling…
                </>
              ) : (
                "Make the call!"
              )}
            </Button>
          </div>
        </div>
      </div>
      </div>
    </>
  );
}

// Preset Card Component for simple toggles
function PresetCard({
  icon,
  title,
  description,
  enabled,
  onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <Card
      className={`shadow-md transition-all duration-200 ${
        enabled ? "ring-2 ring-primary/20" : "hover:shadow-lg"
      }`}
    >
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-lg transition-colors ${
                enabled
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {icon}
            </div>
            <div>
              <h3 className="font-medium">{title}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={onToggle} />
        </div>
      </CardContent>
    </Card>
  );
}

// Call Plan Card Component
function CallPlanCard({
  callIntent,
  restaurantName,
  restaurantPhone,
  reservationDate,
  reservationTime,
  reservationPartySize,
  reservationName,
  reservationPhone,
  totalQuestions,
  liveQuestions,
}: {
  callIntent: "make_reservation" | "questions_only";
  restaurantName: string;
  restaurantPhone: string;
  reservationDate: Date | undefined;
  reservationTime: string;
  reservationPartySize: number;
  reservationName: string;
  reservationPhone: string;
  totalQuestions: number;
  liveQuestions: string[];
}) {
  // Format reservation datetime for display
  const formatReservationDateTime = () => {
    if (!reservationDate) return "—";
    const [hours, minutes] = reservationTime.split(":").map(Number);
    const combined = new Date(reservationDate);
    combined.setHours(hours, minutes, 0, 0);
    return combined.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <Card className="shadow-lg bg-white relative z-10">
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 mb-4">
          <Phone className="size-5 text-primary" />
          <h2 className="text-lg font-semibold">Call Plan</h2>
        </div>

        <div className="space-y-4">
          {/* Restaurant Info */}
          <div className="space-y-2">
            <div className="flex justify-between items-start">
              <span className="text-sm text-muted-foreground">Restaurant</span>
              <span className="text-sm font-medium text-right">
                {restaurantName.trim() || "Not specified"}
              </span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-sm text-muted-foreground">Phone</span>
              <span className="text-sm font-mono">
                {restaurantPhone.trim() || "—"}
              </span>
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Mode indicator */}
          <div className="flex items-center gap-2">
            <Badge
              variant={callIntent === "make_reservation" ? "default" : "secondary"}
              className={callIntent === "make_reservation" ? "bg-primary" : ""}
            >
              {callIntent === "make_reservation" ? "Booking reservation" : "Questions only"}
            </Badge>
          </div>

          {/* Reservation Details - Only when booking */}
          {callIntent === "make_reservation" && (
            <>
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <CalendarCheck className="size-3.5" />
                  Reservation
                </h3>
                <div className="flex justify-between items-start">
                  <span className="text-sm text-muted-foreground">Date & Time</span>
                  <span className="text-sm font-medium text-right">
                    {formatReservationDateTime()}
                  </span>
                </div>
                <div className="flex justify-between items-start">
                  <span className="text-sm text-muted-foreground">Party Size</span>
                  <span className="text-sm font-medium">
                    {reservationPartySize} {reservationPartySize === 1 ? "person" : "people"}
                  </span>
                </div>
                <div className="flex justify-between items-start">
                  <span className="text-sm text-muted-foreground">Name</span>
                  <span className="text-sm font-medium text-right">
                    {reservationName.trim() || "—"}
                  </span>
                </div>
                <div className="flex justify-between items-start">
                  <span className="text-sm text-muted-foreground">Callback</span>
                  <span className="text-sm font-mono">
                    {reservationPhone.trim() || "—"}
                  </span>
                </div>
              </div>
            </>
          )}

          {liveQuestions.length > 0 && (
            <>
              <div className="h-px bg-border" />

              {/* Extra Questions List */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                  <span>{callIntent === "questions_only" ? "Questions" : "Extra Questions"}</span>
                  <Badge
                    variant={totalQuestions > 0 ? "default" : "secondary"}
                    className={totalQuestions > 0 ? "bg-primary" : ""}
                  >
                    {totalQuestions} / 10
                  </Badge>
                </h3>
                <ul className="space-y-2">
                  {liveQuestions.map((q, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-primary mt-0.5">•</span>
                      <span className="text-foreground">{q}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          <div className="h-px bg-border" />

          {/* Notes */}
          <div className="space-y-1.5 text-xs text-muted-foreground">
            {callIntent === "make_reservation" ? (
              <p>We&apos;ll book your reservation and summarize the call.</p>
            ) : (
              <p>We&apos;ll call and ask your questions.</p>
            )}
            {callIntent === "make_reservation" && (
              <p>Times shown in your local timezone.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
