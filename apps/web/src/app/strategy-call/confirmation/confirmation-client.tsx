"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Headphones,
  Mail,
  MessageCircleQuestion,
} from "lucide-react";
import { BookingSummary } from "@/components/strategy-call/booking-summary";
import {
  ConfirmationVideo,
  type VideoCoverageUpdate,
} from "@/components/strategy-call/confirmation-video";
import type { BookingSummaryDTO } from "@/lib/strategy-call/booking";
import {
  CONFIRMATION_VIDEOS,
  CONTENT_VERSION,
  type ConfirmationVideoSlug,
} from "@/lib/strategy-call/confirmation-content";
import {
  isVideoComplete,
  sanitizeStoredRanges,
  watchedPercent,
  type WatchedRange,
} from "@/lib/strategy-call/confirmation-progress";

type FunnelEventName =
  | "confirmation_viewed"
  | "booking_summary_loaded"
  | "booking_summary_missing"
  | "video_started"
  | "video_progress"
  | "video_completed"
  | "video_error"
  | "all_videos_completed"
  | "reschedule_clicked";

type ProgressThreshold = 25 | 50 | 75 | 90 | 100;

type StoredVideoProgress = {
  ranges: WatchedRange[];
  resumeAt: number;
  duration: number;
  completedByEnd: boolean;
  completed: boolean;
  started: boolean;
  reportedThresholds: ProgressThreshold[];
  completionReported: boolean;
};

type StoredProgress = Record<ConfirmationVideoSlug, StoredVideoProgress>;

type FunnelEvent = {
  eventName: FunnelEventName;
  videoSlug?: ConfirmationVideoSlug;
  progressPercent?: ProgressThreshold;
  positionSeconds?: number;
  errorCode?: string;
};

const STORAGE_KEY = `drive247:strategy-call:${CONTENT_VERSION}`;
const PROGRESS_THRESHOLDS: readonly ProgressThreshold[] = [25, 50, 75, 90, 100];
const PROCESSING_POLL_MS = 2_500;
const PROCESSING_TIMEOUT_MS = 20_000;

function createEmptyVideoProgress(): StoredVideoProgress {
  return {
    ranges: [],
    resumeAt: 0,
    duration: 0,
    completedByEnd: false,
    completed: false,
    started: false,
    reportedThresholds: [],
    completionReported: false,
  };
}

function createEmptyProgress(): StoredProgress {
  return {
    "marketplace-control": createEmptyVideoProgress(),
    "system-walkthrough": createEmptyVideoProgress(),
    faqs: createEmptyVideoProgress(),
    "who-its-for": createEmptyVideoProgress(),
  };
}

function isProgressThreshold(value: unknown): value is ProgressThreshold {
  return PROGRESS_THRESHOLDS.some((threshold) => threshold === value);
}

function readStoredProgress(): StoredProgress {
  const fallback = createEmptyProgress();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as {
      videos?: Partial<Record<ConfirmationVideoSlug, Partial<StoredVideoProgress>>>;
    };

    for (const video of CONFIRMATION_VIDEOS) {
      const stored = parsed.videos?.[video.slug];
      if (!stored) continue;
      const ranges = sanitizeStoredRanges(stored.ranges);
      const duration =
        typeof stored.duration === "number" &&
        Number.isFinite(stored.duration) &&
        stored.duration > 0 &&
        stored.duration <= 86_400
          ? stored.duration
          : 0;
      const percent = watchedPercent(ranges, duration);
      const completedByEnd =
        stored.completedByEnd === true && percent >= 80;
      const completed = isVideoComplete(ranges, duration, completedByEnd);
      fallback[video.slug] = {
        ranges,
        resumeAt:
          typeof stored.resumeAt === "number" &&
          Number.isFinite(stored.resumeAt) &&
          stored.resumeAt >= 0 &&
          stored.resumeAt <= 86_400
            ? Math.min(stored.resumeAt, duration || 86_400)
            : 0,
        duration,
        completedByEnd,
        completed,
        started: stored.started === true,
        reportedThresholds: Array.isArray(stored.reportedThresholds)
          ? stored.reportedThresholds.filter(
              (threshold) =>
                isProgressThreshold(threshold) && threshold <= percent,
            )
          : [],
        completionReported:
          completed && stored.completionReported === true,
      };
    }
  } catch {
    // Corrupt or blocked browser storage must never break the funnel.
  }

  return fallback;
}

function makeEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  const randomNibble = () => Math.floor(Math.random() * 16).toString(16);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const value = Number.parseInt(randomNibble(), 16);
    return (token === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function sendFunnelEvent(event: FunnelEvent) {
  const payload = JSON.stringify({
    ...event,
    contentVersion: CONTENT_VERSION,
    eventId: makeEventId(),
  });

  void fetch("/api/strategy-call/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => {
    // Analytics is deliberately non-blocking and contains no PII.
  });
}

