"use client";

import { useState, useEffect, useMemo } from "react";
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
} from "lucide-react";
import Link from "next/link";
import { EmojiBackground } from "@/components/EmojiBackground";

interface PresetState {
  takes_reservations: boolean;
  wait_time_now: boolean;
  dietary_options: { enabled: boolean; restriction: string; proceed_if_unavailable: boolean };
  hours_today: boolean;
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

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Form state
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantPhone, setRestaurantPhone] = useState("");
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
  const [reservationPhone, setReservationPhone] = useState("");
  const [customQuestions, setCustomQuestions] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Prefill from query params (for retry)
  useEffect(() => {
    const name = searchParams.get("restaurant_name");
    const phone = searchParams.get("restaurant_phone_e164");
    if (name) setRestaurantName(name);
    if (phone) setRestaurantPhone(phone);
  }, [searchParams]);

  // Get user timezone
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

    // Basic client-side validation - restaurant phone
    if (!restaurantPhone.trim()) {
      setError("Restaurant phone number is required.");
      return;
    }

    if (!/^\+\d+$/.test(restaurantPhone.trim())) {
      setError(
        "Restaurant phone must be in E.164 format (e.g., +14165551234)."
      );
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

      if (!reservationPhone.trim()) {
        setError("Callback phone number is required.");
        return;
      }

      if (!/^\+\d+$/.test(reservationPhone.trim())) {
        setError(
          "Callback phone must be in E.164 format (e.g., +14165551234)."
        );
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
      restaurant_phone_e164: restaurantPhone.trim(),
      call_intent: callIntent,
      questions,
    };

    // Only include reservation fields when booking
    if (callIntent === "make_reservation") {
      requestBody.reservation_name = reservationName.trim();
      requestBody.reservation_phone_e164 = reservationPhone.trim();
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

      // Navigate to /calls with the new call selected
      router.push(`/calls?selected=${data.call_id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Form is valid when restaurant phone is provided, plus reservation fields when booking
  const isFormValid = 
    restaurantPhone.trim() !== "" &&
    (callIntent === "questions_only" || (
      reservationDate !== undefined &&
      reservationTime !== "" &&
      reservationPartySize >= 1 &&
      reservationPartySize <= 20 &&
      reservationName.trim() !== "" &&
      reservationPhone.trim() !== ""
    ));

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-emerald-50/30">
      <EmojiBackground />
      {/* Main content wrapper - positioned above emoji background */}
      <div className="relative z-10">
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
          {/* Step 1 */}
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center size-8 rounded-full bg-primary text-primary-foreground">
              <CheckCircle2 className="size-5" />
            </div>
            <span className="text-sm font-medium text-foreground">Restaurant</span>
          </div>
          <div className="w-8 h-0.5 bg-primary" />
          {/* Step 2 */}
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center size-8 rounded-full bg-primary text-primary-foreground">
              <CheckCircle2 className="size-5" />
            </div>
            <span className="text-sm font-medium text-foreground">Questions</span>
          </div>
          <div className="w-8 h-0.5 bg-border" />
          {/* Step 3 */}
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center size-8 rounded-full border-2 border-border bg-background text-muted-foreground">
              <Circle className="size-4" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">Results</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto max-w-6xl px-4 pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,380px] gap-6">
          {/* Left Column - Form */}
          <div className="space-y-6">
            {/* Restaurant Card */}
            <Card className="shadow-md">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Phone className="size-5 text-primary" />
                  <h2 className="text-lg font-semibold">Restaurant</h2>
                </div>
                <div className="space-y-4">
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
                      onChange={(e) => setRestaurantName(e.target.value)}
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
                    <Input
                      id="restaurant-phone"
                      type="tel"
                      placeholder="+14165551234"
                      value={restaurantPhone}
                      onChange={(e) => setRestaurantPhone(e.target.value)}
                      className="focus-visible:ring-primary"
                    />
                    <div className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <HelpCircle className="size-3.5 mt-0.5 shrink-0" />
                      <span>Use + and country code (e.g., +14165551234)</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Call Intent Toggle */}
            <Card className={`shadow-md transition-all duration-200 ${
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
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={`w-full justify-start text-left font-normal ${
                              !reservationDate && "text-muted-foreground"
                            }`}
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
                            onSelect={setReservationDate}
                            disabled={(date) =>
                              date < today || date > maxDate
                            }
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
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
                      className="focus-visible:ring-primary"
                    />
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
                      className="focus-visible:ring-primary"
                    />
                  </div>

                  {/* Callback Phone */}
                  <div>
                    <label
                      htmlFor="callback-phone"
                      className="mb-2 block text-sm font-medium"
                    >
                      Callback Phone <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="callback-phone"
                      type="tel"
                      placeholder="+14165550000"
                      value={reservationPhone}
                      onChange={(e) => setReservationPhone(e.target.value)}
                      className="focus-visible:ring-primary"
                    />
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
                      Dietary restriction
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
                      className="focus-visible:ring-primary"
                    />
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                      <label
                        htmlFor="proceed-if-unavailable"
                        className="text-sm text-muted-foreground cursor-pointer"
                      >
                        Still reserve if they can&apos;t accommodate
                      </label>
                      <Switch
                        id="proceed-if-unavailable"
                        checked={presets.dietary_options.proceed_if_unavailable}
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
                restaurantPhone={restaurantPhone}
                reservationDate={reservationDate}
                reservationTime={reservationTime}
                reservationPartySize={reservationPartySize}
                reservationName={reservationName}
                reservationPhone={reservationPhone}
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
            restaurantPhone={restaurantPhone}
            reservationDate={reservationDate}
            reservationTime={reservationTime}
            reservationPartySize={reservationPartySize}
            reservationName={reservationName}
            reservationPhone={reservationPhone}
            totalQuestions={totalQuestions}
            liveQuestions={liveQuestions}
          />
        </div>
      </main>

      {/* Sticky Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-md border-t border-border shadow-lg">
        <div className="container mx-auto max-w-6xl px-4 py-4">
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
      </div>{/* End of z-10 content wrapper */}
    </div>
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
