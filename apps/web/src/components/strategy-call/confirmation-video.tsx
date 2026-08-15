"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  Play,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ConfirmationVideo as ConfirmationVideoDefinition,
  ConfirmationVideoSlug,
} from "@/lib/strategy-call/confirmation-content";
import {
  addWatchedRange,
  watchedPercent,
  type WatchedRange,
} from "@/lib/strategy-call/confirmation-progress";

export type VideoCoverageUpdate = {
  ranges: WatchedRange[];
  resumeAt: number;
  duration: number;
  ended: boolean;
};

type ConfirmationVideoProps = {
  video: ConfirmationVideoDefinition;
  isFirst: boolean;
  isActive: boolean;
  storedRanges: readonly WatchedRange[];
  resumeAt: number;
  storedComplete: boolean;
  onPlay: (slug: ConfirmationVideoSlug) => void;
  onStarted: (slug: ConfirmationVideoSlug, positionSeconds: number) => void;
  onCoverageChange: (
    slug: ConfirmationVideoSlug,
    update: VideoCoverageUpdate,
  ) => void;
  onError: (slug: ConfirmationVideoSlug, errorCode: string) => void;
};

type PlaybackSample = {
  mediaTime: number;
  wallTime: number;
};

function getMediaErrorCode(video: HTMLVideoElement): string {
  switch (video.error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "aborted";
    case MediaError.MEDIA_ERR_NETWORK:
      return "network";
    case MediaError.MEDIA_ERR_DECODE:
      return "decode";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "source_not_supported";
    default:
      return navigator.onLine ? "unknown" : "offline";
  }
}

