"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

// Types
interface CallListItem {
  id: string;
  restaurant_name: string | null;
  restaurant_phone_e164: string;
  call_intent: "make_reservation" | "questions_only";
  status: string;
  is_extracting: boolean;
  reservation_status: string | null;
  created_at: string;
}

interface Answer {
  question: string;
  answer: string;
  details?: string;
  confidence?: number;
  needs_followup?: boolean;
  source_snippet?: string;
}

interface ReservationResult {
  status?: string;
  details?: string;
  confirmed_datetime_local_iso?: string;
  timezone?: string;
  party_size?: number;
  name?: string;
  callback_phone_e164?: string;
  confirmation_number?: string;
  failure_reason?: string;
  failure_category?: string;
}

interface AnswersJson {
  reservation?: ReservationResult;
  answers: Answer[];
  overall_notes?: string;
}

interface TranscriptEntry {
  timestamp?: string;
  speaker?: string;
  text?: string;
}

interface ReservationResultJson {
  status?: string;
  details?: string;
  confirmed_datetime_local_iso?: string;
  timezone?: string;
  party_size?: number;
  name?: string;
  callback_phone_e164?: string;
  confirmation_number?: string;
  failure_reason?: string;
  failure_category?: string;
}

interface CallDetail {
  id: string;
  restaurant_name: string | null;
  restaurant_phone_e164: string;
  call_intent: "make_reservation" | "questions_only";
  reservation_name?: string;
  reservation_phone_e164?: string;
  reservation_datetime_local_iso?: string;
  reservation_timezone?: string;
  reservation_party_size?: number;
  reservation_status: string | null;
  reservation_result_json: ReservationResultJson | null;
  questions_json: unknown;
  status: string;
  is_extracting: boolean;
  failure_reason: string | null;
  failure_details: string | null;
  artifacts: {
    answers_json: AnswersJson | null;
    transcript_text: string | null;
    transcript_json: TranscriptEntry[] | null;
  };
}

// Status timeline steps
const TIMELINE_STEPS = [
  { step: 1, label: "Call starting" },
  { step: 2, label: "Call in progress" },
  { step: 3, label: "Gathering information from restaurant" },
  { step: 4, label: "Summarizing transcript" },
  { step: 5, label: "Answers available" },
];

function getTimelineStep(status: string, isExtracting: boolean): number {
  switch (status) {
    case "queued":
      return 1;
    case "calling":
      return 2;
    case "connected":
      return 3;
    case "completed":
      return isExtracting ? 4 : 5;
    case "failed":
      return -1; // Special case for failed
    default:
      return 1;
  }
}

function getStatusBadgeVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "failed":
      return "destructive";
    case "queued":
    case "calling":
    case "connected":
      return "secondary";
    default:
      return "outline";
  }
}

function getReservationStatusBadgeVariant(
  status: string | null
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "confirmed":
      return "default";
    case "failed":
      return "destructive";
    case "needs_followup":
      return "outline";
    case "requested":
      return "secondary";
    default:
      return "outline";
  }
}

function getReservationStatusLabel(status: string | null): string {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "failed":
      return "Failed";
    case "needs_followup":
      return "Needs Follow-up";
    case "requested":
      return "Requested";
    default:
      return status || "";
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString();
}