const BOOKING_STATUSES = new Set<BookingSummaryDTO["status"]>([
  "scheduled",
  "rescheduled",
  "cancelled",
  "processing",
  "missing",
]);

function parseBookingSummary(value: unknown): BookingSummaryDTO | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.status !== "string" ||
    !BOOKING_STATUSES.has(record.status as BookingSummaryDTO["status"]) ||
    typeof record.canShowDetails !== "boolean"
  ) {
    return null;
  }

  const optionalStrings = [
    record.startsAt,
    record.endsAt,
    record.timezone,
    record.rescheduleUrl,
  ];
  if (
    optionalStrings.some(
      (field) => field !== undefined && typeof field !== "string",
    )
  ) {
    return null;
  }

  return {
    status: record.status as BookingSummaryDTO["status"],
    startsAt: record.startsAt as string | undefined,
    endsAt: record.endsAt as string | undefined,
    timezone: record.timezone as string | undefined,
    rescheduleUrl: record.rescheduleUrl as string | undefined,
    canShowDetails: record.canShowDetails,
  };
}

function getHeroCopy(
  status: BookingSummaryDTO["status"],
  processingTimedOut: boolean,
) {
  if (status === "missing" || processingTimedOut) {
    return {
      badge: "STRATEGY CALL PREPARATION",
      title: "Prepare for your Drive247 strategy call.",
      description:
        "Watch these four short videos to understand the system, the shift toward control, and what to bring to a future call.",
    };
  }
  if (status === "cancelled") {
    return {
      badge: "BOOKING STATUS UPDATED",
      title: "Your booking was cancelled. You can still prepare here.",
      description:
        "The four videos remain available, and you can choose another strategy-call time whenever you're ready.",
    };
  }
  if (status === "processing") {
    return {
      badge: "BOOKING VERIFICATION IN PROGRESS",
      title: "We’re verifying your booking details.",
      description:
        "Your GHL calendar invite remains valid. While the secure booking record catches up, start these four preparation videos below.",
    };
  }
  return {
    badge: "CALL BOOKED — PLEASE WATCH BEFORE WE MEET",
    title:
      "Your strategy call is booked. Complete these 4 short videos before we meet.",
    description:
      "In the next few minutes, you'll see why control matters more than another marketplace tactic, how Drive247 works, and whether it fits your operation.",
  };
}