export function ConfirmationVideo({
  video,
  isFirst,
  isActive,
  storedRanges,
  resumeAt,
  storedComplete,
  onPlay,
  onStarted,
  onCoverageChange,
  onError,
}: ConfirmationVideoProps) {
  const containerRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rangesRef = useRef<WatchedRange[]>([...storedRanges]);
  const lastSampleRef = useRef<PlaybackSample | null>(null);
  const startedRef = useRef(false);
  const restoredRef = useRef(false);
  const pendingPlayRef = useRef(false);

  const [sourceActive, setSourceActive] = useState(isFirst);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [coveragePercent, setCoveragePercent] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);

  useEffect(() => {
    rangesRef.current = [...storedRanges];
  }, [storedRanges]);

  useEffect(() => {
    if (isActive) return;
    const element = videoRef.current;
    if (element && !element.paused) element.pause();
  }, [isActive]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || sourceActive || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSourceActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [sourceActive]);

  useEffect(() => {
    const container = containerRef.current;
    const element = videoRef.current;
    if (!container || !element || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio < 0.25 && !element.paused) {
          element.pause();
        }
      },
      { threshold: [0, 0.25, 0.5] },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [sourceActive]);

  const playWithSound = useCallback(async () => {
    const element = videoRef.current;
    if (!element) return;

    setMediaError(null);
    onPlay(video.slug);

    if (!sourceActive) {
      pendingPlayRef.current = true;
      setSourceActive(true);
      return;
    }

    element.muted = false;
    try {
      if (!element.currentSrc) element.load();
      await element.play();
    } catch {
      setMediaError("playback_blocked");
      onError(video.slug, "playback_blocked");
    }
  }, [onError, onPlay, sourceActive, video.slug]);

  useEffect(() => {
    if (!sourceActive || !pendingPlayRef.current) return;
    pendingPlayRef.current = false;
    const element = videoRef.current;
    if (!element) return;
    element.load();
    element.muted = false;
    void element.play().catch(() => {
      setMediaError("playback_blocked");
      onError(video.slug, "playback_blocked");
    });
  }, [onError, sourceActive, video.slug]);

  const recordPlaybackSample = useCallback(
    (ended: boolean) => {
      const element = videoRef.current;
      if (!element || !Number.isFinite(element.duration) || element.duration <= 0) {
        return;
      }

      const current: PlaybackSample = {
        mediaTime: element.currentTime,
        wallTime: performance.now(),
      };
      const previous = lastSampleRef.current;
      lastSampleRef.current = current;

      let ranges = rangesRef.current;
      if (previous) {
        const mediaDelta = current.mediaTime - previous.mediaTime;
        const wallDelta = Math.max(0, (current.wallTime - previous.wallTime) / 1000);
        const maximumLegitimateDelta =
          wallDelta * Math.max(1, element.playbackRate) * 1.5 + 0.75;

        if (
          mediaDelta > 0 &&
          mediaDelta <= Math.max(1.5, maximumLegitimateDelta)
        ) {
          ranges = addWatchedRange(
            ranges,
            previous.mediaTime,
            current.mediaTime,
            element.duration,
          );
          rangesRef.current = ranges;
        }
      }

      const percent = watchedPercent(ranges, element.duration);
      setCoveragePercent(percent);
      onCoverageChange(video.slug, {
        ranges,
        resumeAt: ended ? 0 : element.currentTime,
        duration: element.duration,
        ended,
      });
    },
    [onCoverageChange, video.slug],
  );

  const handleLoadedMetadata = () => {
    const element = videoRef.current;
    if (!element) return;
    setDuration(element.duration);
    setCoveragePercent(watchedPercent(rangesRef.current, element.duration));

    if (
      !restoredRef.current &&
      !storedComplete &&
      resumeAt > 0 &&
      resumeAt < element.duration - 1
    ) {
      restoredRef.current = true;
      element.currentTime = resumeAt;
    }
  };

  const handlePlaying = () => {
    const element = videoRef.current;
    if (!element) return;
    setHasPlayed(true);
    setIsBuffering(false);
    setMediaError(null);
    onPlay(video.slug);
    lastSampleRef.current = {
      mediaTime: element.currentTime,
      wallTime: performance.now(),
    };

    if (!startedRef.current) {
      startedRef.current = true;
      onStarted(video.slug, element.currentTime);
    }
  };

  const handleRetry = () => {
    const element = videoRef.current;
    if (!element) return;
    setMediaError(null);
    setSourceActive(true);
    element.load();
  };

  const displayCoveragePercent =
    duration > 0
      ? Math.max(coveragePercent, watchedPercent(storedRanges, duration))
      : coveragePercent;
  const displayComplete = storedComplete || displayCoveragePercent >= 90;

  return (
    <section
      ref={containerRef}
      id={`video-${video.order}`}
      aria-labelledby={`video-${video.order}-title`}
      className="scroll-mt-24"
    >
      <div className="mb-5 flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-black text-white shadow-sm dark:bg-indigo-500"
        >
          {video.order}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
            Video {video.order} of 4
          </p>
          <h2
            id={`video-${video.order}-title`}
            className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl"
          >
            {video.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
            {video.description}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-black shadow-xl shadow-indigo-950/10">
        <div className="relative aspect-video w-full">
          <video
            ref={videoRef}
            className="size-full bg-black object-contain"
            controls={hasPlayed}
            playsInline
            preload={isFirst ? "metadata" : "none"}
            poster={video.poster}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => onPlay(video.slug)}
            onPlaying={handlePlaying}
            onPause={() => {
              recordPlaybackSample(false);
              lastSampleRef.current = null;
            }}
            onWaiting={() => setIsBuffering(true)}
            onTimeUpdate={() => recordPlaybackSample(false)}
            onSeeking={() => {
              lastSampleRef.current = null;
            }}
            onSeeked={(event) => {
              lastSampleRef.current = {
                mediaTime: event.currentTarget.currentTime,
                wallTime: performance.now(),
              };
            }}
            onEnded={() => {
              recordPlaybackSample(true);
              lastSampleRef.current = null;
            }}
            onError={(event) => {
              const code = getMediaErrorCode(event.currentTarget);
              setMediaError(code);
              setIsBuffering(false);
              onError(video.slug, code);
            }}
          >
            {sourceActive ? <source src={video.src} type="video/mp4" /> : null}
            {sourceActive ? (
              <track
                default
                kind="captions"
                src={video.captions}
                srcLang="en"
                label="English"
              />
            ) : null}
            {video.transcript
              ? "Your browser does not support HTML video. Read the approved transcript below."
              : "Your browser does not support HTML video. Contact Drive247 support for help."}
          </video>

          {!hasPlayed && !mediaError ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/35 p-4">
              <Button
                type="button"
                size="lg"
                onClick={playWithSound}
                className="min-h-12 rounded-full bg-white px-6 font-bold text-slate-950 shadow-xl hover:bg-amber-100 focus-visible:ring-white"
                aria-label={`Play video ${video.order}, ${video.title}, with sound`}
              >
                <Play aria-hidden="true" className="fill-current" />
                Play with sound
              </Button>
            </div>
          ) : null}

          {isBuffering && !mediaError ? (
            <div
              role="status"
              className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/75 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Loading video…
            </div>
          ) : null}

          {mediaError ? (
            <div
              role="alert"
              className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 p-5 text-center text-white"
            >
              <AlertTriangle aria-hidden="true" className="size-7 text-amber-300" />
              <p className="mt-3 font-bold">This video could not be loaded.</p>
              <p className="mt-1 max-w-md text-sm text-slate-300">
                {video.transcript
                  ? "Check your connection and try again. The approved transcript and the rest of your booking page are still available."
                  : "Check your connection and try again. The rest of your booking page remains available, or you can contact support for help."}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={handleRetry}
                className="mt-4 min-h-11 border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
              >
                <RefreshCw aria-hidden="true" />
                Retry video
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex min-h-6 items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">
          {Math.floor(displayCoveragePercent)}% actually watched
        </span>
        {displayComplete ? (
          <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 aria-hidden="true" className="size-4" />
            Watched
          </span>
        ) : null}
      </div>

      <div className="mt-3 rounded-xl border border-indigo-200/70 bg-indigo-50/50 p-4 dark:border-indigo-400/15 dark:bg-indigo-400/[0.06]">
        <p className="flex items-start gap-2 text-sm leading-relaxed">
          <Lightbulb
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-indigo-600 dark:text-indigo-400"
          />
          <span>
            <strong>Key takeaway:</strong> {video.takeaway}
          </span>
        </p>
      </div>

      <details className="mt-3 rounded-xl border bg-card open:shadow-sm">
        <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {video.transcript ? "Read accessible transcript" : "Transcript status"}
        </summary>
        <div className="border-t px-4 py-4 text-sm leading-relaxed text-muted-foreground">
          {video.transcript ? (
            video.transcript.map((paragraph) => (
              <p key={paragraph} className="not-first:mt-3">
                {paragraph}
              </p>
            ))
          ) : (
            <p role="status">
              The approved verbatim transcript is not available yet. It must be
              added and checked against the final video before this funnel is
              enabled in production. For help in the meantime, email{" "}
              <a
                href="mailto:support@drive-247.com"
                className="font-semibold text-foreground underline underline-offset-4"
              >
                support@drive-247.com
              </a>
              .
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