export default function CallsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // List state
  const [calls, setCalls] = useState<CallListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Selected call state
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [callDetail, setCallDetail] = useState<CallDetail | null>(null);
  const [initialLoading, setInitialLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Transcript visibility
  const [showTranscript, setShowTranscript] = useState(false);

  // Polling ref
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Scroll ref for infinite scroll
  const listRef = useRef<HTMLDivElement>(null);

  // Load initial calls
  const loadCalls = useCallback(async () => {
    setIsLoadingList(true);
    setListError(null);
    try {
      const response = await fetch("/api/calls?limit=10");
      const data = await response.json();
      if (!response.ok) {
        setListError(data.error || "Failed to load calls.");
        return;
      }
      setCalls(data.items || []);
      setNextCursor(data.next_cursor);
    } catch {
      setListError("Network error. Please refresh.");
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  // Load more calls (infinite scroll)
  const loadMoreCalls = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const response = await fetch(`/api/calls?limit=10&cursor=${nextCursor}`);
      const data = await response.json();
      if (response.ok) {
        setCalls((prev) => [...prev, ...(data.items || [])]);
        setNextCursor(data.next_cursor);
      }
    } catch {
      // Silently fail for load more
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextCursor, isLoadingMore]);

  // Load call detail - isInitial distinguishes first load from poll refresh
  const loadCallDetail = useCallback(
    async (callId: string, isInitial: boolean) => {
      if (isInitial) {
        setInitialLoading(true);
        setDetailError(null);
        setRefreshError(null);
      } else {
        setIsRefreshing(true);
        setRefreshError(null);
      }

      try {
        const response = await fetch(`/api/calls/${callId}`);
        const data = await response.json();
        if (!response.ok) {
          if (isInitial) {
            setDetailError(data.error || "Failed to load call details.");
          } else {
            setRefreshError("Couldn't refresh");
          }
          return null;
        }
        setCallDetail(data);
        setRefreshError(null);
        return data as CallDetail;
      } catch {
        if (isInitial) {
          setDetailError("Network error. Please try again.");
        } else {
          setRefreshError("Couldn't refresh");
        }
        return null;
      } finally {
        if (isInitial) {
          setInitialLoading(false);
        } else {
          setIsRefreshing(false);
        }
      }
    },
    []
  );

  // Initial load
  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  // Handle selected from query param
  useEffect(() => {
    const selected = searchParams.get("selected");
    if (selected && !selectedCallId) {
      setSelectedCallId(selected);
    }
  }, [searchParams, selectedCallId]);

  // Load detail when selected changes
  useEffect(() => {
    if (selectedCallId) {
      loadCallDetail(selectedCallId, true);
      setShowTranscript(false);
    } else {
      setCallDetail(null);
    }
  }, [selectedCallId, loadCallDetail]);

  // Polling for call status
  useEffect(() => {
    // Clear previous polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    if (!callDetail) return;

    // Check if call is finished
    const isFinished =
      (callDetail.status === "completed" || callDetail.status === "failed") &&
      !callDetail.is_extracting;

    if (isFinished) return;

    // Start polling - use isInitial=false for refresh
    pollingRef.current = setInterval(async () => {
      const updated = await loadCallDetail(callDetail.id, false);
      if (updated) {
        const updatedFinished =
          (updated.status === "completed" || updated.status === "failed") &&
          !updated.is_extracting;
        if (updatedFinished && pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }
    }, 1500);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [callDetail?.id, callDetail?.status, callDetail?.is_extracting, loadCallDetail]);

  // Infinite scroll handler
  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = listEl;
      if (scrollHeight - scrollTop - clientHeight < 100) {
        loadMoreCalls();
      }
    };

    listEl.addEventListener("scroll", handleScroll);
    return () => listEl.removeEventListener("scroll", handleScroll);
  }, [loadMoreCalls]);

  // Download transcript
  const downloadTranscript = () => {
    if (!callDetail) return;

    let content = "";

    if (callDetail.artifacts.transcript_json) {
      // Format with timestamps and speaker labels
      content = callDetail.artifacts.transcript_json
        .map((entry) => {
          const timestamp = entry.timestamp || "";
          const speaker = entry.speaker || "Unknown";
          const text = entry.text || "";
          return `[${timestamp}] ${speaker}: ${text}`;
        })
        .join("\n");
    } else if (callDetail.artifacts.transcript_text) {
      content = callDetail.artifacts.transcript_text;
    } else {
      content = "No transcript available.";
    }

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript-${callDetail.id}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Get transcript display text
  const getTranscriptText = (): string => {
    if (!callDetail) return "";

    if (callDetail.artifacts.transcript_json) {
      return callDetail.artifacts.transcript_json
        .map((entry) => {
          const timestamp = entry.timestamp || "";
          const speaker = entry.speaker || "Unknown";
          const text = entry.text || "";
          return `[${timestamp}] ${speaker}: ${text}`;
        })
        .join("\n");
    }

    return callDetail.artifacts.transcript_text || "No transcript available.";
  };

  // Handle retry call
  const handleRetryCall = () => {
    if (!callDetail) return;
    const params = new URLSearchParams();
    if (callDetail.restaurant_name) {
      params.set("restaurant_name", callDetail.restaurant_name);
    }
    params.set("restaurant_phone_e164", callDetail.restaurant_phone_e164);
    router.push(`/?${params.toString()}`);
  };

  const currentStep = callDetail
    ? getTimelineStep(callDetail.status, callDetail.is_extracting)
    : 0;

  // Determine if polling is active:
  // selectedCall exists AND NOT terminal (terminal = status in ('completed','failed') AND is_extracting=false)
  const isTerminal =
    callDetail &&
    (callDetail.status === "completed" || callDetail.status === "failed") &&
    !callDetail.is_extracting;
  const isPollingActive = callDetail !== null && !isTerminal;

  return (
    <div className="flex h-screen bg-background">
      {/* Left Panel - Call List */}
      <div className="flex w-80 flex-col border-r">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">Call History</h2>
          <Button variant="outline" size="sm" onClick={() => router.push("/")}>
            New call
          </Button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto">
          {isLoadingList ? (
            <div className="flex items-center justify-center p-8">
              <span className="text-muted-foreground">Loading...</span>
            </div>
          ) : listError ? (
            <div className="p-4 text-center text-destructive">{listError}</div>
          ) : calls.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              No calls yet. Make your first call!
            </div>
          ) : (
            <>
              {calls.map((call) => (
                <div
                  key={call.id}
                  onClick={() => setSelectedCallId(call.id)}
                  className={`cursor-pointer border-b p-4 transition-colors hover:bg-muted/50 ${
                    selectedCallId === call.id ? "bg-muted" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {call.restaurant_name || "Unknown"}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {call.restaurant_phone_e164}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(call.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={getStatusBadgeVariant(call.status)}>
                        {call.status}
                      </Badge>
                      {call.call_intent === "make_reservation" && call.reservation_status && (
                        <Badge 
                          variant={getReservationStatusBadgeVariant(call.reservation_status)}
                          className="text-xs"
                        >
                          {getReservationStatusLabel(call.reservation_status)}
                        </Badge>
                      )}
                      {call.call_intent === "questions_only" && (
                        <Badge 
                          variant="outline"
                          className="text-xs"
                        >
                          Questions only
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {isLoadingMore && (
                <div className="p-4 text-center text-muted-foreground">
                  Loading more...
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right Panel - Call Details */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!selectedCallId ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            Select a call to view details
          </div>
        ) : initialLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-muted-foreground">Loading call details...</span>
          </div>
        ) : detailError && !callDetail ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <p className="text-destructive">{detailError}</p>
            <Button onClick={() => loadCallDetail(selectedCallId, true)}>
              Retry
            </Button>
          </div>
        ) : callDetail ? (
          <div className="flex-1 overflow-y-auto p-6">
            {/* Header */}
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold">
                  {callDetail.restaurant_name || "Unknown Restaurant"}
                </h1>
                <p className="text-muted-foreground">
                  {callDetail.restaurant_phone_e164}
                </p>
                {callDetail.call_intent === "questions_only" && (
                  <span className="mt-1 inline-block rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Questions only call
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => router.push("/")}>
                  New call
                </Button>
                <Button variant="outline" onClick={handleRetryCall}>
                  Retry call
                </Button>
              </div>
            </div>

            {/* Status Timeline */}
            <Card className="mb-6">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Status</CardTitle>
                  <div className="flex items-center gap-2">
                    {isPollingActive && (
                      <span className="flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                        Live
                      </span>
                    )}
                    {refreshError && (
                      <span className="text-xs text-amber-600">Last refresh failed</span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {callDetail.status === "failed" ? (
                  <div className="rounded-md bg-destructive/10 p-4">
                    <p className="font-medium text-destructive">Call Failed</p>
                    {callDetail.failure_reason && (
                      <p className="mt-1 text-sm text-destructive">
                        {callDetail.failure_reason}
                      </p>
                    )}
                    {callDetail.failure_details && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {callDetail.failure_details}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {TIMELINE_STEPS.map(({ step, label }) => {
                      const isCompleted = currentStep >= step;
                      const isCurrent = currentStep === step;
                      return (
                        <div key={step} className="flex items-center gap-3">
                          <div
                            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                              isCompleted
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {isCompleted ? "✓" : step}
                          </div>
                          <span
                            className={`text-sm ${
                              isCurrent
                                ? "font-medium"
                                : isCompleted
                                ? "text-foreground"
                                : "text-muted-foreground"
                            }`}
                          >
                            {label}
                            {isCurrent && currentStep < 5 && (
                              <span className="ml-2 inline-block animate-pulse">
                                ...
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Reservation Outcome - only show for make_reservation calls */}
            {callDetail.call_intent === "make_reservation" && (callDetail.reservation_status || callDetail.reservation_result_json) && (
              <Card className="mb-6 border-2 border-primary/20">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Reservation Outcome</CardTitle>
                    {callDetail.reservation_status && (
                      <Badge 
                        variant={getReservationStatusBadgeVariant(callDetail.reservation_status)}
                        className="text-sm"
                      >
                        {getReservationStatusLabel(callDetail.reservation_status)}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Show reservation result details if available */}
                    {callDetail.reservation_result_json && (
                      <div className="space-y-3">
                        {callDetail.reservation_result_json.details && (
                          <p className="text-sm">{callDetail.reservation_result_json.details}</p>
                        )}
                        
                        {/* Key details grid */}
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          {callDetail.reservation_result_json.confirmed_datetime_local_iso && (
                            <div>
                              <span className="text-muted-foreground">Confirmed Time</span>
                              <p className="font-medium">
                                {new Date(callDetail.reservation_result_json.confirmed_datetime_local_iso).toLocaleString(undefined, {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </p>
                            </div>
                          )}
                          {callDetail.reservation_result_json.party_size && (
                            <div>
                              <span className="text-muted-foreground">Party Size</span>
                              <p className="font-medium">{callDetail.reservation_result_json.party_size} people</p>
                            </div>
                          )}
                          {callDetail.reservation_result_json.name && (
                            <div>
                              <span className="text-muted-foreground">Name</span>
                              <p className="font-medium">{callDetail.reservation_result_json.name}</p>
                            </div>
                          )}
                          {callDetail.reservation_result_json.confirmation_number && (
                            <div>
                              <span className="text-muted-foreground">Confirmation #</span>
                              <p className="font-medium font-mono">{callDetail.reservation_result_json.confirmation_number}</p>
                            </div>
                          )}
                        </div>

                        {/* Failure info if present */}
                        {callDetail.reservation_result_json.failure_reason && (
                          <div className="rounded-md bg-destructive/10 p-3">
                            <p className="text-sm font-medium text-destructive">
                              {callDetail.reservation_result_json.failure_reason}
                            </p>
                            {callDetail.reservation_result_json.failure_category && (
                              <Badge variant="outline" className="mt-2 text-xs">
                                {callDetail.reservation_result_json.failure_category}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Show requested reservation details if no result yet */}
                    {!callDetail.reservation_result_json && callDetail.reservation_status === "requested" && (
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <p>Reservation request in progress...</p>
                        {callDetail.reservation_datetime_local_iso && (
                          <p>
                            Requested for: {new Date(callDetail.reservation_datetime_local_iso).toLocaleString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })} for {callDetail.reservation_party_size} people
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Answers */}
            {callDetail.artifacts.answers_json && callDetail.artifacts.answers_json.answers.length > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="text-base">Answers</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {callDetail.artifacts.answers_json.answers.map(
                    (answer, index) => (
                      <div key={index} className="rounded-lg border p-4">
                        <p className="mb-2 font-medium">{answer.question}</p>
                        <p className="text-lg">{answer.answer}</p>
                        {answer.details && (
                          <p className="mt-2 text-sm text-muted-foreground">
                            {answer.details}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {answer.confidence !== undefined && (
                            <Badge variant="outline">
                              Confidence: {Math.round(answer.confidence * 100)}%
                            </Badge>
                          )}
                          {answer.needs_followup && (
                            <Badge variant="secondary">Needs follow-up</Badge>
                          )}
                        </div>
                        {answer.source_snippet && (
                          <p className="mt-2 text-xs italic text-muted-foreground">
                            &quot;{answer.source_snippet}&quot;
                          </p>
                        )}
                      </div>
                    )
                  )}
                  {callDetail.artifacts.answers_json.overall_notes && (
                    <>
                      <Separator />
                      <div className="text-sm text-muted-foreground">
                        <span className="font-medium">Notes:</span>{" "}
                        {callDetail.artifacts.answers_json.overall_notes}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Transcript */}
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Transcript</CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowTranscript(!showTranscript)}
                  >
                    {showTranscript ? "Hide transcript" : "Show transcript"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={downloadTranscript}
                  >
                    Download transcript
                  </Button>
                </div>
              </CardHeader>
              {showTranscript && (
                <CardContent>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm">
                    {getTranscriptText()}
                  </pre>
                </CardContent>
              )}
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