export function ConfirmationClient({
  initialBooking,
}: {
  initialBooking: BookingSummaryDTO;
}) {
  const [booking, setBooking] = useState(initialBooking);
  const [progress, setProgress] = useState<StoredProgress>(createEmptyProgress);
  const [activeSlug, setActiveSlug] = useState<ConfirmationVideoSlug | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [processingTimedOut, setProcessingTimedOut] = useState(false);
  const pageEventSentRef = useRef(false);
  const summaryEventRef = useRef<"loaded" | "missing" | null>(null);
  const allCompleteEventRef = useRef(false);
  const immediateEventMarksRef = useRef(new Set<string>());
  const progressRef = useRef<StoredProgress>(createEmptyProgress());

  useEffect(() => {
    const stored = readStoredProgress();
    progressRef.current = stored;
    setProgress(stored);
    for (const video of CONFIRMATION_VIDEOS) {
      if (stored[video.slug].started) {
        immediateEventMarksRef.current.add(`started:${video.slug}`);
      }
      if (stored[video.slug].completionReported) {
        immediateEventMarksRef.current.add(`completed:${video.slug}`);
      }
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: CONTENT_VERSION, videos: progress }),
      );
    } catch {
      // Private browsing/storage limits should not affect video playback.
    }
  }, [progress, storageReady]);

  useEffect(() => {
    const marker = `${STORAGE_KEY}:confirmation-viewed`;
    const sendWhenVisible = () => {
      if (pageEventSentRef.current || document.visibilityState === "hidden") return;
      pageEventSentRef.current = true;
      try {
        if (window.sessionStorage.getItem(marker) === "1") return;
        window.sessionStorage.setItem(marker, "1");
      } catch {
        // Keep the event best-effort when storage is unavailable.
      }
      sendFunnelEvent({ eventName: "confirmation_viewed" });
    };

    sendWhenVisible();
    document.addEventListener("visibilitychange", sendWhenVisible);
    return () => document.removeEventListener("visibilitychange", sendWhenVisible);
  }, []);

  useEffect(() => {
    if (booking.status !== "processing") {
      setProcessingTimedOut(false);
      return;
    }

    const controller = new AbortController();
    let requestInFlight = false;
    const poll = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const response = await fetch("/api/strategy-call/booking", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const nextBooking = parseBookingSummary(await response.json());
        if (nextBooking) setBooking(nextBooking);
      } catch {
        // A webhook or network delay must not block the education content.
      } finally {
        requestInFlight = false;
      }
    };
    const interval = window.setInterval(() => void poll(), PROCESSING_POLL_MS);
    const timeout = window.setTimeout(() => {
      setProcessingTimedOut(true);
      window.clearInterval(interval);
    }, PROCESSING_TIMEOUT_MS);

    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [booking.status]);

  useEffect(() => {
    const hasTrustedSummary =
      booking.canShowDetails &&
      booking.status !== "processing" &&
      booking.status !== "missing";

    if (hasTrustedSummary && summaryEventRef.current !== "loaded") {
      summaryEventRef.current = "loaded";
      sendFunnelEvent({ eventName: "booking_summary_loaded" });
    }

    const summaryMissing =
      booking.status === "missing" || processingTimedOut;
    if (summaryMissing && summaryEventRef.current !== "missing") {
      summaryEventRef.current = "missing";
      sendFunnelEvent({ eventName: "booking_summary_missing" });
    }
  }, [booking.canShowDetails, booking.status, processingTimedOut]);

  const completedCount = useMemo(
    () =>
      CONFIRMATION_VIDEOS.filter((video) => progress[video.slug].completed)
        .length,
    [progress],
  );

  useEffect(() => {
    if (
      storageReady &&
      completedCount === CONFIRMATION_VIDEOS.length &&
      !allCompleteEventRef.current
    ) {
      allCompleteEventRef.current = true;
      const marker = `${STORAGE_KEY}:all-complete-reported`;
      try {
        if (window.localStorage.getItem(marker) === "1") return;
        window.localStorage.setItem(marker, "1");
      } catch {
        // The in-memory ref still prevents duplicates during this page view.
      }
      sendFunnelEvent({ eventName: "all_videos_completed" });
    }
  }, [completedCount, storageReady]);

  const handleStarted = useCallback(
    (slug: ConfirmationVideoSlug, positionSeconds: number) => {
      const mark = `started:${slug}`;
      if (!immediateEventMarksRef.current.has(mark)) {
        immediateEventMarksRef.current.add(mark);
        sendFunnelEvent({
          eventName: "video_started",
          videoSlug: slug,
          positionSeconds: Math.max(0, Math.floor(positionSeconds)),
        });
      }

      const current = progressRef.current;
      const next = {
        ...current,
        [slug]: { ...current[slug], started: true },
      };
      progressRef.current = next;
      setProgress(next);
    },
    [],
  );

  const handleCoverageChange = useCallback(
    (slug: ConfirmationVideoSlug, update: VideoCoverageUpdate) => {
      const current = progressRef.current;
      const previous = current[slug];
      const percent = watchedPercent(update.ranges, update.duration);
      const newlyReached = PROGRESS_THRESHOLDS.filter(
        (threshold) =>
          percent >= threshold &&
          !previous.reportedThresholds.includes(threshold),
      );
      const completedByEnd =
        previous.completedByEnd || (update.ended && percent >= 80);
      const completed = isVideoComplete(
        update.ranges,
        update.duration,
        completedByEnd,
      );
      let completionReported = previous.completionReported;
      const shouldReportCompletion = completed && !completionReported;
      if (shouldReportCompletion) completionReported = true;

      const next: StoredProgress = {
        ...current,
        [slug]: {
          ...previous,
          ranges: update.ranges,
          resumeAt: update.resumeAt,
          duration: update.duration,
          completedByEnd,
          completed,
          reportedThresholds: [
            ...previous.reportedThresholds,
            ...newlyReached,
          ],
          completionReported,
        },
      };
      progressRef.current = next;
      setProgress(next);

      for (const threshold of newlyReached) {
        sendFunnelEvent({
          eventName: "video_progress",
          videoSlug: slug,
          progressPercent: threshold,
          positionSeconds: Math.max(0, Math.floor(update.resumeAt)),
        });
      }

      if (shouldReportCompletion) {
        const mark = `completed:${slug}`;
        if (!immediateEventMarksRef.current.has(mark)) {
          immediateEventMarksRef.current.add(mark);
          sendFunnelEvent({
            eventName: "video_completed",
            videoSlug: slug,
            positionSeconds: Math.max(0, Math.floor(update.resumeAt)),
          });
        }
      }
    },
    [],
  );

  const hero = getHeroCopy(booking.status, processingTimedOut);
  const pageProgress = completedCount * 25;

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 sm:px-6 sm:pb-24">
      <section className="pb-8 pt-8 sm:pb-10 sm:pt-12">
        <div className="rounded-3xl border-2 border-amber-300 bg-amber-50 p-5 shadow-[0_16px_50px_-28px_rgba(217,119,6,0.7)] dark:border-amber-300/40 dark:bg-amber-300/[0.08] sm:p-8">
          <div className="flex flex-col items-center text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-400 text-amber-950 shadow-sm">
              <AlertTriangle aria-hidden="true" className="size-8" strokeWidth={2.5} />
            </div>
            <p className="mt-5 rounded-full bg-amber-300 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.13em] text-amber-950 sm:text-xs">
              {hero.badge}
            </p>
            {/*
              No sub-head under the headline — funnel owner's call. The badge
              plus the headline carry the instruction, and getting the viewer to
              the first video sooner is the whole point of the page. hero.description
              is kept in getHeroCopy for the page metadata and for anyone who
              wants it back.
            */}
            <h1 className="mt-5 max-w-3xl text-3xl font-black tracking-tight text-balance sm:text-5xl">
              {hero.title}
            </h1>
          </div>
        </div>
      </section>

      <BookingSummary
        booking={booking}
        processingTimedOut={processingTimedOut}
        onRescheduleClick={() =>
          sendFunnelEvent({ eventName: "reschedule_clicked" })
        }
      />

      <section
        aria-label="Video completion progress"
        className="sticky top-3 z-20 my-8 rounded-2xl border bg-background/95 p-4 shadow-lg shadow-slate-950/5 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:my-10"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold">Your preparation progress</p>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {completedCount} of 4 videos watched
            </p>
          </div>
          <span className="text-lg font-black text-indigo-600 dark:text-indigo-400">
            {pageProgress}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={`${completedCount} of 4 videos watched`}
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={completedCount}
          aria-valuetext={`${completedCount} of 4 videos watched`}
          className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-indigo-600 transition-[width] duration-500 motion-reduce:transition-none dark:bg-indigo-400"
            style={{ width: `${pageProgress}%` }}
          />
        </div>
      </section>

      <div className="space-y-16 sm:space-y-24">
        {CONFIRMATION_VIDEOS.map((video, index) => (
          <ConfirmationVideo
            key={video.slug}
            video={video}
            isFirst={index === 0}
            isActive={activeSlug === video.slug}
            storedRanges={progress[video.slug].ranges}
            resumeAt={progress[video.slug].resumeAt}
            storedComplete={progress[video.slug].completed}
            storedDuration={progress[video.slug].duration}
            onPlay={setActiveSlug}
            onPlayFailed={(slug) =>
              setActiveSlug((current) => (current === slug ? null : current))
            }
            onStarted={handleStarted}
            onCoverageChange={handleCoverageChange}
            onError={(slug, errorCode) =>
              sendFunnelEvent({
                eventName: "video_error",
                videoSlug: slug,
                errorCode,
              })
            }
          />
        ))}
      </div>

      <section
        aria-labelledby="call-preparation-title"
        className="mt-20 rounded-3xl border bg-card p-6 sm:mt-24 sm:p-8"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2
            aria-hidden="true"
            className="mt-0.5 size-6 shrink-0 text-indigo-600 dark:text-indigo-400"
          />
          <div>
            <h2 id="call-preparation-title" className="text-xl font-extrabold tracking-tight sm:text-2xl">
              Bring these to your strategy call
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A little preparation lets us spend more time on your operation.
            </p>
          </div>
        </div>

        <ul className="mt-6 space-y-3">
          {[
            "Your fleet size, vehicle types and current availability process",
            "How customers currently find and book with you",
            "Your biggest blocker with marketplaces, payments or customer management",
            "Your target launch date and what a successful direct-booking channel means to you",
          ].map((item) => (
            <li key={item} className="flex items-start gap-3 text-sm leading-relaxed">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-indigo-600/10 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300">
                <Check aria-hidden="true" className="size-3" strokeWidth={3} />
              </span>
              {item}
            </li>
          ))}
        </ul>

        <div className="mt-7 border-t pt-6">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Mail aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              Your calendar invite contains the private meeting and
              booking-management links.
            </span>
          </p>
          <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
            <Headphones aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              Video trouble? Email{" "}
              <a
                href="mailto:support@drive-247.com"
                className="font-semibold text-foreground underline underline-offset-4 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
              >
                support@drive-247.com
              </a>
              .
            </span>
          </p>
          <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
            <MessageCircleQuestion aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              Need a different time? Use the verified reschedule link above or
              the link in your calendar invite.
            </span>
          </p>
        </div>
      </section>

      {booking.status === "cancelled" ? (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Ready to continue?{" "}
          <Link
            href="/strategy-call"
            className="font-semibold text-foreground underline underline-offset-4"
          >
            Choose a new strategy-call time
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
