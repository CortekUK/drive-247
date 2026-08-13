"use client";

import { useState } from "react";
import { Play, ExternalLink, Info, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type BookingMode = "fixed" | "auto_extend" | "installments" | "payg";

interface InfoPage {
  heading: string;
  body: string;
}

interface ModeOption {
  id: BookingMode;
  title: string;
  tagline: string;
  description: string;
  bestFor: string;
  videoUrl: string; // explainer video shown in a dialog ("" = not ready yet)
  infoPages: InfoPage[]; // paginated text explainer shown in the info dialog
}

// MOCK: placeholder sample video so every section plays for now.
// Swap each mode's videoUrl for the real /explainers/{mode}.mp4 when ready.
const SAMPLE_VIDEO =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

const MODES: ModeOption[] = [
  {
    id: "fixed",
    title: "Fixed Date Rental",
    tagline: "One rental, set dates",
    description:
      "Operator picks a pickup and return date. The full amount is charged upfront as a single agreement.",
    bestFor: "Standard short & long rentals",
    videoUrl: SAMPLE_VIDEO, // TODO: replace with real Fixed Date explainer
    infoPages: [
      {
        heading: "What it is",
        body: "A single rental with a defined start and end. You set the pickup and return dates, the system works out the total, and the agreement covers exactly that window.",
      },
      {
        heading: "How billing works",
        body: "The full rental amount — plus any taxes, fees and extras — is charged once, upfront at booking. There are no recurring charges. A refundable deposit hold may be placed on the card separately.",
      },
      {
        heading: "When to use it",
        body: "Best when both you and the customer know the exact return date. It's the simplest, most predictable option: one agreement, one charge, a clear end date.",
      },
    ],
  },
  {
    id: "auto_extend",
    title: "Auto-Extended",
    tagline: "Renews automatically",
    description:
      "Rental renews each cycle and charges upfront for the next period until it's cancelled.",
    bestFor: "Ongoing weekly / monthly drivers",
    videoUrl: SAMPLE_VIDEO, // TODO: replace with real Auto-Extended explainer
    infoPages: [
      {
        heading: "What it is",
        body: "An open-ended rental that automatically renews each cycle — weekly or monthly — until you or the customer cancels it. No need to recreate the booking every period.",
      },
      {
        heading: "How billing works",
        body: "At the start of every cycle the next period is charged upfront. If a charge fails, the customer is reminded automatically and the rental can be paused until it's resolved.",
      },
      {
        heading: "When to use it",
        body: "Best for ongoing weekly or monthly drivers who keep the car indefinitely — gig drivers and long-term renters who don't have a fixed return date.",
      },
    ],
  },
  {
    id: "installments",
    title: "Installments",
    tagline: "Split the total",
    description:
      "The total rental amount is divided into a schedule of smaller payments charged over time.",
    bestFor: "Larger totals paid in stages",
    videoUrl: SAMPLE_VIDEO, // TODO: replace with real Installments explainer
    infoPages: [
      {
        heading: "What it is",
        body: "The full rental total is split into a schedule of smaller payments instead of one large upfront charge — making bigger rentals easier for the customer to commit to.",
      },
      {
        heading: "How billing works",
        body: "You choose how many installments and how often they're due. Each installment is charged automatically on its due date, and any missed payment triggers a reminder.",
      },
      {
        heading: "When to use it",
        body: "Best for larger totals a customer would rather pay in stages across the rental period, while you still secure the full amount over time.",
      },
    ],
  },
  {
    id: "payg",
    title: "Pay As You Go",
    tagline: "Charge per day",
    description:
      "Daily charges accrue automatically as the rental runs, with a deposit held up front.",
    bestFor: "Open-ended, usage-based rentals",
    videoUrl: SAMPLE_VIDEO, // TODO: replace with real PAYG explainer
    infoPages: [
      {
        heading: "What it is",
        body: "Daily charges accrue automatically as the rental runs. There's no fixed end date — the customer simply pays for each day they keep the car.",
      },
      {
        heading: "How billing works",
        body: "A refundable deposit is held up front. A background job adds each day's charge as it passes, and reminders escalate if a balance is owed.",
      },
      {
        heading: "Closing the rental",
        body: "When the car is returned, the final total settles and the deposit hold is released. Perfect for open-ended, usage-based rentals where the return date isn't set.",
      },
    ],
  },
];

// Local video files (mp4/webm) and same-origin pages can play in-dialog.
// External design links (claude.ai / claudeusercontent.com) block iframing, so we open them in a new tab.
const isVideoFile = (url: string) => /\.(mp4|webm|ogg)(\?|$)/i.test(url);
const isEmbeddable = (url: string) =>
  url.startsWith("/") || isVideoFile(url) || /youtube\.com|youtu\.be|vimeo\.com|player\./i.test(url);

interface BookingModeGridProps {
  selected: BookingMode | null;
  onSelect: (mode: BookingMode) => void;
  /**
   * Which modes this tenant may actually use.
   *
   * PAYG and auto-extend are per-tenant features gated on rental settings, so
   * the grid must be filtered by the caller. Showing all four unconditionally
   * would offer an operator a mode that silently does nothing — the selection
   * would stick in the UI while the submit handler ignored it. Omit to show
   * everything.
   */
  available?: BookingMode[];
}

export function BookingModeGrid({ selected, onSelect, available }: BookingModeGridProps) {
  const [videoMode, setVideoMode] = useState<ModeOption | null>(null);
  const [infoMode, setInfoMode] = useState<ModeOption | null>(null);
  const [infoPage, setInfoPage] = useState(0);

  const modes = available
    ? MODES.filter((mode) => available.includes(mode.id))
    : MODES;

  const openInfo = (mode: ModeOption) => {
    setInfoPage(0);
    setInfoMode(mode);
  };
  const infoPages = infoMode?.infoPages ?? [];
  const lastPage = infoPages.length - 1;

  return (
    <>
      {/* Mode grid — fills available height, no scroll */}
      <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 grid-rows-[auto] sm:grid-rows-2 gap-4">
          {modes.map((mode) => {
            const isActive = selected === mode.id;
            return (
              <motion.div
                key={mode.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(mode.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(mode.id);
                  }
                }}
                whileTap={{ scale: 0.995 }}
                animate={{ scale: isActive ? [1, 1.012, 1] : 1 }}
                transition={{ duration: 0.5, ease: "easeInOut" }}
                className={cn(
                  "group relative text-left rounded-2xl border bg-card p-5 flex flex-col cursor-pointer transition-colors duration-150",
                  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isActive
                    ? "border-primary ring-1 ring-primary"
                    : "border-border hover:border-foreground/20"
                )}
              >
                <button
                  type="button"
                  aria-label={isActive ? `${mode.title} selected` : `About ${mode.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isActive) openInfo(mode);
                  }}
                  className={cn(
                    "absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
                  )}
                >
                  {isActive ? <Check className="h-4 w-4" strokeWidth={3} /> : <Info className="h-4 w-4" />}
                </button>

                <div className="min-w-0 pr-8">
                  <h3 className="text-base font-semibold text-foreground leading-tight">{mode.title}</h3>
                  <p className="text-xs font-medium text-primary mt-0.5">{mode.tagline}</p>
                </div>

                <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
                  {mode.description}
                </p>

                <div className="mt-auto pt-3 border-t flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Best for
                    </span>
                    <span className="text-[11px] text-foreground/70 truncate">{mode.bestFor}</span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setVideoMode(mode);
                    }}
                    className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    How it works
                  </button>
                </div>
              </motion.div>
            );
          })}
      </div>

      {/* Explainer video dialog */}
      <Dialog open={!!videoMode} onOpenChange={(open) => !open && setVideoMode(null)}>
        <DialogContent className="w-[90vw] max-w-[820px] h-[82vh] sm:!max-w-[820px] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0 px-5 pt-4 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Play className="h-4 w-4 fill-current text-primary" />
              {videoMode?.title} — How it works
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 w-full bg-black">
            {!videoMode?.videoUrl ? (
              <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground bg-muted">
                Explainer video coming soon.
              </div>
            ) : isVideoFile(videoMode.videoUrl) ? (
              <video src={videoMode.videoUrl} controls autoPlay className="h-full w-full bg-black object-contain" />
            ) : isEmbeddable(videoMode.videoUrl) ? (
              <iframe
                src={videoMode.videoUrl}
                title={`${videoMode.title} explainer`}
                className="h-full w-full border-0"
                allow="autoplay; fullscreen"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center px-6">
                <p className="text-sm text-muted-foreground">
                  This explainer is hosted externally and can&apos;t be embedded here.
                </p>
                <a
                  href={videoMode.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open video in new tab
                </a>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Mode explainer (paginated) dialog */}
      <Dialog open={!!infoMode} onOpenChange={(open) => !open && setInfoMode(null)}>
        <DialogContent className="w-[90vw] max-w-[820px] h-[82vh] sm:!max-w-[820px] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0 px-6 pt-5 pb-4 border-b">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Info className="h-4 w-4 text-primary" />
              {infoMode?.title}
            </DialogTitle>
          </DialogHeader>

          {/* Page body */}
          <div className="flex-1 min-h-0 overflow-y-auto px-8 py-10 flex flex-col items-center justify-center text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-lg font-semibold text-primary">
              {infoPage + 1}
            </span>
            <h3 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">
              {infoPages[infoPage]?.heading}
            </h3>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              {infoPages[infoPage]?.body}
            </p>
          </div>

          {/* Pagination footer */}
          <div className="shrink-0 flex items-center justify-between border-t px-6 py-4">
            <button
              type="button"
              onClick={() => setInfoPage((p) => Math.max(0, p - 1))}
              disabled={infoPage === 0}
              className={cn(
                "inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                infoPage === 0
                  ? "text-muted-foreground/40 cursor-not-allowed"
                  : "text-foreground hover:bg-muted"
              )}
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>

            {/* dots */}
            <div className="flex items-center gap-1.5">
              {infoPages.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Go to page ${i + 1}`}
                  onClick={() => setInfoPage(i)}
                  className={cn(
                    "h-2 rounded-full transition-all",
                    i === infoPage ? "w-5 bg-primary" : "w-2 bg-primary/25 hover:bg-primary/40"
                  )}
                />
              ))}
            </div>

            {infoPage < lastPage ? (
              <button
                type="button"
                onClick={() => setInfoPage((p) => Math.min(lastPage, p + 1))}
                className="inline-flex items-center gap-1 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setInfoMode(null)}
                className="inline-flex items-center gap-1 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
